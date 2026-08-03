import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { User } from "../models/User";

// Capture verification links sent by the (mocked) mailer.
const { sentMails } = vi.hoisted(() => ({
  sentMails: [] as { to: string; subject: string; link: string }[],
}));

vi.mock("../services/email.service", () => ({
  sendMail: async (to: string, subject: string, html: string) => {
    const match = html.match(/href="([^"]+)"/);
    sentMails.push({ to, subject, link: match?.[1] ?? html });
  },
  verificationEmailHtml: (link: string) => `<a href="${link}">verify</a>`,
}));

const { app } = createApp();
const agent = request.agent(app);

const userInput = {
  name: "Test User",
  email: "test@example.com",
  password: "supersecret123",
};

function extractToken(link: string): string {
  const url = new URL(link);
  return url.searchParams.get("token") ?? "";
}

beforeAll(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  vi.restoreAllMocks();
});

describe("Auth", () => {
  describe("POST /api/auth/register", () => {
    it("creates a user, hashes the password and queues a verification email", async () => {
      const res = await agent.post("/api/auth/register").send(userInput);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(userInput.email);
      expect(res.body.data.user.emailVerified).toBe(false);
      expect(sentMails.length).toBeGreaterThan(0);
      expect(sentMails[0].to).toBe(userInput.email);

      const stored = await User.findOne({ email: userInput.email }).select("+passwordHash");
      expect(stored!.passwordHash).not.toBe(userInput.password);
    });

    it("rejects a duplicate email", async () => {
      const res = await request(app).post("/api/auth/register").send(userInput);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("rejects a short password", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "X", email: "x@example.com", password: "short" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/auth/verify-email", () => {
    it("verifies the user with a valid token", async () => {
      const link = sentMails[sentMails.length - 1].link;
      const res = await request(app).get("/api/auth/verify-email").query({ token: extractToken(link) });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe("Email verified");

      const stored = await User.findOne({ email: userInput.email });
      expect(stored!.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it("rejects an invalid token", async () => {
      const res = await request(app).get("/api/auth/verify-email").query({ token: "bogus" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns an access token and sets an httpOnly refresh cookie", async () => {
      const res = await agent.post("/api/auth/login").send({
        email: userInput.email,
        password: userInput.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
      const cookie = res.headers["set-cookie"]?.find((c: string) => c.startsWith("wb_refresh="));
      expect(cookie).toBeTruthy();
      expect(cookie).toContain("HttpOnly");
    });

    it("rejects wrong credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: userInput.email,
        password: "wrongpassword",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("rotates the refresh token and returns a fresh access token", async () => {
      const res = await agent.post("/api/auth/refresh");
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.user.email).toBe(userInput.email);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns the current user with a valid access token", async () => {
      const login = await agent.post("/api/auth/login").send({
        email: userInput.email,
        password: userInput.password,
      });
      const token = login.body.data.accessToken;
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(userInput.email);
    });

    it("rejects a missing token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the refresh cookie", async () => {
      const res = await agent.post("/api/auth/logout");
      expect(res.status).toBe(200);
      const cookie = res.headers["set-cookie"]?.find((c: string) => c.startsWith("wb_refresh="));
      const cleared = cookie?.includes("Max-Age=0") ?? false;
      const expired = cookie?.includes("Expires=Thu, 01 Jan 1970") ?? false;
      expect(cleared || expired).toBe(true);
    });
  });
});
