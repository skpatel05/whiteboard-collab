import { Response } from "express";
import { Board } from "../models/Board";
import { Note } from "../models/Note";
import { ApiError } from "../utils/ApiError";
import { requireBoardAccess } from "../services/access.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const ACTION_ITEM_PATTERNS = [
  /^(action item|action-item|action):?\s+/i,
  /^todo( item)?:\s+/i,
  /^task:\s+/i,
  /^to do:\s+/i,
  /^owner[:=]\s*(\w+)\s*[-:]\s*(.+)/i,
];

/**
 * Mock "LLM" service: extracts action items from the board's meeting minutes.
 * Swappable for a real LLM call later — same request/response contract.
 */
export async function getActionItems(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);

  const [board, notes] = await Promise.all([
    Board.findById(boardId, { title: 1 }).lean(),
    Note.find({ board: boardId, kind: "minutes" }).sort({ updatedAt: 1 }).lean(),
  ]);
  if (!board) throw ApiError.notFound("Board not found");

  const minutes = notes.map((n) => n.content).join("\n");
  const lines = minutes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const actionItems: string[] = [];

  for (const line of lines) {
    for (const pattern of ACTION_ITEM_PATTERNS) {
      if (pattern.test(line)) {
        actionItems.push(line.replace(/^[-*•]\s*/, ""));
        break;
      }
    }
  }

  // Fallback heuristic: bullet lines containing an action verb.
  if (actionItems.length === 0) {
    for (const line of lines) {
      const bare = line.replace(/^[-*•]\s*/, "");
      if (/\b(will|should|must|needs to|going to)\b/i.test(bare)) {
        actionItems.push(bare);
      }
    }
  }

  // Simulate LLM latency.
  await new Promise((r) => setTimeout(r, 150));

  res.json({
    success: true,
    data: {
      board: board.title,
      actionItems: Array.from(new Set(actionItems)).slice(0, 20),
      generatedBy: "mock-llm-service",
    },
  });
}
