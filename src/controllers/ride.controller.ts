import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';

export const createRide = (req: AuthRequest, res: Response): void => {
    const driver_id = req.user?.id;
    const { vehicle_id, origin, destination, departure, price, seats_offered } = req.body;

    if (!origin || !destination || !departure || vehicle_id === undefined || price === undefined || seats_offered === undefined) {
        res.status(400).json({ 
            error: 'All fields are required' 
        });
        return;
    }

    const numVehicleId = Number(vehicle_id);
    const numPrice = Number(price);
    const numSeatsOffered = Number(seats_offered);

    if (!Number.isInteger(numVehicleId) || !Number.isInteger(numSeatsOffered) || isNaN(numPrice)) {
        res.status(400).json({ error: 'Vehicle id and seats offered must be integers, price must be a number' });
        return;
    }

    if (numPrice < 0 || numSeatsOffered <= 0) {
        res.status(400).json({ error: 'Price cannot be negative and seats offered must be greater than 0' });
        return;
    }

    // validate departure date
    const departureDate = new Date(departure);
    if (isNaN(departureDate.getTime())) {
        res.status(400).json({ error: 'Invalid departure date format' });
        return;
    }
    
    // compare against the current time
    if (departureDate <= new Date()) {
        res.status(400).json({ error: 'Departure time must be in the future' });
        return;
    }

    // Check vehicle ownership and capacity
    const getVehicleQuery = `SELECT seats FROM vehicles WHERE id = ? AND user_id = ?`;

    db.get(getVehicleQuery, [numVehicleId, driver_id], (err, vehicle: { seats: number }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while verifying vehicle' });
            return;
        }

        if (!vehicle) {
            res.status(404).json({ error: 'Vehicle not found or you do not have permission to use it' });
            return;
        }

        const maxPassengerSeats = vehicle.seats - 1;

        if (numSeatsOffered > maxPassengerSeats) {
            res.status(400).json({ 
                error: `Vehicle capacity exceeded. This vehicle can offer a maximum of ${maxPassengerSeats} passenger seat(s)` 
            });
            return;
        }

        // Insert the new ride safely
        const insertRideQuery = `
            INSERT INTO rides (driver_id, vehicle_id, origin, destination, departure, price, seats_offered, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
        `;

        db.run(
            insertRideQuery, 
            [driver_id, numVehicleId, origin, destination, departureDate.toISOString(), numPrice, numSeatsOffered], 
            function (err) {
                if (err) {
                    res.status(500).json({ error: 'Failed to publish the ride' });
                    return;
                }

                res.status(201).json({ 
                    message: 'Ride published successfully', 
                    ride_id: this.lastID 
                });
            }
        );
    });
};

export const searchRides = (req: Request, res: Response): void => {
    const origin = req.query.origin as string | undefined;
    const destination = req.query.destination as string | undefined;
    const date = req.query.date as string | undefined;
    const minSeatsParam = req.query.min_seats as string | undefined;
    const minPriceParam = req.query.min_price as string | undefined;
    const maxPriceParam = req.query.max_price as string | undefined;
    const sortByParam = (req.query.sort_by as string | undefined) || 'departure';
    const sortOrderParam = ((req.query.sort_order as string | undefined) || 'asc').toLowerCase();
    const pageParam = req.query.page as string | undefined;
    const limitParam = req.query.limit as string | undefined;

    // Validate date filter if provided
    if (date !== undefined && date.trim() !== '') {
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            res.status(400).json({ error: 'Invalid date format' });
            return;
        }
    }

    // Validate min_seats filter
    let minSeats: number | undefined;
    if (minSeatsParam !== undefined && minSeatsParam.trim() !== '') {
        minSeats = Number(minSeatsParam);
        if (!Number.isInteger(minSeats) || minSeats < 0) {
            res.status(400).json({ error: 'Minimum seats must be a non-negative integer' });
            return;
        }
    }

    // Validate price range filters
    let minPrice: number | undefined;
    if (minPriceParam !== undefined && minPriceParam.trim() !== '') {
        minPrice = Number(minPriceParam);
        if (isNaN(minPrice) || minPrice < 0) {
            res.status(400).json({ error: 'Minimum price must be a non-negative number' });
            return;
        }
    }

    let maxPrice: number | undefined;
    if (maxPriceParam !== undefined && maxPriceParam.trim() !== '') {
        maxPrice = Number(maxPriceParam);
        if (isNaN(maxPrice) || maxPrice < 0) {
            res.status(400).json({ error: 'Maximum price must be a non-negative number' });
            return;
        }
    }

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
        res.status(400).json({ error: 'Minimum price cannot be greater than maximum price' });
        return;
    }

    // Validate sorting parameters (prevent SQL injection)
    const allowedSortColumns: Record<string, string> = {
        departure: 'r.departure',
        price: 'r.price'
    };

    if (!allowedSortColumns[sortByParam]) {
        res.status(400).json({ error: "Invalid sorting value. Allowed values are: 'departure', 'price'" });
        return;
    }

    if (sortOrderParam !== 'asc' && sortOrderParam !== 'desc') {
        res.status(400).json({ error: "Invalid sorting order value. Allowed values are: 'asc', 'desc'" });
        return;
    }

    const orderByColumn = allowedSortColumns[sortByParam];
    const orderDirection = sortOrderParam === 'desc' ? 'DESC' : 'ASC';

    // Validate pagination parameters
    const page = pageParam !== undefined && pageParam.trim() !== '' ? Number(pageParam) : 1;
    const limit = limitParam !== undefined && limitParam.trim() !== '' ? Number(limitParam) : 10;

    if (!Number.isInteger(page) || page < 1) {
        res.status(400).json({ error: 'Page must be a positive integer' });
        return;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ error: 'Limit must be an integer between 1 and 100' });
        return;
    }

    const offset = (page - 1) * limit;

    // Base WHERE clause: only future rides that are bookable or full
    let whereClause = `
        WHERE r.departure > datetime('now') 
        AND r.status IN ('open', 'full')
    `;
    const filterParams: (string | number)[] = [];

    if (origin && origin.trim() !== '') {
        // using LIKE for case-insensitive, partial matching ("Warsaw" matches "Warsaw Central")
        whereClause += ` AND r.origin LIKE ?`;
        filterParams.push(`%${origin.trim()}%`);
    }

    if (destination && destination.trim() !== '') {
        whereClause += ` AND r.destination LIKE ?`;
        filterParams.push(`%${destination.trim()}%`);
    }

    if (date && date.trim() !== '') {
        // use SQLite's date() function to ignore the time of day and match just the calendar date
        whereClause += ` AND date(r.departure) = date(?)`;
        filterParams.push(date.trim());
    }

    if (minSeats !== undefined) {
        whereClause += ` AND (r.seats_offered - (SELECT IFNULL(SUM(b.seats), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'accepted')) >= ?`;
        filterParams.push(minSeats);
    }

    if (minPrice !== undefined) {
        whereClause += ` AND r.price >= ?`;
        filterParams.push(minPrice);
    }

    if (maxPrice !== undefined) {
        whereClause += ` AND r.price <= ?`;
        filterParams.push(maxPrice);
    }

    // 1. Count total matching rides for pagination metadata
    const countQuery = `
        SELECT COUNT(*) AS total 
        FROM rides r 
        ${whereClause}
    `;

    db.get(countQuery, filterParams, (countErr, countRow: { total: number }) => {
        if (countErr) {
            res.status(500).json({ error: 'Database error while counting rides' });
            return;
        }

        const total = countRow ? countRow.total : 0;
        const totalPages = Math.ceil(total / limit);

        // 2. Fetch paginated, sorted ride records with derived free_seats and driver rating
        const dataQuery = `
            SELECT 
                r.id, 
                r.origin, 
                r.destination, 
                r.departure, 
                r.price, 
                r.seats_offered, 
                r.status,
                u.name AS driver_name,
                (SELECT ROUND(AVG(rt.value), 2) FROM ratings rt WHERE rt.driver_id = r.driver_id) AS driver_avg_rating,
                (r.seats_offered - (SELECT IFNULL(SUM(b.seats), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'accepted')) AS free_seats
            FROM rides r
            JOIN users u ON r.driver_id = u.id
            ${whereClause}
            ORDER BY ${orderByColumn} ${orderDirection}
            LIMIT ? OFFSET ?
        `;

        db.all(dataQuery, [...filterParams, limit, offset], (err, rides: any[]) => {
            if (err) {
                res.status(500).json({ error: 'Database error while searching for rides' });
                return;
            }

            res.status(200).json({
                data: rides,
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

export const readRideById = (req: Request, res: Response): void => {
    const ride_id = Number(req.params.id);

    if (!Number.isInteger(ride_id) || ride_id <= 0) {
        res.status(400).json({ error: 'Invalid ride ID format' });
        return;
    }

    const query = `
        SELECT 
            r.id, 
            r.origin, 
            r.destination, 
            r.departure, 
            r.price, 
            r.seats_offered, 
            r.status,
            u.name AS driver_name,
            v.make AS vehicle_make, 
            v.model AS vehicle_model, 
            v.plate_number AS vehicle_plate,
            (r.seats_offered - (SELECT IFNULL(SUM(b.seats), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'accepted')) AS free_seats
        FROM rides r
        JOIN users u ON r.driver_id = u.id
        JOIN vehicles v ON r.vehicle_id = v.id
        WHERE r.id = ?
    `;

    db.get(query, [ride_id], (err, ride) => {
        if (err) {
            res.status(500).json({ error: 'Database error while fetching ride details' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }

        res.status(200).json(ride);
    });
};

export const updateRideStatus = (req: AuthRequest, res: Response): void => {
    const ride_id = Number(req.params.id);
    const user_id = req.user?.id;
    const isAdmin = req.user?.roles === 'Administrator';
    const { status } = req.body;

    if (!Number.isInteger(ride_id) || ride_id <= 0) {
        res.status(400).json({ error: 'Invalid ride ID format' });
        return;
    }

    // Driver can manually transition to departed, finished or cancelled
    // Administrator can cancel any ride
    const allowedStatuses = ['departed', 'finished', 'cancelled'];
    
    if (!status || !allowedStatuses.includes(status)) {
        res.status(400).json({ 
            error: `Invalid status update. Allowed manual statuses are: ${allowedStatuses.join(', ')}` 
        });
        return;
    }

    // Admins can only cancel rides (not depart or finish on behalf of drivers)
    if (isAdmin && status !== 'cancelled') {
        res.status(400).json({ error: 'Administrators can only cancel rides' });
        return;
    }

    // Fetch current ride status and driver_id
    const getRideQuery = `SELECT id, driver_id, status FROM rides WHERE id = ?`;

    db.get(getRideQuery, [ride_id], (err, ride: { id: number; driver_id: number; status: string }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while verifying ride' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }

        // Non-admins must own the ride
        if (!isAdmin && ride.driver_id !== user_id) {
            res.status(403).json({ error: 'Access denied. You can only update your own rides' });
            return;
        }

        const currentStatus = ride.status;

        // Prevent changing terminal states (dead ends)
        if (currentStatus === 'cancelled' || currentStatus === 'finished') {
            res.status(400).json({ error: `Ride is already ${currentStatus} and cannot be changed further` });
            return;
        }

        // Enforce chronological order for drivers
        if (status === 'finished' && currentStatus !== 'departed') {
            res.status(400).json({ error: 'Ride must be marked as departed before it can be finished' });
            return;
        }

        if (status === 'departed' && currentStatus === 'departed') {
            res.status(400).json({ error: 'Ride has already departed' });
            return;
        }

        // update
        const updateQuery = `UPDATE rides SET status = ? WHERE id = ?`;

        db.run(updateQuery, [status, ride_id], function(updateErr) {
            if (updateErr) {
                res.status(500).json({ error: 'Failed to update ride status' });
                return;
            }

            // log
            const insertRideAuditQuery = `
                INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                VALUES ('Ride', ?, ?, ?, ?)
            `;

            db.run(insertRideAuditQuery, [ride_id, currentStatus, status, user_id], (auditErr) => {
                if (auditErr) {
                    res.status(500).json({ error: 'Ride status updated, but failed to write audit log' });
                    return;
                }

                if (status !== 'cancelled') {
                    res.status(200).json({ message: `Ride successfully transitioned to ${status}` });
                    return;
                }

                // If ride is cancelled, we need to apply cancellation to all pending/accepted bookings and write audit logs
                const getActiveBookingsQuery = `
                    SELECT id, status FROM bookings 
                    WHERE ride_id = ? AND status IN ('pending', 'accepted')
                `;

                db.all(getActiveBookingsQuery, [ride_id], (bErr, activeBookings: { id: number; status: string }[]) => {
                    if (bErr) {
                        res.status(500).json({ error: 'Ride cancelled, but failed to retrieve bookings for cascade cancellation' });
                        return;
                    }

                    if (!activeBookings || activeBookings.length === 0) {
                        res.status(200).json({ message: `Ride successfully transitioned to ${status}` });
                        return;
                    }

                    const cancelBookingsQuery = `
                        UPDATE bookings SET status = 'cancelled' 
                        WHERE ride_id = ? AND status IN ('pending', 'accepted')
                    `;

                    db.run(cancelBookingsQuery, [ride_id], function(cErr) {
                        if (cErr) {
                            res.status(500).json({ error: 'Ride cancelled, but failed to cancel associated bookings' });
                            return;
                        }

                        // log
                        const insertBookingAuditQuery = `
                            INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                            VALUES ('Booking', ?, ?, 'cancelled', ?)
                        `;

                        let pending = activeBookings.length;
                        let failed = false;

                        for (const b of activeBookings) {
                            db.run(insertBookingAuditQuery, [b.id, b.status, user_id], (bAuditErr) => {
                                if (bAuditErr) {
                                    failed = true;
                                }
                                if (--pending === 0) {
                                    if (failed) {
                                        res.status(500).json({ error: 'Bookings cancelled, but failed to write some audit logs' });
                                    } else {
                                        res.status(200).json({ message: `Ride successfully transitioned to ${status}` });
                                    }
                                }
                            });
                        }
                    });
                });
            });
        });
    });
};