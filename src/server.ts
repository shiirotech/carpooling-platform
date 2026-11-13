import express, { Express, Request, Response } from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import userRoutes from './routes/user.routes.js';
import rideRoutes from './routes/ride.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import ratingRoutes from './routes/rating.routes.js';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // parses incoming JSON payloads
app.use(morgan('dev')); // logs reqs to the terminal


app.get('/api/ping', (_req: Request, res: Response) => {
    res.json({ message: 'Carpooling API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ratings', ratingRoutes);

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});