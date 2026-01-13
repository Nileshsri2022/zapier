import { Router } from "express";
import { authMiddleware } from "../middlewares";
import { fetchAvailableActions } from "../controllers/ActionsController";

const router = Router();

router.get("/", authMiddleware, fetchAvailableActions);

export const ActionsRouter = router;