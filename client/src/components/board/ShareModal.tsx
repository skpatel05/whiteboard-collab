import { useCallback, useEffect, useState } from "react";
import api, { apiErrorMessage } from "../../lib/api";

interface ShareModalProps {
  boardId: string;
  onClose: () => void;
}

export default function ShareModal({ boardId, onClose }: ShareModalProps) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ensureLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ data: { token: string; expiresAt: string } }>(`/boards/${boardId}/share`);
      setToken(res.data.data.token);
      setExpiresAt(res.data.data.expiresAt);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void ensureLink();
  }, [ensureLink]);

  const publicUrl = token ? `${window.location.origin}/share/${token}` : null;

  const copy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard unavailable");
    }
  };

  const revoke = async () => {
    try {
      await api.delete(`/boards/${boardId}/share`);
      setToken(null);
      setExpiresAt(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Share board</h3>
          <button onClick={onClose} className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-slate-400">Creating share link…</p>
        ) : publicUrl ? (
          <>
            <p className="mb-2 text-sm text-slate-500">
              Anyone with this link can <b>view</b> this board. {expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}.` : ""}
            </p>
            <div className="mb-3 flex gap-2">
              <input readOnly value={publicUrl} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600" />
              <button onClick={() => void copy()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button onClick={() => void revoke()} className="text-sm text-red-500 hover:underline">
              Revoke link
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-400">No active share link.</p>
        )}
      </div>
    </div>
  );
}
