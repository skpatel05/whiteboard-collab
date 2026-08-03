import { Router } from "express";
import { acceptInvitation } from "../controllers/workspace.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/:token/accept", requireAuth, asyncHandler(acceptInvitation));

export default router;
