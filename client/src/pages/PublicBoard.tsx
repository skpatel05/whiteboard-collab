import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { apiErrorMessage } from "../lib/api";
import { WhiteboardSocket } from "../lib/socket";
import { usePresenceStore } from "../store/presence";
import { BoardDoc } from "../lib/boardDoc";
import type { Shape } from "../lib/boardDoc";
import Toolbar from "../components/board/Toolbar";
import type { Tool } from "../components/board/Toolbar";
import CanvasStage from "../components/board/CanvasStage";
import PresenceLayer from "../components/board/PresenceLayer";
import NotesPanel from "../components/board/NotesPanel";

interface PublicBoardPayload {
  data: {
    board: { id: string; title: string };
    document: { snapshot: string | null; ops: { payload: string }[] };
  };
}

export default function PublicBoard() {
  const { token } = useParams<{ token: string }>();
  const presenceEntries = usePresenceStore((s) => s.entries);

  const docRef = useRef<BoardDoc | null>(null);
  const sockRef = useRef<WhiteboardSocket | null>(null);
  const boardIdRef = useRef<string | null>(null);
  const lastVersionRef = useRef(0);
  const cursorSentAtRef = useRef(0);
  const rejoiningRef = useRef(false);
  const mySocketIdRef = useRef<string | null>(null);

  const [title, setTitle] = useState("");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [minutes, setMinutes] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [stroke, setStroke] = useState("#1e293b");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const doc = new BoardDoc();
    docRef.current = doc;
    const sock = new WhiteboardSocket();
    sockRef.current = sock;
    sock.connect(token);

    const unsubShapes = doc.observeShapes(setShapes);
    const unsubMinutes = doc.observeMinutes(setMinutes);

    const unsubOutbound = doc.observeOutbound((update) => {
      const boardId = boardIdRef.current;
      if (!boardId) return;
      void (async () => {
        try {
          const v = await sock.sendUpdate(boardId, update, lastVersionRef.current, doc.doc.clientID);
          lastVersionRef.current = v;
        } catch {
          setError("Edit failed to sync — check your connection");
        }
      })();
    });

    const rejoin = async () => {
      if (rejoiningRef.current || !boardIdRef.current) return;
      rejoiningRef.current = true;
      try {
        const state = await sock.joinBoard(boardIdRef.current);
        lastVersionRef.current = state.version;
        mySocketIdRef.current = state.mySocketId;
        doc.applySnapshot(state.snapshot);
        sock.requestPresence(boardIdRef.current);
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        rejoiningRef.current = false;
      }
    };

    let unsubs: (() => void)[] = [];

    void (async () => {
      try {
        const res = await api.get<PublicBoardPayload>(`/boards/public/${token}`);
        if (cancelled) return;
        boardIdRef.current = res.data.data.board.id;
        setTitle(res.data.data.board.title);
        doc.applySnapshot(res.data.data.document.snapshot ?? "");
        for (const op of res.data.data.document.ops) doc.applyOp(op.payload);

        await sock.ensureConnected();
        if (cancelled) return;

        unsubs = [
          sock.on("board:update", (payload) => {
            if (payload.boardId === boardIdRef.current) doc.applyOp(payload.update);
          }),
          sock.on("presence:update", (payload) => {
            if (payload.boardId === boardIdRef.current) {
              usePresenceStore.getState().set(payload.presence);
            }
          }),
          sock.on("board:error", (payload) => setError(payload.message)),
          sock.on("connect", () => {
            void rejoin();
          }),
        ];

        await rejoin();
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      unsubShapes();
      unsubMinutes();
      unsubOutbound();
      if (boardIdRef.current) sock.leaveBoard(boardIdRef.current);
      sock.disconnect();
      usePresenceStore.getState().clear();
      doc.destroy();
      docRef.current = null;
      sockRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      const key = e.key.toLowerCase();
      const map: Record<string, Tool> = {
        v: "select",
        h: "pan",
        p: "pen",
        r: "rect",
        o: "ellipse",
        l: "line",
        a: "arrow",
        s: "sticky",
      };
      if (map[key] && !e.ctrlKey && !e.metaKey) {
        setTool(map[key]);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        docRef.current?.removeShape(selectedId);
        setSelectedId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) docRef.current?.redo();
        else docRef.current?.undo();
      }
      if ((e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        docRef.current?.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const handleCursorMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - cursorSentAtRef.current < 60) return;
    cursorSentAtRef.current = now;
    const boardId = boardIdRef.current;
    if (boardId) sockRef.current?.moveCursor(boardId, x, y);
  }, []);

  const addShape = useCallback((shape: Shape) => {
    docRef.current?.addShape(shape);
  }, []);

  const patchShape = useCallback((id: string, patch: Partial<Shape>) => {
    docRef.current?.patchShape(id, patch);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    docRef.current?.removeShape(selectedId);
    setSelectedId(null);
  }, [selectedId]);

  const presenceCount = Object.values(presenceEntries).filter(
    (e) => e.socketId && e.socketId !== mySocketIdRef.current,
  ).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate font-semibold text-slate-800">{title || "Shared board"}</span>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Anyone with the link can edit
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {presenceCount + 1} online
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowNotes((s) => !s)}
            className={`rounded-lg px-3 py-1 text-sm ${showNotes ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Minutes
          </button>
          <Link to="/" className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
            Open in app
          </Link>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-1.5 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <Toolbar
        tool={tool}
        setTool={setTool}
        stroke={stroke}
        setStroke={setStroke}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        canWrite={true}
        onUndo={() => docRef.current?.undo()}
        onRedo={() => docRef.current?.redo()}
        onDeleteSelected={removeSelected}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden bg-slate-100">
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-slate-100/60 text-sm text-slate-400">
              Loading shared board…
            </div>
          )}
          <CanvasStage
            shapes={shapes}
            view={view}
            tool={tool}
            stroke={stroke}
            strokeWidth={strokeWidth}
            canWrite={true}
            selectedId={selectedId}
            width={size.width}
            height={size.height}
            onViewChange={setView}
            onSelect={setSelectedId}
            onAddShape={addShape}
            onPatchShape={patchShape}
            onCursorMove={handleCursorMove}
          />
          <PresenceLayer
            entries={presenceEntries}
            view={view}
            width={size.width}
            height={size.height}
            mySocketId={mySocketIdRef.current}
          />
        </div>

        {showNotes && (
          <NotesPanel minutes={minutes} onChange={(t) => docRef.current?.setMinutes(t)} canWrite={true} onClose={() => setShowNotes(false)} />
        )}
      </div>
    </div>
  );
}
