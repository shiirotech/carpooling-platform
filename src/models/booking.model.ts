export interface Booking {
    id?: number;
    seats: number;
    status: string; // 'pending', 'accepted', 'rejected', 'cancelled'
    created_at?: string;
    ride_id: number;
    passenger_id: number;
}