import express from "express";
import { AuthController } from "../controllers";
import { authMiddleware } from "../middlewares";

const router = express.Router();

router.post("/signup", AuthController.signup);
router.post("/signin", AuthController.signin);
router.get("/:userId", authMiddleware, AuthController.getUserDetails)

export { router as AuthRouter };
