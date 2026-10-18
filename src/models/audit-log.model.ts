export interface AuditLog {
    id?: number;
    entity_type: string; // 'Ride' or 'Booking'
    entity_id: number;
    old_status: string | null;
    new_status: string;
    created_at?: string;
    changed_by_id: number;
}