import { afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectRedis, redis } from "../lib/redis";
import { logger } from "../lib/logger";

let mongod: MongoMemoryServer;

// Start in-memory MongoDB BEFORE the app module graph is imported so that
// config/env picks up the memory-server URI.
const started = MongoMemoryServer.create()
  .then((instance) => {
    mongod = instance;
    process.env.MONGO_URI = instance.getUri();
    process.env.NODE_ENV = "test";
    return mongoose.connect(instance.getUri());
  })
  .then(() => connectRedis())
  .then(() => redis.flushdb())
  .catch((err) => {
    logger.error("Test setup failed", err);
    throw err;
  });

await started;

afterAll(async () => {
  await mongoose.disconnect();
  redis.disconnect();
  if (mongod) await mongod.stop();
});
