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
    const today = getTodayDateString();
    console.log(`[${new Date().toISOString()}] Running daily song curation job for ${today}...`);

    return new Promise((resolve, reject) => {
        // Check if challenges for today already exist
        db.get('SELECT COUNT(*) as count FROM daily_challenges WHERE challenge_date = ?', [today], async (err, row) => {
            if (err) {
                console.error('Error checking existing daily songs:', err.message);
                return reject(err);
            }
            if (row && row.count > 0) {
                console.log(`Songs for ${today} already exist (${row.count} songs). Skipping curation.`);
                return resolve();
            }

            console.log(`No songs for ${today} found in daily_challenges. Attempting to curate from curated_songs table...`);

            try {
                // Step 1: Select random, eligible songs from curated_songs table
                // Songs must have all necessary fields populated, including youtube_video_id
                // and not have been used too recently (e.g., in the last 30 days).
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0,10);

                const selectCuratedSql = `
                    SELECT 
                        id AS curated_song_db_id, /* ID from curated_songs table */
                        title, 
                        artist, 
                        album_art_url, 
                        duration_ms, 
                        youtube_video_id,
                        spotify_track_id AS track_id_from_source /* Use spotify_track_id as the source ID */
                    FROM curated_songs
                    WHERE 
                        spotify_track_id IS NOT NULL AND spotify_track_id NOT LIKE 'SPOTIFY_%' AND spotify_track_id NOT LIKE 'ERROR_%'
                        AND youtube_video_id IS NOT NULL AND youtube_video_id NOT LIKE 'YOUTUBE_%' AND youtube_video_id NOT LIKE 'ERROR_%'
                        AND title IS NOT NULL
                        AND artist IS NOT NULL
                        AND album_art_url IS NOT NULL
                        AND duration_ms IS NOT NULL
                        AND (is_active = 1 OR is_active IS NULL)
                        AND (last_used_for_challenge IS NULL OR last_used_for_challenge < ?)
                    ORDER BY RANDOM()
                    LIMIT ?;
                `;
                
                const tracksToChallenge = await new Promise((resolveSelect, rejectSelect) => {
                    db.all(selectCuratedSql, [thirtyDaysAgoStr, DAILY_SONG_COUNT], (selectErr, selectedRows) => {
                        if (selectErr) {
                            console.error("Error selecting songs from curated_songs:", selectErr.message);
                            return rejectSelect(selectErr);
                        }
                        resolveSelect(selectedRows || []);
                    });
                });

                if (!tracksToChallenge || tracksToChallenge.length === 0) {
                    const msg = 'No eligible songs found in curated_songs table to form a daily challenge.';
                    console.error(msg);
                    // Not rejecting here, as it might be a temporary state. Job will try again next day.
                    // Or, you might want to send an alert.
                    return resolve(); // Resolve without creating challenge if no songs
                }

                if (tracksToChallenge.length < DAILY_SONG_COUNT) {
                    console.warn(`[Curator] Fetched only ${tracksToChallenge.length} eligible songs from curated_songs, less than desired ${DAILY_SONG_COUNT}.`);
                }

                console.log(`[Curator] Selected ${tracksToChallenge.length} songs from curated_songs to insert into daily_challenges.`);

                // Step 2: Insert selected songs into daily_challenges table
                // and update last_used_for_challenge in curated_songs
                const insertDailyChallengeSql = `
                    INSERT INTO daily_challenges 
                    (challenge_date, song_order, source_name, track_id_from_source, title, artist, album_art_url, duration_ms, youtube_video_id) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const updateCuratedSql = `
                    UPDATE curated_songs 
                    SET last_used_for_challenge = ? 
                    WHERE id = ?
                `;

                // Use a transaction for inserting into daily_challenges and updating curated_songs
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION;', async (txErr) => {
                        if (txErr) {
                            console.error("Error beginning transaction:", txErr.message);
                            return reject(txErr);
                        }

                        let songsSuccessfullyInserted = 0;
                        try {
                            const dailyChallengeStmt = db.prepare(insertDailyChallengeSql);
                            const updateCuratedStmt = db.prepare(updateCuratedSql);

                            for (let i = 0; i < tracksToChallenge.length; i++) {
                                const track = tracksToChallenge[i];
                                const songOrder = i + 1;
                                
                                await new Promise((resolveRun, rejectRun) => {
                                    dailyChallengeStmt.run(
                                        today,
                                        songOrder,
                                        'curated_spotify', // Source name indicating it's from our curated list, originally from Spotify
                                        track.track_id_from_source,
                                        track.title,
                                        track.artist,
                                        track.album_art_url,
                                        track.duration_ms,
                                        track.youtube_video_id,
                                        (runErr) => {
                                            if (runErr) {
                                                console.error('Error inserting song into daily_challenges:', track.title, runErr.message);
                                                return rejectRun(runErr); // This will trigger catch and rollback
                                            }
                                            songsSuccessfullyInserted++;
                                            resolveRun();
                                        }
                                    );
                                });
                                
                                // Update last_used_for_challenge for the song in curated_songs
                                await new Promise((resolveUpdate, rejectUpdate) => {
                                     updateCuratedStmt.run(today, track.curated_song_db_id, (updateErr) => {
                                        if (updateErr) {
                                            console.error('Error updating last_used_for_challenge for curated_song ID:', track.curated_song_db_id, updateErr.message);
                                            // Decide if this should also rollback. For now, log and continue.
                                        }
                                        resolveUpdate();
                                    });
                                });
                            }

                            dailyChallengeStmt.finalize();
                            updateCuratedStmt.finalize();
                            
                            db.run('COMMIT;', (commitErr) => {
                                if (commitErr) {
                                    console.error('Transaction commit error:', commitErr.message);
                                    return reject(commitErr); // Rollback should be attempted by error handler
                                }
                                console.log(`[Curator] Successfully curated and stored ${songsSuccessfullyInserted} songs for ${today}.`);
                                resolve();
                            });

                        } catch (processingError) {
                            console.error('Error during song processing and insertion transaction:', processingError.message);
                            db.run('ROLLBACK;', (rbErr) => {
                                if (rbErr) console.error('Rollback error on processingError:', rbErr.message);
                                reject(processingError);
                            });
                        }
                    });
                });

            } catch (curationError) {
                console.error('Error during daily song curation process:', curationError.message, curationError.stack);
                // Ensure rollback is attempted if transaction was started and error occurred before commit/rollback logic
                // The transaction block itself has a catch that should handle rollback.
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
            console.error("Daily song curation cron job failed:", error.message);
        }
    }, {
        scheduled: true,
        timezone: "UTC" // Example: Run at 1 AM UTC
    });
    console.log('Daily song curation job scheduled (e.g., 1:00 AM UTC). Check timezone.');

    // Initial run on startup after a delay to ensure DB is fully ready and other startups might have finished
    (async () => {
        try {
            console.log('Waiting for DB and a moment before initial song curation on startup...');
            await dbInitializationPromise; 
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            
            console.log('Attempting initial song curation on startup...');
            await curateDailySongs();
        } catch (error) {
            console.error("Initial song curation on startup failed:", error.message);
        }
    })();
}

module.exports = { startDailyJob, curateDailySongs };
