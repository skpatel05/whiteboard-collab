import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: true,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error("Redis error", err.message));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

// Dedicated subscriber client (pub/sub pattern requires a separate connection)
export const redisSub = redis.duplicate();
redisSub.on("error", (err) => logger.error("Redis subscriber error", err.message));
