import * as Y from "yjs";

export type ShapeType = "pen" | "rect" | "ellipse" | "line" | "arrow" | "sticky";

export interface Shape {
  id: string;
  type: ShapeType;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  text?: string;
  color?: string;
  userId?: string;
  createdAt?: number;
}

const REMOTE = "remote";

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Wraps a board's Y.Doc: shapes (Y.Map) and meeting minutes (Y.Text).
 * All mutations go through this class so the doc's update stream is the single
 * source of truth for outbound sync.
 */
export class BoardDoc {
  readonly doc: Y.Doc;
  readonly shapes: Y.Map<Shape>;
  readonly minutes: Y.Text;
  readonly undoManager: Y.UndoManager;

  constructor() {
    this.doc = new Y.Doc();
    this.shapes = this.doc.getMap<Shape>("shapes");
    this.minutes = this.doc.getText("minutes");
    this.undoManager = new Y.UndoManager([this.shapes, this.minutes]);
  }

  applySnapshot(base64: string): void {
    if (base64) Y.applyUpdate(this.doc, fromBase64(base64), REMOTE);
  }

  applyOp(base64: string): void {
    Y.applyUpdate(this.doc, fromBase64(base64), REMOTE);
  }

  addShape(shape: Shape): void {
    this.shapes.set(shape.id, shape);
  }

  patchShape(id: string, patch: Partial<Shape>): void {
    const current = this.shapes.get(id);
    if (!current) return;
    this.shapes.set(id, { ...current, ...patch });
  }

  removeShape(id: string): void {
    this.shapes.delete(id);
  }

  getShapes(): Shape[] {
    return Array.from(this.shapes.entries()).map(([, shape]) => shape);
  }

  setMinutes(text: string): void {
    const current = this.minutes.toString();
    if (current === text) return;
    let prefix = 0;
    while (prefix < current.length && prefix < text.length && current[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < current.length - prefix &&
      suffix < text.length - prefix &&
      current[current.length - 1 - suffix] === text[text.length - 1 - suffix]
    ) {
      suffix++;
    }
    const delFrom = prefix;
    const delCount = current.length - prefix - suffix;
    if (delCount > 0) this.minutes.delete(delFrom, delCount);
    const insert = text.slice(prefix, text.length - suffix);
    if (insert.length > 0) this.minutes.insert(delFrom, insert);
  }

  /** Observe changes to the shapes map. Returns an unsubscribe fn. */
  observeShapes(onChange: (shapes: Shape[]) => void): () => void {
    const handler = () => onChange(this.getShapes());
    this.shapes.observe(handler);
    handler();
    return () => this.shapes.unobserve(handler);
  }

  observeMinutes(onChange: (text: string) => void): () => void {
    const handler = () => onChange(this.minutes.toString());
    this.minutes.observe(handler);
    handler();
    return () => this.minutes.unobserve(handler);
  }

  /**
   * Observe outbound updates (any update not originating from a remote apply).
   * Returns an unsubscribe fn.
   */
  observeOutbound(onUpdate: (update: Uint8Array) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) onUpdate(update);
    };
    this.doc.on("update", handler);
    return () => this.doc.off("update", handler);
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  destroy(): void {
    this.doc.destroy();
  }
}
