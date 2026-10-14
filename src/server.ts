import express, { Express, Request, Response } from 'express';
import morgan from 'morgan';

const app: Express = express();
const port = 3000;

// Middleware
app.use(express.json()); // parses incoming JSON payloads
app.use(morgan('dev')); // logs reqs to the terminal


app.get('/api/ping', (req: Request, res: Response) => {
    res.json({message: 'Carpooling API is running'});
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});