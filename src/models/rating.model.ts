export interface Rating {
    id?: number;
    value: number; // 1 to 5
    comment?: string;
    ride_id: number;
    passenger_id: number;
    driver_id: number;
}