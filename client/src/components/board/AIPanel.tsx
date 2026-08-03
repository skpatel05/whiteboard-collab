import { useState } from "react";
import api, { apiErrorMessage } from "../../lib/api";

interface AIPanelProps {
  boardId: string;
  onClose: () => void;
}

export default function AIPanel({ boardId, onClose }: AIPanelProps) {
  const [actionItems, setActionItems] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ data: { actionItems: string[]; generatedBy: string } }>(
        `/boards/${boardId}/ai/action-items`,
      );
      setActionItems(res.data.data.actionItems);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await api.post<Blob>(`/boards/${boardId}/export/pdf`, {}, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `board-${boardId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-800">Assist & export</span>
        <button onClick={onClose} className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          ✕
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">AI action items</p>
          <p className="mb-3 text-xs text-slate-400">Extracts next steps from the meeting minutes.</p>
          <button
            onClick={() => void generate()}
            disabled={loading}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Analyzing…" : "Generate action items"}
          </button>
          {actionItems && (
            <ul className="mt-3 space-y-1.5">
              {actionItems.length === 0 && <li className="text-sm text-slate-400">No action items found in minutes.</li>}
              {actionItems.map((item, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">
                  <span className="text-primary">▸</span>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Meeting summary</p>
          <p className="mb-3 text-xs text-slate-400">Server-generated PDF with the board title, minutes and sticky notes.</p>
          <button
            onClick={() => void exportPdf()}
            disabled={exporting}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {exporting ? "Generating…" : "Export PDF"}
          </button>
        </div>
      </div>

      {error && <div className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </aside>
  );
}
