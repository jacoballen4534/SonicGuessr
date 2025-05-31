// Description: Main router for data-related API endpoints.
const express = require('express');
const router = express.Router();
const db = require('../services/database-service');
const { DAILY_SONG_COUNT } = require('../config'); // For max levels in guess
const musicSourceService = require('../services/music-source-service');

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

router.patch('/user/profile', isAuthenticated, async (req, res) => {
    const userId = req.user.id; // Get user ID from the authenticated session
    const { username, profile_image_url } = req.body;

    if (!username && !profile_image_url) {
        return res.status(400).json({ error: 'No update fields provided (username or profile_image_url required).' });
    }

    const dbInstance = db.getDb(); // Use your getDb function
    let updateFields = [];
    let updateValues = [];

    if (username !== undefined) {
        const trimmedUsername = username.trim();
        if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
            return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
        }
        // TODO: Add more username validation (e.g., allowed characters) if desired

        // Check for username uniqueness BEFORE attempting update
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
            console.error("Error checking username uniqueness:", err.message);
            return res.status(500).json({ error: 'Failed to validate username.' });
        }
        updateFields.push('username = ?');
        updateValues.push(trimmedUsername);
    }

    if (profile_image_url !== undefined) {
        // Basic URL validation (optional, can be more robust)
        try {
            new URL(profile_image_url); // Throws error if invalid URL
            updateFields.push('profile_image_url = ?');
            updateValues.push(profile_image_url);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid profile image URL format.' });
        }
    }

    if (updateFields.length === 0) {
         // Should not happen if initial check for fields is done, but as a safeguard
        return res.status(400).json({ error: 'No valid fields to update.'});
    }

    updateValues.push(userId); // For the WHERE clause

    const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

    dbInstance.run(sql, updateValues, function (err) {
        if (err) {
            console.error("Error updating user profile:", err.message);
            return res.status(500).json({ error: 'Failed to update profile.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found or no changes made.' });
        }

        // Fetch the updated user profile to return
        dbInstance.get('SELECT id, google_id, username, display_name, email, profile_image_url FROM users WHERE id = ?', [userId], (getErr, updatedUser) => {
            if (getErr) {
                console.error("Error fetching updated profile:", getErr.message);
                return res.status(500).json({ error: 'Profile updated, but failed to fetch updated details.' });
            }
            if (!updatedUser) {
                 return res.status(404).json({ error: 'User not found after update.' });
            }
            const { google_id, id, ...userProfile } = updatedUser; // Exclude google_id and internal id
            res.json({ message: 'Profile updated successfully', user: userProfile });
        });
    });
});


// GET /api/songs/autocomplete
router.get('/songs/autocomplete', async (req, res) => {
    const { query } = req.query;
    const desiredLimit = 7; // How many suggestions we ideally want

    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'Query parameter is required and must be at least 2 characters.' });
    }

    const searchTerm = query.trim();
    const dbInstance = db.getDb()

    // 1. Try searching the local cache
    const localSql = `
        SELECT spotify_track_id as id, title, artist 
        FROM song_suggestion_cache 
        WHERE title LIKE ? OR artist LIKE ? 
        ORDER BY title ASC 
        LIMIT ?
    `;
    const likeQuery = `%${searchTerm}%`;

    dbInstance.all(localSql, [likeQuery, likeQuery, desiredLimit], async (err, localRows) => {
        if (err) {
            console.error("[Cache Search] Error fetching autocomplete suggestions from local cache:", err.message);
            // Don't fail here, proceed to Spotify search as a fallback
        }

        if (localRows && localRows.length >= desiredLimit) {
            console.log(`[Cache Search] Found ${localRows.length} suggestions in cache for query "${searchTerm}".`);
            return res.json(localRows);
        }

        // 2. If not enough results from cache, fetch from Spotify
        let combinedResults = localRows || [];
        const remainingNeeded = desiredLimit - combinedResults.length;
        
        console.log(`[Cache Search] Found ${combinedResults.length} in cache. Need ${remainingNeeded > 0 ? remainingNeeded : 0} more. Fetching from Spotify for query "${searchTerm}".`);

        try {
            const spotifySuggestions = await musicSourceService.searchTracksOnSpotify(searchTerm, desiredLimit); // Fetch a good number

            if (spotifySuggestions && spotifySuggestions.length > 0) {
                // Add new Spotify suggestions to combinedResults, avoiding duplicates based on id
                const existingIds = new Set(combinedResults.map(r => r.id));
                const newUniqueSuggestions = spotifySuggestions.filter(s => !existingIds.has(s.id));
                
                combinedResults = combinedResults.concat(newUniqueSuggestions);
                
                // Trim to desiredLimit if we have too many now
                combinedResults = combinedResults.slice(0, desiredLimit);

                // Asynchronously save new Spotify suggestions to cache (don't wait for this to respond to user)
                if (newUniqueSuggestions.length > 0) {
                     musicSourceService.saveSuggestionsToCache(newUniqueSuggestions)
                        .then(() => console.log(`[Cache Save] Cache update initiated for ${newUniqueSuggestions.length} items from Spotify.`))
                        .catch(cacheErr => console.error("[Cache Save] Error saving Spotify suggestions to cache:", cacheErr.message));
                }
            }
            
            console.log(`[Spotify Search] Returning ${combinedResults.length} combined suggestions for query "${searchTerm}".`);
            res.json(combinedResults);

        } catch (spotifyErr) {
            console.error("[Spotify Search] Error fetching autocomplete suggestions from Spotify service:", spotifyErr.message);
            // If Spotify fails, and we had some local results, return those. Otherwise, error.
            if (combinedResults.length > 0) {
                console.log(`[Spotify Search Failed] Returning ${combinedResults.length} cached suggestions for query "${searchTerm}".`);
                return res.json(combinedResults);
            }
            res.status(500).json({ error: 'Failed to retrieve autocomplete suggestions.' });
        }
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
