import { Router } from "express";
import * as note from "../controllers/note.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { resolveBoardAccess } from "../middleware/access.middleware";

const router = Router();

router.use(requireAuth);

router.get("/:boardId/notes", resolveBoardAccess("owner", "editor", "viewer"), asyncHandler(note.listNotes));
router.post("/:boardId/notes", resolveBoardAccess("owner", "editor"), asyncHandler(note.createNote));
router.patch(
  "/:boardId/notes/:noteId",
  resolveBoardAccess("owner", "editor"),
  asyncHandler(note.updateNote),
);
router.delete(
  "/:boardId/notes/:noteId",
  resolveBoardAccess("owner", "editor"),
  asyncHandler(note.deleteNote),
);

export default router;
