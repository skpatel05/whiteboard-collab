import { useMemo, useRef, useState } from "react";
import { Ellipse, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { Shape } from "../../lib/boardDoc";
import { STICKY_COLORS } from "./colors";
import type { Tool } from "./Toolbar";

export interface ViewPos {
  x: number;
  y: number;
}

interface CanvasStageProps {
  shapes: Shape[];
  view: ViewPos;
  tool: Tool;
  stroke: string;
  strokeWidth: number;
  canWrite: boolean;
  selectedId: string | null;
  width: number;
  height: number;
  onViewChange: (view: ViewPos) => void;
  onSelect: (id: string | null) => void;
  onAddShape: (shape: Shape) => void;
  onPatchShape: (id: string, patch: Partial<Shape>) => void;
  onCursorMove: (x: number, y: number) => void;
}

type Draft =
  | { kind: "box"; boxKind: "rect" | "ellipse" | "sticky"; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: "line"; shapeKind: "pen" | "line" | "arrow"; points: number[] };

function arrowHead(fromX: number, fromY: number, toX: number, toY: number, size = 12): number[] {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const spread = 0.65;
  return [
    toX + size * Math.cos(angle + Math.PI - spread),
    toY + size * Math.sin(angle + Math.PI - spread),
    toX + size * Math.cos(angle + Math.PI + spread),
    toY + size * Math.sin(angle + Math.PI + spread),
  ];
}

function shapeBounds(s: Shape): { x: number; y: number; w: number; h: number } | null {
  if (s.type === "rect" || s.type === "sticky") {
    return { x: s.x ?? 0, y: s.y ?? 0, w: s.width ?? 0, h: s.height ?? 0 };
  }
  if (s.type === "ellipse") {
    return { x: (s.x ?? 0) - (s.width ?? 0) / 2, y: (s.y ?? 0) - (s.height ?? 0) / 2, w: s.width ?? 0, h: s.height ?? 0 };
  }
  if (s.points && s.points.length >= 2) {
    const xs = s.points.filter((_, i) => i % 2 === 0);
    const ys = s.points.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX - 6, y: minY - 6, w: Math.max(...xs) - minX + 12, h: Math.max(...ys) - minY + 12 };
  }
  return null;
}

export default function CanvasStage({
  shapes,
  view,
  tool,
  stroke,
  strokeWidth,
  canWrite,
  selectedId,
  width,
  height,
  onViewChange,
  onSelect,
  onAddShape,
  onPatchShape,
  onCursorMove,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; x: number; y: number; w: number; h: number } | null>(
    null,
  );

  const dragRef = useRef<{ startView: ViewPos; startPointer: { x: number; y: number } } | null>(null);

  const worldPos = (): { x: number; y: number } => {
    const pos = stageRef.current?.getPointerPosition();
    return { x: (pos?.x ?? 0) - view.x, y: (pos?.y ?? 0) - view.y };
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    onCursorMove(worldPos().x, worldPos().y);
    if (tool === "select") {
      const target = e.target as Konva.Node;
      if (target.id() !== "background") return;
      onSelect(null);
      return;
    }
    if (tool === "pan") {
      const pos = e.target.getStage()?.getPointerPosition();
      dragRef.current = { startView: view, startPointer: { x: pos?.x ?? 0, y: pos?.y ?? 0 } };
      return;
    }
    if (!canWrite) return;
    const w = worldPos();
    if (tool === "sticky") {
      const size = 180;
      const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      const color = STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
      onAddShape({
        id,
        type: "sticky",
        x: w.x - size / 2,
        y: w.y - size / 2,
        width: size,
        height: size,
        color,
        text: "",
      });
      onSelect(id);
      return;
    }
    if (tool === "pen" || tool === "line" || tool === "arrow") {
      setDraft({ kind: "line", shapeKind: tool, points: [w.x, w.y, w.x, w.y] });
    } else {
      setDraft({ kind: "box", boxKind: tool as "rect" | "ellipse", start: w, current: w });
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const w = worldPos();
    onCursorMove(w.x, w.y);

    if (dragRef.current) {
      const pos = e.target.getStage()?.getPointerPosition();
      const dx = (pos?.x ?? 0) - dragRef.current.startPointer.x;
      const dy = (pos?.y ?? 0) - dragRef.current.startPointer.y;
      onViewChange({ x: dragRef.current.startView.x + dx, y: dragRef.current.startView.y + dy });
      return;
    }

    if (!draft) return;
    if (draft.kind === "line") {
      const points =
        draft.shapeKind === "pen"
          ? [...draft.points, w.x, w.y]
          : [draft.points[0], draft.points[1], w.x, w.y];
      setDraft({ ...draft, points });
    } else {
      setDraft({ ...draft, current: w });
    }
  };

  const onMouseUp = () => {
    dragRef.current = null;
    if (!draft) return;
    const d = draft;
    setDraft(null);

    if (d.kind === "line") {
      const [x1, y1, x2, y2] = d.points;
      if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 3) return;
      const id = `${d.shapeKind[0]}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      onAddShape({
        id,
        type: d.shapeKind,
        points: d.points,
        stroke,
        strokeWidth,
        userId: undefined,
        createdAt: Date.now(),
      });
      onSelect(id);
      return;
    }

    const { start, current } = d;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    if (w < 3 || h < 3) return;
    const id = `${d.boxKind[0]}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    onAddShape({
      id,
      type: d.boxKind,
      x,
      y,
      width: w,
      height: h,
      stroke,
      strokeWidth,
      fill: "transparent",
      createdAt: Date.now(),
    });
    onSelect(id);
  };

  const onShapeDragEnd = (id: string) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    onPatchShape(id, { x: e.target.x(), y: e.target.y() });
  };

  const onShapeDblClick = (id: string, s: Shape) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canWrite) return;
    const pos = e.target.getStage()?.getPointerPosition();
    const w = worldPos();
    const screenX = s.type === "ellipse" ? (s.x ?? 0) - (s.width ?? 0) / 2 : s.x ?? 0;
    const screenY = s.type === "ellipse" ? (s.y ?? 0) - (s.height ?? 0) / 2 : s.y ?? 0;
    void pos;
    void w;
    setEditing({
      id,
      text: s.text ?? "",
      x: screenX + view.x,
      y: screenY + view.y,
      w: s.type === "ellipse" ? (s.width ?? 100) : (s.width ?? 180),
      h: s.type === "ellipse" ? (s.height ?? 40) : (s.height ?? 160),
    });
  };

  const saveEditing = () => {
    if (editing) {
      onPatchShape(editing.id, { text: editing.text });
    }
    setEditing(null);
  };

  const draftPreview = useMemo(() => buildPreview(draft, stroke, strokeWidth), [draft, stroke, strokeWidth]);

  return (
    <>
      <Stage ref={stageRef} width={width} height={height}>
        <Layer>
          <Rect
            id="background"
            x={0}
            y={0}
            width={width}
            height={height}
            fill="#f8fafc"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => dragRef.current && onMouseUp()}
          />
        </Layer>

        <Layer x={view.x} y={view.y}>
          {shapes.map((s) => {
            const selected = s.id === selectedId;
            const common = {
              id: s.id,
              listening: tool === "select",
              stroke: selected ? "#6366f1" : s.stroke,
              strokeWidth: selected ? Math.max(s.strokeWidth ?? 2, 2.5) : s.strokeWidth,
              onMouseDown: () => onSelect(s.id),
              onDblClick: onShapeDblClick(s.id, s),
            };
            if (s.type === "rect") {
              return (
                <Rect
                  key={s.id}
                  {...common}
                  x={s.x}
                  y={s.y}
                  width={s.width}
                  height={s.height}
                  fill={s.fill ?? "transparent"}
                  draggable={tool === "select" && canWrite}
                  onDragEnd={onShapeDragEnd(s.id)}
                />
              );
            }
            if (s.type === "ellipse") {
              return (
                <Ellipse
                  key={s.id}
                  {...common}
                  x={s.x}
                  y={s.y}
                  radiusX={(s.width ?? 0) / 2}
                  radiusY={(s.height ?? 0) / 2}
                  fill={s.fill ?? "transparent"}
                  draggable={tool === "select" && canWrite}
                  onDragEnd={onShapeDragEnd(s.id)}
                />
              );
            }
            if (s.type === "sticky") {
              return (
                <GroupSticky
                  key={s.id}
                  s={s}
                  selected={selected}
                  listening={tool === "select"}
                  onDragEnd={onShapeDragEnd(s.id)}
                  draggable={tool === "select" && canWrite}
                  onMouseDown={() => onSelect(s.id)}
                  onDblClick={onShapeDblClick(s.id, s)}
                />
              );
            }
            const points = s.points ?? [];
            if (s.type === "arrow" && points.length >= 4) {
              const [x1, y1] = points;
              const [x2, y2] = [points[points.length - 2], points[points.length - 1]];
              const head = arrowHead(x1, y1, x2, y2);
              return (
                <>
                  <Line
                    id={s.id}
                    points={points}
                    stroke={s.stroke}
                    strokeWidth={s.strokeWidth}
                    lineCap="round"
                    onMouseDown={() => onSelect(s.id)}
                    onDblClick={onShapeDblClick(s.id, s)}
                  />
                  <Line
                    id={`${s.id}-head`}
                    points={head}
                    closed
                    fill={selected ? "#6366f1" : s.stroke}
                    stroke={selected ? "#6366f1" : s.stroke}
                    strokeWidth={1}
                    onMouseDown={() => onSelect(s.id)}
                  />
                </>
              );
            }
            return (
              <Line
                key={s.id}
                id={s.id}
                points={points}
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                lineCap={s.type === "pen" ? "round" : undefined}
                lineJoin={s.type === "pen" ? "round" : undefined}
                onMouseDown={() => onSelect(s.id)}
                onDblClick={onShapeDblClick(s.id, s)}
              />
            );
          })}

          {selectedId && shapes.find((s) => s.id === selectedId) && (
            <SelectionOutline shape={shapes.find((s) => s.id === selectedId)!} />
          )}

          {draft && draftPreview && (
            <DraftShape preview={draftPreview} />
          )}
        </Layer>
      </Stage>

      {editing && (
        <div
          className="absolute z-10 rounded-md border-2 border-primary shadow-lg"
          style={{ left: editing.x, top: editing.y, width: editing.w, height: editing.h }}
        >
          <textarea
            autoFocus
            value={editing.text}
            onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
            onBlur={saveEditing}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) saveEditing();
            }}
            className="h-full w-full resize-none rounded-md bg-white/95 p-2 text-sm outline-none"
          />
        </div>
      )}
    </>
  );
}

function GroupSticky({
  s,
  selected,
  draggable,
  onDragEnd,
  onMouseDown,
  onDblClick,
  listening,
}: {
  s: Shape;
  selected: boolean;
  draggable: boolean;
  onDragEnd: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseDown: () => void;
  onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  listening: boolean;
}) {
  return (
    <>
      <Rect
        x={s.x}
        y={s.y}
        width={s.width}
        height={s.height}
        fill={s.color ?? "#fde68a"}
        shadowColor="rgba(0,0,0,0.15)"
        shadowBlur={6}
        shadowOffsetY={3}
        cornerRadius={4}
        stroke={selected ? "#6366f1" : undefined}
        strokeWidth={selected ? 2.5 : 0}
        draggable={draggable}
        listening={listening}
        onDragEnd={onDragEnd}
        onMouseDown={onMouseDown}
        onDblClick={onDblClick}
      />
      <Text
        x={(s.x ?? 0) + 8}
        y={(s.y ?? 0) + 6}
        width={(s.width ?? 180) - 16}
        height={(s.height ?? 160) - 12}
        text={s.text || "Double-click to edit"}
        fontSize={14}
        fontStyle={s.text ? "normal" : "italic"}
        fill={s.text ? "#1e293b" : "#94a3b8"}
        verticalAlign="top"
        wrap="word"
      />
    </>
  );
}

function SelectionOutline({ shape }: { shape: Shape }) {
  const bounds = shapeBounds(shape);
  if (!bounds) return null;
  return (
    <Rect
      x={bounds.x}
      y={bounds.y}
      width={bounds.w}
      height={bounds.h}
      stroke="#6366f1"
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}

function DraftShape({ preview }: { preview: NonNullable<ReturnType<typeof buildPreview>> }) {
  if (preview.kind === "line") {
    return <Line points={preview.points} stroke={preview.stroke} strokeWidth={preview.strokeWidth} lineCap="round" listening={false} />;
  }
  if (preview.kind === "arrow") {
    return (
      <>
        <Line points={preview.linePoints} stroke={preview.stroke} strokeWidth={preview.strokeWidth} lineCap="round" listening={false} />
        <Line points={preview.head} closed fill={preview.stroke} stroke={preview.stroke} strokeWidth={1} listening={false} />
      </>
    );
  }
  if (preview.boxKind === "rect") {
    return <Rect x={preview.x} y={preview.y} width={preview.w} height={preview.h} stroke={preview.stroke} strokeWidth={2} listening={false} />;
  }
  return (
    <Ellipse
      x={preview.x + preview.w / 2}
      y={preview.y + preview.h / 2}
      radiusX={preview.w / 2}
      radiusY={preview.h / 2}
      stroke={preview.stroke}
      strokeWidth={2}
      listening={false}
    />
  );
}

function buildPreview(
  draft: Draft | null,
  stroke: string,
  strokeWidth: number,
): { kind: "arrow"; linePoints: number[]; head: number[]; stroke: string; strokeWidth: number } | { kind: "line"; points: number[]; stroke: string; strokeWidth: number } | { kind: "box"; boxKind: "rect" | "ellipse" | "sticky"; x: number; y: number; w: number; h: number; stroke: string } | null {
  if (!draft) return null;
  if (draft.kind === "line") {
    if (draft.shapeKind === "arrow") {
      const [x1, y1, x2, y2] = draft.points;
      const head = arrowHead(x1, y1, x2, y2);
      return { kind: "arrow", linePoints: draft.points, head, stroke, strokeWidth };
    }
    return { kind: "line", points: draft.points, stroke, strokeWidth };
  }
  const x = Math.min(draft.start.x, draft.current.x);
  const y = Math.min(draft.start.y, draft.current.y);
  return {
    kind: "box",
    boxKind: draft.boxKind,
    x,
    y,
    w: Math.abs(draft.current.x - draft.start.x),
    h: Math.abs(draft.current.y - draft.start.y),
    stroke,
  };
}
