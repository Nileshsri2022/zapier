import express from 'express';
import { AuthController } from '../controllers';
import { authMiddleware, authLimiter } from '../middlewares';

const router = express.Router();

// Auth routes with strict rate limiting (5 attempts per 15 min)
router.post('/signup', authLimiter, AuthController.signup);
router.post('/signin', authLimiter, AuthController.signin);
router.get('/me', authMiddleware, AuthController.getCurrentUser);
router.get('/:userId', authMiddleware, AuthController.getUserDetails);

export { router as AuthRouter };
