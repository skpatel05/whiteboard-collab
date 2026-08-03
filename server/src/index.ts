import { env } from "./config/env";
import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./lib/database";
import { connectRedis, redis } from "./lib/redis";
import { logger } from "./lib/logger";

async function main(): Promise<void> {
  await connectDatabase();
  await connectRedis();

  const { httpServer } = createApp();

  httpServer.listen(env.port, () => {
    logger.info(`Server listening on http://localhost:${env.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    httpServer.close();
    await disconnectDatabase();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error during startup", err);
  process.exit(1);
});
