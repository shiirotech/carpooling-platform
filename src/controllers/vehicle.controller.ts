import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';
import { Vehicle } from '../models/vehicle.model.js';

export const createVehicle = (req: AuthRequest, res: Response): void => {
    const { make, model, plate_number, seats } = req.body;
    const user_id = req.user?.id;

    if (!make || !model || !plate_number || !seats) {
        res.status(400).json({ error: 'All vehicle fields are required' });
        return;
    }

    const query = `INSERT INTO vehicles (make, model, plate_number, seats, user_id) VALUES (?, ?, ?, ?, ?)`;

    db.run(query, [make, model, plate_number, seats, user_id], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                res.status(409).json({ error: 'A vehicle with this plate number is already registered' });
            } else {
                res.status(500).json({ error: 'Failed to create vehicle' });
            }
            return;
        }

        res.status(201).json({ message: 'Vehicle created successfully', id: this.lastID });
    });
};

export const readVehicles = (req: AuthRequest, res: Response): void => {
    const user_id = req.user?.id;
    
    const query = `SELECT * FROM vehicles WHERE user_id = ?`;

    db.all(query, [user_id], (err, rows: Vehicle[]) => {
        if (err) {
            res.status(500).json({ error: 'Failed to retrieve vehicle(s)' });
            return;
        }

        res.status(200).json(rows);
    });
};

export const updateVehicle = (req: AuthRequest, res: Response): void => {
    const vehicle_id = Number(req.params.id);
    const user_id = req.user?.id;
    const { make, model, plate_number, seats } = req.body;

    if (!make && !model && plate_number === undefined && seats === undefined) {
        res.status(400).json({ error: 'Provide at least one field to update' });
        return;
    }

    // fetch current vehicle data to check existing seat count
    const getVehicleSeatsQuery = `SELECT seats FROM vehicles WHERE id = ? AND user_id = ?`;

    db.get(getVehicleSeatsQuery, [vehicle_id, user_id], (err, vehicle: { seats: number }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while fetching vehicle' });
            return;
        }
        
        if (!vehicle) {
            res.status(404).json({ error: 'Vehicle not found or access denied' });
            return;
        }

        const oldSeats = vehicle.seats;
        const newSeats = seats !== undefined ? Number(seats) : oldSeats;

        if (!Number.isInteger(newSeats) || newSeats <= 0) {
            res.status(400).json({ error: 'Vehicle must have a valid number of seats greater than 0' });
            return;
        }

        // we need to check the new number of seats and perform some business logic
        if (newSeats !== oldSeats) {
            // find any active or upcoming rides using this vehicle
            const futureRidesQuery = `
                SELECT r.id, r.status, r.seats_offered, 
                    (SELECT IFNULL(SUM(b.seats), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status = 'accepted') as booked_seats
                FROM rides r
                WHERE r.vehicle_id = ? AND r.status NOT IN ('finished', 'cancelled', 'departed')
            `;

            db.all(futureRidesQuery, [vehicle_id], (err, activeRides: any[]) => {
                if (err) {
                    res.status(500).json({ error: 'Database error during ride validation' });
                    return;
                }

                if (newSeats < oldSeats) {
                    for (const ride of activeRides) {
                        if (newSeats - 1 < ride.booked_seats) {
                            res.status(400).json({ 
                                error: 'Cannot reduce vehicle seats: all current seats are booked' 
                            });
                            return;
                        }
                    }
                }

                // update and handle potential status changes if capacity increased
                executeDatabaseUpdate(activeRides);
            });
        } else {
            // Seats didn't change, safe to update other fields directly
            executeDatabaseUpdate([]);
        }

        function executeDatabaseUpdate(activeRides: any[]) {
            const fields: string[] = [];
            const params: (string | number)[] = [];

            if (make) {
                fields.push('make = ?');
                params.push(make);
            }

            if (model) {
                fields.push('model = ?');
                params.push(model);
            }

            if (plate_number !== undefined) {
                fields.push('plate_number = ?');
                params.push(plate_number);
            }

            if (seats !== undefined) {
                fields.push('seats = ?');
                params.push(newSeats);
            }

            params.push(vehicle_id, user_id!);

            const updateQuery = `UPDATE vehicles SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`;

            db.run(updateQuery, params, function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        res.status(409).json({ error: 'A vehicle with this plate number is already registered' });
                    } else {
                        res.status(500).json({ error: 'Failed to update vehicle' });
                    }
                    return;
                }

                if (this.changes === 0) {
                    res.status(404).json({ error: 'Vehicle not found or access denied' });
                    return;
                }

                const rideUpdates: [number, string, number][] = [];

                if (newSeats !== oldSeats) {
                    const delta = newSeats - oldSeats;

                    for (const ride of activeRides) {
                        let updatedSeatsOffered = ride.seats_offered;
                        let updatedStatus = ride.status;

                        if (newSeats > oldSeats) {
                            updatedSeatsOffered += delta;
                            if (ride.status === 'full') {
                                updatedStatus = 'open';
                            }
                        } else {
                            updatedSeatsOffered = newSeats - 1
                            if (ride.booked_seats >= updatedSeatsOffered) {
                                updatedStatus = 'full';
                            }
                        }

                        if (updatedSeatsOffered !== ride.seats_offered || updatedStatus !== ride.status) {
                            rideUpdates.push([updatedSeatsOffered, updatedStatus, ride.id]);
                        }
                    }
                }

                if (rideUpdates.length === 0) {
                    res.status(200).json({ message: 'Vehicle updated successfully' });
                    return;
                }

                let pending = rideUpdates.length;
                let failed = false;

                const updateRideQuery = `UPDATE rides SET seats_offered = ?, status = ? WHERE id = ?`;

                for (const params of rideUpdates) {
                    db.run(updateRideQuery, params, (err) => {
                        if (err) {
                            console.error(`Failed to synchronize ride ID ${params[2]}:`, err);
                            failed = true;
                        }
                        if (--pending === 0) {
                            if (failed) {
                                res.status(500).json({ error: 'Vehicle updated, but some rides could not be synchronized' });
                            } else {
                                res.status(200).json({ message: 'Vehicle updated successfully' });
                            }
                        }
                    });
                }
            });
        }
    });
};

export const deleteVehicle = (req: AuthRequest, res: Response): void => {
    const vehicle_id = req.params.id;
    const user_id = req.user?.id;

    // check if the vehicle is used in any future non-cancelled rides
    const checkQuery = `
        SELECT COUNT(*) as count FROM rides
        WHERE vehicle_id = ? AND departure > datetime('now') AND status != 'cancelled'
    `;

    db.get(checkQuery, [vehicle_id], (err, row: { count: number }) => {
        if (err) {
            res.status(500).json({ error: 'Database error during validation' });
            return;
        }

        if (row.count > 0) {
            res.status(400).json({ error: 'Cannot delete a vehicle used in a future ride' });
            return;
        }

        // if safe, proceed to deleting
        const deleteQuery = `DELETE FROM vehicles WHERE id = ? AND user_id = ?`;
        db.run(deleteQuery, [vehicle_id, user_id], function(err) {
            if (err) {
                res.status(500).json({ error: 'Failed to delete vehicle' });
                return;
            }

            if (this.changes === 0) {
                res.status(404).json({ error: 'Vehicle not found or access denied' });
                return;
            }

            res.status(200).json({ message: 'Vehicle deleted successfully' });
        });
    });
};