import { Response } from 'express';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../middleware/auth.middleware.js';
import db from '../db/database.js';
import { SafeUser } from '../models/user.model.js';

export const readProfile = (req: AuthRequest, res: Response): void => {
    const user_id = req.user?.id;

    const query = `SELECT id, name, email, roles FROM users WHERE id = ?`;

    db.get(query, [user_id], (err, row: SafeUser) => {
        if (err) {
            res.status(500).json({ error: 'Failed to fetch user profile' });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.status(200).json(row);
    });
};

export const updateProfile = (req: AuthRequest, res: Response): void => {
    const user_id = req.user?.id;
    const { name, email } = req.body;
    
    if (!name && !email) {
        res.status(400).json({ error: 'Provide at least a name or email to update' });
        return;
    }

    const fields: string[] = [];
    const params: (string | number)[] = [];

    if (name) {
        fields.push('name = ?');
        params.push(name);
    }

    if (email) {
        fields.push('email = ?');
        params.push(email);
    }

    params.push(user_id!);

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

    db.run(query, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                res.status(409).json({ error: 'Email is already in use' });
            } else {
                res.status(500).json({ error: 'Failed to update profile' });
            }
            return;
        }

        res.status(200).json({ message: 'Profile updated successfully' });
    });
};

export const changePassword = (req: AuthRequest, res: Response): void => {
    const user_id = req.user?.id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        res.status(400).json({ error: 'Both old and new passwords are required' });
        return;
    }

    const query = `SELECT password_hash FROM users WHERE id = ?`;

    db.get(query, [user_id], (err, row: { password_hash: string}) => {
        if (err) {
            res.status(500).json({ error: 'Failed to retrieve user data' });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const matches = bcrypt.compareSync(oldPassword, row.password_hash);

        if (!matches) {
            res.status(401).json({ error: 'Incorrect current password' });
            return;
        }

        const newHash = bcrypt.hashSync(newPassword, 10);
        const updateQuery = `UPDATE users SET password_hash = ? WHERE id = ?`;

        db.run(updateQuery, [newHash, user_id], function(err) {
            if (err) {
                res.status(500).json({ error: 'Failed to update password' });
                return;
            }

            res.status(200).json({ message: 'Password updated successfully' });
        });
    });
};

// admin
export const readAllUsers = (_req: AuthRequest, res: Response): void => {
    const query = `SELECT id, name, email, roles FROM users`;

    db.all(query, [], (err, rows: SafeUser[]) => {
        if (err) {
            res.status(500).json({ error: 'Failed to retrieve users' });
            return;
        }

        res.status(200).json(rows);
    });
};

// admin
export const updateUserRoles = (req: AuthRequest, res: Response): void => {
    const target_id = req.params.id;
    const { roles: newRoles } = req.body;

    if (!newRoles) {
        res.status(400).json({ error: 'New roles must be provided' });
        return;
    }

    // fetch user's current roles
    const getUserQuery = `SELECT roles FROM users WHERE id = ?`;
    db.get(getUserQuery, [target_id], (err, targetRow: { roles: string }) => {
        if (err) {
            res.status(500).json({ error: 'Failed to retrieve user roles' });
            return;
        }

        if (!targetRow) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const currentRoles = targetRow.roles.split(',');
        const proposedRoles = newRoles.split(',');

        const losingDriverRole = currentRoles.includes('Driver') && !proposedRoles.includes('Driver');
        const losingPassengerRole = currentRoles.includes('Passenger') && !proposedRoles.includes('Passenger');

        // if losing Driver role, verify no active/future rides exist
        const checkDriverStep = () => {
            if (losingDriverRole) {
                const checkDriverRides = `
                    SELECT COUNT(*) as count FROM rides
                    WHERE driver_id = ? AND status NOT IN ('finished', 'cancelled')
                `;

                db.get(checkDriverRides, [target_id], (err, row: { count: number }) => {
                    if (err) {
                        res.status(500).json({ error: 'Database error during driver validation' });
                        return;
                    }

                    if (row.count > 0) {
                        res.status(400).json({ 
                            error: 'Cannot remove Driver role while user has active or scheduled future rides' 
                        });
                        return;
                    }

                    checkPassengerStep();
                });
            } else {
                checkPassengerStep();
            }
        };
        
        // if losing Passenger role, verify no active/future bookings exist
        const checkPassengerStep = () => {
            if (losingPassengerRole) {
                const checkPassengerBookings = `
                    SELECT COUNT(*) as count FROM bookings b
                    JOIN rides r ON b.ride_id = r.id
                    WHERE b.passenger_id = ?
                    AND b.status NOT IN ('rejected', 'cancelled')
                    AND r.status NOT IN ('finished', 'cancelled')
                `;

                db.get(checkPassengerBookings, [target_id], (err, row: { count: number}) => {
                    if (err) {
                        res.status(500).json({ error: 'Database error during passenger validation' });
                        return;
                    }

                    if (row.count > 0) {
                        res.status(400).json({ 
                            error: 'Cannot remove Passenger role while user has active or upcoming ride bookings' 
                        });
                        return;
                    }

                    applyRoleUpdate();
                });
            } else {
                applyRoleUpdate();
            }
        };

        const applyRoleUpdate = () => {
            const updateQuery = `UPDATE users SET roles = ? WHERE id = ?`;
            
            db.run(updateQuery, [newRoles, target_id], (err) => {
                if (err) {
                    res.status(500).json({ error: 'Failed to update user roles' });
                    return;
                }

                res.status(200).json({ message: 'User roles updated successfully' });
            });
        };

        checkDriverStep();
    });
};