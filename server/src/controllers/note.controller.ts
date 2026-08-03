import { Response } from "express";
import { Note, NoteKind } from "../models/Note";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import { requireBoardAccess } from "../services/access.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const VALID_KINDS: NoteKind[] = ["sticky", "minutes"];

function serializeNote(note: Record<string, unknown>) {
  return {
    id: String(note._id),
    board: String(note.board),
    kind: note.kind,
    author: String(note.author),
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    color: note.color,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export async function listNotes(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);

  const kind = req.query.kind as string | undefined;
  const filter: Record<string, unknown> = { board: boardId };
  if (kind) filter.kind = kind;

  const notes = await Note.find(filter).sort({ updatedAt: -1 }).lean();
  sendSuccess(res, { notes: notes.map((n) => serializeNote(n as unknown as Record<string, unknown>)) });
}

export async function createNote(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const { kind, content, x, y, width, height, color } = req.body ?? {};
  const noteKind = kind ?? "sticky";
  if (!VALID_KINDS.includes(noteKind)) throw ApiError.badRequest("Invalid note kind");

  const note = await Note.create({
    board: boardId,
    kind: noteKind,
    author: req.auth!.id,
    content: content ?? "",
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(color !== undefined ? { color } : {}),
  });

  sendSuccess(res, { note: serializeNote(note.toObject()) }, 201);
}

export async function updateNote(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId, noteId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const note = await Note.findOne({ _id: noteId, board: boardId }).lean();
  if (!note) throw ApiError.notFound("Note not found");

  const { content, x, y, width, height, color } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (content !== undefined) updates.content = content;
  if (x !== undefined) updates.x = x;
  if (y !== undefined) updates.y = y;
  if (width !== undefined) updates.width = width;
  if (height !== undefined) updates.height = height;
  if (color !== undefined) updates.color = color;

  const updated = await Note.findByIdAndUpdate(noteId, { $set: updates }, { new: true }).lean();
  sendSuccess(res, { note: serializeNote(updated as unknown as Record<string, unknown>) });
}

export async function deleteNote(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId, noteId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const deleted = await Note.findOneAndDelete({ _id: noteId, board: boardId }).lean();
  if (!deleted) throw ApiError.notFound("Note not found");
  sendSuccess(res, { message: "Note deleted" });
}
