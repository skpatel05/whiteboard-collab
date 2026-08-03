import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "./logger";

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected");
  });
  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error", err);
  });
  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  await mongoose.connect(env.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
