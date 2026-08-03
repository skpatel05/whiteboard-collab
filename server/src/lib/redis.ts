import { EventEmitter } from "events";
import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Minimal Redis-like interface the app depends on. Both the real ioredis client
 * and the in-memory fallback satisfy it, so the platform runs with just
 * MongoDB (no Redis container) — refresh-token rotation and pub/sub fan-out
 * degrade gracefully to single-process behavior.
 */
export interface RedisLike {
  connect(): Promise<unknown>;
  disconnect(): void;
  duplicate(): RedisLike;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<number>;
  flushdb(): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  psubscribe(...patterns: string[]): Promise<unknown>;
  on(event: string, handler: (...args: any[]) => void): void;
}

const memoryEvents = new EventEmitter();
memoryEvents.setMaxListeners(0);

/** In-process Redis stand-in: an expiring key/value store + shared pub/sub bus. */
class MemoryRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private patterns: string[] = [];
  private handlers: Array<(pattern: string, channel: string, message: string) => void> = [];
  private attached = false;

  connect(): Promise<unknown> {
    return Promise.resolve("OK");
  }

  disconnect(): void {}

  duplicate(): RedisLike {
    return new MemoryRedis();
  }

  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown> {
    const expiresAt = mode === "EX" && typeof ttl === "number" ? Date.now() + ttl * 1000 : Infinity;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return Promise.resolve(null);
    if (item.expiresAt < Date.now()) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(item.value);
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  exists(key: string): Promise<number> {
    const item = this.store.get(key);
    if (item && item.expiresAt >= Date.now()) return Promise.resolve(1);
    return Promise.resolve(0);
  }

  flushdb(): Promise<unknown> {
    this.store.clear();
    return Promise.resolve("OK");
  }

  publish(channel: string, message: string): Promise<number> {
    memoryEvents.emit("message", "", channel, message);
    return Promise.resolve(0);
  }

  psubscribe(...patterns: string[]): Promise<unknown> {
    this.patterns.push(...patterns);
    this.attach();
    return Promise.resolve();
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (event === "pmessage") {
      this.handlers.push(handler as (pattern: string, channel: string, message: string) => void);
      this.attach();
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    memoryEvents.on("message", (pattern: string, channel: string, message: string) => {
      if (!this.matches(channel)) return;
      for (const handler of this.handlers) handler(pattern, channel, message);
    });
  }

  private matches(channel: string): boolean {
    for (const p of this.patterns) {
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      if (new RegExp(`^${escaped}$`).test(channel)) return true;
    }
    return false;
  }
}

const usingMemoryFallback = !env.redisUrl || env.redisUrl.trim() === "";

let redis: RedisLike;
let redisSub: RedisLike;

if (usingMemoryFallback) {
  const mem = new MemoryRedis();
  redis = mem;
  redisSub = mem.duplicate();
  logger.warn("REDIS_URL not set — using in-memory fallback (single-process only)");
} else {
  const client = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: true,
  });
  client.on("connect", () => logger.info("Redis connected"));
  client.on("error", (err) => logger.error("Redis error", (err as Error).message));
  redis = client as unknown as RedisLike;
  redisSub = client.duplicate() as unknown as RedisLike;
  redisSub.on("error", (err) => logger.error("Redis subscriber error", (err as Error).message));
}

export async function connectRedis(): Promise<void> {
  if (usingMemoryFallback) return;
  await redis.connect();
}

export { redis, redisSub, usingMemoryFallback };
