// File: services/database-service.js
// Description: Handles SQLite database connection and operations.
// Changes:
// - In `createSessionsTable`, changed column `expire` to `expired`.

const sqlite3 = require('sqlite3').verbose();
const { DATABASE_FILE } = require('../config');

let db; // Will be initialized after connection

const dbInitializationPromise = new Promise((resolve, reject) => {
    db = new sqlite3.Database(DATABASE_FILE, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
            return reject(err);
        }
        console.log('Connected to the SQLite database.');
        initializeDatabase().then(resolve).catch(reject);
    });
});

// Function to initialize database tables
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                display_name TEXT,
                email TEXT UNIQUE,
                profile_image_url TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `;

        const createDailyChallengesTable = `
            CREATE TABLE IF NOT EXISTS daily_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_date TEXT NOT NULL, -- YYYY-MM-DD
                song_order INTEGER NOT NULL,
                source_name TEXT NOT NULL,
                track_id_from_source TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                preview_url TEXT,
                album_art_url TEXT,
                duration_ms INTEGER,
                UNIQUE(challenge_date, song_order),
                UNIQUE(challenge_date, track_id_from_source)
            );
        `;

        const createScoresTable = `
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                daily_challenge_id INTEGER NOT NULL,
                score INTEGER NOT NULL,
                guessed_at_level INTEGER NOT NULL,
                played_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
                FOREIGN KEY (daily_challenge_id) REFERENCES daily_challenges (id) ON DELETE CASCADE
            );
        `;
        
        // Session table (if using connect-sqlite3 with default table name)
        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expired INTEGER NOT NULL -- CHANGED 'expire' to 'expired'
            );
        `;


        db.serialize(() => {
            const promises = [];
            promises.push(new Promise((res, rej) => db.run(createUsersTable, err => {
                if (err) { console.error("Error creating users table:", err.message); return rej(err); }
                console.log("Users table checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createDailyChallengesTable, err => {
                if (err) { console.error("Error creating daily_challenges table:", err.message); return rej(err); }
                console.log("Daily challenges table checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createScoresTable, err => {
                if (err) { console.error("Error creating scores table:", err.message); return rej(err); }
                console.log("Scores table checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createSessionsTable, err => {
                if (err) { console.error("Error creating sessions table:", err.message); return rej(err); }
                console.log("Sessions table checked/created."); res();
            })));

            Promise.all(promises).then(resolve).catch(reject);
        });
    });
}

// Export the database connection (it will be defined once the promise resolves)
// and the initialization promise.
module.exports = {
    getDb: () => db, // Function to get the db instance
    dbInitializationPromise
};