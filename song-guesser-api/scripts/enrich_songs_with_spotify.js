// song-guesser-api/scripts/enrich_songs_with_spotify.js

const path = require('path');
const { getDb, dbInitializationPromise } = require('../services/database-service');
const musicSourceService = require('../services/music-source-service');

const DELAY_BETWEEN_SPOTIFY_CALLS_MS = 250; // Respect rate limits
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to normalize text for comparison
function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove most punctuation (keeps spaces)
        .replace(/\s+/g, ' ')       // Normalize multiple spaces to one
        .trim();
}

// Helper function to find the best match from Spotify search results
function findBestSpotifyMatch(localSong, spotifyResults) {
    const normalizedLocalTitle = normalizeText(localSong.title);
    const normalizedLocalArtist = normalizeText(localSong.artist);

    let bestMatch = null;
    let highestScore = -1;

    for (const spotifyTrack of spotifyResults) {
        if (!spotifyTrack.title || !spotifyTrack.artist) continue;

        const normalizedSpotifyTitle = normalizeText(spotifyTrack.title);
        const normalizedSpotifyArtist = normalizeText(spotifyTrack.artist);
        let currentScore = 0;

        // Artist matching (crucial)
        if (normalizedSpotifyArtist.includes(normalizedLocalArtist) || 
            normalizedLocalArtist.includes(normalizedSpotifyArtist)) {
            currentScore += 5; // Strong indicator
            if (normalizedSpotifyArtist === normalizedLocalArtist) {
                currentScore += 5; // Exact artist match is even better
            }
        } else {
            continue; // If artist doesn't match well, probably not the right song
        }

        // Title matching
        if (normalizedSpotifyTitle === normalizedLocalTitle) {
            currentScore += 10; // Exact title match is best
        } else if (normalizedSpotifyTitle.includes(normalizedLocalTitle) || 
                   normalizedLocalTitle.includes(normalizedSpotifyTitle)) {
            currentScore += 3; // Contains match is okay
        }
        
        // Bonus if original local title (with quotes) is exactly in spotify title
        if (spotifyTrack.title.includes(localSong.title)) {
            currentScore += 2;
        }


        if (currentScore > highestScore) {
            highestScore = currentScore;
            bestMatch = spotifyTrack;
        }
    }
    // Define a minimum score threshold for a confident match
    if (bestMatch && highestScore >= 8) { // Adjust threshold as needed (e.g. >=8 means good artist + some title similarity)
        console.log(`    Confident match found with score ${highestScore}: Spotify's "${bestMatch.title}" by "${bestMatch.artist}" for local "${localSong.title}" by "${localSong.artist}"`);
        return bestMatch;
    }
    return null;
}


async function markSongAsProblematic(db, curatedSongId, statusMarker = 'SPOTIFY_PROBLEM') {
    const uniqueStatusMarker = `${statusMarker}_${curatedSongId}`;
    const sql = `UPDATE curated_songs SET spotify_track_id = ?, is_active = 0 WHERE id = ? AND spotify_track_id IS NULL`;
    return new Promise((resolve, reject) => {
        db.run(sql, [uniqueStatusMarker, curatedSongId], function(err) {
            if (err) {
                console.error(`  Error marking song ID ${curatedSongId} with status "${uniqueStatusMarker}": ${err.message}`);
                return reject(err);
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
            WHERE spotify_track_id IS NULL AND (is_active = 1 OR is_active IS NULL) 
            -- LIMIT 10 -- For testing smaller batches
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
        console.log(`\nProcessing: "${song.title}" by "${song.artist}" (Year: ${song.year || 'N/A'})`);
        let spotifyTrackForDb = null;
        let foundMatchConfidence = false;

        // Attempt 1: Precise search (title, artist, year)
        let searchQuery = `track:${song.title} artist:${song.artist}`;
        if (song.year) { searchQuery += ` year:${song.year}`; }
        
        console.log(`  Attempt 1: Precise search: "${searchQuery}"`);
        let searchResults = await musicSourceService.searchTracksOnSpotify(searchQuery, 3, spotifyToken);
        await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);
        let potentialMatch = findBestSpotifyMatch(song, searchResults);

        if (potentialMatch) {
            foundMatchConfidence = true;
        } else {
            // Attempt 2: Broader search (title, artist only)
            console.log(`  Attempt 2: Broader search (title & artist)...`);
            searchQuery = `track:${song.title} artist:${song.artist}`;
            searchResults = await musicSourceService.searchTracksOnSpotify(searchQuery, 5, spotifyToken);
            await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);
            potentialMatch = findBestSpotifyMatch(song, searchResults);
            if (potentialMatch) foundMatchConfidence = true;
        }
        
        if (!foundMatchConfidence) {
            // Attempt 3: Even broader search (general query terms, no field specifiers)
            console.log(`  Attempt 3: General keyword search...`);
            searchQuery = `${song.title} ${song.artist}`;
            searchResults = await musicSourceService.searchTracksOnSpotify(searchQuery, 5, spotifyToken);
            await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);
            potentialMatch = findBestSpotifyMatch(song, searchResults);
            if (potentialMatch) foundMatchConfidence = true;
        }

        if (foundMatchConfidence && potentialMatch) {
            console.log(`  Confident Spotify Match: "${potentialMatch.title}" by "${potentialMatch.artist}" (ID: ${potentialMatch.id})`);
            try {
                const detailedTracks = await musicSourceService.fetchFullTrackDetails([potentialMatch.id], spotifyToken);
                await delay(DELAY_BETWEEN_SPOTIFY_CALLS_MS);

                if (detailedTracks && detailedTracks.length > 0) {
                    spotifyTrackForDb = detailedTracks[0];
                    const updateSql = `
                        UPDATE curated_songs 
                        SET spotify_track_id = ?, title = ?, artist = ?, 
                            album_art_url = ?, duration_ms = ?, is_active = 1
                        WHERE id = ? AND spotify_track_id IS NULL
                    `;
                    const updateValues = [
                        spotifyTrackForDb.id, spotifyTrackForDb.title, spotifyTrackForDb.artist,
                        spotifyTrackForDb.album_art_url, spotifyTrackForDb.duration_ms, song.id
                    ];
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        db.run(updateSql, updateValues, function(updateErr) {  
                            if (updateErr) { console.error(`DB UPDATE ERROR for "${spotifyTrackForDb.title}"`, updateErr); return rejectUpdate(updateErr); }
                            if (this.changes > 0) { songsUpdated++; console.log(`  SUCCESS: Updated DB for "${spotifyTrackForDb.title}"`);}
                            else { console.warn(`  DB UPDATE 0 changes for "${spotifyTrackForDb.title}". Already processed?`);}
                            resolveUpdate();
                        });
                    });
                } else {
                    console.warn(`  Could not fetch full details for Spotify ID: ${potentialMatch.id}`);
                    await markSongAsProblematic(db, song.id, 'SPOTIFY_DETAILS_FAIL');
                    songsMarkedProblematic++;
                }
            } catch (detailError) {
                console.error(`  Error fetching full details for "${potentialMatch.title}": ${detailError.message}`);
                await markSongAsProblematic(db, song.id, 'ERROR_FETCHING_DETAILS');
                songsMarkedProblematic++;
            }
        } else {
            console.warn(`  No confident Spotify match found for "${song.title}" by "${song.artist}" after all attempts.`);
            await markSongAsProblematic(db, song.id, 'SPOTIFY_NO_CONFIDENT_MATCH');
            songsMarkedProblematic++;
        }
    }

    console.log(`\n--- Spotify Enrichment Complete ---`);
    console.log(`Songs successfully updated: ${songsUpdated}`);
    console.log(`Songs marked as problematic: ${songsMarkedProblematic}`);
}

// Run the enrichment process
enrichSongsWithSpotify().catch(err => {
    console.error("Unhandled error in enrichSongsWithSpotify script:", err);
});