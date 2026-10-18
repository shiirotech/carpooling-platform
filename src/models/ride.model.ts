export interface Ride {
    id?: number;
    origin: string;
    destination: string;
    departure: string;
    seats_offered: number;
    price: number;
    status: string; // 'open', 'full', 'finished', 'cancelled', 'departed'
    driver_id: number;
    vehicle_id: number;
}