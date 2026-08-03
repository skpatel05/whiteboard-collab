import { Response } from "express";
import PDFDocument from "pdfkit";
import { Board } from "../models/Board";
import { Note } from "../models/Note";
import { ApiError } from "../utils/ApiError";
import { requireBoardAccess } from "../services/access.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

/**
 * Server-generated PDF meeting summary: board title + all notes (minutes and
 * sticky notes) in a printable document.
 */
export async function exportBoardPdf(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);

  const [board, notes] = await Promise.all([
    Board.findById(boardId).lean(),
    Note.find({ board: boardId }).sort({ updatedAt: 1 }).lean(),
  ]);
  if (!board) throw ApiError.notFound("Board not found");

  const minutes = notes.filter((n) => n.kind === "minutes").map((n) => n.content).filter(Boolean).join("\n\n");
  const stickies = notes.filter((n) => n.kind === "sticky").map((n) => `- ${n.content}`).filter(Boolean);

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolve) => doc.on("end", resolve));

  doc.fontSize(20).fillColor("#111827").text(board.title);
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#6b7280").text(`Generated ${new Date().toISOString()}`);
  doc.moveDown(1);

  doc.fontSize(14).fillColor("#111827").text("Meeting Minutes");
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#374151");
  if (minutes) {
    doc.text(minutes);
  } else {
    doc.fillColor("#9ca3af").text("No minutes recorded.");
  }

  doc.moveDown(1.5);
  doc.fontSize(14).fillColor("#111827").text("Sticky Notes");
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#374151");
  if (stickies.length > 0) {
    stickies.forEach((s) => doc.text(s));
  } else {
    doc.fillColor("#9ca3af").text("No sticky notes yet.");
  }

  doc.end();
  await finished;

  const buffer = Buffer.concat(chunks);
  const filename = encodeURIComponent(`${board.title.replace(/[^\w-]/g, "")}-summary.pdf`);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  res.send(buffer);
}
