import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { User } from "../models/User";

const { app } = createApp();
let owner: string;
let editor: string;
let viewer: string;
let outsider: string;

async function register(email: string): Promise<{ token: string; agent: ReturnType<typeof request.agent> }> {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({
    name: email.split("@")[0],
    email,
    password: "supersecret123",
  });
  const login = await agent.post("/api/auth/login").send({ email, password: "supersecret123" });
  return { token: login.body.data.accessToken ?? "", agent };
}

function auth(token: string): string {
  return `Bearer ${token}`;
}

async function createWorkspace(token: string, name: string): Promise<string> {
  const res = await request(app).post("/api/workspaces").set("Authorization", auth(token)).send({ name });
  return res.body.data.workspace.id;
}

async function createBoard(token: string, workspaceId: string, title: string): Promise<string> {
  const res = await request(app)
    .post("/api/boards")
    .set("Authorization", auth(token))
    .send({ workspaceId, title });
  return res.body.data.board.id;
}

let workspaceId: string;

beforeAll(async () => {
  await User.deleteMany({});
  const o = await register("owner@example.com");
  const e = await register("editor@example.com");
  const v = await register("viewer@example.com");
  const x = await register("outsider@example.com");
  owner = o.token;
  editor = e.token;
  viewer = v.token;
  outsider = x.token;

  workspaceId = await createWorkspace(owner, "Design Team");
});

describe("Workspaces", () => {
  it("owner can add members with roles", async () => {
    const editorUser = await User.findOne({ email: "editor@example.com" });
    const viewerUser = await User.findOne({ email: "viewer@example.com" });
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set("Authorization", auth(owner))
      .send({ userId: String(editorUser!._id), role: "editor" });
    expect(res.status).toBe(201);
    const res2 = await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set("Authorization", auth(owner))
      .send({ userId: String(viewerUser!._id), role: "viewer" });
    expect(res2.status).toBe(201);
  });

  it("non-members cannot read the workspace", async () => {
    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set("Authorization", auth(outsider));
    expect(res.status).toBe(404);
  });

  it("members can read the workspace", async () => {
    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}`)
      .set("Authorization", auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.data.workspace.memberCount).toBe(3);
  });
});

describe("Boards + RBAC", () => {
  let boardId: string;

  it("editor can create a board", async () => {
    boardId = await createBoard(editor, workspaceId, "Q3 Roadmap");
  });

  it("viewer cannot create a board", async () => {
    const res = await request(app)
      .post("/api/boards")
      .set("Authorization", auth(viewer))
      .send({ workspaceId, title: "Nope" });
    expect(res.status).toBe(403);
  });

  it("viewer and editor can read the board", async () => {
    const res = await request(app).get(`/api/boards/${boardId}`).set("Authorization", auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.data.board.title).toBe("Q3 Roadmap");
    expect(res.body.data.document.snapshotVersion).toBe(0);
  });

  it("viewer cannot update the board", async () => {
    const res = await request(app)
      .patch(`/api/boards/${boardId}`)
      .set("Authorization", auth(viewer))
      .send({ title: "Hacked" });
    expect(res.status).toBe(403);
  });

  it("editor can update the board title", async () => {
    const res = await request(app)
      .patch(`/api/boards/${boardId}`)
      .set("Authorization", auth(editor))
      .send({ title: "Q3 Roadmap (updated)" });
    expect(res.status).toBe(200);
    expect(res.body.data.board.title).toBe("Q3 Roadmap (updated)");
  });

  it("outsider gets 404 on the board", async () => {
    const res = await request(app).get(`/api/boards/${boardId}`).set("Authorization", auth(outsider));
    expect(res.status).toBe(404);
  });

  it("search finds a board by title", async () => {
    const res = await request(app)
      .get(`/api/boards?workspace=${workspaceId}&search=roadmap`)
      .set("Authorization", auth(editor));
    expect(res.status).toBe(200);
    expect(res.body.data.boards.length).toBe(1);
    expect(res.body.data.boards[0].id).toBe(boardId);
  });

  it("star/unstar and touch update board metadata", async () => {
    await request(app).post(`/api/boards/${boardId}/star`).set("Authorization", auth(editor));
    let res = await request(app).get(`/api/boards/${boardId}`).set("Authorization", auth(editor));
    expect(res.body.data.board.starred).toBe(true);

    await request(app).post(`/api/boards/${boardId}/touch`).set("Authorization", auth(editor));
    res = await request(app).get(`/api/boards/${boardId}`).set("Authorization", auth(editor));
    expect(res.body.data.board.lastOpenedAt).toBeTruthy();

    await request(app).delete(`/api/boards/${boardId}/star`).set("Authorization", auth(editor));
    res = await request(app).get(`/api/boards/${boardId}`).set("Authorization", auth(editor));
    expect(res.body.data.board.starred).toBe(false);
  });
});

describe("Notes", () => {
  let boardId: string;
  let noteId: string;

  it("editor creates a board and sticky note", async () => {
    boardId = await createBoard(editor, workspaceId, "Notes Board");
    const res = await request(app)
      .post(`/api/boards/${boardId}/notes`)
      .set("Authorization", auth(editor))
      .send({ kind: "sticky", content: "Idea: ship it", x: 100, y: 200, color: "#fef08a" });
    expect(res.status).toBe(201);
    noteId = res.body.data.note.id;
  });

  it("viewer can list but not edit notes", async () => {
    const list = await request(app).get(`/api/boards/${boardId}/notes`).set("Authorization", auth(viewer));
    expect(list.status).toBe(200);
    expect(list.body.data.notes.length).toBe(1);

    const edit = await request(app)
      .patch(`/api/boards/${boardId}/notes/${noteId}`)
      .set("Authorization", auth(viewer))
      .send({ content: "hacked" });
    expect(edit.status).toBe(403);
  });

  it("editor can update a note", async () => {
    const res = await request(app)
      .patch(`/api/boards/${boardId}/notes/${noteId}`)
      .set("Authorization", auth(editor))
      .send({ content: "Idea: ship it now", x: 150 });
    expect(res.status).toBe(200);
    expect(res.body.data.note.content).toBe("Idea: ship it now");
    expect(res.body.data.note.x).toBe(150);
  });
});

describe("Invitations", () => {
  it("owner invites an outsider by email, they accept and gain editor access", async () => {
    const invite = await request(app)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set("Authorization", auth(owner))
      .send({ email: "invitee@example.com", role: "editor" });
    expect(invite.status).toBe(201);
    const token = invite.body.data.invitation.token;

    const { token: inviteeToken } = await register("invitee@example.com");
    const accept = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set("Authorization", auth(inviteeToken));
    expect(accept.status).toBe(200);

    const me = await request(app).get("/api/auth/me").set("Authorization", auth(inviteeToken));
    const boardId = await createBoard(inviteeToken, workspaceId, "Invitee Board");
    expect(boardId).toBeTruthy();
  });

  it("cannot accept a revoked invitation", async () => {
    const invite = await request(app)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set("Authorization", auth(owner))
      .send({ email: "revoked@example.com", role: "viewer" });
    const token = invite.body.data.invitation.token;

    await request(app)
      .delete(`/api/workspaces/${workspaceId}/invitations/${invite.body.data.invitation.id}`)
      .set("Authorization", auth(owner));

    const { token: revokedUserToken } = await register("revoked@example.com");
    const accept = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set("Authorization", auth(revokedUserToken));
    expect(accept.status).toBe(400);
  });
});

describe("Public share links", () => {
  it("creates a view-only share link readable without auth, expires correctly", async () => {
    const boardId = await createBoard(editor, workspaceId, "Public Board");
    const share = await request(app)
      .post(`/api/boards/${boardId}/share`)
      .set("Authorization", auth(editor))
      .send({ expiresInDays: 1 });
    expect(share.status).toBe(201);
    const token = share.body.data.token;

    const pub = await request(app).get(`/api/boards/public/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.board.title).toBe("Public Board");

    // Short-expiry link
    const short = await request(app)
      .post(`/api/boards/${boardId}/share`)
      .set("Authorization", auth(editor))
      .send({ expiresInDays: -1 });
    expect(short.status).toBe(201);
    const expired = await request(app).get(`/api/boards/public/${short.body.data.token}`);
    expect(expired.status).toBe(404);
  });
});

describe("Version history", () => {
  it("lists and restores snapshots", async () => {
    const boardId = await createBoard(editor, workspaceId, "Versioned Board");
    // Simulate a snapshot being written (as the realtime layer would).
    const BoardOp = (await import("../models/BoardOp")).BoardOp;
    const Board = (await import("../models/Board")).Board;
    await BoardOp.create({
      board: boardId,
      user: (await User.findOne({ email: "editor@example.com" }))!._id,
      kind: "snapshot",
      version: 1,
      baseVersion: 0,
      payload: Buffer.from("binary-doc-state"),
    });
    await Board.updateOne({ _id: boardId }, { $set: { currentVersion: 1, lastSnapshotVersion: 1 } });

    const versions = await request(app)
      .get(`/api/boards/${boardId}/versions`)
      .set("Authorization", auth(viewer));
    expect(versions.status).toBe(200);
    expect(versions.body.data.versions.length).toBe(1);
    expect(versions.body.data.versions[0].version).toBe(1);

    const restore = await request(app)
      .post(`/api/boards/${boardId}/versions/1/restore`)
      .set("Authorization", auth(editor));
    expect(restore.status).toBe(200);
    expect(restore.body.data.version).toBe(2);
  });
});
