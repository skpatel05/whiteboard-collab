import type { ShapeType } from "../../lib/boardDoc";
import { STROKE_COLORS } from "./colors";

export type Tool = ShapeType | "select" | "pan";

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "select", label: "↖", title: "Select / move (V)" },
  { id: "pan", label: "✥", title: "Pan canvas (H)" },
  { id: "pen", label: "✎", title: "Freehand pen (P)" },
  { id: "rect", label: "▭", title: "Rectangle (R)" },
  { id: "ellipse", label: "◯", title: "Ellipse (O)" },
  { id: "line", label: "╱", title: "Line (L)" },
  { id: "arrow", label: "→", title: "Arrow (A)" },
  { id: "sticky", label: "▤", title: "Sticky note (S)" },
];

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  stroke: string;
  setStroke: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  canWrite: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
}

export default function Toolbar({
  tool,
  setTool,
  stroke,
  setStroke,
  strokeWidth,
  setStrokeWidth,
  canWrite,
  onUndo,
  onRedo,
  onDeleteSelected,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.title}
            disabled={!canWrite && t.id !== "select" && t.id !== "pan"}
            onClick={() => setTool(t.id)}
            className={`grid h-8 w-8 place-items-center rounded-md text-base transition-colors ${
              tool === t.id
                ? "bg-primary/10 text-primary ring-1 ring-primary/40"
                : "text-slate-600 hover:bg-slate-100"
            } ${!canWrite && t.id !== "select" && t.id !== "pan" ? "opacity-40" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <div className="flex items-center gap-1">
        {STROKE_COLORS.map((c) => (
          <button
            key={c}
            title="Stroke color"
            disabled={!canWrite}
            onClick={() => setStroke(c)}
            className={`h-5 w-5 rounded-full ring-offset-1 ${stroke === c ? "ring-2 ring-slate-500" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        Width
        <input
          type="range"
          min={1}
          max={12}
          value={strokeWidth}
          disabled={!canWrite}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-20 accent-primary"
        />
        <span className="w-4 text-slate-500">{strokeWidth}</span>
      </label>

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <button
        title="Undo (Ctrl+Z)"
        disabled={!canWrite}
        onClick={onUndo}
        className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40"
      >
        ↺
      </button>
      <button
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canWrite}
        onClick={onRedo}
        className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40"
      >
        ↻
      </button>
      <button
        title="Delete selection (Del)"
        disabled={!canWrite}
        onClick={onDeleteSelected}
        className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        🗑
      </button>
    </div>
  );
}
