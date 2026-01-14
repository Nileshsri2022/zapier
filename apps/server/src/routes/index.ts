import express from "express";
import { AuthRouter } from "./AuthRoutes";
import { ZapRouter } from "./ZapRoutes";
import { TriggerRouter } from "./TriggerRoutes";
import { ActionsRouter } from "./ActionsRouter";
import GmailRouter from "./GmailRoutes";
import GitHubRouter from "./GitHubRoutes";

const router = express.Router();

router.use("/auth", AuthRouter);
router.use("/zaps", ZapRouter);
router.use("/triggers", TriggerRouter);
router.use("/actions", ActionsRouter);
router.use("/gmail", GmailRouter);
router.use("/github", GitHubRouter);

export default router;

