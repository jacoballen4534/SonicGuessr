// File: services/database-service.js
// Changes:
// - In `createDailyChallengesTable`:
//   - Removed `preview_url TEXT,`
//   - Added `youtube_video_id TEXT,`

const sqlite3 = require('sqlite3').verbose();
const { DATABASE_FILE } = require('../config');

let db;

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
                challenge_date TEXT NOT NULL, 
                song_order INTEGER NOT NULL,
                source_name TEXT NOT NULL, -- e.g., "spotify" (for metadata source)
                track_id_from_source TEXT NOT NULL, -- Spotify track ID
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album_art_url TEXT, -- Spotify album art
                duration_ms INTEGER, -- Spotify track duration
                youtube_video_id TEXT, -- <<< ADDED: YouTube video ID for audio
                UNIQUE(challenge_date, song_order),
                UNIQUE(challenge_date, track_id_from_source) 
            );
        `;
        // Note: `preview_url` was removed from the schema above.

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
        
        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expired INTEGER NOT NULL 
            );
        `;

                // New table for caching song suggestions
        const createSongSuggestionCacheTable = `
            CREATE TABLE IF NOT EXISTS song_suggestion_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spotify_track_id TEXT UNIQUE NOT NULL, -- To prevent duplicates
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                -- album_art_url TEXT, -- Optional: if you want to cache this too
                fetched_at TEXT DEFAULT (datetime('now'))
            );
        `;
        // Index for faster searching on title (and potentially artist later)
        const createSuggestionTitleIndex = `
            CREATE INDEX IF NOT EXISTS idx_suggestion_title ON song_suggestion_cache (title);
        `;
         const createSuggestionArtistIndex = `
            CREATE INDEX IF NOT EXISTS idx_suggestion_artist ON song_suggestion_cache (artist);
        `;

        // --- NEW TABLE FOR CURATED SONGS (from Billboard charts etc.) ---
        const createCuratedSongsTable = `
            CREATE TABLE IF NOT EXISTS curated_songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                year INTEGER,
                raw_rank_billboard TEXT, -- Optional: To store the rank from the chart
                source_details TEXT,     -- Optional: To store info like "Billboard Hot 100"
                spotify_track_id TEXT UNIQUE, 
                album_art_url TEXT,          
                duration_ms INTEGER,         
                youtube_video_id TEXT,       
                last_used_for_challenge DATE, 
                is_active BOOLEAN DEFAULT 1  
            );
        `;
        const createCuratedSongsTitleArtistYearIndex = `
            CREATE INDEX IF NOT EXISTS idx_curated_songs_title_artist_year ON curated_songs (title, artist, year);
        `;
        const createCuratedSongsSpotifyIdIndex = `
            CREATE INDEX IF NOT EXISTS idx_curated_songs_spotify_id ON curated_songs (spotify_track_id);
        `;
        // --- END OF NEW TABLE FOR CURATED SONGS ---


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

            // Add creation for the new table and its index
            promises.push(new Promise((res, rej) => db.run(createSongSuggestionCacheTable, err => {
                if (err) { console.error("Error creating song_suggestion_cache table:", err.message); return rej(err); }
                console.log("Song suggestion cache table checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createSuggestionTitleIndex, err => {
                if (err) { console.error("Error creating idx_suggestion_title index:", err.message); return rej(err); }
                console.log("idx_suggestion_title index checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createSuggestionArtistIndex, err => {
                if (err) { console.error("Error creating idx_suggestion_artist index:", err.message); return rej(err); }
                console.log("idx_suggestion_artist index checked/created."); res();
            })));

            // --- ADDING CURATED_SONGS TABLE AND ITS INDEXES ---
            promises.push(new Promise((res, rej) => db.run(createCuratedSongsTable, err => {
                if (err) { console.error("Error creating curated_songs table:", err.message); return rej(err); }
                console.log("Curated songs table checked/created."); res();
            })));
            promises.push(new Promise((res, rej) => db.run(createCuratedSongsTitleArtistYearIndex, err => {
                if (err) { console.error("Error creating idx_curated_songs_title_artist_year index:", err.message); return rej(err); }
                console.log("idx_curated_songs_title_artist_year index checked/created."); res();
            })));
             promises.push(new Promise((res, rej) => db.run(createCuratedSongsSpotifyIdIndex, err => {
                if (err) { console.error("Error creating idx_curated_songs_spotify_id index:", err.message); return rej(err); }
                console.log("idx_curated_songs_spotify_id index checked/created."); res();
            })));
            // --- END OF ADDING CURATED_SONGS ---

            Promise.all(promises).then(resolve).catch(reject);
        });
    });
}

module.exports = {
    getDb: () => db,
    dbInitializationPromise
};