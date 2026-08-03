import { Router } from "express";
import * as auth from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", asyncHandler(auth.register));
router.get("/verify-email", asyncHandler(auth.verifyEmail));
router.post("/login", asyncHandler(auth.login));
router.post("/refresh", asyncHandler(auth.refresh));
router.post("/logout", asyncHandler(auth.logout));
router.get("/me", requireAuth, asyncHandler(auth.me));

export default router;
