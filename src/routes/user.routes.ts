import { Router } from 'express';
import {
    readProfile,
    updateProfile,
    changePassword,
    readAllUsers,
    updateUserRoles
} from '../controllers/user.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// profile management for logged-in users
router.get('/profile', authenticateToken, readProfile);
router.put('/profile/update', authenticateToken, updateProfile);
router.put('/profile/password', authenticateToken, changePassword);

// for admin
router.get('/', authenticateToken, requireRole('Administrator'), readAllUsers);
router.put('/:id/roles', authenticateToken, requireRole('Administrator'), updateUserRoles);

export default router;