console.log('The endpoint user requires a subscription. Not using for now');
return;

// song-guesser-api/scripts/enrich_songs_with_genres_theaudiodb.js
const axios = require('axios');
const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const { THEAUDIODB_API_KEY, THEAUDIODB_API_BASE_URL } = require('../config');

const DELAY_BETWEEN_API_CALLS_MS = 800; // Be polite to TheAudioDB
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function enrichGenresWithTheAudioDB() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise;
    const db = getDb();
    console.log('Database initialized. Starting TheAudioDB genre enrichment process...');

    if (!THEAUDIODB_API_KEY) {
        console.error('THEAUDIODB_API_KEY is not configured. Aborting.');
        return;
    }

    const songsToEnrich = await new Promise((resolve, reject) => {
        const sql = `
            SELECT id, title, artist 
            FROM curated_songs 
            WHERE spotify_track_id IS NOT NULL       -- Has Spotify ID
              AND spotify_track_id NOT LIKE 'SPOTIFY_%' -- Is not a Spotify error marker
              AND spotify_track_id NOT LIKE 'ERROR_%'
              AND genres IS NULL                   -- Genres column is currently empty
              AND (is_active = 1 OR is_active IS NULL)
            LIMIT 2 -- Process in batches
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (songsToEnrich.length === 0) {
        console.log('No songs found in curated_songs needing genre enrichment from TheAudioDB.');
        return;
    }

    console.log(`Found ${songsToEnrich.length} songs to enrich with genres from TheAudioDB.`);
    let songsUpdated = 0;
    let songsNotFoundOrNoGenre = 0;
    let songsErrored = 0;

    for (const song of songsToEnrich) {
        console.log(`\nProcessing: "${song.title}" by "${song.artist}" for genre...`);
        try {
            const searchUrl = `${THEAUDIODB_API_BASE_URL}/${THEAUDIODB_API_KEY}/searchtrack.php?s=${encodeURIComponent(song.artist)}&t=${encodeURIComponent(song.title)}`;
            const response = await axios.get(searchUrl);
            await delay(DELAY_BETWEEN_API_CALLS_MS);

            if (response.data && response.data.track && response.data.track.length > 0) {
                const trackData = response.data.track[0]; // Assume first result is best
                const genre = trackData.strGenre;
                const style = trackData.strStyle; // Often more specific than genre

                let genresToStore = [];
                if (genre) genresToStore.push(genre.trim());
                if (style && style.toLowerCase() !== genre?.toLowerCase()) { // Add style if different from genre
                    genresToStore.push(style.trim());
                }
                
                const genresString = genresToStore.length > 0 ? genresToStore.join(', ') : null;

                if (genresString) {
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        db.run(
                            'UPDATE curated_songs SET genres = ? WHERE id = ? AND genres IS NULL', 
                            [genresString, song.id], 
                            function(updateErr) {
                                if (updateErr) return rejectUpdate(updateErr);
                                if (this.changes > 0) {
                                    console.log(`  SUCCESS: Updated song ID ${song.id} with genres: "${genresString}"`);
                                    songsUpdated++;
                                } else {
                                    console.log(`  INFO: Song ID ${song.id} might have been updated by another process or already had genres.`);
                                }
                                resolveUpdate();
                            }
                        );
                    });
                } else {
                    console.warn(`  No genre information found on TheAudioDB for "${song.title}" by "${song.artist}".`);
                    // Optionally mark it so you don't retry TheAudioDB for this song
                    // await db.runAsync('UPDATE curated_songs SET genres = ? WHERE id = ?', ['TADB_NO_GENRE', song.id]);
                    songsNotFoundOrNoGenre++;
                }
            } else {
                console.warn(`  Track not found on TheAudioDB: "${song.title}" by "${song.artist}".`);
                // Optionally mark it
                songsNotFoundOrNoGenre++;
            }
        } catch (error) {
            console.error(`  Error processing song "${song.title}" with TheAudioDB: ${error.message}`);
            songsErrored++;
            // Optionally mark it
        }
    }

    console.log(`\n--- TheAudioDB Genre Enrichment Complete ---`);
    console.log(`Songs successfully updated with genres: ${songsUpdated}`);
    console.log(`Songs where track/genre not found on TheAudioDB: ${songsNotFoundOrNoGenre}`);
    console.log(`Songs that errored during processing: ${songsErrored}`);
}

// Run the enrichment process
enrichGenresWithTheAudioDB().catch(err => {
    console.error("Unhandled error in enrichGenresWithTheAudioDB script:", err);
});