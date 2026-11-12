import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import {
    createBooking,
    respondToBooking,
    cancelBooking,
    readAllBookings
} from '../controllers/booking.controller.js';

const router = Router();

// Passenger booking actions
router.post('/', authenticateToken, requireRole('Passenger', 'Driver,Passenger'), createBooking);
router.get('/', authenticateToken, requireRole('Passenger', 'Driver,Passenger'), readAllBookings);
router.delete('/:id', authenticateToken, requireRole('Passenger', 'Driver,Passenger'), cancelBooking);

// Driver booking actions
router.put('/:id', authenticateToken, requireRole('Driver', 'Driver,Passenger'), respondToBooking);

export default router;