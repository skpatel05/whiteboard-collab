const isProd = process.env.NODE_ENV === "production";

type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = isProd ? "info" : "debug";

function log(level: Level, message: string, meta?: unknown): void {
  if (order[level] < order[minLevel]) return;
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta === undefined ? {} : { meta }),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: unknown) => log("debug", message, meta),
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta),
};
