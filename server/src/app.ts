import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { initSocket } from "./socket";
import authRoutes from "./routes/auth.routes";
import { sendSuccess } from "./utils/response";

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    sendSuccess(res, { status: "ok", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });
  initSocket(io);

  return { app, httpServer, io };
}
