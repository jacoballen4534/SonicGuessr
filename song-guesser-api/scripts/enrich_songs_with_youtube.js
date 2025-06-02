// song-guesser-api/scripts/enrich_songs_with_youtube.js

const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const musicSourceService = require('../services/music-source-service'); // Requires searchYouTubeVideo
const { YOUTUBE_API_KEY } = require('../config'); // For checking if API key is set

// YouTube Data API has quotas. Be mindful. 
// A common quota is 10,000 units/day. A search is ~100 units.
// This delay helps, but for large lists, process in batches or over days.
const DELAY_BETWEEN_YOUTUBE_CALLS_MS = 2000; // 2 seconds to be very safe with quotas & API limits

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function markSongYouTubeStatus(db, curatedSongId, youtube_id_or_status_marker) {
    const sql = `UPDATE curated_songs SET youtube_video_id = ? WHERE id = ? AND youtube_video_id IS NULL`;
    return new Promise((resolve, reject) => {
        db.run(sql, [youtube_id_or_status_marker, curatedSongId], function(err) {
            if (err) {
                console.error(`  Error updating YouTube status for song ID ${curatedSongId} to "${youtube_id_or_status_marker}": ${err.message}`);
                return reject(err);
            }
            if (this.changes > 0) {
                if (youtube_id_or_status_marker && !youtube_id_or_status_marker.startsWith('YOUTUBE_')) {
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

    if (!YOUTUBE_API_KEY) {
        console.error('YOUTUBE_API_KEY is not configured in your .env/config.js. Aborting YouTube enrichment.');
        return;
    }

    const songsToEnrich = await new Promise((resolve, reject) => {
        // Select songs that have Spotify details but no YouTube ID yet, and are active
        const sql = `
            SELECT id, title, artist, duration_ms 
            FROM curated_songs 
            WHERE spotify_track_id IS NOT NULL 
              AND spotify_track_id NOT LIKE 'SPOTIFY_%' /* Avoid those marked problematic from Spotify step */
              AND spotify_track_id NOT LIKE 'ERROR_%' 
              AND youtube_video_id IS NULL
              AND (is_active = 1 OR is_active IS NULL)
            LIMIT 2 -- Process in batches to manage API quotas
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
    let songsMarkedNotFound = 0;
    let songsErrored = 0;

    for (const song of songsToEnrich) {
        console.log(`\nProcessing for YouTube ID: "${song.title}" by ${song.artist}`);
        
        try {
            const youtubeVideoId = await musicSourceService.searchYouTubeVideo(
                song.title, 
                song.artist, 
                song.duration_ms 
            );
            await delay(DELAY_BETWEEN_YOUTUBE_CALLS_MS); // Delay between each song's Youtube

            if (youtubeVideoId) {
                const changes = await markSongYouTubeStatus(db, song.id, youtubeVideoId);
                if (changes > 0) songsUpdatedWithVideoId++;
            } else {
                console.warn(`  No suitable YouTube video found for "${song.title}" by ${song.artist}.`);
                await markSongYouTubeStatus(db, song.id, 'Youtube_NOT_FOUND');
                songsMarkedNotFound++;
            }
        } catch (error) {
            console.error(`  Error during Youtube/update for song "${song.title}": ${error.message}`);
            songsErrored++;
            try {
                await markSongYouTubeStatus(db, song.id, 'ERROR_DURING_YOUTUBE_ENRICH');
            } catch (markError) {
                console.error(`  Additionally, failed to mark song ID ${song.id} as errored: ${markError.message}`);
            }
        }
    }

    console.log(`\n--- YouTube Enrichment Complete ---`);
    console.log(`Songs successfully updated with YouTube Video ID: ${songsUpdatedWithVideoId}`);
    console.log(`Songs marked as no YouTube video found: ${songsMarkedNotFound}`);
    console.log(`Songs errored during processing: ${songsErrored}`);
}

// Run the enrichment process
enrichSongsWithYouTube().catch(err => {
    console.error("Unhandled error in enrichSongsWithYouTube script:", err);
});