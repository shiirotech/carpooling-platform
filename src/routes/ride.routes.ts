import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { 
    createRide, 
    searchRides, 
    readRideById, 
    updateRideStatus 
} from '../controllers/ride.controller.js';

const router = Router();

router.get('/', searchRides);
router.get('/:id', readRideById);

router.post('/', authenticateToken, requireRole('Driver', 'Driver,Passenger'), createRide);
router.put('/:id/status', authenticateToken, requireRole('Driver', 'Driver,Passenger'), updateRideStatus);

export default router;