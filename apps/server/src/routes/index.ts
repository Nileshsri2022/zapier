import express from "express";
import { AuthRouter } from "./AuthRoutes";
import { ZapRouter } from "./ZapRoutes";
import { TriggerRouter } from "./TriggerRoutes";
import { ActionsRouter } from "./ActionsRouter";
import GmailRouter from "./GmailRoutes";
import GitHubRouter from "./GitHubRoutes";
import GoogleSheetsRouter from "./GoogleSheetsRoutes";
import WhatsAppRouter from "./WhatsAppRoutes";

const router = express.Router();

router.use("/auth", AuthRouter);
router.use("/zaps", ZapRouter);
router.use("/triggers", TriggerRouter);
router.use("/actions", ActionsRouter);
router.use("/gmail", GmailRouter);
router.use("/github", GitHubRouter);
router.use("/sheets", GoogleSheetsRouter);
router.use("/whatsapp", WhatsAppRouter);

export default router;


