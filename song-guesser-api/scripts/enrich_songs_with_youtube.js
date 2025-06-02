// song-guesser-api/scripts/enrich_songs_with_youtube.js

const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const musicSourceService = require('../services/music-source-service'); // Requires searchYouTubeVideo
const { YOUTUBE_API_KEYS } = require('../config'); // For checking if API key is set

// YouTube Data API has quotas. Be mindful. 
// A common quota is 10,000 units/day. A search is ~100 units.
// This delay helps, but for large lists, process in batches or over days.
const DELAY_BETWEEN_YOUTUBE_CALLS_MS = 2000; // 2 seconds to be very safe with quotas & API limits

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function markSongYouTubeStatus(db, curatedSongId, youtube_id_or_status_marker) {
    // This function now only updates if youtube_video_id IS NULL,
    // meaning if a real ID was found, it won't be overwritten by a later "NOT_FOUND" marker
    // for the same song in an unlikely scenario.
    const sql = `UPDATE curated_songs SET youtube_video_id = ? WHERE id = ? AND youtube_video_id IS NULL`;
    return new Promise((resolve, reject) => {
        db.run(sql, [youtube_id_or_status_marker, curatedSongId], function(err) {
            if (err) {
                console.error(`  Error updating YouTube status for song ID ${curatedSongId} to "${youtube_id_or_status_marker}": ${err.message}`);
                return reject(err);
            }
            if (this.changes > 0) {
                if (youtube_id_or_status_marker && !youtube_id_or_status_marker.startsWith('YOUTUBE_') && !youtube_id_or_status_marker.startsWith('ERROR_')) {
                    console.log(`  SUCCESS: Found YouTube ID "${youtube_id_or_status_marker}" for song ID ${curatedSongId}.`);
                } else {
                    console.log(`  Marked song ID ${curatedSongId} with YouTube status: "${youtube_id_or_status_marker}".`);
                }
            }
            resolve(this.changes);
        });
    });
}

async function enrichSongsWithYouTube() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise;
    const db = getDb();
    console.log('Database initialized. Starting YouTube enrichment process...');

    const initialKey = musicSourceService.getCurrentYouTubeApiKey ? musicSourceService.getCurrentYouTubeApiKey() : null; // If getCurrentYouTubeApiKey is exported
    if (!initialKey && (!YOUTUBE_API_KEYS || YOUTUBE_API_KEYS.length === 0)) { // Check config directly too
        console.error('YOUTUBE_API_KEYS are not configured. Aborting YouTube enrichment.');
        return;
    }

    const songsToEnrich = await new Promise((resolve, reject) => {
        const sql = `
            SELECT id, title, artist, duration_ms 
            FROM curated_songs 
            WHERE spotify_track_id IS NOT NULL 
              AND spotify_track_id NOT LIKE 'SPOTIFY_%' 
              AND spotify_track_id NOT LIKE 'ERROR_%' 
              AND youtube_video_id IS NULL
              AND (is_active = 1 OR is_active IS NULL)
            ORDER BY year DESC
            LIMIT 300; -- Process in batches to manage API quotas
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (songsToEnrich.length === 0) {
        console.log('No songs found in curated_songs needing YouTube enrichment at this time.');
        return;
    }

    console.log(`Found ${songsToEnrich.length} songs to enrich with YouTube video IDs.`);
    let songsUpdatedWithVideoId = 0;
    let songsMarkedNotFound = 0; // Songs where search completed but found nothing suitable
    let songsSkippedDueToErrorThisRun = 0; // Songs that errored and will be retried (includes quota error song)

    for (let i = 0; i < songsToEnrich.length; i++) {
        const song = songsToEnrich[i];
        console.log(`\nProcessing (${i + 1}/${songsToEnrich.length}): "${song.title}" by ${song.artist}`);
        
        try {
            const youtubeVideoId = await musicSourceService.searchYouTubeVideo(
                song.title, 
                song.artist, 
                song.duration_ms 
            );

            if (youtubeVideoId) {
                const changes = await markSongYouTubeStatus(db, song.id, youtubeVideoId);
                if (changes > 0) songsUpdatedWithVideoId++;
            } else {
                // searchYouTubeVideo returned null, meaning no suitable video was found after all its attempts
                console.warn(`  No suitable YouTube video found for "${song.title}" by ${song.artist} (search returned null).`);
                await markSongYouTubeStatus(db, song.id, 'Youtube_NOT_FOUND');
                songsMarkedNotFound++;
            }
        } catch (error) {
            songsSkippedDueToErrorThisRun++; // Count this song as skipped in this run due to error
            console.error(`  Error processing song "${song.title}": ${error.message}`);
            
            let isQuotaError = false;
            // Axios errors (from direct calls in this script if any, or if searchYouTubeVideo re-throws raw Axios error)
            if (error.name === "AllApiKeysExhaustedError" || 
                (error.isAxiosError && error.response && error.response.status === 403) ||
                (error.message && error.message.toLowerCase().includes('quota')) ) {
                console.error('>>> YouTube API quota likely reached for ALL available keys or a persistent API access issue. Stopping enrichment for this run. <<<');
                console.error(`    The current song ("${song.title}") and subsequent songs in this batch were not processed and will be retried later.`);
                break; // Exit the main song processing loop
            
            } else {
                // For other types of errors not related to quota, mark the song as problematic in the DB
                console.log(`    Marking song "${song.title}" as 'ERROR_DURING_YOUTUBE_ENRICH' in DB due to non-quota error.`);
                try {
                    await markSongYouTubeStatus(db, song.id, 'ERROR_DURING_YOUTUBE_ENRICH');
                } catch (markError) {
                    console.error(`  Additionally, failed to mark song ID ${song.id} as errored: ${markError.message}`);
                }
            }
        }

        // Delay between processing different songs, unless we broke out of the loop
        if (i < songsToEnrich.length - 1) {
            await delay(DELAY_BETWEEN_YOUTUBE_CALLS_MS);
        }
    }

    console.log(`\n--- YouTube Enrichment Run Complete ---`);
    console.log(`Songs successfully updated with YouTube Video ID: ${songsUpdatedWithVideoId}`);
    console.log(`Songs where search completed but no suitable video found (marked Youtube_NOT_FOUND): ${songsMarkedNotFound}`);
    console.log(`Songs that encountered an error during processing this run (may include quota error song): ${songsSkippedDueToErrorThisRun}`);
    console.log(`Remaining songs pending YouTube enrichment (approx, run script again to see precise): ${songsToEnrich.length - (songsUpdatedWithVideoId + songsMarkedNotFound + songsSkippedDueToErrorThisRun)}`);
}

// Run the enrichment process
enrichSongsWithYouTube().catch(err => {
    console.error("Unhandled error in enrichSongsWithYouTube script:", err);
});