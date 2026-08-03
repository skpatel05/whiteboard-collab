import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useBoardStore } from "../store/board";
import { usePresenceStore } from "../store/presence";
import { whiteboardSocket } from "../lib/socket";
import { BoardDoc } from "../lib/boardDoc";
import type { Shape } from "../lib/boardDoc";
import { drainUpdates, enqueueUpdate, queuedCount } from "../lib/offlineQueue";
import { apiErrorMessage } from "../lib/api";
import type { WorkspaceRole } from "../types";
import Toolbar from "../components/board/Toolbar";
import type { Tool } from "../components/board/Toolbar";
import CanvasStage from "../components/board/CanvasStage";
import PresenceLayer from "../components/board/PresenceLayer";
import NotesPanel from "../components/board/NotesPanel";
import AIPanel from "../components/board/AIPanel";
import ShareModal from "../components/board/ShareModal";
import VersionHistory from "../components/board/VersionHistory";

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { fetchBoard } = useBoardStore();
  const presenceEntries = usePresenceStore((s) => s.entries);

  const docRef = useRef<BoardDoc | null>(null);
  const boardIdRef = useRef(boardId);
  const lastVersionRef = useRef(0);
  const cursorSentAtRef = useRef(0);
  const rejoiningRef = useRef(false);
  const presenceUserIdRef = useRef<string | null>(null);
  const mySocketIdRef = useRef<string | null>(null);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [minutes, setMinutes] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [stroke, setStroke] = useState("#1e293b");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0 });
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [panel, setPanel] = useState<"none" | "notes" | "ai">("none");
  const [showShare, setShowShare] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canWrite = role !== "viewer";

  const drain = useCallback(async () => {
    const remaining = await drainUpdates(async (q) => {
      const v = await whiteboardSocket.sendUpdate(q.boardId, Uint8Array.from(atob(q.update), (c) => c.charCodeAt(0)), lastVersionRef.current, q.clientId);
      if (q.boardId === boardIdRef.current) lastVersionRef.current = v;
    });
    setQueued(remaining);
  }, []);

  useEffect(() => {
    boardIdRef.current = boardId;
  }, [boardId]);

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
    if (!boardId) return;
    boardIdRef.current = boardId;

    const doc = new BoardDoc();
    docRef.current = doc;

    const unsubShapes = doc.observeShapes(setShapes);
    const unsubMinutes = doc.observeMinutes(setMinutes);

    const unsubOutbound = doc.observeOutbound((update) => {
      void (async () => {
        const payload = {
          boardId,
          update: bytesToBase64(update),
          baseVersion: lastVersionRef.current,
          clientId: doc.doc.clientID,
        };
        if (!navigator.onLine) {
          await enqueueUpdate(payload);
          setQueued(await queuedCount());
          return;
        }
        try {
          const v = await whiteboardSocket.sendUpdate(boardId, update, lastVersionRef.current, doc.doc.clientID);
          lastVersionRef.current = v;
        } catch {
          await enqueueUpdate(payload);
          setQueued(await queuedCount());
        }
      })();
    });

    let subscribed = false;

    const rejoin = async () => {
      if (rejoiningRef.current || !boardIdRef.current) return;
      rejoiningRef.current = true;
      try {
        const state = await whiteboardSocket.joinBoard(boardIdRef.current);
        lastVersionRef.current = state.version;
        mySocketIdRef.current = state.mySocketId;
        doc.applySnapshot(state.snapshot);
        whiteboardSocket.requestPresence(boardIdRef.current);
        await drain();
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        rejoiningRef.current = false;
      }
    };

    let unsubs: (() => void)[] = [];

    const setup = async () => {
      try {
        const { board, document } = await fetchBoard(boardId);
        setRole(board.myRole);
        setTitle(board.title);
        presenceUserIdRef.current = board.id;
        doc.applySnapshot(document.snapshot ?? "");
        for (const op of document.ops) doc.applyOp(op.payload);
        setQueued(await queuedCount());

        await whiteboardSocket.ensureConnected();
        if (subscribed) return;
        subscribed = true;

        unsubs = [
          whiteboardSocket.on("board:update", (payload) => {
            if (payload.boardId === boardIdRef.current) doc.applyOp(payload.update);
          }),
          whiteboardSocket.on("presence:update", (payload) => {
            if (payload.boardId === boardIdRef.current) {
              usePresenceStore.getState().set(payload.presence);
            }
          }),
          whiteboardSocket.on("board:error", (payload) => setError(payload.message)),
          whiteboardSocket.on("connect", () => {
            void rejoin();
          }),
        ];

        await rejoin();
      } catch (err) {
        setError(apiErrorMessage(err));
      }
    };

    void setup();

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubs.forEach((u) => u());
      unsubShapes();
      unsubMinutes();
      unsubOutbound();
      if (boardIdRef.current) whiteboardSocket.leaveBoard(boardIdRef.current);
      usePresenceStore.getState().clear();
      doc.destroy();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (!canWrite && (tool === "pan" || tool === "select")) return;
    if (!canWrite) setTool("select");
  }, [canWrite, tool]);

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
        if (canWrite || key === "v" || key === "h") setTool(map[key]);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && canWrite) {
        docRef.current?.removeShape(selectedId);
        setSelectedId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "z" && canWrite) {
        e.preventDefault();
        if (e.shiftKey) docRef.current?.redo();
        else docRef.current?.undo();
      }
      if ((e.ctrlKey || e.metaKey) && key === "y" && canWrite) {
        e.preventDefault();
        docRef.current?.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, canWrite]);

  useEffect(() => {
    if (online) void drain();
  }, [online, drain]);

  const handleCursorMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - cursorSentAtRef.current < 60) return;
    cursorSentAtRef.current = now;
    if (boardIdRef.current) whiteboardSocket.moveCursor(boardIdRef.current, x, y);
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
          <Link to="/dashboard" className="shrink-0 text-sm text-slate-500 hover:text-primary">
            ← Boards
          </Link>
          <span className="truncate font-semibold text-slate-800">{title || "Loading…"}</span>
          {role && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">{role}</span>
          )}
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {presenceCount + 1} online
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!online && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
              Offline {queued > 0 ? `• ${queued} pending` : ""}
            </span>
          )}
          <button
            onClick={() => setPanel(panel === "notes" ? "none" : "notes")}
            className={`rounded-lg px-3 py-1 text-sm ${panel === "notes" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Minutes
          </button>
          <button
            onClick={() => setPanel(panel === "ai" ? "none" : "ai")}
            className={`rounded-lg px-3 py-1 text-sm ${panel === "ai" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            AI & export
          </button>
          <button
            onClick={() => setShowVersions(true)}
            className="rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Versions
          </button>
          <button
            onClick={() => setShowShare(true)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Share
          </button>
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button onClick={() => void logout()} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100">
            Log out
          </button>
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
        canWrite={canWrite}
        onUndo={() => docRef.current?.undo()}
        onRedo={() => docRef.current?.redo()}
        onDeleteSelected={removeSelected}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden bg-slate-100">
          <CanvasStage
            shapes={shapes}
            view={view}
            tool={tool}
            stroke={stroke}
            strokeWidth={strokeWidth}
            canWrite={canWrite}
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

        {panel === "notes" && (
          <NotesPanel minutes={minutes} onChange={(t) => docRef.current?.setMinutes(t)} canWrite={canWrite} onClose={() => setPanel("none")} />
        )}
        {panel === "ai" && <AIPanel boardId={boardId ?? ""} onClose={() => setPanel("none")} />}
      </div>

      {showShare && <ShareModal boardId={boardId ?? ""} onClose={() => setShowShare(false)} />}
      {showVersions && (
        <VersionHistory boardId={boardId ?? ""} canRestore={canWrite} onClose={() => setShowVersions(false)} />
      )}
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
