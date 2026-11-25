import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import {
    readAllAuditLogs,
    readAuditLogById
} from '../controllers/audit-log.controller.js';

const router = Router();

// All audit log endpoints are restricted to Administrators and are strictly read-only
router.use(authenticateToken, requireRole('Administrator'));

router.get('/', readAllAuditLogs);
router.get('/:id', readAuditLogById);

export default router;