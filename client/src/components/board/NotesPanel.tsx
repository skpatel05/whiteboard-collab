import { useRef } from "react";

interface NotesPanelProps {
  minutes: string;
  onChange: (text: string) => void;
  canWrite: boolean;
  onClose: () => void;
}

function applyToSelection(textarea: HTMLTextAreaElement, before: string, after: string, onChange: (t: string) => void) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const next = value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, end + before.length);
  });
}

function toggleBullets(textarea: HTMLTextAreaElement, onChange: (t: string) => void) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const chunk = value.slice(lineStart, end);
  const bulleted = chunk
    .split("\n")
    .map((line) => (line.startsWith("- ") ? line.slice(2) : `- ${line}`))
    .join("\n");
  onChange(value.slice(0, lineStart) + bulleted + value.slice(end));
}

export default function NotesPanel({ minutes, onChange, canWrite, onClose }: NotesPanelProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-800">Meeting minutes</span>
        <button onClick={onClose} className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          ✕
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        <button
          title="Bold (**text**)"
          disabled={!canWrite}
          onClick={() => ref.current && applyToSelection(ref.current, "**", "**", onChange)}
          className="h-7 w-7 rounded text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          B
        </button>
        <button
          title="Italic (*text*)"
          disabled={!canWrite}
          onClick={() => ref.current && applyToSelection(ref.current, "*", "*", onChange)}
          className="h-7 w-7 rounded text-sm italic text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          I
        </button>
        <button
          title="Bullet list"
          disabled={!canWrite}
          onClick={() => ref.current && toggleBullets(ref.current, onChange)}
          className="h-7 w-7 rounded text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          •
        </button>
      </div>

      <textarea
        ref={ref}
        value={minutes}
        readOnly={!canWrite}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Capture meeting notes here — edits sync live with everyone in the room."
        className="flex-1 resize-none p-3 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-400"
      />

      <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-400">
        {canWrite ? "Editing live • Markdown-style **bold**, *italic*, - bullets" : "Read-only view"}
      </div>
    </aside>
  );
}
