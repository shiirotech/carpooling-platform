import { Router } from 'express';
import {
    createVehicle,
    readVehicles,
    updateVehicle,
    deleteVehicle
} from '../controllers/vehicle.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// all vehicle endpoints require the user to be logged in and have the 'Driver' role
router.use(authenticateToken, requireRole('Driver'));

router.post('/', createVehicle);
router.get('/', readVehicles);
router.put('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);

export default router;