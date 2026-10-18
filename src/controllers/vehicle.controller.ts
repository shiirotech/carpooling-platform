import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';
import { Vehicle } from '../models/vehicle.model.js';

export const createVehicle = (req: AuthRequest, res: Response): void => {
    const { make, model, plate_number, seats } = req.body;
    const user_id = req.user?.id;

    if (!make || !model || !plate_number || !seats) {
        res.status(400).json({ error: 'All vehicle fields are required!' });
        return;
    }

    const query = `INSERT INTO vehicles (make, model, plate_number, seats, user_id) VALUES (?, ?, ?, ?, ?)`;

    db.run(query, [make, model, plate_number, seats, user_id], function(err) {
        if (err) {
            res.status(500).json({ error: 'Failed to create vehicle' });
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
    const vehicle_id = req.params.id;
    const user_id = req.user?.id;
    const { make, model, plate_number, seats } = req.body;

    const query = `UPDATE vehicles SET make = ?, model = ?, plate_number = ?, seats = ? WHERE id = ? AND user_id = ?`;

    db.run(query, [make, model, plate_number, seats, vehicle_id, user_id], function(err) {
        if (err) {
            res.status(500).json({ error: 'Failed to update vehicle' });
            return;
        }

        if (this.changes === 0) {
            res.status(404).json({ error: 'Vehicle not found or access denied' });
            return;
        }

        res.status(200).json({ message: 'Vehicle updated successfully '});
    });
};

export const deleteVehicle = (req: AuthRequest, res: Response): void => {
    const vehicle_id = req.params.id;
    const user_id = req.user?.id;

    // check if the vehicle is used in any future rides and the ride is not cancelled
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