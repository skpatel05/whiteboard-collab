import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useBoardStore } from "../store/board";
import api from "../lib/api";
import type { Workspace } from "../types";

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { boards, loadingBoards, fetchBoards, createBoard, toggleStar } = useBoardStore();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [search, setSearch] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadWorkspaces() {
    const res = await api.get<{ data: { workspaces: Workspace[] } }>("/workspaces");
    const list = res.data.data.workspaces;
    setWorkspaces(list);
    if (!activeWorkspace && list.length > 0) {
      setActiveWorkspace(list[0].id);
    }
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  useEffect(() => {
    void fetchBoards({
      workspace: activeWorkspace || undefined,
      search: search || undefined,
      starred: starredOnly || undefined,
      sort: "recent",
    });
  }, [activeWorkspace, search, starredOnly]);

  async function handleCreateBoard(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!activeWorkspace) {
      setError("Create or select a workspace first");
      return;
    }
    const board = await createBoard(activeWorkspace, newTitle);
    setNewTitle("");
    setShowCreate(false);
    navigate(`/boards/${board.id}`);
  }

  async function handleCreateWorkspace(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.post<{ data: { workspace: Workspace } }>("/workspaces", {
      name: newWorkspaceName,
    });
    const ws = res.data.data.workspace;
    setNewWorkspaceName("");
    setActiveWorkspace(ws.id);
    await loadWorkspaces();
  }

  const avatarColor = user?.avatarColor ?? "#6366f1";

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-primary">◧ Whiteboard</span>
          <select
            value={activeWorkspace}
            onChange={(e) => setActiveWorkspace(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            {workspaces.length === 0 && <option value="">No workspace</option>}
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">{user?.email}</span>
          <span
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {user?.name?.[0]?.toUpperCase()}
          </span>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search boards by title or owner…"
              className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={() => setStarredOnly((s) => !s)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                starredOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              ★ Starred
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              + New board
            </button>
          </div>
        </div>

        {workspaces.length === 0 && (
          <form
            onSubmit={handleCreateWorkspace}
            className="mb-6 rounded-xl border border-dashed border-slate-300 bg-white p-6"
          >
            <p className="text-sm font-medium text-slate-700">Create your first workspace</p>
            <div className="mt-3 flex gap-2">
              <input
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                required
                placeholder="e.g. Design Team"
                className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Create workspace
              </button>
            </div>
          </form>
        )}

        {showCreate && (
          <form
            onSubmit={handleCreateBoard}
            className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm font-medium text-slate-700">New board</p>
            <div className="mt-3 flex gap-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
                placeholder="Board title"
                className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {loadingBoards ? (
          <p className="text-sm text-slate-500">Loading boards…</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-slate-500">No boards yet. Create one to start collaborating.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => {
                  void useBoardStore.getState().touchBoard(board.id);
                  navigate(`/boards/${board.id}`);
                }}
                className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-primary/50 hover:shadow"
              >
                <div className="flex items-start justify-between">
                  <span className="text-sm font-semibold text-slate-800 group-hover:text-primary">
                    {board.title}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleStar(board.id);
                    }}
                    className={`text-lg ${board.starred ? "text-amber-400" : "text-slate-300 hover:text-amber-300"}`}
                  >
                    ★
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-500">
                  {board.description || "Untitled board"}
                </p>
                <p className="mt-3 text-xs text-slate-400">
                  {board.lastOpenedAt
                    ? `Last opened ${new Date(board.lastOpenedAt).toLocaleDateString()}`
                    : "Never opened"}
                </p>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
