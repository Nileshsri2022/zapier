import { Router } from "express";
import { authMiddleware } from "../middlewares";
import { fetchAvailableTriggers, handleWebhook } from "../controllers/TriggerController";

const router = Router();

router.get("/", authMiddleware, fetchAvailableTriggers);
router.post("/webhook/:zapId", handleWebhook);

export const TriggerRouter = router;
