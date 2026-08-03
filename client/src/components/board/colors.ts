export const STROKE_COLORS = ["#1e293b", "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

export const STICKY_COLORS = ["#fde68a", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa"];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
