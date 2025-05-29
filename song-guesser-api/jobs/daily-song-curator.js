// File: jobs/daily-song-curator.js
// Description: Scheduled job to fetch and cache daily challenge songs.
// Changes:
// - `curateDailySongs` now gets the `db` instance via `getDb()`.
// - The startup call to `curateDailySongs` inside `startDailyJob` now awaits `dbInitializationPromise`.

const cron = require('node-cron');
const { getDb, dbInitializationPromise } = require('../services/database-service'); // Updated import
const spotifyService = require('../services/spotify-service');
const { DAILY_SONG_COUNT } = require('../config');

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

async function curateDailySongs() {
    const db = getDb(); // Get the initialized db instance
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
                const potentialTracks = await spotifyService.getTracksFromPlaylist(undefined, DAILY_SONG_COUNT * 2);
                
                if (!potentialTracks || potentialTracks.length === 0) {
                    return reject(new Error('No tracks fetched from Spotify.'));
                }

                const selectedTracks = potentialTracks
                    .sort(() => 0.5 - Math.random()) // Shuffle
                    .slice(0, DAILY_SONG_COUNT);

                if (selectedTracks.length < DAILY_SONG_COUNT) {
                    console.warn(`Could only select ${selectedTracks.length} tracks with previews, less than desired ${DAILY_SONG_COUNT}.`);
                }
                if (selectedTracks.length === 0) {
                    return reject(new Error('Zero tracks selected after filtering for daily challenge.'));
                }

                const insertStmt = db.prepare(`
                    INSERT INTO daily_challenges 
                    (challenge_date, song_order, source_name, track_id_from_source, title, artist, preview_url, album_art_url, duration_ms) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                db.serialize(() => {
                    db.run('BEGIN TRANSACTION;', txErr => { if (txErr) return reject(txErr); });
                    selectedTracks.forEach((track, index) => {
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
                             db.run('ROLLBACK;');
                             return reject(finalizeErr);
                        }
                        db.run('COMMIT;', (commitErr) => {
                            if (commitErr) {
                                console.error('Transaction commit error:', commitErr.message);
                                db.run('ROLLBACK;');
                                return reject(commitErr);
                            }
                            console.log(`Successfully curated and stored ${selectedTracks.length} songs for ${today}.`);
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

function startDailyJob() {
    cron.schedule('0 1 * * *', async () => { // Runs daily at 1 AM UTC
        console.log(`[${new Date().toISOString()}] Cron job triggered for daily song curation.`);
        try {
            await dbInitializationPromise; // Ensure DB is ready before cron job runs for the first time after a restart
            await curateDailySongs();
        } catch (error) {
            console.error("Daily song curation cron job failed:", error);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });
    console.log('Daily song curation job scheduled for 1:00 AM UTC.');

    // Run once on startup after DB initialization
    (async () => {
        try {
            await dbInitializationPromise; // Wait for DB to be initialized
            console.log('Database initialized. Attempting initial song curation on startup...');
            await curateDailySongs();
        } catch (error) {
            console.error("Initial song curation on startup failed:", error.message);
        }
    })();
}

module.exports = { startDailyJob, curateDailySongs };