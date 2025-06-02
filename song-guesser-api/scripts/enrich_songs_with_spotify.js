// song-guesser-api/scripts/enrich_songs_with_spotify.js

const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const musicSourceService = require('../services/music-source-service');

const DELAY_BETWEEN_SPOTIFY_CALLS_MS = 1100; // Respect rate limits

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function markSongAsProblematic(db, curatedSongId, statusMarker = 'SPOTIFY_PROBLEM') {
    // Make the status marker unique for each song to avoid UNIQUE constraint violations
    // on spotify_track_id if multiple songs have the same problem status.
    const uniqueStatusMarker = `${statusMarker}_${curatedSongId}`;
    
    const sql = `UPDATE curated_songs SET spotify_track_id = ?, is_active = 0 WHERE id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [uniqueStatusMarker, curatedSongId], function(err) {
            if (err) {
                console.error(`  Error marking song ID ${curatedSongId} with status "${uniqueStatusMarker}": ${err.message}`);
                return reject(err); // Propagate error if needed, or just log and resolve
            }
            if (this.changes > 0) {
                console.log(`  Marked song ID ${curatedSongId} as inactive with Spotify status: "${uniqueStatusMarker}".`);
            }
            resolve();
        });
    });
}

async function enrichSongsWithSpotify() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise;
    const db = getDb();
    console.log('Database initialized. Starting Spotify enrichment process...');

    let spotifyToken;
    try {
        spotifyToken = await musicSourceService.getAccessToken();
        if (!spotifyToken) {
            console.error('Failed to get Spotify access token. Aborting.');
            return;
        }
        console.log('Spotify access token obtained.');
    } catch (e) {
        console.error('Error getting Spotify access token:', e.message);
        return;
    }

    const songsToEnrich = await new Promise((resolve, reject) => {
        const sql = `
            SELECT id, title, artist, year 
            FROM curated_songs 
            WHERE spotify_track_id IS NULL 
              AND (is_active = 1 OR is_active IS NULL) 
            -- LIMIT 10 -- Process in batches if you have many
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (songsToEnrich.length === 0) {
        console.log('No songs found in curated_songs needing Spotify enrichment.');
        return;
    }

    console.log(`Found ${songsToEnrich.length} songs to enrich with Spotify details.`);
    let songsUpdated = 0;
    let songsMarkedProblematic = 0;
    
    for (const song of songsToEnrich) {
        console.log(`\nProcessing: "${song.title}" by ${song.artist} (${song.year || 'N/A'})`);
        let searchQuery = `track:${song.title} artist:${song.artist}`;
        if (song.year) {
            searchQuery += ` year:${song.year}`;
        }

        try {
            const searchResults = await musicSourceService.searchTracksOnSpotify(searchQuery, 1, spotifyToken);
            await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);

            if (searchResults && searchResults.length > 0) {
                const spotifyTrackBasic = searchResults[0];
                console.log(`  Spotify search found: "${spotifyTrackBasic.title}" by ${spotifyTrackBasic.artist} (ID: ${spotifyTrackBasic.id})`);

                const detailedTracks = await musicSourceService.fetchFullTrackDetails([spotifyTrackBasic.id], spotifyToken);
                await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);

                if (detailedTracks && detailedTracks.length > 0) {
                    const spotifyTrackFull = detailedTracks[0];
                    
                    const updateSql = `
                        UPDATE curated_songs 
                        SET spotify_track_id = ?, 
                            title = ?,             /* Use Spotify's canonical title */
                            artist = ?,            /* Use Spotify's canonical artist */
                            album_art_url = ?, 
                            duration_ms = ?,
                            is_active = 1          /* Mark as active since we found it */
                        WHERE id = ? AND spotify_track_id IS NULL /* Only update if not already processed by another run */
                    `;
                    // Using Spotify's title/artist might be better for consistency
                    const updateValues = [
                        spotifyTrackFull.id,
                        spotifyTrackFull.title, 
                        spotifyTrackFull.artist,
                        spotifyTrackFull.album_art_url,
                        spotifyTrackFull.duration_ms,
                        song.id
                    ];

                    await new Promise((resolveUpdate, rejectUpdate) => {
                        db.run(updateSql, updateValues, function(updateErr) {
                            if (updateErr) {
                                console.error(`  DB UPDATE ERROR for "${spotifyTrackFull.title}": ${updateErr.message}`);
                                // If it's a UNIQUE constraint error here, it means another process/run updated it.
                                if (updateErr.code === 'SQLITE_CONSTRAINT') {
                                    console.warn(`  Skipping update for "${spotifyTrackFull.title}", may have been processed by another instance or already has a Spotify ID.`);
                                    resolveUpdate(); // Resolve so script can continue
                                } else {
                                    rejectUpdate(updateErr);
                                }
                                return;
                            }
                            if (this.changes > 0) {
                                console.log(`  SUCCESS: Updated DB for "${spotifyTrackFull.title}" with Spotify details.`);
                                songsUpdated++;
                            } else {
                                console.warn(`  DB UPDATE made 0 changes for "${spotifyTrackFull.title}". Song ID ${song.id} might have been updated by another process or already had Spotify ID.`);
                            }
                            resolveUpdate();
                        });
                    });
                } else {
                    console.warn(`  Spotify full details not found for track ID: ${spotifyTrackBasic.id}`);
                    await markSongAsProblematic(db, song.id, 'SPOTIFY_DETAILS_NOT_FOUND');
                    songsMarkedProblematic++;
                }
            } else {
                console.warn(`  No Spotify search results for "${song.title}" by ${song.artist}.`);
                await markSongAsProblematic(db, song.id, 'SPOTIFY_SEARCH_NOT_FOUND');
                songsMarkedProblematic++;
            }
        } catch (error) {
            console.error(`  Error processing song "${song.title}": ${error.message}`);
            await markSongAsProblematic(db, song.id, 'ERROR_DURING_ENRICHMENT');
            songsMarkedProblematic++;
        }
    }

    console.log(`\n--- Spotify Enrichment Complete ---`);
    console.log(`Songs successfully updated with Spotify details: ${songsUpdated}`);
    console.log(`Songs marked as problematic (not found/error): ${songsMarkedProblematic}`);
}


// Run the enrichment process
enrichSongsWithSpotify().catch(err => {
    console.error("Unhandled error in enrichSongsWithSpotify script:", err);
});