import { afterAll } from "vitest";
import mongoose from "mongoose";
import { connectRedis, redis } from "../lib/redis";
import { logger } from "../lib/logger";

/**
 * Tests run against a real local MongoDB (e.g. the `mongo` service in
 * docker-compose), NOT mongodb-memory-server, so the same stack an interviewer
 * would run (`docker compose up` → mongo + server + client) is exercised.
 *
 * A dedicated `whiteboard_test` database is used and dropped on every run —
 * dev data in `whiteboard` is never touched. Override with MONGO_URI_TEST.
 */
const TEST_MONGO_URI = process.env.MONGO_URI_TEST ?? "mongodb://localhost:27017/whiteboard_test";

const started = (async () => {
  process.env.NODE_ENV = "test";
  await mongoose.connect(TEST_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await connectRedis();
  await redis.flushdb();
})().catch((err) => {
  logger.error("Test setup failed", err);
  throw err;
});

await started;

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  redis.disconnect();
});
