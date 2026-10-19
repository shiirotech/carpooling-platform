import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../db/database.js';
import { User, SafeUser } from '../models/user.model.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET is not defined in the .env file');
}

export const register = (req: Request, res: Response): void => {
    const { name, email, password, roles } = req.body;

    if (!name || !email || !password) {
        res.status(400).json({ error: 'Provide name, email and password' });
        return;
    }

    // default role will be Passenger
    const allowedRoles = ['Passenger', 'Driver', 'Driver,Passenger'];
    const userRole = roles && allowedRoles.includes(roles) ? roles : 'Passenger';
    const password_hash = bcrypt.hashSync(password, 10);

    const query = `INSERT INTO users (name, email, password_hash, roles) VALUES (?, ?, ?, ?)`;

    db.run(query, [name, email, password_hash, userRole], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                res.status(409).json({ error: 'Email is already in use' });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
            return;
        }

        const newUser: SafeUser = {
            id: this.lastID,
            name,
            email,
            roles: userRole
        };

        res.status(201).json({ message: 'User registered successfully', user: newUser });
    });
};

export const login = (req: Request, res: Response): void => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }

    const query = `SELECT * FROM users WHERE email = ?`;

    db.get(query, [email], (err, row: User) => {
        if (err) {
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        if (!row) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const passwordMatch = bcrypt.compareSync(password, row.password_hash);

        if (!passwordMatch) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const token = jwt.sign(
            { id: row.id, roles: row.roles },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const userLogged: SafeUser = {
            id: row.id!,
            name: row.name,
            email: row.email,
            roles: row.roles
        };

        res.status(200).json({ message: 'Login successful', token, user: userLogged });
    });
};