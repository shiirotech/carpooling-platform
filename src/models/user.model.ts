export interface User {
    id?: number;
    name: string;
    email: string;
    password_hash: string;
    roles: string;
}

// define a safe type we return to the frontend to avoid leaking password hash
export interface SafeUser {
    id: number;
    name: string;
    email: string;
    roles: string;
}