import { AddressInfo } from "net";
import request from "supertest";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { BoardOp } from "../models/BoardOp";
import { User } from "../models/User";

const { app, httpServer } = createApp();
let port: number;

let ownerToken: string;
let viewerToken: string;
let workspaceId: string;
let boardId: string;

function base64(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}
function fromBase64(s: string): Uint8Array {
  return Buffer.from(s, "base64");
}

async function register(email: string): Promise<string> {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ name: email.split("@")[0], email, password: "supersecret123" });
  const login = await agent.post("/api/auth/login").send({ email, password: "supersecret123" });
  return login.body.data.accessToken;
}

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      auth: { token },
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", (err) => reject(err));
  });
}

function waitFor<T>(client: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    client.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function joinBoard(client: ClientSocket, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("board:join", id, (res: { ok: boolean; error?: string }) => {
      if (res.ok) resolve();
      else reject(new Error(res.error ?? "join failed"));
    });
  });
}

/** Create a fresh Y.Doc whose shared "shapes" map is the source of truth. */
function makeShapesDoc(initial?: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  const shapes = doc.getMap<unknown>("shapes");
  if (initial) {
    for (const [k, v] of Object.entries(initial)) shapes.set(k, v);
  }
  return doc;
}

beforeAll(async () => {
  await User.deleteMany({});
  httpServer.listen(0);
  port = (httpServer.address() as AddressInfo).port;

  ownerToken = await register("rt-owner@example.com");
  viewerToken = await register("rt-viewer@example.com");

  const ws = await request(app)
    .post("/api/workspaces")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Realtime WS" });
  workspaceId = ws.body.data.workspace.id;

  const viewerUser = await User.findOne({ email: "rt-viewer@example.com" });
  await request(app)
    .post(`/api/workspaces/${workspaceId}/members`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ userId: String(viewerUser!._id), role: "viewer" });

  const board = await request(app)
    .post("/api/boards")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ workspaceId, title: "Live Board" });
  boardId = board.body.data.board.id;
});

afterAll(async () => {
  httpServer.close();
});

describe("Realtime sync (3 concurrent clients)", () => {
  it("converges on a single update sent by one client (no lost updates)", async () => {
    const a = await connect(ownerToken);
    const b = await connect(ownerToken);
    const c = await connect(ownerToken);

    try {
      await Promise.all([joinBoard(a, boardId), joinBoard(b, boardId), joinBoard(c, boardId)]);

      const bGotUpdate = waitFor<{ update: string }>(b, "board:update");
      const cGotUpdate = waitFor<{ update: string }>(c, "board:update");

      // Client A writes a shape.
      const docA = makeShapesDoc();
      docA.getMap<unknown>("shapes").set("rect1", { type: "rect", x: 10, y: 20, w: 100, h: 50, color: "#ef4444" });
      const update = Y.encodeStateAsUpdate(docA);
      a.emit("board:update", {
        boardId,
        update: base64(update),
        baseVersion: 0,
        clientId: 1001,
      });

      const [bMsg, cMsg] = await Promise.all([bGotUpdate, cGotUpdate]);

      const docB = makeShapesDoc();
      Y.applyUpdate(docB, fromBase64(bMsg.update));
      const docC = makeShapesDoc();
      Y.applyUpdate(docC, fromBase64(cMsg.update));

      expect(docB.getMap<unknown>("shapes").get("rect1")).toEqual({
        type: "rect",
        x: 10,
        y: 20,
        w: 100,
        h: 50,
        color: "#ef4444",
      });
      expect(docC.getMap<unknown>("shapes").get("rect1")).toEqual(
        docB.getMap<unknown>("shapes").get("rect1"),
      );
    } finally {
      a.disconnect();
      b.disconnect();
      c.disconnect();
    }
  });

  it("merges concurrent edits from two clients so both converge", async () => {
    const a = await connect(ownerToken);
    const b = await connect(ownerToken);

    try {
      await Promise.all([joinBoard(a, boardId), joinBoard(b, boardId)]);

      const bGot = waitFor<{ update: string }>(b, "board:update");
      const aGot = waitFor<{ update: string }>(a, "board:update");

      const docA = makeShapesDoc();
      const docB = makeShapesDoc();
      docA.getMap<unknown>("shapes").set("fromA", { shape: "circle" });
      docB.getMap<unknown>("shapes").set("fromB", { shape: "square" });
      const updateA = Y.encodeStateAsUpdate(docA);
      const updateB = Y.encodeStateAsUpdate(docB);

      a.emit("board:update", { boardId, update: base64(updateA), baseVersion: 0, clientId: 1 });
      b.emit("board:update", { boardId, update: base64(updateB), baseVersion: 0, clientId: 2 });

      const [aReceived, bReceived] = await Promise.all([aGot, bGot]);

      Y.applyUpdate(docA, fromBase64(aReceived.update));
      Y.applyUpdate(docB, fromBase64(bReceived.update));

      expect(docA.getMap<unknown>("shapes").get("fromA")).toBeTruthy();
      expect(docA.getMap<unknown>("shapes").get("fromB")).toBeTruthy();
      expect(docB.getMap<unknown>("shapes").get("fromA")).toBeTruthy();
      expect(docB.getMap<unknown>("shapes").get("fromB")).toBeTruthy();

      // Both docs must be byte-identical after convergence.
      expect(Buffer.from(Y.encodeStateAsUpdate(docA))).toEqual(Buffer.from(Y.encodeStateAsUpdate(docB)));
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });

  it("persists ops and increments the board version", async () => {
    const opCount = await BoardOp.countDocuments({ board: boardId, kind: "op" });
    expect(opCount).toBeGreaterThan(0);

    const board = await request(app).get(`/api/boards/${boardId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(board.body.data.board.currentVersion).toBeGreaterThan(0);
  });

  it("rejects writes from a viewer on the socket", async () => {
    const viewer = await connect(viewerToken);
    try {
      await joinBoard(viewer, boardId);

      const errPromise = waitFor<{ code: string }>(viewer, "board:error");
      const doc = makeShapesDoc();
      doc.getMap<unknown>("shapes").set("hack", { x: 1 });
      viewer.emit("board:update", {
        boardId,
        update: base64(Y.encodeStateAsUpdate(doc)),
        baseVersion: 0,
        clientId: 999,
      });

      const err = await errPromise;
      expect(err.code).toBe("FORBIDDEN");
    } finally {
      viewer.disconnect();
    }
  });
});

describe("Presence", () => {
  it("broadcasts cursor moves and removes entries on disconnect", async () => {
    const a = await connect(ownerToken);
    const b = await connect(ownerToken);

    try {
      await Promise.all([joinBoard(a, boardId), joinBoard(b, boardId)]);

      const presencePromise = waitFor<{ presence: Array<{ socketId: string; x: number; y: number }> }>(
        a,
        "presence:update",
      );
      b.emit("cursor:move", { boardId, x: 320, y: 480 });
      const presence = await presencePromise;
      const entry = presence.presence.find((p) => p.socketId === b.id);
      expect(entry).toBeTruthy();
      expect(entry!.x).toBe(320);
      expect(entry!.y).toBe(480);

      // On disconnect, the remaining client gets a presence update without B.
      const removedPromise = waitFor<{ presence: Array<{ socketId: string }> }>(a, "presence:update");
      b.disconnect();
      const removed = await removedPromise;
      expect(removed.presence.some((p) => p.socketId === b.id)).toBe(false);
    } finally {
      a.disconnect();
    }
  });

  it("carries the user's avatar color on presence entries", async () => {
    const owner = await User.findOne({ email: "rt-owner@example.com" });
    const a = await connect(ownerToken);
    try {
      await joinBoard(a, boardId);

      const presencePromise = waitFor<{ presence: Array<{ socketId: string; avatarColor?: string }> }>(
        a,
        "presence:update",
      );
      a.emit("presence:request", boardId);
      const { presence } = await presencePromise;
      const own = presence.find((p) => p.socketId === a.id);
      expect(own).toBeTruthy();
      expect(own!.avatarColor).toBe(owner!.avatarColor);
    } finally {
      a.disconnect();
    }
  });

  it("keeps every cursor visible when one user moves (full snapshot broadcast)", async () => {
    const a = await connect(ownerToken);
    const b = await connect(ownerToken);
    try {
      await Promise.all([joinBoard(a, boardId), joinBoard(b, boardId)]);

      const presencePromise = waitFor<{ presence: Array<{ socketId: string; x: number }> }>(a, "presence:update");
      b.emit("cursor:move", { boardId, x: 100, y: 200 });
      const { presence } = await presencePromise;

      // B's updated cursor is present…
      expect(presence.some((p) => p.socketId === b.id && p.x === 100)).toBe(true);
      // …and A's own entry was NOT clobbered by B's move.
      expect(presence.some((p) => p.socketId === a.id)).toBe(true);
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });
});

describe("Public share links (realtime)", () => {
  let shareToken: string;

  beforeAll(async () => {
    const share = await request(app)
      .post(`/api/boards/${boardId}/share`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ expiresInDays: 7 });
    shareToken = share.body.data.token;
  });

  it("lets a guest join via share token with editor role and write live", async () => {
    const guest = await connect(shareToken);
    try {
      const statePromise = waitFor<{ role: string; myUserId: string }>(guest, "board:state");
      await joinBoard(guest, boardId);
      const state = await statePromise;
      expect(state.role).toBe("editor");

      const ack = new Promise<{ ok: boolean }>((resolve) => {
        const doc = makeShapesDoc();
        doc.getMap<unknown>("shapes").set("guestShape", { type: "rect", x: 5, y: 5, w: 50, h: 50 });
        guest.emit(
          "board:update",
          { boardId, update: base64(Y.encodeStateAsUpdate(doc)), baseVersion: 0, clientId: 42 },
          (res: { ok: boolean }) => resolve(res),
        );
      });
      expect((await ack).ok).toBe(true);
    } finally {
      guest.disconnect();
    }
  });

  it("broadcasts a guest's edit to an authenticated member in realtime", async () => {
    const owner = await connect(ownerToken);
    const guest = await connect(shareToken);
    try {
      await Promise.all([joinBoard(owner, boardId), joinBoard(guest, boardId)]);

      const ownerGot = waitFor<{ update: string }>(owner, "board:update");
      const doc = makeShapesDoc();
      doc.getMap<unknown>("shapes").set("fromGuest", { shape: "rect" });
      guest.emit("board:update", {
        boardId,
        update: base64(Y.encodeStateAsUpdate(doc)),
        baseVersion: 0,
        clientId: 5,
      });

      const msg = await ownerGot;
      const ownerDoc = makeShapesDoc();
      Y.applyUpdate(ownerDoc, fromBase64(msg.update));
      expect(ownerDoc.getMap<unknown>("shapes").get("fromGuest")).toEqual({ shape: "rect" });
    } finally {
      owner.disconnect();
      guest.disconnect();
    }
  });

  it("rejects an invalid share token at the handshake", async () => {
    await expect(connect("deadbeef00000000000000000000000000000000")).rejects.toThrow();
  });

  it("prevents a guest from joining a board other than its share link", async () => {
    const other = await request(app)
      .post("/api/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ workspaceId, title: "Other Board" });
    const otherBoardId = other.body.data.board.id;

    const guest = await connect(shareToken);
    try {
      const errPromise = waitFor<{ code: string }>(guest, "board:error");
      await joinBoard(guest, otherBoardId).catch(() => undefined);
      const err = await errPromise;
      expect(err.code).toBe("NOT_FOUND");
    } finally {
      guest.disconnect();
    }
  });
});

describe("Reconnect", () => {
  it("a reconnecting client receives full state it missed while offline", async () => {
    const a = await connect(ownerToken);
    const b = await connect(ownerToken);
    await Promise.all([joinBoard(a, boardId), joinBoard(b, boardId)]);

    const doc = makeShapesDoc();
    doc.getMap<unknown>("shapes").set("offlineShape", { id: 42 });
    a.emit("board:update", { boardId, update: base64(Y.encodeStateAsUpdate(doc)), baseVersion: 0, clientId: 7 });
    // Give the update a moment to persist, then drop B.
    await new Promise((r) => setTimeout(r, 200));
    b.disconnect();
    a.disconnect();

    // A new client (reconnected B) joins and must receive the full state.
    const c = await connect(ownerToken);
    try {
      const statePromise = waitFor<{ snapshot: string; version: number }>(c, "board:state");
      await joinBoard(c, boardId);
      const state = await statePromise;
      expect(state.version).toBeGreaterThan(0);

      const docC = makeShapesDoc();
      Y.applyUpdate(docC, fromBase64(state.snapshot));
      expect(docC.getMap<unknown>("shapes").get("offlineShape")).toEqual({ id: 42 });
    } finally {
      c.disconnect();
    }
  });
});
