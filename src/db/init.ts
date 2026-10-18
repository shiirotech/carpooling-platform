import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const db = new sqlite3.Database('carpooling.db', (err) => {
    if (err) {
        console.error('Error opening database: ', err.message);
        process.exit(1);
    }
    console.log('Connected to the SQLite database');
});

db.serialize(() => {
    // Enforce foreign key constraints and protect from deleting dependent entries
    db.run('PRAGMA foreign_keys = ON');

    // This is initialization script, so I am deleting the tables if exist to ensure db is clean
    db.run(`DROP TABLE IF EXISTS audit_logs`);
    db.run(`DROP TABLE IF EXISTS ratings`);
    db.run(`DROP TABLE IF EXISTS bookings`);
    db.run(`DROP TABLE IF EXISTS rides`);
    db.run(`DROP TABLE IF EXISTS vehicles`);
    db.run(`DROP TABLE IF EXISTS users`);

    // 1. Create user table
    db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            roles TEXT NOT NULL
        )`
    );

    // 2. Create vehicles table
    db.run(`CREATE TABLE vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            make TEXT NOT NULL,
            model TEXT NOT NULL,
            plate_number TEXT NOT NULL,
            seats INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`
    );

    // 3. Create rides table
    db.run(`CREATE TABLE rides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            departure DATETIME NOT NULL,
            seats_offered INTEGER NOT NULL,
            price REAL NOT NULL,
            status TEXT NOT NULL,
            driver_id INTEGER NOT NULL,
            vehicle_id INTEGER NOT NULL,
            FOREIGN KEY (driver_id) REFERENCES users (id),
            FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
        )`
    );

    // 4. Create bookings table
    db.run(`CREATE TABLE bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seats INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ride_id INTEGER NOT NULL,
            passenger_id INTEGER NOT NULL,
            FOREIGN KEY (ride_id) REFERENCES rides (id),
            FOREIGN KEY (passenger_id) REFERENCES users (id)
        )`
    );

    // 5. Create ratings table
    db.run(`CREATE TABLE ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            value INTEGER NOT NULL,
            comment TEXT,
            ride_id INTEGER NOT NULL,
            passenger_id INTEGER NOT NULL,
            driver_id INTEGER NOT NULL,
            FOREIGN KEY (ride_id) REFERENCES rides (id),
            FOREIGN KEY (passenger_id) REFERENCES users (id),
            FOREIGN KEY (driver_id) REFERENCES users (id)
        )`
    );

    // 6. Create audit log table
    db.run(`CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            old_status TEXT,
            new_status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            changed_by_id INTEGER NOT NULL,
            FOREIGN KEY (changed_by_id) REFERENCES users (id)
        )`
    );

    // Generate a reusable password hash for all demo accounts
    const DEFAULT_USER_PASSWORD = process.env.DEFAULT_USER_PASSWORD;
    if (!DEFAULT_USER_PASSWORD) {
        throw new Error('FATAL ERROR: DEFAULT_USER_PASSWORD is not defined in the .env file');
    }
    const hash = bcrypt.hashSync(DEFAULT_USER_PASSWORD, 10);

    console.log('Inserting demo users...');

    // 1. Insert users (1 Admin, 3 Drivers, 5 Passengers - user 4 has both roles)
    const users = [
        ['Admin', 'admin@test.com', hash, 'Administrator'],
        ['Driver One', 'd1@test.com', hash, 'Driver'],
        ['Driver Two', 'd2@test.com', hash, 'Driver'],
        ['Driver/Pass', 'dp@test.com', hash, 'Driver,Passenger'],
        ['Pass One', 'p1@test.com', hash, 'Passenger'],
        ['Pass Two', 'p2@test.com', hash, 'Passenger'],
        ['Pass Three', 'p3@test.com', hash, 'Passenger'],
        ['Pass Four', 'p4@test.com', hash, 'Passenger']
    ];
    const insertUser = db.prepare(`INSERT INTO users (name, email, password_hash, roles) VALUES (?, ?, ?, ?)`);
    users.forEach(u => insertUser.run(u));
    insertUser.finalize();

    console.log('Inserting demo vehicles...');

    // 2. Insert vehicles (4 vehicles assigned to drivers)
    const vehicles = [
        ['Toyota', 'Corolla', 'WAW1234', 4, 2], // belongs to driver one (id = 2)
        ['Honda', 'Civic', 'LODZ567', 4, 2], // belongs to driver one (id = 2)
        ['Ford', 'Focus', 'POZ890', 3, 3], // belongs to driver two (id = 3)
        ['Skoda', 'Octavia', 'KRK112', 4, 4] // belongs to driver/passenger (id = 4)
    ];
    const insertVehicle = db.prepare(`INSERT INTO vehicles (make, model, plate_number, seats, user_id) VALUES (?, ?, ?, ?, ?)`);
    vehicles.forEach(v => insertVehicle.run(v));
    insertVehicle.finalize();

    console.log('Inserting demo rides...');

    // 3. Insert rides (10 rides of every status)
    const rides = [
        ['Warsaw', 'Lodz', '2026-10-20 08:00', 3, 50.0, 'open', 2, 1], // driver one, vehicle 1
        ['Lodz', 'Warsaw', '2026-10-21 16:00', 3, 55.0, 'open', 2, 2], // driver one, vehicle 2
        ['Krakow', 'Warsaw', '2026-10-22 09:00', 2, 120.0, 'full', 3, 3], // driver two, vehicle 3
        ['Warsaw', 'Gdansk', '2026-10-10 07:00', 3, 100.0, 'finished', 4, 4], // driver/pass, vehicle 4
        ['Poznan', 'Lodz', '2026-10-25 10:00', 3, 60.0, 'cancelled', 2, 2], // driver one, vehicle 2
        ['Wroclaw', 'Warsaw', '2026-10-15 12:00', 2, 80.0, 'departed', 3, 3], // driver two, vehicle 3
        ['Lodz', 'Krakow', '2026-10-26 08:00', 3, 90.0, 'open', 4, 4], // driver/pass, vehicle 4
        ['Warsaw', 'Poznan', '2026-10-27 09:00', 3, 75.0, 'open', 2, 1], // driver one, vehicle 1
        ['Gdansk', 'Warsaw', '2026-09-01 14:00', 2, 110.0, 'finished', 3, 3], // driver two, vehicle 3
        ['Lodz', 'Wroclaw', '2026-09-15 08:00', 3, 65.0, 'finished', 4, 4] // driver/pass, vehicle 4
    ];
    const insertRide = db.prepare(`INSERT INTO rides (origin, destination, departure, seats_offered, price, status, driver_id, vehicle_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    rides.forEach(r => insertRide.run(r));
    insertRide.finalize();

    console.log('Inserting demo bookings...');

    // 4. Insert bookings
    const bookings = [
        [1, 'pending', 1, 5], // ride 1, pass 1
        [1, 'accepted', 3, 6], // ride 3, pass 2
        [1, 'accepted', 4, 8], // ride 4, pass 4
        [1, 'rejected', 5, 5], // ride 5, pass 1
        [1, 'accepted', 9, 6], // ride 9, pass 2
        [1, 'accepted', 10, 7], // ride 10, pass 3
    ];
    const insertBooking = db.prepare(`INSERT INTO bookings (seats, status, ride_id, passenger_id) VALUES (?, ?, ?, ?)`);
    bookings.forEach(b => insertBooking.run(b));
    insertBooking.finalize();

    console.log('Inserting demo ratings...')

    // 5. Insert ratings
    const ratings = [
        [5, 'Great driver!', 4, 8, 4], // ride 4, pass 4, driver 3
        [4, 'Good ride', 9, 6, 3], // ride 9, pass 2, driver 2
        [3, 'The ride was okay..', 10, 7, 4] // ride 10, pass 3, driver 3
    ];
    const insertRating = db.prepare(`INSERT INTO ratings (value, comment, ride_id, passenger_id, driver_id) VALUES (?, ?, ?, ?, ?)`);
    ratings.forEach(r => insertRating.run(r));
    insertRating.finalize();

    console.log('Inserting demo audit logs...');

    // 6. Insert audit logs
    const audits = [
        ['Ride', 5, 'open', 'cancelled', 2],     // driver 1 cancelled ride 5
        ['Booking', 2, 'pending', 'accepted', 3] // driver 2 accepted booking 2
    ];
    const insertAudit = db.prepare(`INSERT INTO audit_logs (entity_type, entity_id, old_status, new_status, changed_by_id) VALUES (?, ?, ?, ?, ?)`);
    audits.forEach(a => insertAudit.run(a));
    insertAudit.finalize();

    console.log('Database schema initialized successfully!');
});

db.close();