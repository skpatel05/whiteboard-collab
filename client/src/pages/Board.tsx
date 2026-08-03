import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useBoardStore } from "../store/board";
import api, { apiErrorMessage } from "../lib/api";

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const { activeBoard, fetchBoard, clearActive, documentLoaded } = useBoardStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) return;
    void fetchBoard(boardId)
      .then(({ board }) => {
        void api.post(`/boards/${board.id}/touch`).catch(() => undefined);
      })
      .catch((err) => setError(apiErrorMessage(err)));
    return () => clearActive();
  }, [boardId, fetchBoard, clearActive]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-2.5">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-slate-500 hover:text-primary">
            ← Boards
          </Link>
          <span className="font-semibold text-slate-800">{activeBoard?.title ?? "Loading…"}</span>
          {activeBoard && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
              {activeBoard.myRole}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </header>

      {error && <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</div>}

      <main className="flex flex-1 items-center justify-center bg-slate-100">
        {!documentLoaded ? (
          <p className="text-sm text-slate-500">Loading board…</p>
        ) : (
          <p className="text-sm text-slate-500">
            Collaborative canvas arrives in the next phase. Board version: {activeBoard?.currentVersion}
          </p>
        )}
      </main>
    </div>
  );
}
