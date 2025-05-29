// File: jobs/daily-song-curator.js
// Description: Scheduled job to fetch and cache daily challenge songs.
// Changes:
// - Calls `spotifyService.getTracksForDailyChallenge` instead of `getTracksFromPlaylist`.

const cron = require('node-cron');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const spotifyService = require('../services/spotify-service'); // This now exports getTracksForDailyChallenge
const { DAILY_SONG_COUNT } = require('../config');

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

async function curateDailySongs() {
    const db = getDb();
    console.log(`[${new Date().toISOString()}] Running daily song curation job...`);
    const today = getTodayDateString();

    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM daily_challenges WHERE challenge_date = ?', [today], async (err, row) => {
            if (err) {
                console.error('Error checking existing daily songs:', err.message);
                return reject(err);
            }
            if (row && row.count > 0) {
                console.log(`Songs for ${today} already exist. Skipping curation.`);
                return resolve();
            }

            try {
                // Use the new function to get tracks
                const tracksForChallenge = await spotifyService.getTracksForDailyChallenge(DAILY_SONG_COUNT);
                
                if (!tracksForChallenge || tracksForChallenge.length === 0) {
                    return reject(new Error('No tracks fetched from Spotify for daily challenge.'));
                }

                // If fewer tracks than DAILY_SONG_COUNT were returned, we proceed with what we have.
                if (tracksForChallenge.length < DAILY_SONG_COUNT) {
                    console.warn(`Fetched only ${tracksForChallenge.length} tracks, less than the desired ${DAILY_SONG_COUNT}.`);
                }
                // No need to shuffle or slice again if getTracksForDailyChallenge already returns the desired count or fewer.

                const insertStmt = db.prepare(`
                    INSERT INTO daily_challenges 
                    (challenge_date, song_order, source_name, track_id_from_source, title, artist, preview_url, album_art_url, duration_ms) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                db.serialize(() => {
                    db.run('BEGIN TRANSACTION;', txErr => { if (txErr) return reject(txErr); });
                    tracksForChallenge.forEach((track, index) => {
                        insertStmt.run(
                            today, index + 1, 'spotify', track.id, track.title,
                            track.artist, track.preview_url, track.album_art_url, track.duration_ms,
                            (runErr) => {
                                if (runErr) console.error('Error inserting song:', track.title, runErr.message);
                            }
                        );
                    });
                    insertStmt.finalize(finalizeErr => {
                        if (finalizeErr) {
                             console.error('Finalize statement error:', finalizeErr.message);
                             db.run('ROLLBACK;'); // Attempt rollback
                             return reject(finalizeErr);
                        }
                        db.run('COMMIT;', (commitErr) => {
                            if (commitErr) {
                                console.error('Transaction commit error:', commitErr.message);
                                db.run('ROLLBACK;'); // Attempt rollback
                                return reject(commitErr);
                            }
                            console.log(`Successfully curated and stored ${tracksForChallenge.length} songs for ${today}.`);
                            resolve();
                        });
                    });
                });
            } catch (curationError) {
                console.error('Error during daily song curation process:', curationError.message);
                db.run('ROLLBACK;', (rbErr) => { 
                    if (rbErr) console.error('Rollback error during curationError handling:', rbErr.message);
                }); 
                reject(curationError);
            }
        });
    });
}

// startDailyJob function remains the same
function startDailyJob() {
    cron.schedule('0 1 * * *', async () => { 
        console.log(`[${new Date().toISOString()}] Cron job triggered for daily song curation.`);
        try {
            await dbInitializationPromise; 
            await curateDailySongs();
        } catch (error) {
            console.error("Daily song curation cron job failed:", error);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });
    console.log('Daily song curation job scheduled for 1:00 AM UTC.');

    (async () => {
        try {
            await dbInitializationPromise; 
            console.log('Database initialized. Attempting initial song curation on startup...');
            await curateDailySongs();
        } catch (error) {
            console.error("Initial song curation on startup failed:", error.message);
        }
    })();
}

module.exports = { startDailyJob, curateDailySongs };