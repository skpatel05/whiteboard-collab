import type { PresenceEntry } from "../../lib/socket";
import type { ViewPos } from "./CanvasStage";

interface PresenceLayerProps {
  entries: Record<string, PresenceEntry>;
  view: ViewPos;
  width: number;
  height: number;
  mySocketId: string | null;
}

export default function PresenceLayer({ entries, view, width, height, mySocketId }: PresenceLayerProps) {
  const list = Object.values(entries).filter((e) => e.socketId !== mySocketId);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ width, height }}>
      {list.map((entry) => {
        const left = entry.x + view.x;
        const top = entry.y + view.y;
        if (left < -30 || top < -30 || left > width + 30 || top > height + 30) return null;
        return (
          <div
            key={entry.socketId}
            className="absolute transition-transform duration-75"
            style={{ left, top, transform: "translate(-2px, -2px)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="drop-shadow">
              <path
                d="M5.7 2.6 20.9 10a1 1 0 0 1 .1 1.8l-5.8 2.3-2.3 5.8a1 1 0 0 1-1.8-.1L2.6 6.3a1 1 0 0 1 3.1-3.7z"
                fill={entry.avatarColor ?? "#6366f1"}
              />
            </svg>
            <span
              className="ml-2 inline-block -translate-y-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
              style={{ backgroundColor: entry.avatarColor ?? "#6366f1" }}
            >
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
