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

    // base query: only future rides that are bookable or full
    let query = `
        SELECT id, origin, destination, departure, price, seats_offered, status 
        FROM rides 
        WHERE departure > datetime('now') 
        AND status IN ('open', 'full')
    `;
    
    const params: (string | number)[] = [];

    if (origin) {
        // using LIKE for case-insensitive, partial matching ("Warsaw" matches "Warsaw Central")
        query += ` AND origin LIKE ?`;
        params.push(`%${origin}%`);
    }

    if (destination) {
        query += ` AND destination LIKE ?`;
        params.push(`%${destination}%`);
    }

    if (date) {
        // use SQLite's date() function to ignore the time of day and match just the calendar date
        query += ` AND date(departure) = date(?)`;
        params.push(date);
    }

    // Order results logically (soonest rides first)
    query += ` ORDER BY departure ASC`;

    db.all(query, params, (err, rides: any[]) => {
        if (err) {
            res.status(500).json({ error: 'Database error while searching for rides' });
            return;
        }

        res.status(200).json(rides);
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
    const driver_id = req.user?.id;
    const { status } = req.body;

    if (!Number.isInteger(ride_id) || ride_id <= 0) {
        res.status(400).json({ error: 'Invalid ride ID format' });
        return;
    }

    // Driver can only manually transition to these states
    const allowedStatuses = ['departed', 'finished', 'cancelled'];
    
    if (!status || !allowedStatuses.includes(status)) {
        res.status(400).json({ 
            error: `Invalid status update. Allowed manual statuses are: ${allowedStatuses.join(', ')}` 
        });
        return;
    }

    // fetch current ride status to enforce logical state transitions
    const getRideQuery = `SELECT status FROM rides WHERE id = ? AND driver_id = ?`;

    db.get(getRideQuery, [ride_id, driver_id], (err, ride: { status: string }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while verifying ride' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found or access denied' });
            return;
        }

        const currentStatus = ride.status;

        // Prevent from changing terminal states (dead ends)
        if (currentStatus === 'cancelled' || currentStatus === 'finished') {
            res.status(400).json({ error: `Ride is already ${currentStatus} and cannot be changed further` });
            return;
        }

        // Enforce chronological order
        if (status === 'finished' && currentStatus !== 'departed') {
            res.status(400).json({ error: 'Ride must be marked as departed before it can be finished' });
            return;
        }

        if (status === 'departed' && currentStatus === 'departed') {
            res.status(400).json({ error: 'Ride has already departed' });
            return;
        }

        // If all checks pass, execute the update
        const updateQuery = `UPDATE rides SET status = ? WHERE id = ?`;

        db.run(updateQuery, [status, ride_id], function(err) {
            if (err) {
                res.status(500).json({ error: 'Failed to update ride status' });
                return;
            }

            res.status(200).json({ message: `Ride successfully transitioned to ${status}` });
        });
    });
};