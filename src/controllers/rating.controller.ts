import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';

/*
 * Passenger rates the driver after a ride is finished (1 to 5, optional comment).
 * Only passengers with an accepted booking can rate and only once per ride.
 */
export const createRating = (req: AuthRequest, res: Response): void => {
    const passenger_id = req.user?.id;
    const { ride_id, value, comment } = req.body;

    if (ride_id === undefined || value === undefined) {
        res.status(400).json({ error: 'Ride ID and rating value are required' });
        return;
    }

    const numRideId = Number(ride_id);
    const numValue = Number(value);

    if (!Number.isInteger(numRideId) || numRideId <= 0) {
        res.status(400).json({ error: 'Ride ID must be a positive integer' });
        return;
    }

    if (!Number.isInteger(numValue) || numValue < 1 || numValue > 5) {
        res.status(400).json({ error: 'Rating value must be an integer between 1 and 5' });
        return;
    }

    let sanitizedComment: string | null = null;
    if (comment !== undefined && comment !== null) {
        if (typeof comment !== 'string') {
            res.status(400).json({ error: 'Comment must be a string' });
            return;
        }
        const trimmed = comment.trim();
        if (trimmed.length > 0) {
            sanitizedComment = trimmed;
        }
    }

    // 1. Fetch ride to verify it exists and is finished
    const getRideQuery = `SELECT id, driver_id, status FROM rides WHERE id = ?`;

    db.get(getRideQuery, [numRideId], (err, ride: { id: number; driver_id: number; status: string }) => {
        if (err) {
            res.status(500).json({ error: 'Database error while verifying ride' });
            return;
        }

        if (!ride) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }

        if (ride.driver_id === passenger_id) {
            res.status(400).json({ error: 'Drivers cannot rate themselves' });
            return;
        }

        if (ride.status !== 'finished') {
            res.status(400).json({ error: 'You can only rate a driver after the ride is finished' });
            return;
        }

        // 2. Verify passenger had an accepted booking for this ride
        const checkBookingQuery = `
            SELECT id FROM bookings 
            WHERE ride_id = ? AND passenger_id = ? AND status = 'accepted'
        `;

        db.get(checkBookingQuery, [numRideId, passenger_id], (bErr, booking) => {
            if (bErr) {
                res.status(500).json({ error: 'Database error while verifying booking' });
                return;
            }

            if (!booking) {
                res.status(403).json({ error: 'Only passengers with an accepted booking for this ride can rate the driver' });
                return;
            }

            // 3. Enforce once-per-ride rating limit
            const checkExistingRatingQuery = `
                SELECT id FROM ratings 
                WHERE ride_id = ? AND passenger_id = ?
            `;

            db.get(checkExistingRatingQuery, [numRideId, passenger_id], (rErr, existingRating) => {
                if (rErr) {
                    res.status(500).json({ error: 'Database error while checking existing ratings' });
                    return;
                }

                if (existingRating) {
                    res.status(409).json({ error: 'You have already rated the driver for this ride' });
                    return;
                }

                // 4. Insert rating
                const insertRatingQuery = `
                    INSERT INTO ratings (value, comment, ride_id, passenger_id, driver_id)
                    VALUES (?, ?, ?, ?, ?)
                `;

                db.run(insertRatingQuery, [numValue, sanitizedComment, numRideId, passenger_id, ride.driver_id], function (insertErr) {
                    if (insertErr) {
                        res.status(500).json({ error: 'Failed to submit rating' });
                        return;
                    }

                    res.status(201).json({
                        message: 'Rating submitted successfully',
                        rating_id: this.lastID,
                        value: numValue,
                        comment: sanitizedComment,
                        ride_id: numRideId,
                        driver_id: ride.driver_id
                    });
                });
            });
        });
    });
};

/*
 * Retrieve ratings (publicly readable, supports optional ?driver_id= and ?ride_id= filters).
 * Also returns summary statistics (average_rating and total_ratings) for the matching scope.
 */
export const readRatings = (req: Request, res: Response): void => {
    const driverIdParam = req.query.driver_id as string | undefined;
    const rideIdParam = req.query.ride_id as string | undefined;

    let whereClause = `WHERE 1=1`;
    const params: number[] = [];

    if (driverIdParam !== undefined && driverIdParam.trim() !== '') {
        const numDriverId = Number(driverIdParam);
        if (!Number.isInteger(numDriverId) || numDriverId <= 0) {
            res.status(400).json({ error: 'Driver id must be a positive integer' });
            return;
        }
        whereClause += ` AND rt.driver_id = ?`;
        params.push(numDriverId);
    }

    if (rideIdParam !== undefined && rideIdParam.trim() !== '') {
        const numRideId = Number(rideIdParam);
        if (!Number.isInteger(numRideId) || numRideId <= 0) {
            res.status(400).json({ error: 'Ride id must be a positive integer' });
            return;
        }
        whereClause += ` AND rt.ride_id = ?`;
        params.push(numRideId);
    }

    const summaryQuery = `
        SELECT 
            COUNT(*) AS total_ratings,
            ROUND(AVG(rt.value), 2) AS average_rating
        FROM ratings rt
        ${whereClause}
    `;

    db.get(summaryQuery, params, (sumErr, summary: { total_ratings: number; average_rating: number | null }) => {
        if (sumErr) {
            res.status(500).json({ error: 'Database error while summarizing ratings' });
            return;
        }

        const listQuery = `
            SELECT 
                rt.id,
                rt.value,
                rt.comment,
                rt.ride_id,
                rt.passenger_id,
                rt.driver_id,
                p.name AS passenger_name,
                d.name AS driver_name,
                r.origin,
                r.destination,
                r.departure
            FROM ratings rt
            JOIN users p ON rt.passenger_id = p.id
            JOIN users d ON rt.driver_id = d.id
            JOIN rides r ON rt.ride_id = r.id
            ${whereClause}
            ORDER BY rt.id DESC
        `;

        db.all(listQuery, params, (err, ratings: any[]) => {
            if (err) {
                res.status(500).json({ error: 'Database error while retrieving ratings' });
                return;
            }

            res.status(200).json({
                summary: {
                    total_ratings: summary ? summary.total_ratings : 0,
                    average_rating: summary ? summary.average_rating : null
                },
                ratings
            });
        });
    });
};

// admin
export const deleteRating = (req: AuthRequest, res: Response): void => {
    const rating_id = Number(req.params.id);

    if (!Number.isInteger(rating_id) || rating_id <= 0) {
        res.status(400).json({ error: 'Invalid rating ID format' });
        return;
    }

    const deleteQuery = `DELETE FROM ratings WHERE id = ?`;

    db.run(deleteQuery, [rating_id], function (err) {
        if (err) {
            res.status(500).json({ error: 'Failed to delete rating' });
            return;
        }

        if (this.changes === 0) {
            res.status(404).json({ error: 'Rating not found' });
            return;
        }

        res.status(200).json({ message: 'Rating removed successfully' });
    });
};