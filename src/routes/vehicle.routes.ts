import { Router } from 'express';
import {
    createVehicle,
    readVehicles,
    updateVehicle,
    deleteVehicle
} from '../controllers/vehicle.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// all vehicle endpoints require the user to be logged in and have the 'Driver' or 'Driver,Passenger' role
router.use(authenticateToken, requireRole('Driver', 'Driver,Passenger'));

router.post('/', createVehicle);
router.get('/', readVehicles);
router.put('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);

export default router;