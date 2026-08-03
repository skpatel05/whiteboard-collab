import type { Server } from "socket.io";
import { logger } from "../lib/logger";

export type IOServer = Server;

export function initSocket(io: IOServer): void {
  io.on("connection", (socket) => {
    logger.info("Socket connected", { id: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", { id: socket.id, reason });
    });
  });
}
