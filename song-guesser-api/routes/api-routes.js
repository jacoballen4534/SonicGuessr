// Description: Main router for data-related API endpoints.
const express = require('express');
const router = express.Router();
const db = require('../services/database-service');
const { DAILY_SONG_COUNT } = require('../config'); // For max levels in guess

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

// Middleware to check if user is authenticated (example)
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) { // This relies on Passport session
        return next();
    }
    res.status(401).json({ message: 'User not authenticated' });
}


// GET /api/daily-challenge/songs
router.get('/daily-challenge/songs', (req, res) => {
    const today = getTodayDateString();
    const sql = `
        SELECT id, challenge_date, song_order, source_name, track_id_from_source, 
               title, artist, album_art_url, duration_ms, youtube_video_id 
        FROM daily_challenges 
        WHERE challenge_date = ? 
        ORDER BY song_order ASC
    `;
    // Changed preview_url to youtube_video_id in the SELECT statement.

    // The 'db' variable should be the result of getDb() from database-service
    const database = db.getDb(); // Assuming your 'db' import provides a getDb() method.
                               // If 'db' is already the database instance, just use 'db.all'.
                               // Based on your provided file, it seems `db` is not the instance itself
                               // but the module, so you'd call `const { getDb } = require('../services/database-service');`
                               // and then `const database = getDb();` or use `db.getDb().all(...)` directly.
                               // For consistency with other files, let's assume:
                               // const { getDb } = require('../services/database-service'); (at the top)
                               // const currentDb = getDb(); (inside the route or as a module-level var if appropriate)
                               // currentDb.all(...)
    
    // Correcting based on how db is typically used with your structure:
    // You'd likely have `const { getDb } = require('../services/database-service');` at the top.
    // Then `const currentDbInstance = getDb();`
    // So, the call would be `getDb().all(...)` if `db` is the module, or just `db.all` if `db` is already an instance.
    // The provided snippet uses `db.all` which implies `db` is already an instance.
    // However, your `database-service.js` exports `getDb`. So, this route file should use `getDb().all`.

    // Assuming `db` refers to the imported module `require('../services/database-service')`
    // and you have destructured `getDb` from it or call `db.getDb()`
    
    const currentDb = require('../services/database-service').getDb(); // Or however you access the db instance

    currentDb.all(sql, [today], (err, rows) => {
        if (err) {
            console.error("Error fetching daily challenge songs:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve daily challenge songs.' });
        }
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'No daily challenge songs available for today. Please try again later.' });
        }
        // Ensure the response objects contain youtube_video_id instead of preview_url
        res.json(rows.map(row => ({
            id: row.id,
            challenge_date: row.challenge_date,
            song_order: row.song_order,
            source_name: row.source_name,
            track_id_from_source: row.track_id_from_source,
            title: row.title,
            artist: row.artist,
            album_art_url: row.album_art_url,
            duration_ms: row.duration_ms,
            youtube_video_id: row.youtube_video_id // Ensure this is included
            // preview_url: undefined, // Explicitly remove if it was there before
        })));
    });
});

// POST /api/daily-challenge/guess
// This route should be protected, e.g., require authentication
router.post('/daily-challenge/guess', isAuthenticated, (req, res) => {
    const { daily_challenge_song_id, guess, currentLevel } = req.body; // daily_challenge_song_id is 'id' from daily_challenges table
    const userId = req.user.id; // Assuming req.user is populated by Passport

    if (!daily_challenge_song_id || !guess || currentLevel === undefined) {
        return res.status(400).json({ error: 'Missing required fields: daily_challenge_song_id, guess, currentLevel.' });
    }

    const today = getTodayDateString();
    const getSongSql = 'SELECT id, title, artist FROM daily_challenges WHERE id = ? AND challenge_date = ?';
    
    db.getDb().get(getSongSql, [daily_challenge_song_id, today], (err, song) => {
        if (err) {
            console.error("Error fetching song for guess:", err.message);
            return res.status(500).json({ error: 'Error processing guess.' });
        }
        if (!song) {
            return res.status(404).json({ error: 'Challenge song not found for today or ID is invalid.' });
        }

        const MAX_LEVELS = 5; // Should match frontend logic or be configurable
        let responsePayload = {};

        if (guess.trim().toLowerCase() === song.title.trim().toLowerCase()) {
            const pointsAwarded = (MAX_LEVELS - parseInt(currentLevel) + 1) * 10; // Example scoring
            responsePayload = {
                correct: true,
                songTitle: song.title,
                artist: song.artist,
                message: `Correct! It was ${song.title} by ${song.artist}.`,
                pointsAwarded: pointsAwarded
            };
            // Store score in DB
            const storeScoreSql = 'INSERT INTO scores (user_id, daily_challenge_id, score, guessed_at_level) VALUES (?, ?, ?, ?)';
            db.getDb().run(storeScoreSql, [userId, song.id, pointsAwarded, currentLevel], (scoreErr) => {
                if (scoreErr) {
                    console.error("Error storing score:", scoreErr.message);
                    // Non-critical for guess response, but log it.
                }
            });
        } else {
            if (parseInt(currentLevel) < MAX_LEVELS) {
                responsePayload = {
                    correct: false,
                    nextLevel: parseInt(currentLevel) + 1,
                    message: 'Incorrect. Try the next level!'
                };
            } else {
                responsePayload = {
                    correct: false,
                    gameOverForSong: true,
                    songTitle: song.title,
                    artist: song.artist,
                    message: `Incorrect. The song was ${song.title} by ${song.artist}.`
                };
            }
        }
        res.json(responsePayload);
    });
});


// GET /api/songs/autocomplete
router.get('/songs/autocomplete', (req, res) => {
    const { query } = req.query;
    const today = getTodayDateString();

    if (!query) return res.status(400).json({ error: 'Query parameter is required.' });

    const sql = `
        SELECT title, artist, track_id_from_source 
        FROM daily_challenges 
        WHERE challenge_date = ? AND title LIKE ?
        ORDER BY title ASC
        LIMIT 5
    `;
    db.getDb().all(sql, [today, `%${query}%`], (err, rows) => {
        if (err) {
            console.error("Error fetching autocomplete suggestions:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve autocomplete suggestions.' });
        }
        res.json(rows.map(row => ({ title: row.title, artist: row.artist, id: row.track_id_from_source })));
    });
});


// GET /api/leaderboard/daily
// This route can be public or protected
router.get('/leaderboard/daily', (req, res) => {
    const today = getTodayDateString();
    // Sum scores for each user for today's challenges
    const sql = `
        SELECT u.username, u.display_name, SUM(s.score) as total_score
        FROM scores s
        JOIN users u ON s.user_id = u.id
        JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
        WHERE dc.challenge_date = ?
        GROUP BY s.user_id
        ORDER BY total_score DESC
        LIMIT 10 
    `; 
    // You might want to ensure username is not null, or use display_name

    db.getDb().all(sql, [today], (err, rows) => {
        if (err) {
            console.error("Error fetching daily leaderboard:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve daily leaderboard.' });
        }
        res.json(rows);
    });
});


module.exports = router;
