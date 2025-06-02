// song-guesser-api/scripts/enrich_genres_musicbrainz.js
const axios = require('axios');
const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const { 
    MUSICBRAINZ_API_BASE_URL,
    MUSICBRAINZ_APP_NAME,
    MUSICBRAINZ_APP_VERSION,
    MUSICBRAINZ_CONTACT_EMAIL
} = require('../config');

const MB_USER_AGENT = `${MUSICBRAINZ_APP_NAME}/${MUSICBRAINZ_APP_VERSION} (${MUSICBRAINZ_CONTACT_EMAIL})`;
const DELAY_BETWEEN_API_CALLS_MS = 1100; // MusicBrainz rate limit: 1 req/sec

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Cache for artist genres to reduce redundant API calls within a single script run
const artistGenreCache = new Map();

async function fetchArtistGenresFromMusicBrainz(artistName, db) {
    if (artistGenreCache.has(artistName.toLowerCase())) {
        console.log(`  [MB Cache] Using cached genres for artist: "${artistName}"`);
        return artistGenreCache.get(artistName.toLowerCase());
    }

    console.log(`  [MusicBrainz] Searching for artist MBID: "${artistName}"`);
    let artistMBID = null;
    try {
        const artistSearchUrl = `${MUSICBRAINZ_API_BASE_URL}/artist?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`;
        const artistSearchResponse = await axios.get(artistSearchUrl, { headers: { 'User-Agent': MB_USER_AGENT } });
        await delay(DELAY_BETWEEN_API_CALLS_MS);

        if (artistSearchResponse.data && artistSearchResponse.data.artists && artistSearchResponse.data.artists.length > 0) {
            // Basic check: take the first artist if score is high enough (e.g., 100)
            if (artistSearchResponse.data.artists[0].score === 100 || artistSearchResponse.data.artists.length === 1) {
                 artistMBID = artistSearchResponse.data.artists[0].id;
                 console.log(`    Found artist MBID: ${artistMBID} for "${artistName}"`);
            } else {
                console.log(`    Artist search for "${artistName}" yielded multiple or low-score results. Skipping for accuracy.`);
            }
        } else {
            console.log(`    Artist "${artistName}" not found on MusicBrainz.`);
        }
    } catch (error) {
        console.error(`  Error searching for artist "${artistName}" on MusicBrainz: ${error.response ? error.response.status : error.message}`);
        return null; // Indicate error or not found
    }

    if (!artistMBID) {
        artistGenreCache.set(artistName.toLowerCase(), null); // Cache not found
        return null;
    }

    console.log(`  [MusicBrainz] Fetching genres for artist MBID: ${artistMBID} ("${artistName}")`);
    try {
        const artistDetailsUrl = `${MUSICBRAINZ_API_BASE_URL}/artist/${artistMBID}?inc=genres+tags&fmt=json`;
        const artistDetailsResponse = await axios.get(artistDetailsUrl, { headers: { 'User-Agent': MB_USER_AGENT } });
        await delay(DELAY_BETWEEN_API_CALLS_MS);

        let foundGenres = new Set(); // Use a Set to avoid duplicate genres

        // MusicBrainz has both 'genres' and 'tags' which can indicate genre
        if (artistDetailsResponse.data) {
            if (artistDetailsResponse.data.genres && artistDetailsResponse.data.genres.length > 0) {
                artistDetailsResponse.data.genres.forEach(g => g.name && foundGenres.add(g.name.toLowerCase()));
            }
            if (artistDetailsResponse.data.tags && artistDetailsResponse.data.tags.length > 0) {
                // Filter tags that are likely genres (this is heuristic)
                // For now, let's take top few tags by count if available, or just their names.
                // Prioritize official 'genres' array if present.
                artistDetailsResponse.data.tags.slice(0, 5).forEach(t => t.name && foundGenres.add(t.name.toLowerCase()));
            }
        }
        
        const genresArray = Array.from(foundGenres);
        console.log(`    Found genres for "${artistName}": ${genresArray.join(', ') || 'None'}`);
        artistGenreCache.set(artistName.toLowerCase(), genresArray);
        return genresArray;

    } catch (error) {
        console.error(`  Error fetching genres for artist MBID ${artistMBID} ("${artistName}"): ${error.response ? error.response.status : error.message}`);
        artistGenreCache.set(artistName.toLowerCase(), null); // Cache error/not found
        return null;
    }
}


async function enrichSongsWithMusicBrainzGenres() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise;
    const db = getDb();
    console.log('Database initialized. Starting MusicBrainz genre enrichment process...');

    const songsToEnrich = await new Promise((resolve, reject) => {
        const sql = `
            SELECT id, title, artist 
            FROM curated_songs 
            WHERE spotify_track_id IS NOT NULL 
              AND spotify_track_id NOT LIKE 'SPOTIFY_%'
              AND spotify_track_id NOT LIKE 'ERROR_%'
              AND genres IS NULL  -- Only process songs without genres
              AND (is_active = 1 OR is_active IS NULL)
            LIMIT 1 -- Process in batches for testing
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (songsToEnrich.length === 0) {
        console.log('No songs found in curated_songs needing MusicBrainz genre enrichment.');
        return;
    }

    console.log(`Found ${songsToEnrich.length} songs to enrich with genres from MusicBrainz.`);
    let songsUpdated = 0;
    let songsWithNoGenreFound = 0;
    let songsErrored = 0;

    for (const song of songsToEnrich) {
        console.log(`\nProcessing: "${song.title}" by "${song.artist}" (ID: ${song.id}) for genres...`);
        try {
            const genresArray = await fetchArtistGenresFromMusicBrainz(song.artist, db);

            if (genresArray && genresArray.length > 0) {
                const genresString = genresArray.join(', ');
                await new Promise((resolveUpdate, rejectUpdate) => {
                    db.run(
                        'UPDATE curated_songs SET genres = ? WHERE id = ? AND genres IS NULL',
                        [genresString, song.id],
                        function(updateErr) {
                            if (updateErr) return rejectUpdate(updateErr);
                            if (this.changes > 0) {
                                console.log(`  SUCCESS: Updated song ID ${song.id} ("${song.title}") with genres: "${genresString}"`);
                                songsUpdated++;
                            } else {
                                console.log(`  INFO: Song ID ${song.id} genres might have been updated by another process.`);
                            }
                            resolveUpdate();
                        }
                    );
                });
            } else if (genresArray === null) { // Explicit null means error or artist not found
                console.warn(`  Could not determine genres for artist "${song.artist}" (MusicBrainz lookup failed or artist not found).`);
                // Optionally mark this song in DB so it's not retried, e.g., genres = 'MB_ARTIST_NOT_FOUND'
                // For now, we'll just skip updating genres, it will be picked up again if genres IS NULL.
                songsWithNoGenreFound++;
            } else { // Empty array means artist found, but no genres listed for them.
                console.warn(`  No genres found on MusicBrainz for artist "${song.artist}".`);
                // Mark as 'MB_NO_GENRES_FOUND' to avoid re-processing for genres.
                await new Promise((resolveUpdate, rejectUpdate) => {
                    db.run('UPDATE curated_songs SET genres = ? WHERE id = ? AND genres IS NULL', ['MB_NO_GENRES_FOUND', song.id], function(err){
                        if(err) return rejectUpdate(err);
                        resolveUpdate();
                    });
                });
                songsWithNoGenreFound++;
            }
        } catch (error) {
            console.error(`  Error processing genres for song "${song.title}" by "${song.artist}": ${error.message}`);
            songsErrored++;
            // Optionally mark song with a generic error status for genres
        }
    }

    console.log(`\n--- MusicBrainz Genre Enrichment Complete ---`);
    console.log(`Songs successfully updated with genres: ${songsUpdated}`);
    console.log(`Songs where artist/genre not found on MusicBrainz (or no genres listed): ${songsWithNoGenreFound}`);
    console.log(`Songs that errored during genre processing: ${songsErrored}`);
}

// Run the enrichment process
enrichSongsWithMusicBrainzGenres().catch(err => {
    console.error("Unhandled error in enrichSongsWithMusicBrainzGenres script:", err);
});