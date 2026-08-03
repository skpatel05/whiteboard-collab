import { Router } from "express";
import * as board from "../controllers/board.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { resolveBoardAccess } from "../middleware/access.middleware";

const router = Router();

// Public share link (view-only, no auth) — must be registered before :boardId routes.
const publicRouter = Router();
publicRouter.get("/public/:token", asyncHandler(board.getPublicBoard));

router.use(requireAuth);

router.post("/", asyncHandler(board.createBoard));
router.get("/", asyncHandler(board.listBoards));

// Single board routes
router.get("/:boardId", asyncHandler(board.getBoard));
router.patch("/:boardId", resolveBoardAccess("owner", "editor"), asyncHandler(board.updateBoard));
router.delete("/:boardId", resolveBoardAccess("owner", "editor"), asyncHandler(board.deleteBoard));

router.post("/:boardId/star", asyncHandler(board.starBoard));
router.delete("/:boardId/star", asyncHandler(board.unstarBoard));
router.post("/:boardId/touch", asyncHandler(board.touchBoard));

router.post("/:boardId/share", resolveBoardAccess("owner", "editor"), asyncHandler(board.createShareLink));
router.delete("/:boardId/share", resolveBoardAccess("owner", "editor"), asyncHandler(board.revokeShareLink));

router.get("/:boardId/versions", asyncHandler(board.listVersions));
router.post(
  "/:boardId/versions/:version/restore",
  resolveBoardAccess("owner", "editor"),
  asyncHandler(board.restoreVersion),
);

export { router, publicRouter };
