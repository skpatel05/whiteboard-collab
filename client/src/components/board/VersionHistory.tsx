import { useCallback, useEffect, useState } from "react";
import api, { apiErrorMessage } from "../../lib/api";

interface BoardVersion {
  version: number;
  user: string;
  createdAt: string;
  baseVersion: number;
}

interface VersionHistoryProps {
  boardId: string;
  canRestore: boolean;
  onClose: () => void;
}

export default function VersionHistory({ boardId, canRestore, onClose }: VersionHistoryProps) {
  const [versions, setVersions] = useState<BoardVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: { versions: BoardVersion[] } }>(`/boards/${boardId}/versions`);
      setVersions(res.data.data.versions);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (version: number) => {
    setRestoring(version);
    setError(null);
    try {
      await api.post(`/boards/${boardId}/versions/${version}/restore`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[70vh] w-full max-w-md flex-col rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Version history</h3>
          <button onClick={onClose} className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex-1 space-y-2 overflow-y-auto">
          {versions.length === 0 && <p className="text-sm text-slate-400">No snapshots yet — edits are saved in real time.</p>}
          {versions.map((v) => (
            <div key={v.version} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-700">v{v.version}</p>
                <p className="text-xs text-slate-400">
                  {new Date(v.createdAt).toLocaleString()} • by {v.user}
                </p>
              </div>
              <button
                disabled={!canRestore || restoring === v.version}
                onClick={() => void restore(v.version)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {restoring === v.version ? "Restoring…" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
