// File: jobs/daily-song-curator.js
// Description: Scheduled job to fetch and cache daily challenge songs.
// Changes:
// - Revised transaction handling in curateDailySongs for robustness.
// - Uses Promise.all to manage insert operations.
// - Ensures explicit rollback on insert failure before attempting commit.
// - Filters tracks missing youtube_video_id before starting transaction.

const cron = require('node-cron');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const spotifyService = require('../services/music-source-service'); // This now exports getTracksForDailyChallenge
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
            // if (row && row.count > 0) {
            //     console.log(`Songs for ${today} already exist (${row.count} songs). Skipping curation.`);
            //     return resolve();
            // }

            try {
                console.log(`No songs for ${today} found. Fetching up to ${DAILY_SONG_COUNT} tracks...`);
                const tracksForChallenge = await spotifyService.getTracksForDailyChallenge(DAILY_SONG_COUNT);
                
                if (!tracksForChallenge || tracksForChallenge.length === 0) {
                    console.error('No tracks returned from music source service for daily challenge.');
                    // getTracksForDailyChallenge should throw if it's a critical failure to get any tracks.
                    return reject(new Error('No tracks fetched from Spotify/YouTube for daily challenge.'));
                }

                if (tracksForChallenge.length < DAILY_SONG_COUNT) {
                    console.warn(`Fetched only ${tracksForChallenge.length} tracks, less than the desired ${DAILY_SONG_COUNT}. Proceeding with these.`);
                }
                
                const validTracksForChallenge = tracksForChallenge.filter(track => {
                    if (!track.youtube_video_id) {
                        console.warn(`[Pre-Transaction Filter] Skipping track "${track.title}" (Spotify ID: ${track.track_id_from_source}) for storage due to missing youtube_video_id.`);
                        return false;
                    }
                    return true;
                });

                if (validTracksForChallenge.length === 0) {
                    const message = tracksForChallenge.length > 0 ? "All fetched tracks were invalid (missing youtube_video_id)." : "No valid tracks to process.";
                    console.error(`${message} Cannot proceed with curation.`);
                    return reject(new Error(`${message} Aborting curation.`));
                }

                db.run('BEGIN TRANSACTION;', function(beginErr) { // Using function for `this` context if needed by sqlite3, though not directly here.
                    if (beginErr) {
                        console.error('Failed to begin transaction:', beginErr.message);
                        return reject(beginErr);
                    }

                    const insertStmt = db.prepare(`
                        INSERT INTO daily_challenges 
                        (challenge_date, song_order, source_name, track_id_from_source, title, artist, album_art_url, duration_ms, youtube_video_id) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    let successfulInserts = 0;
                    const insertPromises = validTracksForChallenge.map((track, index) => {
                        return new Promise((resolveInsert, rejectInsert) => {
                            insertStmt.run(
                                today, index + 1, track.source_name || 'spotify',
                                track.track_id_from_source, track.title, track.artist,
                                track.album_art_url, track.duration_ms, track.youtube_video_id,
                                function(runErr) { // Using `function` for `this` context
                                    if (runErr) {
                                        console.error(`Error inserting song: "${track.title}" (SpotifyID: ${track.track_id_from_source}). Error: ${runErr.message}`);
                                        rejectInsert(runErr); // Reject promise for this specific insert
                                    } else {
                                        successfulInserts++;
                                        resolveInsert();
                                    }
                                }
                            );
                        });
                    });

                    Promise.all(insertPromises)
                        .then(() => {
                            // All inserts were successful
                            insertStmt.finalize((finalizeErr) => {
                                if (finalizeErr) {
                                    console.error('Finalize statement error after successful inserts:', finalizeErr.message);
                                    db.run('ROLLBACK;', (rbErr) => {
                                        if (rbErr) console.error('Rollback error on finalizeErr:', rbErr.message);
                                        reject(finalizeErr); // Reject the main promise
                                    });
                                    return;
                                }

                                db.run('COMMIT;', (commitErr) => {
                                    if (commitErr) {
                                        console.error('Transaction commit error:', commitErr.message);
                                        // Attempt rollback, though transaction might already be inactive
                                        db.run('ROLLBACK;', (rbErr) => {
                                            if (rbErr) console.error('Rollback error on commitErr:', rbErr.message);
                                            reject(commitErr); // Reject the main promise
                                        });
                                    } else {
                                        console.log(`Successfully curated and stored ${successfulInserts} songs for ${today}.`);
                                        resolve(); // Resolve the main promise
                                    }
                                });
                            });
                        })
                        .catch((error) => { // This catch is for Promise.all rejection (an insert failed)
                            console.error('One or more song inserts failed, initiating rollback:', error.message);
                            // It's good practice to finalize the statement even on failure.
                            insertStmt.finalize((finalizeErrOnFail) => {
                                if (finalizeErrOnFail) {
                                    console.error('Finalize statement error during error handling (rollback path):', finalizeErrOnFail.message);
                                }
                                db.run('ROLLBACK;', (rbErr) => {
                                    if (rbErr) console.error('Rollback error after insert error:', rbErr.message);
                                    reject(error); // Reject main promise with the original insert error
                                });
                            });
                        });
                }); // End of db.run('BEGIN TRANSACTION;') callback

            } catch (curationError) { // This catch is mainly for errors from spotifyService.getTracksForDailyChallenge
                console.error('Error during daily song curation process (before transaction attempt or in track fetching):', curationError.message, curationError.stack);
                // No db.run('ROLLBACK;') here as transaction might not have started or already handled by inner logic.
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
            // The error from curateDailySongs (if it rejects) will be caught here.
            // Error logging is already done within curateDailySongs or its called functions.
            console.error("Daily song curation cron job failed:", error.message);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });
    console.log('Daily song curation job scheduled for 1:00 AM UTC.');

    // Initial run on startup
    (async () => {
        try {
            await dbInitializationPromise; 
            console.log('Database initialized. Attempting initial song curation on startup...');
            await curateDailySongs();
        } catch (error) {
            // Error from curateDailySongs on startup
            console.error("Initial song curation on startup failed:", error.message);
        }
    })();
}

module.exports = { startDailyJob, curateDailySongs };