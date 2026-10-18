import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET is not defined in the .env file');
}

// create a custom interface, which extends Request in order to introduce a 'user' property
export interface AuthRequest extends Request {
    user?: {
        id: number;
        roles: string;
    };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Access denied. No token provided' });
        return;
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            res.status(403).json({ error: 'Invalid or expired token' });
            return;
        }

        req.user = decoded as { id: number; roles: string };

        next();
    });
};

// quick helper to protect routes meant only for specific roles
export const requireRole = (requiredRole: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const userRoles = req.user.roles.split(',');

        if (!userRoles.includes(requiredRole)) {
            res.status(403).json({ error: `Access denied. Requires ${requiredRole} role` });
            return;
        }

        next();
    };
};