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
const { SESSION_MAX_LEVELS, DAILY_SONG_COUNT } = require('../config'); // Assuming MAX_LEVELS is defined in config
const musicSourceService = require('../services/music-source-service');


// Helper function to get today's date string (YYYY-MM-DD)
function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

// Middleware to check if user is authenticated (example, adjust as per your auth setup)
// This is a simplified version. Your actual isAuthenticated might be from Passport.
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'User not authenticated' });
};


// GET /api/daily-challenge/songs
router.get('/daily-challenge/songs', async (req, res) => {
    const today = getTodayDateString();
    const dbInstance = getDb();
    let challengeCompletedToday = false;

    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.id) {
        try {
            // Count how many distinct songs the user has scores for on today's challenge date
            const countPlayedSql = `
                SELECT COUNT(DISTINCT s.daily_challenge_id) as songs_played_count
                FROM scores s
                JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
                WHERE s.user_id = ? AND dc.challenge_date = ?;
            `;
            const playedResult = await new Promise((resolve, reject) => {
                dbInstance.get(countPlayedSql, [req.user.id, today], (err, row) => {
                    if (err) return reject(err);
                    resolve(row); // row will be { songs_played_count: X } or null if no scores
                });
            });

            // DAILY_SONG_COUNT is the total number of songs in a daily challenge
            if (playedResult && playedResult.songs_played_count >= DAILY_SONG_COUNT) {
                challengeCompletedToday = true;
                console.log(`[API GET /songs] User ${req.user.id} has completed all ${DAILY_SONG_COUNT} songs for ${today}.`);
            } else {
                console.log(`[API GET /songs] User ${req.user.id} has played ${playedResult ? playedResult.songs_played_count : 0}/${DAILY_SONG_COUNT} songs for ${today}.`);
            }
        } catch (err) {
            console.error("Error checking if challenge completed for user:", err.message);
            // challengeCompletedToday remains false
        }
    } else {
        challengeCompletedToday = false; // For guests, server always reports as not completed
    }

    const fetchSongsSql = `
        SELECT id, challenge_date, song_order, source_name, track_id_from_source, 
               title, artist, album_art_url, duration_ms, youtube_video_id 
        FROM daily_challenges 
        WHERE challenge_date = ? 
        ORDER BY song_order ASC
    `;
    
    dbInstance.all(fetchSongsSql, [today], (err, rows) => {
        if (err) { 
            console.error("Error fetching daily challenge songs:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve daily challenge songs.' });
         }
        if (!rows || rows.length === 0) {
            return res.status(404).json({ 
                message: 'No daily challenge songs available for today. Please try again later.',
                songs: [], 
                challengeCompletedToday 
            });
        }
        res.json({ 
            songs: rows, 
            challengeCompletedToday 
        });
    });
});

// POST /api/daily-challenge/guess
router.post('/daily-challenge/guess', async (req, res) => {
    const { daily_challenge_song_id, guess, currentLevel } = req.body;
    const today = getTodayDateString();
    const dbInstance = getDb();
    const userIsAuthenticated = req.isAuthenticated && req.isAuthenticated();
    const userId = userIsAuthenticated && req.user ? req.user.id : null;


    if (!daily_challenge_song_id || !guess || currentLevel === undefined) {
        return res.status(400).json({ error: 'Missing required fields: daily_challenge_song_id, guess, currentLevel.' });
    }

    // First, check if the user has already completed/played today's challenge
    if (userIsAuthenticated && userId) {
    try {
        const checkPlayedSql = `
            SELECT COUNT(DISTINCT s.daily_challenge_id) as songs_played_count
            FROM scores s
            JOIN daily_challenges dc ON s.daily_challenge_id = dc.id
            WHERE s.user_id = ? AND dc.challenge_date = ?;
        `;


        const playedRow = await new Promise((resolve, reject) => {
            dbInstance.get(checkPlayedSql, [userId, today], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });


        if (playedRow && playedRow.songs_played_count >= DAILY_SONG_COUNT) {
                console.log(`Authenticated User ${userId} attempted to guess but has already completed challenge for ${today}.`);
            return res.status(403).json({ 
                    correct: false,
                message: "You have already completed today's challenge. Come back tomorrow!",
                    gameOverForSong: true 
            });
        }
    } catch (err) {
            console.error("Error checking if challenge completed before guess (authenticated user):", err.message);
        return res.status(500).json({ error: "Server error checking game status." });
        }
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
        const maxLevels = DAILY_SONG_COUNT || 5; 
        let responsePayload = {};

        if (isCorrect) {
            if (userIsAuthenticated && userId) { // Only award and save points for authenticated users
                pointsAwarded = (maxLevels - parseInt(currentLevel) + 1) * 10;
                pointsAwarded = Math.max(0, pointsAwarded);

            const storeScoreSql = 'INSERT INTO scores (user_id, daily_challenge_id, score, guessed_at_level) VALUES (?, ?, ?, ?)';
            dbInstance.run(storeScoreSql, [userId, daily_challenge_song_id, pointsAwarded, currentLevel], (scoreErr) => {
                if (scoreErr) {
                        console.error("Error storing score for user:", userId, scoreErr.message);
                    } else {
                        console.log(`User ${userId} guessed correctly. Song ID: ${daily_challenge_song_id}, Points: ${pointsAwarded}`);
                }
                });
            } else {
                 console.log(`Guest guessed correctly. Song ID: ${daily_challenge_song_id}. No points saved.`);
            }
            responsePayload = {
                    correct: true,
                    songTitle: song.title,
                    artist: song.artist,
                pointsAwarded: userIsAuthenticated ? pointsAwarded : 0, // Show 0 points for guests
                    message: `Correct! It was "${song.title}".`
            };
        } else { // Incorrect guess
            const isLastAttemptForSong = parseInt(currentLevel) >= maxLevels;
            
            if (userIsAuthenticated && userId && isLastAttemptForSong) {
                // Store a 0 score for authenticated users on final incorrect attempt
                const storeScoreSql = 'INSERT INTO scores (user_id, daily_challenge_id, score, guessed_at_level) VALUES (?, ?, ?, ?)';
                dbInstance.run(storeScoreSql, [userId, daily_challenge_song_id, 0, currentLevel], (scoreErr) => {
                    if (scoreErr) console.error("Error storing 0 score for final incorrect guess (user):", userId, scoreErr.message);
                });
            }
            if (userIsAuthenticated && userId) {
                console.log(`User ${userId} guessed incorrectly. Song ID: ${daily_challenge_song_id}, Level: ${currentLevel}`);
            } else {
                console.log(`Guest guessed incorrectly. Song ID: ${daily_challenge_song_id}, Level: ${currentLevel}`);
            }

            responsePayload = {
                correct: false,
                message: "Incorrect. Try the next level!", // Generic message, frontend manages snippet progression
                nextLevel: parseInt(currentLevel) + 1,
                gameOverForSong: isLastAttemptForSong,
                songTitle: isLastAttemptForSong ? song.title : undefined,
                artist: isLastAttemptForSong ? song.artist : undefined
            };
        }
        res.json(responsePayload);
    });
});

router.get('/practice/random-song', async (req, res) => {
    let { startYear, endYear } = req.query;

    if (!startYear) {
        return res.status(400).json({ error: 'A startYear is required.' });
    }

    // Default endYear to startYear if not provided
    endYear = endYear || startYear;

    const start = parseInt(startYear, 10);
    const end = parseInt(endYear, 10);

    if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(400).json({ error: 'Invalid year range provided.' });
    }

    console.log(`[API Practice] Fetching random song between ${start} and ${end}`);
    const dbInstance = getDb();

    try {
        const sql = `
            SELECT 
                title, 
                artist, 
                year,
                album_art_url, 
                duration_ms, 
                youtube_video_id,
                spotify_track_id AS track_id_from_source 
                -- We don't need a specific DB ID for this unscored mode
            FROM curated_songs
            WHERE 
                (year >= ? AND year <= ?)
                AND youtube_video_id IS NOT NULL 
                AND spotify_track_id IS NOT NULL 
                AND spotify_track_id NOT LIKE 'SPOTIFY_%' AND spotify_track_id NOT LIKE 'ERROR_%'
                AND youtube_video_id NOT LIKE 'YOUTUBE_%' AND youtube_video_id NOT LIKE 'ERROR_%'
                AND album_art_url IS NOT NULL
                AND duration_ms IS NOT NULL
                AND (is_active = 1 OR is_active IS NULL)
            ORDER BY RANDOM()
            LIMIT 1;
        `;

        const song = await new Promise((resolve, reject) => {
            dbInstance.get(sql, [start, end], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (song) {
            console.log(`[API Practice] Found song: "${song.title}" by ${song.artist}`);
            res.json(song);
        } else {
            console.log(`[API Practice] No playable songs found for year range ${start}-${end}.`);
            res.status(404).json({ message: `No playable songs found for the selected year range (${start}-${end}). Please try a different range.` });
        }
    } catch (err) {
        console.error("[API Practice] Error fetching random song:", err.message);
        res.status(500).json({ error: 'Failed to retrieve a random song.' });
    }
});


router.patch('/user/profile', isAuthenticated, async (req, res) => {
    const userId = req.user.id; // Get user ID from the authenticated session
    const { username, profile_image_url } = req.body;

    console.log(`[API PATCH /user/profile] User ID: ${userId} attempting to update profile.`);
    console.log(`[API PATCH /user/profile] Received - username: "${username}", profile_image_url: "${profile_image_url}"`);

    if (username === undefined && profile_image_url === undefined) {
        return res.status(400).json({ error: 'No update fields provided (username or profile_image_url required).' });
    }

    const dbInstance = getDb();
    let updateFields = [];
    let updateValues = [];

    if (username !== undefined) {
        const trimmedUsername = username.trim();
        if (trimmedUsername === "" && req.user.username !== null) { // Allowing to clear username if it was previously set
             updateFields.push('username = ?');
             updateValues.push(null); // Set to null if empty string is provided
             console.log(`[API PATCH /user/profile] Preparing to clear username for User ID: ${userId}`);
        } else if (trimmedUsername) {
            if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
                return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
            }
            // Regex for basic alphanumeric + underscore, no spaces. Adjust as needed.
            if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
                return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
            }

            try {
                const existingUser = await new Promise((resolve, reject) => {
                    dbInstance.get('SELECT id FROM users WHERE username = ? AND id != ?', [trimmedUsername, userId], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    });
                });
                if (existingUser) {
                    return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
                }
            } catch (err) {
                console.error("[API PATCH /user/profile] Error checking username uniqueness:", err.message);
                return res.status(500).json({ error: 'Failed to validate username.' });
            }
            updateFields.push('username = ?');
            updateValues.push(trimmedUsername);
            console.log(`[API PATCH /user/profile] Preparing to update username to: "${trimmedUsername}" for User ID: ${userId}`);
        }
    }

    if (profile_image_url !== undefined) {
        const trimmedUrl = profile_image_url.trim();
        if (trimmedUrl === "") { // Allowing to clear profile image URL
            updateFields.push('profile_image_url = ?');
            updateValues.push(null);
            console.log(`[API PATCH /user/profile] Preparing to clear profile_image_url for User ID: ${userId}`);
        } else {
            try {
                new URL(trimmedUrl); // Basic URL validation
                updateFields.push('profile_image_url = ?');
                updateValues.push(trimmedUrl);
                console.log(`[API PATCH /user/profile] Preparing to update profile_image_url for User ID: ${userId}`);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid profile image URL format.' });
            }
        }
    }
    
    if (updateFields.length === 0) {
        console.log('[API PATCH /user/profile] No valid fields to update after processing.');
        // This might happen if user submits current values or empty strings for non-nullable fields that were already null
        // It's better to return the current profile than an error if no actual change is requested.
        // Or, if frontend ensures only changed values are sent, this path might indicate empty payload.
        // For now, let's assume frontend might send unchanged values, so we fetch current and return.
        dbInstance.get('SELECT id, username, display_name, email, profile_image_url FROM users WHERE id = ?', [userId], (getErr, currentUserData) => {
            if (getErr || !currentUserData) {
                return res.status(500).json({ error: 'Could not retrieve current profile.' });
            }
            const { google_id, ...userProfile } = currentUserData; // Exclude google_id
            res.json({ message: 'No changes applied to profile.', user: userProfile });
        });
        return;
    }

    updateValues.push(userId); // For the WHERE clause

    const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    console.log(`[API PATCH /user/profile] Executing SQL: ${sql} with values: ${JSON.stringify(updateValues)}`);

    dbInstance.run(sql, updateValues, function (err) {
        if (err) {
            console.error("[API PATCH /user/profile] Error updating user profile in DB:", err.message);
            return res.status(500).json({ error: 'Failed to update profile.' });
        }
        
        console.log(`[API PATCH /user/profile] DB run callback: this.changes = ${this.changes}`);

        if (this.changes === 0 && updateFields.length > 0) {
            // This means the WHERE clause (user ID) didn't match or values were identical to existing.
            // Since user ID comes from req.user, it should match unless user was deleted.
            console.warn('[API PATCH /user/profile] Update operation made 0 changes to the database. User might not exist or data was identical.');
        }

        // Fetch the updated user profile to return
        dbInstance.get('SELECT id, username, display_name, email, profile_image_url FROM users WHERE id = ?', [userId], (getErr, updatedUserFromDB) => {
            if (getErr) {
                console.error("[API PATCH /user/profile] Error fetching updated profile after DB update:", getErr.message);
                return res.status(500).json({ error: 'Profile update processed, but failed to fetch updated details.' });
            }
            if (!updatedUserFromDB) {
                 console.error("[API PATCH /user/profile] User not found after update attempt.");
                 return res.status(404).json({ error: 'User not found after update.' });
            }
            
            console.log('[API PATCH /user/profile] User data fetched from DB after update attempt:', updatedUserFromDB);
            const { google_id, id, ...userProfile } = updatedUserFromDB; // Exclude google_id and internal id from response
            res.json({ message: 'Profile updated successfully!', user: userProfile });
        });
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
