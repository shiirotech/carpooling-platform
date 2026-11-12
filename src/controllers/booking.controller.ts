import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';

/*
 * Passenger creates a booking request for an open ride.
 * Checks capacity, departure time and prevents drivers from booking own rides.
 */
export const createBooking = (req: AuthRequest, res: Response): void => {
    const passenger_id = req.user?.id;
    const { ride_id, seats } = req.body;

    if (ride_id === undefined || seats === undefined) {
        res.status(400).json({ error: 'Ride ID and seats are required' });
        return;
    }

    const numRideId = Number(ride_id);
    const numSeats = Number(seats);

    if (!Number.isInteger(numRideId) || numRideId <= 0 || !Number.isInteger(numSeats) || numSeats <= 0) {
        res.status(400).json({ error: 'Ride ID and seats must be positive integers' });
        return;
    }

    // 1. Fetch ride details to verify availability, ownership and departure time
    const getRideQuery = `
        SELECT id, driver_id, seats_offered, status, departure 
        FROM rides 
        WHERE id = ?
    `;

    db.get(getRideQuery, [numRideId], (err, ride: { id: number; driver_id: number; seats_offered: number; status: string; departure: string }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while checking ride' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }

        if (ride.driver_id === passenger_id) {
            res.status(400).json({ error: 'Drivers cannot book seats on their own rides' });
            return;
        }

        if (ride.status !== 'open') {
            res.status(400).json({ error: `Cannot book seats on a ride that is ${ride.status}` });
            return;
        }

        const departureDate = new Date(ride.departure);
        if (isNaN(departureDate.getTime()) || departureDate <= new Date()) {
            res.status(400).json({ error: 'Cannot book seats for past or departing rides' });
            return;
        }

        // 2. Prevent duplicate active/pending bookings from the same passenger
        const checkExistingQuery = `
            SELECT id FROM bookings 
            WHERE ride_id = ? AND passenger_id = ? AND status IN ('pending', 'accepted')
        `;

        db.get(checkExistingQuery, [numRideId, passenger_id], (err, existingBooking) => {
            if (err) {
                res.status(500).json({ error: 'Database error while checking existing bookings' });
                return;
            }

            if (existingBooking) {
                res.status(400).json({ error: 'You already have an active or pending booking for this ride' });
                return;
            }

            // 3. Check seat availability
            const getAcceptedSeatsQuery = `
                SELECT IFNULL(SUM(seats), 0) AS accepted_seats 
                FROM bookings 
                WHERE ride_id = ? AND status = 'accepted'
            `;

            db.get(getAcceptedSeatsQuery, [numRideId], (err, seatRow: { accepted_seats: number }) => {
                if (err) {
                    res.status(500).json({ error: 'Database error while checking available seats' });
                    return;
                }

                const availableSeats = ride.seats_offered - seatRow.accepted_seats;

                if (numSeats > availableSeats) {
                    res.status(400).json({ 
                        error: `Not enough free seats available. Only ${availableSeats} seat(s) remaining` 
                    });
                    return;
                }

                // 4. Insert booking with status 'pending'
                const insertBookingQuery = `
                    INSERT INTO bookings (ride_id, passenger_id, seats, status) 
                    VALUES (?, ?, ?, 'pending')
                `;

                db.run(insertBookingQuery, [numRideId, passenger_id, numSeats], function (err) {
                    if (err) {
                        res.status(500).json({ error: 'Failed to create booking' });
                        return;
                    }

                    res.status(201).json({ 
                        message: 'Booking request submitted successfully', 
                        booking_id: this.lastID,
                        status: 'pending',
                        seats: numSeats,
                        ride_id: numRideId
                    });
                });
            });
        });
    });
};

/*
 * Driver responds to a pending booking (accept or reject).
 * When accepting:
 *  - Verifies driver owns the ride
 *  - Checks remaining capacity in real time
 *  - Updates booking status to 'accepted'
 *  - If ride is now fully occupied, automatically transitions ride status to 'full'
 *  - Records event in audit log
 */
export const respondToBooking = (req: AuthRequest, res: Response): void => {
    const driver_id = req.user?.id;
    const booking_id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(booking_id) || booking_id <= 0) {
        res.status(400).json({ error: 'Invalid booking ID' });
        return;
    }

    if (!status || !['accepted', 'rejected'].includes(status)) {
        res.status(400).json({ error: "Decision status must be either 'accepted' or 'rejected'" });
        return;
    }

    // 1. Fetch booking and associated ride information to verify ownership and state
    const getBookingAndRideQuery = `
        SELECT 
            b.id AS booking_id, 
            b.seats AS requested_seats, 
            b.status AS booking_status, 
            b.ride_id,
            b.passenger_id,
            r.driver_id, 
            r.seats_offered, 
            r.status AS ride_status,
            r.departure
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        WHERE b.id = ?
    `;

    db.get(getBookingAndRideQuery, [booking_id], (err, row: any) => {
        if (err) {
            res.status(500).json({ error: 'Database error while retrieving booking details' });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'Booking not found' });
            return;
        }

        if (row.driver_id !== driver_id) {
            res.status(403).json({ error: 'Access denied. Only the ride driver can respond to bookings' });
            return;
        }

        if (row.booking_status !== 'pending') {
            res.status(400).json({ 
                error: `Booking has already been ${row.booking_status} and cannot be modified` 
            });
            return;
        }

        if (['finished', 'cancelled'].includes(row.ride_status)) {
            res.status(400).json({ 
                error: `Cannot process bookings for a ${row.ride_status} ride` 
            });
            return;
        }

        // 2. Decision logic: rejecting
        if (status === 'rejected') {
            const rejectQuery = `UPDATE bookings SET status = 'rejected' WHERE id = ?`;

            db.run(rejectQuery, [booking_id], function (err) {
                if (err) {
                    res.status(500).json({ error: 'Failed to reject booking' });
                    return;
                }

                // log
                const auditQuery = `
                    INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                    VALUES ('Booking', ?, 'pending', 'rejected', ?)
                `;

                db.run(auditQuery, [booking_id, driver_id], (auditErr) => {
                    if (auditErr) {
                        res.status(500).json({ error: 'Booking rejected, but failed to write audit log' });
                        return;
                    }

                    res.status(200).json({ message: 'Booking rejected successfully' });
                });
            });
            return;
        }

        // 3. Decision logic: accepting
        const checkCapacityQuery = `
            SELECT IFNULL(SUM(seats), 0) AS current_accepted_seats 
            FROM bookings 
            WHERE ride_id = ? AND status = 'accepted'
        `;

        db.get(checkCapacityQuery, [row.ride_id], (err, capRow: { current_accepted_seats: number }) => {
            if (err) {
                res.status(500).json({ error: 'Database error while verifying available seats' });
                return;
            }

            const availableSeats = row.seats_offered - capRow.current_accepted_seats;

            if (row.requested_seats > availableSeats) {
                res.status(400).json({ 
                    error: `Cannot accept booking. Insufficient seats available (requested ${row.requested_seats}, available ${availableSeats})` 
                });
                return;
            }

            const acceptQuery = `UPDATE bookings SET status = 'accepted' WHERE id = ?`;

            db.run(acceptQuery, [booking_id], function (err) {
                if (err) {
                    res.status(500).json({ error: 'Failed to accept booking' });
                    return;
                }

                // log
                const bookingAuditQuery = `
                    INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                    VALUES ('Booking', ?, 'pending', 'accepted', ?)
                `;

                db.run(bookingAuditQuery, [booking_id, driver_id], (auditErr) => {
                    if (auditErr) {
                        res.status(500).json({ error: 'Booking accepted, but failed to write audit log' });
                        return;
                    }

                    // 4. Automated state transition
                    const newTotalAccepted = capRow.current_accepted_seats + row.requested_seats;

                    if (newTotalAccepted >= row.seats_offered && row.ride_status === 'open') {
                        const updateRideQuery = `UPDATE rides SET status = 'full' WHERE id = ?`;

                        db.run(updateRideQuery, [row.ride_id], function (rideErr) {
                            if (rideErr) {
                                res.status(500).json({ error: 'Booking accepted, but failed to update ride status to full' });
                                return;
                            }

                            // log
                            const rideAuditQuery = `
                                INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                                VALUES ('Ride', ?, 'open', 'full', ?)
                            `;

                            db.run(rideAuditQuery, [row.ride_id, driver_id], (rAuditErr) => {
                                if (rAuditErr) {
                                    res.status(500).json({ error: 'Ride marked as full, but failed to write audit log' });
                                    return;
                                }

                                res.status(200).json({ 
                                    message: 'Booking accepted successfully. Ride is now full', 
                                    ride_status: 'full' 
                                });
                            });
                        });
                    } else {
                        res.status(200).json({ 
                            message: 'Booking accepted successfully', 
                            ride_status: row.ride_status 
                        });
                    }
                });
            });
        });
    });
};

/*
 * Passenger cancels their own booking before ride departure.
 * If an accepted booking is cancelled and the ride was full, frees up capacity
 * and transitions the ride back from 'full' to 'open'.
 */
export const cancelBooking = (req: AuthRequest, res: Response): void => {
    const passenger_id = req.user?.id;
    const booking_id = Number(req.params.id);

    if (!Number.isInteger(booking_id) || booking_id <= 0) {
        res.status(400).json({ error: 'Invalid booking ID' });
        return;
    }

    const getBookingQuery = `
        SELECT 
            b.id AS booking_id, 
            b.seats, 
            b.status AS booking_status, 
            b.ride_id, 
            b.passenger_id,
            r.departure, 
            r.status AS ride_status
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        WHERE b.id = ? AND b.passenger_id = ?
    `;

    db.get(getBookingQuery, [booking_id, passenger_id], (err, row: any) => {
        if (err) {
            res.status(500).json({ error: 'Database error while fetching booking' });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'Booking not found or you do not have permission to cancel it' });
            return;
        }

        if (row.booking_status === 'cancelled' || row.booking_status === 'rejected') {
            res.status(400).json({ error: `Booking is already ${row.booking_status}` });
            return;
        }

        // Must cancel before ride departure
        const departureDate = new Date(row.departure);
        if (isNaN(departureDate.getTime()) || departureDate <= new Date()) {
            res.status(400).json({ error: 'Cannot cancel a booking after departure time has passed' });
            return;
        }

        if (['departed', 'finished', 'cancelled'].includes(row.ride_status)) {
            res.status(400).json({ error: `Cannot cancel booking because ride is ${row.ride_status}` });
            return;
        }

        const oldBookingStatus = row.booking_status;
        const cancelQuery = `UPDATE bookings SET status = 'cancelled' WHERE id = ?`;

        db.run(cancelQuery, [booking_id], function (err) {
            if (err) {
                res.status(500).json({ error: 'Failed to cancel booking' });
                return;
            }

            // log
            const auditQuery = `
                INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                VALUES ('Booking', ?, ?, 'cancelled', ?)
            `;

            db.run(auditQuery, [booking_id, oldBookingStatus, passenger_id], (auditErr) => {
                if (auditErr) {
                    res.status(500).json({ error: 'Booking cancelled, but failed to write audit log' });
                    return;
                }

                // If the booking was accepted and the ride was full, transition ride back to 'open'
                if (oldBookingStatus === 'accepted' && row.ride_status === 'full') {
                    const reopenRideQuery = `UPDATE rides SET status = 'open' WHERE id = ?`;

                    db.run(reopenRideQuery, [row.ride_id], function (rideErr) {
                        if (rideErr) {
                            res.status(500).json({ error: 'Booking cancelled, but failed to reopen ride' });
                            return;
                        }

                        // log
                        const rideAuditQuery = `
                            INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id)
                            VALUES ('Ride', ?, 'full', 'open', ?)
                        `;

                        db.run(rideAuditQuery, [row.ride_id, passenger_id], (rAuditErr) => {
                            if (rAuditErr) {
                                res.status(500).json({ error: 'Ride reopened, but failed to write audit log' });
                                return;
                            }

                            res.status(200).json({ 
                                message: 'Booking cancelled successfully. Ride status changed to open',
                                ride_status: 'open'
                            });
                        });
                    });
                } else {
                    res.status(200).json({ message: 'Booking cancelled successfully' });
                }
            });
        });
    });
};

// Passenger views all their own bookings with ride and driver details
export const readAllBookings = (req: AuthRequest, res: Response): void => {
    const passenger_id = req.user?.id;

    const query = `
        SELECT 
            b.id, 
            b.seats, 
            b.status, 
            b.created_at, 
            b.ride_id,
            r.origin, 
            r.destination, 
            r.departure, 
            r.price, 
            r.status AS ride_status,
            u.name AS driver_name, 
            u.email AS driver_email,
            v.make AS vehicle_make, 
            v.model AS vehicle_model, 
            v.plate_number AS vehicle_plate
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON r.driver_id = u.id
        JOIN vehicles v ON r.vehicle_id = v.id
        WHERE b.passenger_id = ?
        ORDER BY b.created_at DESC
    `;

    db.all(query, [passenger_id], (err, bookings: any[]) => {
        if (err) {
            res.status(500).json({ error: 'Failed to retrieve bookings' });
            return;
        }

        res.status(200).json(bookings);
    });
};

// Driver views bookings for a specific ride they own
export const getRideBookings = (req: AuthRequest, res: Response): void => {
    const driver_id = req.user?.id;
    const ride_id = Number(req.params.id);

    if (!Number.isInteger(ride_id) || ride_id <= 0) {
        res.status(400).json({ error: 'Invalid ride ID' });
        return;
    }

    // Verify driver owns the ride
    const verifyRideQuery = `SELECT id FROM rides WHERE id = ? AND driver_id = ?`;

    db.get(verifyRideQuery, [ride_id, driver_id], (err, ride) => {
        if (err) {
            res.status(500).json({ error: 'Database error while verifying ride' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found or access denied' });
            return;
        }

        const query = `
            SELECT 
                b.id, 
                b.seats, 
                b.status, 
                b.created_at, 
                b.ride_id, 
                b.passenger_id,
                u.name AS passenger_name, 
                u.email AS passenger_email
            FROM bookings b
            JOIN users u ON b.passenger_id = u.id
            WHERE b.ride_id = ?
            ORDER BY b.created_at DESC
        `;

        db.all(query, [ride_id], (err, bookings: any[]) => {
            if (err) {
                res.status(500).json({ error: 'Failed to retrieve ride bookings' });
                return;
            }

            res.status(200).json(bookings);
        });
    });
};