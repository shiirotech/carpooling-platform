import express, { Express, Request, Response } from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import vehicleRoutes from './routes/vehicle.routes.js';
import userRoutes from './routes/user.routes.js';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // parses incoming JSON payloads
app.use(morgan('dev')); // logs reqs to the terminal


app.get('/api/ping', (_req: Request, res: Response) => {
    res.json({message: 'Carpooling API is running'});
});

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/users', userRoutes);

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});