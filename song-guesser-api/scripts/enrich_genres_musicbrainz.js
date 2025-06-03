// song-guesser-api/scripts/enrich_genres_musicbrainz.js
const axios = require('axios');
const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service'); // Adjust path if needed
const { 
    MUSICBRAINZ_API_BASE_URL,
    MUSICBRAINZ_APP_NAME,
    MUSICBRAINZ_APP_VERSION,
    MUSICBRAINZ_CONTACT_EMAIL
} = require('../config'); // Adjust path if needed

const MB_USER_AGENT = `${MUSICBRAINZ_APP_NAME}/${MUSICBRAINZ_APP_VERSION} (${MUSICBRAINZ_CONTACT_EMAIL || 'Contact info not set'})`;
const DELAY_BETWEEN_API_CALLS_MS = 1100; // MusicBrainz rate limit: ~1 req/sec

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Cache for artist MBIDs and their genres to reduce redundant API calls within a single script run
const artistInfoCache = new Map(); // Stores { mbid: string, genres: string[] }

async function getOrInsertGenreId(db, genreName) {
    genreName = genreName.trim().toLowerCase(); // Normalize genre name
    if (!genreName) return null;

    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM genres WHERE LOWER(name) = ?', [genreName], (err, row) => {
            if (err) return reject(err);
            if (row) {
                resolve(row.id);
            } else {
                db.run('INSERT OR IGNORE INTO genres (name) VALUES (?)', [genreName], function (insertErr) {
                    if (insertErr) return reject(insertErr);
                    // If IGNORE happened due to concurrent insert, this.lastID might be 0.
                    // Re-query to be sure, or rely on UNIQUE constraint and previous SELECT.
                    // For simplicity, if lastID is 0 after IGNORE, it means it likely exists now.
                    if (this.lastID > 0) {
                        console.log(`    [DB Genres] Added new genre: "${genreName}" with ID: ${this.lastID}`);
                        resolve(this.lastID);
                    } else {
                        // Fetch it again if INSERT OR IGNORE didn't return lastID (e.g. it was ignored)
                        db.get('SELECT id FROM genres WHERE LOWER(name) = ?', [genreName], (errGet, rowGet) => {
                            if (errGet) return reject(errGet);
                            if (rowGet) resolve(rowGet.id);
                            else reject(new Error(`Failed to get or insert genre: ${genreName}`));
                        });
                    }
                });
            }
        });
    });
}

async function linkSongToGenre(db, curatedSongId, genreId) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR IGNORE INTO curated_song_genres (curated_song_id, genre_id) VALUES (?, ?)',
            [curatedSongId, genreId],
            function (err) {
                if (err) return reject(err);
                // if (this.changes > 0) console.log(`    Linked song ID ${curatedSongId} to genre ID ${genreId}`);
                resolve(this.changes);
            }
        );
    });
}

async function fetchAndCacheArtistInfoFromMusicBrainz(artistName) {
    const lowerArtistName = artistName.toLowerCase();
    if (artistInfoCache.has(lowerArtistName)) {
        console.log(`  [MB Cache] Using cached info for artist: "${artistName}"`);
        return artistInfoCache.get(lowerArtistName);
    }

    console.log(`  [MusicBrainz] Searching for artist MBID: "${artistName}"`);
    let artistMBID = null;
    let fetchedInfo = { mbid: null, genres: [], status: 'artist_not_found' }; // Default status

    try {
        const artistSearchUrl = `${MUSICBRAINZ_API_BASE_URL}/artist?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`;
        const artistSearchResponse = await axios.get(artistSearchUrl, { headers: { 'User-Agent': MB_USER_AGENT } });
        await delay(DELAY_BETWEEN_API_CALLS_MS);

        if (artistSearchResponse.data && artistSearchResponse.data.artists && artistSearchResponse.data.artists.length > 0) {
            const potentialArtists = artistSearchResponse.data.artists;
            // Prefer exact match or highest score if multiple results
            let chosenArtist = potentialArtists.find(a => a.name.toLowerCase() === lowerArtistName && a.score === 100);
            if (!chosenArtist) {
                chosenArtist = potentialArtists[0]; // Fallback to top result
            }
            
            if (chosenArtist && (chosenArtist.score === 100 || potentialArtists.length === 1 || chosenArtist.name.toLowerCase() === lowerArtistName)) {
                 artistMBID = chosenArtist.id;
                 fetchedInfo.mbid = artistMBID;
                 console.log(`    Found artist MBID: ${artistMBID} for "${artistName}" (Score: ${chosenArtist.score})`);
            } else {
                console.log(`    Artist search for "${artistName}" yielded ambiguous or low-score results. Best match: "${potentialArtists[0].name}" (Score: ${potentialArtists[0].score}). Skipping direct genre fetch for this artist name.`);
                 fetchedInfo.status = 'artist_ambiguous';
            }
        } else {
            console.log(`    Artist "${artistName}" not found on MusicBrainz.`);
            fetchedInfo.status = 'artist_not_found';
        }
    } catch (error) {
        console.error(`  Error searching for artist "${artistName}" on MusicBrainz: ${error.response ? error.response.status : error.message}`);
        fetchedInfo.status = 'artist_search_error';
    }

    if (!artistMBID) {
        artistInfoCache.set(lowerArtistName, fetchedInfo);
        return fetchedInfo;
    }

    console.log(`  [MusicBrainz] Fetching genres for artist MBID: ${artistMBID} ("${artistName}")`);
    try {
        const artistDetailsUrl = `${MUSICBRAINZ_API_BASE_URL}/artist/${artistMBID}?inc=genres+tags&fmt=json`;
        const artistDetailsResponse = await axios.get(artistDetailsUrl, { headers: { 'User-Agent': MB_USER_AGENT } });
        await delay(DELAY_BETWEEN_API_CALLS_MS);

        const foundGenres = new Set(); 
        if (artistDetailsResponse.data) {
            if (artistDetailsResponse.data.genres && artistDetailsResponse.data.genres.length > 0) {
                artistDetailsResponse.data.genres.forEach(g => g.name && foundGenres.add(g.name.toLowerCase()));
            }
            if (artistDetailsResponse.data.tags && artistDetailsResponse.data.tags.length > 0) {
                artistDetailsResponse.data.tags.slice(0, 5).forEach(t => t.name && foundGenres.add(t.name.toLowerCase())); // Take top 5 tags
            }
        }
        fetchedInfo.genres = Array.from(foundGenres);
        fetchedInfo.status = fetchedInfo.genres.length > 0 ? 'genres_found' : 'artist_found_no_genres';
        console.log(`    Found genres for "${artistName}": ${fetchedInfo.genres.join(', ') || 'None'}`);
        
    } catch (error) {
        console.error(`  Error fetching genres for artist MBID ${artistMBID} ("${artistName}"): ${error.response ? error.response.status : error.message}`);
        fetchedInfo.status = 'genre_fetch_error';
    }
    
    artistInfoCache.set(lowerArtistName, fetchedInfo);
    return fetchedInfo;
}

async function enrichSongsWithMusicBrainzGenres() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise;
    const db = getDb();
    console.log('Database initialized. Starting MusicBrainz genre enrichment process...');

    const songsToEnrich = await new Promise((resolve, reject) => {
        // Select songs that have a Spotify ID (meaning they are "valid" tracks)
        // but do not yet have any entries in the curated_song_genres linking table.
        const sql = `
            SELECT cs.id, cs.title, cs.artist 
            FROM curated_songs cs
            LEFT JOIN curated_song_genres csg ON cs.id = csg.curated_song_id
            WHERE cs.spotify_track_id IS NOT NULL 
              AND cs.spotify_track_id NOT LIKE 'SPOTIFY_%'
              AND cs.spotify_track_id NOT LIKE 'ERROR_%'
              AND csg.genre_id IS NULL  -- Key condition: no genres linked yet
              AND (cs.is_active = 1 OR cs.is_active IS NULL)
            GROUP BY cs.id -- Ensure we process each song once
            -- LIMIT 1 -- Process in batches for testing
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
    let songsUpdatedCount = 0; // Count of songs that got at least one genre linked
    let totalGenresLinked = 0;
    let songsProcessedWithError = 0;
    let songsWithNoGenresFoundForArtist = 0;

    for (const song of songsToEnrich) {
        console.log(`\nProcessing: "${song.title}" by "${song.artist}" (Curated ID: ${song.id}) for genres...`);
        try {
            const artistInfo = await fetchAndCacheArtistInfoFromMusicBrainz(song.artist);

            if (artistInfo && artistInfo.genres && artistInfo.genres.length > 0) {
                let genresLinkedThisSong = 0;
                for (const genreName of artistInfo.genres) {
                    const genreId = await getOrInsertGenreId(db, genreName);
                    if (genreId) {
                        const changes = await linkSongToGenre(db, song.id, genreId);
                        if (changes > 0) {
                            totalGenresLinked++;
                            genresLinkedThisSong++;
                        }
                    }
                }
                if (genresLinkedThisSong > 0) {
                    songsUpdatedCount++;
                    console.log(`  SUCCESS: Linked ${genresLinkedThisSong} genre(s) to song ID ${song.id} ("${song.title}")`);
                } else {
                    console.warn(`  INFO: Artist "${song.artist}" had genres, but no new links made for song ID ${song.id} (possibly already linked or DB issue).`);
                    // This case might happen if getOrInsertGenreId fails or linkSongToGenre doesn't make changes (e.g. PK violation on IGNORE)
                }
            } else if (artistInfo && artistInfo.status === 'artist_found_no_genres') {
                console.warn(`  No genres found on MusicBrainz for artist "${song.artist}". Marking as processed for genres.`);
                // Optionally, mark this song in curated_songs with a specific status for genre lookup
                // e.g., by inserting a link to a special "No Genre Found on MB" genre ID in the genres table.
                // For now, it will just not have any genres linked and might be picked up again if not careful.
                // Let's add a "placeholder" link to a genre named "MB_ARTIST_NO_GENRES"
                const placeholderGenreId = await getOrInsertGenreId(db, 'mb_artist_no_genres');
                if (placeholderGenreId) await linkSongToGenre(db, song.id, placeholderGenreId);
                songsWithNoGenresFoundForArtist++;
            } else {
                console.warn(`  Could not determine genres for artist "${song.artist}" (Status: ${artistInfo ? artistInfo.status : 'unknown_failure'}).`);
                songsWithNoGenresFoundForArtist++; // Or count as error if artistInfo.status indicates error
            }
        } catch (error) {
            console.error(`  Error processing genres for song "${song.title}" by "${song.artist}": ${error.message}`);
            songsProcessedWithError++;
        }
    }

    console.log(`\n--- MusicBrainz Genre Enrichment Complete ---`);
    console.log(`Songs updated with at least one genre: ${songsUpdatedCount}`);
    console.log(`Total individual genre links made: ${totalGenresLinked}`);
    console.log(`Songs where artist was found but had no genres listed (or lookup failed): ${songsWithNoGenresFoundForArtist}`);
    console.log(`Songs that errored during genre processing: ${songsProcessedWithError}`);
}

// Run the enrichment process
enrichSongsWithMusicBrainzGenres().catch(err => {
    console.error("Unhandled error in enrichSongsWithMusicBrainzGenres script:", err);
});