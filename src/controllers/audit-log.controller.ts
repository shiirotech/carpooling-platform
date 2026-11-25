import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';

/*
 * Administrator views audit logs of ride and booking status changes.
 * Supports optional filtering by entity_type, entity_id, changed_by_id,
 * date range (from_date, to_date) and pagination (page, limit).
 */
export const readAllAuditLogs = (req: AuthRequest, res: Response): void => {
    const entityTypeParam = req.query.entity_type as string | undefined;
    const entityIdParam = req.query.entity_id as string | undefined;
    const changedByIdParam = req.query.changed_by_id as string | undefined;
    const fromDateParam = req.query.from_date as string | undefined;
    const toDateParam = req.query.to_date as string | undefined;
    const pageParam = req.query.page as string | undefined;
    const limitParam = req.query.limit as string | undefined;

    let whereClause = `WHERE 1=1`;
    const filterParams: (string | number)[] = [];

    // Validate entity_type filter
    if (entityTypeParam !== undefined && entityTypeParam.trim() !== '') {
        const trimmedType = entityTypeParam.trim();
        const allowedEntityTypes = ['Ride', 'Booking'];
        if (!allowedEntityTypes.includes(trimmedType)) {
            res.status(400).json({ error: "Invalid entity_type. Allowed values are: 'Ride', 'Booking'" });
            return;
        }
        whereClause += ` AND al.entity_type = ?`;
        filterParams.push(trimmedType);
    }

    // Validate entity_id filter
    if (entityIdParam !== undefined && entityIdParam.trim() !== '') {
        const numEntityId = Number(entityIdParam);
        if (!Number.isInteger(numEntityId) || numEntityId <= 0) {
            res.status(400).json({ error: 'entity_id must be a positive integer' });
            return;
        }
        whereClause += ` AND al.entity_id = ?`;
        filterParams.push(numEntityId);
    }

    // Validate changed_by_id filter
    if (changedByIdParam !== undefined && changedByIdParam.trim() !== '') {
        const numChangedById = Number(changedByIdParam);
        if (!Number.isInteger(numChangedById) || numChangedById <= 0) {
            res.status(400).json({ error: 'changed_by_id must be a positive integer' });
            return;
        }
        whereClause += ` AND al.changed_by_id = ?`;
        filterParams.push(numChangedById);
    }

    // Validate date range filters
    let parsedFromDate: Date | undefined;
    if (fromDateParam !== undefined && fromDateParam.trim() !== '') {
        parsedFromDate = new Date(fromDateParam.trim());
        if (isNaN(parsedFromDate.getTime())) {
            res.status(400).json({ error: 'Invalid from_date format' });
            return;
        }
        whereClause += ` AND date(al.created_at) >= date(?)`;
        filterParams.push(fromDateParam.trim());
    }

    let parsedToDate: Date | undefined;
    if (toDateParam !== undefined && toDateParam.trim() !== '') {
        parsedToDate = new Date(toDateParam.trim());
        if (isNaN(parsedToDate.getTime())) {
            res.status(400).json({ error: 'Invalid to_date format' });
            return;
        }
        whereClause += ` AND date(al.created_at) <= date(?)`;
        filterParams.push(toDateParam.trim());
    }

    if (parsedFromDate && parsedToDate && parsedFromDate > parsedToDate) {
        res.status(400).json({ error: 'from_date cannot be later than to_date' });
        return;
    }

    // Validate pagination parameters
    const page = pageParam !== undefined && pageParam.trim() !== '' ? Number(pageParam) : 1;
    const limit = limitParam !== undefined && limitParam.trim() !== '' ? Number(limitParam) : 20;

    if (!Number.isInteger(page) || page < 1) {
        res.status(400).json({ error: 'page must be a positive integer' });
        return;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
        return;
    }

    const offset = (page - 1) * limit;

    // 1. Count total matching audit log entries for pagination metadata
    const countQuery = `
        SELECT COUNT(*) AS total
        FROM audit_logs al
        ${whereClause}
    `;

    db.get(countQuery, filterParams, (countErr, countRow: { total: number }) => {
        if (countErr) {
            res.status(500).json({ error: 'Database error while counting audit logs' });
            return;
        }

        const total = countRow ? countRow.total : 0;
        const totalPages = Math.ceil(total / limit);

        // 2. Fetch paginated audit logs joined with actor details (newest first)
        const dataQuery = `
            SELECT
                al.id,
                al.entity_type,
                al.entity_id,
                al.old_status,
                al.new_status,
                al.created_at,
                al.changed_by_id,
                u.name AS changed_by_name,
                u.email AS changed_by_email,
                u.roles AS changed_by_roles
            FROM audit_logs al
            JOIN users u ON al.changed_by_id = u.id
            ${whereClause}
            ORDER BY al.created_at DESC, al.id DESC
            LIMIT ? OFFSET ?
        `;

        db.all(dataQuery, [...filterParams, limit, offset], (err, logs: any[]) => {
            if (err) {
                res.status(500).json({ error: 'Database error while retrieving audit logs' });
                return;
            }

            res.status(200).json({
                data: logs,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages
                }
            });
        });
    });
};

// Administrator views a single audit log entry by ID.
export const readAuditLogById = (req: AuthRequest, res: Response): void => {
    const log_id = Number(req.params.id);

    if (!Number.isInteger(log_id) || log_id <= 0) {
        res.status(400).json({ error: 'Invalid audit log ID format' });
        return;
    }

    const query = `
        SELECT
            al.id,
            al.entity_type,
            al.entity_id,
            al.old_status,
            al.new_status,
            al.created_at,
            al.changed_by_id,
            u.name AS changed_by_name,
            u.email AS changed_by_email,
            u.roles AS changed_by_roles
        FROM audit_logs al
        JOIN users u ON al.changed_by_id = u.id
        WHERE al.id = ?
    `;

    db.get(query, [log_id], (err, log) => {
        if (err) {
            res.status(500).json({ error: 'Database error while fetching audit log entry' });
            return;
        }

        if (!log) {
            res.status(404).json({ error: 'Audit log entry not found' });
            return;
        }

        res.status(200).json(log);
    });
};