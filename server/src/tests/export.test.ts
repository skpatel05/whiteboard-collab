import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { User } from "../models/User";

const { app } = createApp();
let token: string;
let workspaceId: string;
let boardId: string;

beforeAll(async () => {
  await User.deleteMany({});
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ name: "Exporter", email: "export@example.com", password: "supersecret123" });
  const login = await agent.post("/api/auth/login").send({ email: "export@example.com", password: "supersecret123" });
  token = login.body.data.accessToken;
  const ws = await request(app).post("/api/workspaces").set("Authorization", `Bearer ${token}`).send({ name: "Export WS" });
  workspaceId = ws.body.data.workspace.id;
  const board = await request(app).post("/api/boards").set("Authorization", `Bearer ${token}`).send({ workspaceId, title: "Sprint Review" });
  boardId = board.body.data.board.id;

  await request(app)
    .post(`/api/boards/${boardId}/notes`)
    .set("Authorization", `Bearer ${token}`)
    .send({ kind: "minutes", content: "Agenda reviewed.\nAction item: ship v2 dashboard\nOwner: Ankita - update docs\nTomorrow we should finalize the launch plan" });
});

describe("Board export", () => {
  it("generates a PDF meeting summary", async () => {
    const res = await request(app)
      .post(`/api/boards/${boardId}/export/pdf`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("-summary.pdf");
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(500);
  });

  it("rejects export without auth", async () => {
    const res = await request(app).post(`/api/boards/${boardId}/export/pdf`);
    expect(res.status).toBe(401);
  });
});

describe("Mock AI action items", () => {
  it("extracts action items from minutes", async () => {
    const res = await request(app)
      .post(`/api/boards/${boardId}/ai/action-items`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const items = res.body.data.actionItems as string[];
    expect(items).toContain("Action item: ship v2 dashboard");
    expect(items.some((i) => /update docs/i.test(i))).toBe(true);
    expect(res.body.data.generatedBy).toBe("mock-llm-service");
  });
});
