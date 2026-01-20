import { Router } from 'express';
import { ZapController } from '../controllers';
import { authMiddleware, validateBody } from '../middlewares';
import { RenameZapSchema, EnableZapSchema, UpdateZapActionsSchema } from '@repo/types';

const router = Router();

router
  .route('/:zapId')
  .get(authMiddleware, ZapController.fetchZapWithId)
  .put(authMiddleware, validateBody(UpdateZapActionsSchema), ZapController.updateZapWithId)
  .delete(authMiddleware, ZapController.deleteZapWithId);
router.patch(
  '/:zapId/rename',
  authMiddleware,
  validateBody(RenameZapSchema),
  ZapController.renameZapWithId
);
router.patch(
  '/:zapId/enable',
  authMiddleware,
  validateBody(EnableZapSchema),
  ZapController.enableZapExecution
);
router.patch('/:zapId/filters', authMiddleware, ZapController.updateZapFilters);
router.get('/:zapId/runs', authMiddleware, ZapController.fetchZapRuns);
router.post('/', authMiddleware, ZapController.createZap);
router.get('/', authMiddleware, ZapController.fetchZapList);

export { router as ZapRouter };
