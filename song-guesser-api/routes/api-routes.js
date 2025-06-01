// File: routes/api-routes.js
// Description: Handles API routes for daily challenges, guesses, autocomplete, and leaderboards.
// Changes:
// - Modified GET /api/daily-challenge/songs:
//   - If user is authenticated, checks if they have already submitted any score for today's challenge.
//   - Adds a `challengeCompletedToday: boolean` flag to the response.
// - Modified POST /api/daily-challenge/guess:
//   - Before processing a guess, checks if the authenticated user has already submitted any score for today.
//   - If so, returns a 403 Forbidden error.

const express = require('express');
const router = express.Router();
const { getDb } = require('../services/database-service');
const { SESSION_MAX_LEVELS } = require('../config'); // Assuming MAX_LEVELS is defined in config

// Helper function to get today's date string (YYYY-MM-DD)
function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

// Middleware to check if user is authenticated (example, adjust as per your auth setup)
// This is a simplified version. Your actual isAuthenticated might be from Passport.
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) { // Check if req.isAuthenticated exists and then call it
        return next();
    }
    res.status(401).json({ error: 'User not authenticated' });
};


// GET /api/daily-challenge/songs
router.get('/daily-challenge/songs', async (req, res) => {
    const today = getTodayDateString();
    const dbInstance = getDb();
    let challengeCompletedToday = false;

    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        try {
            const checkPlayedSql = `
                SELECT 1 
                FROM scores s
                JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
                WHERE s.user_id = ? AND dc.challenge_date = ?
                LIMIT 1;
            `;
            const playedRow = await new Promise((resolve, reject) => {
                dbInstance.get(checkPlayedSql, [req.user.id, today], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
            if (playedRow) {
                challengeCompletedToday = true;
            }
        } catch (err) {
            console.error("Error checking if challenge completed for user:", err.message);
            // Proceed without this flag if error, or handle error differently
        }
    }

    const sql = `
        SELECT id, challenge_date, song_order, source_name, track_id_from_source, 
               title, artist, album_art_url, duration_ms, youtube_video_id 
        FROM daily_challenges 
        WHERE challenge_date = ? 
        ORDER BY song_order ASC
    `;
    
    dbInstance.all(sql, [today], (err, rows) => {
        if (err) {
            console.error("Error fetching daily challenge songs:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve daily challenge songs.' });
        }
        if (!rows || rows.length === 0) {
            return res.status(404).json({ 
                message: 'No daily challenge songs available for today. Please try again later.',
                challengeCompletedToday // Still send this flag
            });
        }
        res.json({ 
            songs: rows.map(row => ({ /* ...map row data if needed, or send as is... */ ...row })),
            challengeCompletedToday 
        });
    });
});

// POST /api/daily-challenge/guess
router.post('/daily-challenge/guess', isAuthenticated, async (req, res) => {
    const { daily_challenge_song_id, guess, currentLevel } = req.body;
    const userId = req.user.id; // From authenticated user
    const today = getTodayDateString();
    const dbInstance = getDb();

    if (!daily_challenge_song_id || !guess || currentLevel === undefined) {
        return res.status(400).json({ error: 'Missing required fields: daily_challenge_song_id, guess, currentLevel.' });
    }

    // First, check if the user has already completed/played today's challenge
    try {
        const checkPlayedSql = `
            SELECT 1 
            FROM scores s
            JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
            WHERE s.user_id = ? AND dc.challenge_date = ?
            LIMIT 1;
        `;
        const playedRow = await new Promise((resolve, reject) => {
            dbInstance.get(checkPlayedSql, [userId, today], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (playedRow) {
            console.log(`User ${userId} attempted to guess but has already completed challenge for ${today}.`);
            return res.status(403).json({ 
                correct: false, // To ensure frontend doesn't think it's a valid guess outcome
                message: "You have already completed today's challenge. Come back tomorrow!",
                gameOverForSong: true // Treat it as game over for any song if challenge is done
            });
        }
    } catch (err) {
        console.error("Error checking if challenge completed before guess:", err.message);
        return res.status(500).json({ error: "Server error checking game status." });
    }

    // Proceed with guess logic if challenge not yet completed today
    const getSongSql = 'SELECT title, artist FROM daily_challenges WHERE id = ? AND challenge_date = ?';
    dbInstance.get(getSongSql, [daily_challenge_song_id, today], (err, song) => {
        if (err) {
            console.error("Error fetching song for guess:", err.message);
            return res.status(500).json({ error: 'Error verifying song.' });
        }
        if (!song) {
            return res.status(404).json({ error: 'Song not found for today or ID is incorrect.' });
        }

        const isCorrect = guess.trim().toLowerCase() === song.title.trim().toLowerCase();
        let pointsAwarded = 0;
        const maxLevels = SESSION_MAX_LEVELS || 5; // Use config or default

        if (isCorrect) {
            pointsAwarded = (maxLevels - parseInt(currentLevel) + 1) * 10; // Example scoring
            pointsAwarded = Math.max(0, pointsAwarded); // Ensure points are not negative

            const storeScoreSql = 'INSERT INTO scores (user_id, daily_challenge_id, score, guessed_at_level) VALUES (?, ?, ?, ?)';
            dbInstance.run(storeScoreSql, [userId, daily_challenge_song_id, pointsAwarded, currentLevel], (scoreErr) => {
                if (scoreErr) {
                    console.error("Error storing score:", scoreErr.message);
                    // Continue to respond to user even if score saving fails, but log it.
                }
                console.log(`User ${userId} guessed correctly. Song ID: ${daily_challenge_song_id}, Points: ${pointsAwarded}`);
                res.json({
                    correct: true,
                    songTitle: song.title,
                    artist: song.artist,
                    pointsAwarded: pointsAwarded,
                    message: `Correct! It was "${song.title}".`
                });
            });
        } else {
            // Incorrect guess
            // Check if this was the last attempt for this song based on client-side levels (or server-side if you track attempts per song)
            const isLastAttemptForSong = parseInt(currentLevel) >= maxLevels;
            
            // Store a score of 0 for an incorrect guess if it's the final attempt for the song,
            // or if you want to record every attempt. For now, only record on correct or final incorrect.
            if (isLastAttemptForSong) {
                const storeScoreSql = 'INSERT INTO scores (user_id, daily_challenge_id, score, guessed_at_level) VALUES (?, ?, ?, ?)';
                dbInstance.run(storeScoreSql, [userId, daily_challenge_song_id, 0, currentLevel], (scoreErr) => {
                    if (scoreErr) console.error("Error storing 0 score for final incorrect guess:", scoreErr.message);
                });
                 console.log(`User ${userId} guessed incorrectly on final attempt. Song ID: ${daily_challenge_song_id}`);
            } else {
                 console.log(`User ${userId} guessed incorrectly. Song ID: ${daily_challenge_song_id}, Level: ${currentLevel}`);
            }

            res.json({
                correct: false,
                message: "Incorrect. Try the next level!",
                nextLevel: parseInt(currentLevel) + 1, // Suggest next level
                gameOverForSong: isLastAttemptForSong, // True if it was the last defined level
                songTitle: isLastAttemptForSong ? song.title : undefined,
                artist: isLastAttemptForSong ? song.artist : undefined
            });
        }
    });
});


// GET /api/songs/autocomplete
router.get('/songs/autocomplete', async (req, res) => {
    const { query } = req.query;
    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'Query parameter is required and must be at least 2 characters.' });
    }
    try {
        const suggestions = await musicSourceService.searchTracksOnSpotify(query.trim(), 7);
        res.json(suggestions);
    } catch (error) {
        console.error("[API Route] Error fetching autocomplete suggestions from Spotify service:", error.message);
        res.status(500).json({ error: 'Failed to retrieve autocomplete suggestions.' });
    }
});

// GET /api/leaderboard/daily
router.get('/leaderboard/daily', async (req, res) => {
    const today = getTodayDateString();
    const dbInstance = getDb();
    let currentUserEntry = null;

    const allRankedScoresSql = `
        SELECT 
            u.id as user_id, 
            u.username, 
            u.display_name, 
            SUM(s.score) as total_score,
            RANK() OVER (ORDER BY SUM(s.score) DESC) as rank
        FROM scores s
        JOIN users u ON s.user_id = u.id
        JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
        WHERE dc.challenge_date = ?
        GROUP BY s.user_id
        ORDER BY rank ASC, u.username ASC; 
    `;

    try {
        const allEntries = await new Promise((resolve, reject) => {
            dbInstance.all(allRankedScoresSql, [today], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        const topEntries = allEntries.slice(0, 10);

        if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.id) {
            const currentUserId = req.user.id;
            const foundUserEntry = allEntries.find(entry => entry.user_id === currentUserId);
            if (foundUserEntry) {
                currentUserEntry = foundUserEntry;
            }
        }
        
        res.json({
            topEntries: topEntries,
            currentUserEntry: currentUserEntry 
        });

    } catch (err) {
        console.error("Error fetching daily leaderboard:", err.message);
        return res.status(500).json({ error: 'Failed to retrieve daily leaderboard.' });
    }
});


module.exports = router;
