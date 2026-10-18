import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('carpooling.db', (err) => {
    if (err) {
        console.error('Error connecting to the database: ', err.message);
    } else {
        console.log('Express server connected to the database');
    }
});

export default db;