import { Router } from 'express';
import { authMiddleware } from '../middlewares';
import { fetchAvailableActions } from '../controllers/ActionsController';

import AiActionsRouter from './AiActionsRoutes';

const router = Router();
router.use('/ai', AiActionsRouter);

router.get('/', authMiddleware, fetchAvailableActions);

export const ActionsRouter = router;
