import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import {
    createRating,
    readRatings,
    deleteRating
} from '../controllers/rating.controller.js';

const router = Router();

router.get('/', readRatings);
router.post('/', authenticateToken, requireRole('Passenger', 'Driver,Passenger'), createRating);
router.delete('/:id', authenticateToken, requireRole('Administrator'), deleteRating);

export default router;