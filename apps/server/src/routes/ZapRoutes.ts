import { Router } from "express";
import { ZapController } from "../controllers";
import { authMiddleware } from "../middlewares";

const router = Router();

router.route("/:zapId")
    .get(authMiddleware, ZapController.fetchZapWithId)
    .put(authMiddleware, ZapController.updateZapWithId)
    .delete(authMiddleware, ZapController.deleteZapWithId)
router.patch("/:zapId/rename",authMiddleware, ZapController.renameZapWithId )
router.patch("/:zapId/enable",authMiddleware, ZapController.enableZapExecution )
router.post("/", authMiddleware, ZapController.createZap)
router.get("/", authMiddleware, ZapController.fetchZapList)


export { router as ZapRouter }
