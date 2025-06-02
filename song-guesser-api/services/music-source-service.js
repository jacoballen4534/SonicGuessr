// File: services/music-source-service.js
// Description: Handles interactions with Spotify Web API (for metadata) and YouTube Data API (for audio sources).
// Changes:
// - Renamed from spotify-service.js in spirit to music-source-service.js.
// - Added searchYouTubeVideo function to find suitable YouTube video IDs.
// - Modified fetchTracksFromSpecificPlaylist and fetchFullTrackDetails to focus on metadata for Youtube,
//   removing the dependency on Spotify's preview_url for track selection.
// - getTracksForDailyChallenge now orchestrates fetching Spotify metadata and then finding YouTube video IDs.
//   It attempts to fill the DAILY_SONG_COUNT with tracks that have a valid YouTube source.

const axios = require('axios');
const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ACCOUNTS_URL,
    SPOTIFY_API_BASE_URL,
    SPOTIFY_MARKET,
    YOUTUBE_API_KEY,
    DAILY_SONG_COUNT,
    THEAUDIODB_API_KEY,
    THEAUDIODB_API_BASE_URL,
    MUSICBRAINZ_API_BASE_URL, // <<< New config var
    MUSICBRAINZ_APP_NAME,     // <<< New config var
    MUSICBRAINZ_APP_VERSION,  // <<< New config var
    MUSICBRAINZ_CONTACT_EMAIL // <<< New config var
} = require('../config');
const { getDb } = require('./database-service'); 

console.log('[MUSIC_SOURCE_DEBUG] music-source-service.js loaded.');

const MB_USER_AGENT = `${MUSICBRAINZ_APP_NAME}/${MUSICBRAINZ_APP_VERSION} (${MUSICBRAINZ_CONTACT_EMAIL || 'Contact info not set'})`;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let spotifyAccessToken = null;
let tokenExpiryTime = 0;

async function getAccessToken() {
    if (spotifyAccessToken && Date.now() < tokenExpiryTime) {
        return spotifyAccessToken;
    }
    console.log('[MUSIC_SOURCE_DEBUG] Attempting to get new Spotify access token.');
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        console.error('Spotify Client ID or Secret is not configured.');
        throw new Error('Spotify API credentials missing.');
    }
    try {
        const response = await axios.post(SPOTIFY_ACCOUNTS_URL, 'grant_type=client_credentials', {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            }
        });
        spotifyAccessToken = response.data.access_token;
        tokenExpiryTime = Date.now() + (response.data.expires_in - 300) * 1000;
        console.log('[MUSIC_SOURCE_DEBUG] Spotify access token obtained.');
        return spotifyAccessToken;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error getting Spotify access token:', errorMsg);
        throw new Error('Could not authenticate with Spotify: ' + errorMsg);
    }
}

function isLikelyOfficialChannel(channelTitle, artistName) {
    if (!channelTitle || !artistName) return false;
    const lowerChannel = channelTitle.toLowerCase();
    const lowerArtist = artistName.toLowerCase();
    const artistFirstWord = lowerArtist.split(' ')[0];
    return lowerChannel.includes(lowerArtist) || 
           lowerChannel.includes(artistFirstWord) || // In case artist name is shortened in channel
           lowerChannel.includes('vevo') || 
           lowerChannel.endsWith(' - topic') || 
           lowerChannel.includes('official');
}


// Helper function to parse YouTube's ISO 8601 duration string to milliseconds
function parseISO8601Duration(isoDuration) {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const matches = isoDuration.match(regex);
    const hours = parseInt(matches[1]) || 0;
    const minutes = parseInt(matches[2]) || 0;
    const seconds = parseInt(matches[3]) || 0;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

async function searchYouTubeVideo(title, artist, spotifyDurationMs) {
    if (!YOUTUBE_API_KEY) {
        console.error('YouTube API Key is not configured in config.js');
        throw new Error('YouTube API Key missing.'); // Or return null if preferred
    }

    console.log(`[Youtube] Starting search for: "${artist} - ${title}" (Spotify Duration: ${spotifyDurationMs}ms)`);

    // Define query types with priority and strictness for matching
    const searchStrategies = [
        { queryText: `${artist} - ${title} Official Audio`, type: 'official-audio', strictChannel: true },
        { queryText: `${artist} - ${title} Lyric Video`, type: 'lyric-video', strictChannel: true }, // Try to find official lyric videos
        { queryText: `${artist} - ${title} (Lyrics)`, type: 'lyrics', strictChannel: false }, // For titles explicitly with (Lyrics)
        { queryText: `${artist} - ${title} Audio`, type: 'audio', strictChannel: false },
        { queryText: `${artist} - ${title} Topic`, type: 'topic', strictChannel: true }, // Topic channels are usually good
        { queryText: `${artist} - ${title}`, type: 'general', strictChannel: false }     // Fallback
    ];

    const youtubeApiSearchUrl = 'https://www.googleapis.com/youtube/v3/search';
    const youtubeApiVideosUrl = 'https://www.googleapis.com/youtube/v3/videos';

    for (const strategy of searchStrategies) {
        console.log(`[Youtube] Querying (Strategy: ${strategy.type}): "${strategy.queryText}"`);
        try {
            const searchResponse = await axios.get(youtubeApiSearchUrl, {
                params: {
                    part: 'snippet',
                    q: strategy.queryText,
                    type: 'video',
                    videoCategoryId: '10', // Music
                    videoEmbeddable: 'true',
                    maxResults: 3,         // Fetch a few candidates
                    key: YOUTUBE_API_KEY
                }
            });

            if (searchResponse.data.items && searchResponse.data.items.length > 0) {
                for (const item of searchResponse.data.items) {
                    const videoId = item.id.videoId;
                    const videoTitle = item.snippet.title;
                    const videoTitleLower = videoTitle.toLowerCase();
                    const channelTitle = item.snippet.channelTitle;

                    // 1. Undesired Keywords Filter (stricter)
                    const undesiredKeywords = [
                        "live", "cover", "remix", "interview", "teaser", 
                        "reaction", "parody", "tutorial", "instrumental", "karaoke",
                        "official video", "music video" // Keep "official music video" out unless it's all we find later
                    ];
                    // Allow "lyric video" but not just "video" if we seek audio
                    if (undesiredKeywords.some(keyword => videoTitleLower.includes(keyword) && !videoTitleLower.includes("lyric video"))) {
                        console.log(`  [SKIP] Undesired keyword in "${videoTitle}"`);
                        continue;
                    }

                    // 2. Type-based Preference and Confidence
                    let isMatch = false;
                    let isHighConfidence = false;

                    switch (strategy.type) {
                        case 'official-audio':
                            if (videoTitleLower.includes("official audio")) {
                                isMatch = true;
                                if (isLikelyOfficialChannel(channelTitle, artist)) isHighConfidence = true;
                            }
                            break;
                        case 'lyric-video': // Catches "Lyric Video"
                            if (videoTitleLower.includes("lyric video")) {
                                isMatch = true;
                                // For lyric videos, channel might be less strictly official but still good
                                if (isLikelyOfficialChannel(channelTitle, artist)) isHighConfidence = true;
                            }
                            break;
                        case 'lyrics': // Catches "(Lyrics)" or just "lyrics" in title
                            if (videoTitleLower.includes("lyrics")) { // More relaxed for (Lyrics)
                                isMatch = true;
                                // Don't require strict channel for this query type initially
                            }
                            break;
                        case 'audio':
                            if (videoTitleLower.includes("audio") && !videoTitleLower.includes("official audio")) {
                                isMatch = true;
                            }
                            break;
                        case 'topic':
                            if (channelTitle.toLowerCase().includes(" - topic") && 
                                channelTitle.toLowerCase().includes(artist.toLowerCase().split(" ")[0])) { // Check first word of artist
                                isMatch = true;
                                isHighConfidence = true; // Topic channels are generally good
                            }
                            break;
                        case 'general':
                            isMatch = true; // For general fallback, all results are initially considered for duration etc.
                            break;
                    }
                    
                    if (!isMatch) {
                        console.log(`  [SKIP] Did not match preferred type criteria for strategy "${strategy.type}" for video "${videoTitle}"`);
                        continue;
                    }

                    // 3. Channel Strictness (for certain strategies if not already high confidence)
                    if (strategy.strictChannel && !isHighConfidence && !isLikelyOfficialChannel(channelTitle, artist)) {
                        console.log(`  [SKIP] Channel "${channelTitle}" not deemed official enough for strict strategy "${strategy.type}" for video "${videoTitle}"`);
                        continue;
                    }

                    // 4. Duration Check (if spotifyDurationMs is provided)
                    if (spotifyDurationMs) {
                        try {
                            const videoDetailsResponse = await axios.get(youtubeApiVideosUrl, {
                                params: { part: 'contentDetails', id: videoId, key: YOUTUBE_API_KEY }
                            });
                            if (videoDetailsResponse.data.items && videoDetailsResponse.data.items.length > 0) {
                                const durationISO = videoDetailsResponse.data.items[0].contentDetails.duration;
                                const youtubeDurationMs = parseISO8601Duration(durationISO);
                                
                                // Allow +/- 20% of Spotify duration, or max 30-40s difference
                                const twentyPercent = spotifyDurationMs * 0.20;
                                const maxDiff = Math.min(30000, twentyPercent); // Stricter for shorter songs

                                if (Math.abs(youtubeDurationMs - spotifyDurationMs) > maxDiff) {
                                    console.log(`  [SKIP] Duration mismatch for "${videoTitle}" (YT: ${youtubeDurationMs}ms, Spotify: ${spotifyDurationMs}ms, MaxDiff: ${maxDiff}ms)`);
                                    continue;
                                }
                                console.log(`  [PASS] Duration check for "${videoTitle}" (YT: ${youtubeDurationMs}ms, Spotify: ${spotifyDurationMs}ms)`);
                            } else {
                                console.warn(`  [WARN] Could not get duration details for ${videoId}. Proceeding without duration check.`);
                            }
                        } catch (detailsError) {
                            console.warn(`  [WARN] Error fetching duration for ${videoId}: ${detailsError.message}. Proceeding without duration check.`);
                        }
                    }

                    // If we reach here, the video is considered a good match for the current strategy
                    console.log(`[Youtube] FOUND suitable match with strategy "${strategy.type}": "${videoTitle}" (ID: ${videoId}) by channel "${channelTitle}"`);
                    return videoId;
                }
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[Youtube] Error during query "${query}": ${errorMsg}`);
            if (error.response && error.response.status === 403) { // Quota limit or other access issue
                console.error('[Youtube] YouTube API request forbidden. Check API key and quotas.');
                throw new Error('YouTube API request failed (403). Possible quota issue.');
            }
            // Don't throw for other errors, just try next query type
        }
    }
    console.warn(`[Youtube] No suitable YouTube video found for "${artist} - ${title}" after all strategies.`);
    return null;
}

async function fetchTracksFromSpecificPlaylist(playlistId, trackLimit = 50, token) {
    if (!token) token = await getAccessToken(); // Get token if not provided
    if (!token) throw new Error('Missing Spotify access token for fetching playlist tracks.');

    try {
        const response = await axios.get(`${SPOTIFY_API_BASE_URL}/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                fields: 'items(track(id,name,artists(name),album(images),duration_ms))',
                limit: trackLimit,
                market: SPOTIFY_MARKET
            }
        });
        const tracks = response.data.items
            .map(item => item.track)
            .filter(track => track && track.id && track.name && track.artists && track.artists.length > 0 && track.duration_ms) // Ensure essential metadata + duration
            .map(track => ({
                id: track.id,
                title: track.name,
                artist: track.artists.map(artist => artist.name).join(', '),
                album_art_url: track.album && track.album.images && track.album.images.length > 0 ? track.album.images[0].url : null,
                duration_ms: track.duration_ms
            }));
        console.log(`[Spotify] Fetched ${tracks.length} track metadata entries from playlist ${playlistId}.`);
        return tracks;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Spotify] Error fetching track metadata from playlist ${playlistId}: ${errorMsg}`);
        return [];
    }
}

async function fetchFullTrackDetails(trackIds, token) {
    if (!trackIds || trackIds.length === 0) return [];
    if (!token) token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token for full track details.');

    const MAX_IDS_PER_REQUEST = 50;
    let allFetchedTrackDetails = [];
    for (let i = 0; i < trackIds.length; i += MAX_IDS_PER_REQUEST) {
        const batchIds = trackIds.slice(i, i + MAX_IDS_PER_REQUEST);
        try {
            const response = await axios.get(`${SPOTIFY_API_BASE_URL}/tracks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { ids: batchIds.join(','), market: SPOTIFY_MARKET }
            });
            if (response.data && response.data.tracks) {
                const validTracks = response.data.tracks
                    .filter(t => t && t.id && t.name && t.artists && t.artists.length > 0 && t.duration_ms && t.album)
                    .map(track => ({
                        id: track.id,
                        title: track.name,
                        artist: track.artists.map(artist => artist.name).join(', '),
                        album_art_url: track.album && track.album.images.length > 0 ? track.album.images[0].url : null,
                        duration_ms: track.duration_ms
                    }));
                allFetchedTrackDetails = allFetchedTrackDetails.concat(validTracks);
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[Spotify] Error fetching batch of full track details: ${errorMsg}`);
        }
    }
    console.log(`[Spotify] Received ${allFetchedTrackDetails.length} valid Spotify track objects for ${trackIds.length} requested IDs.`);
    return allFetchedTrackDetails;
}

async function fetchTracksFromTopPlaylistsStrategy(token, desiredTrackCount, initialFetchMultiplier) {
    console.log(`[Spotify Strategy 1 - Top Playlists] Searching for "Top 50" or "Top 100" playlists (market: ${SPOTIFY_MARKET})...`);
    let candidates = [];
    // Try a few different search queries for top playlists
    const searchQueries = ["Top 50"]; 
    const spotifyFetchLimit = desiredTrackCount * initialFetchMultiplier;

    for (const playlistQuery of searchQueries) {
        if (candidates.length >= spotifyFetchLimit) break; // Stop if we have enough candidates

        try {
            const searchResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: playlistQuery,
                    type: 'playlist',
                    market: SPOTIFY_MARKET,
                    limit: 5 // Get a few matching playlists
                }
            });

            if (searchResponse.data.playlists && searchResponse.data.playlists.items.length > 0) {
                
                const foundPlaylists = searchResponse.data.playlists.items;
                // Shuffle found playlists to vary selection
                const shuffledPlaylists = [...foundPlaylists].sort(() => 0.5 - Math.random()).filter((Boolean))

                // Try fetching tracks from one or two of these playlists
                for (let i=0; i < Math.min(2, shuffledPlaylists.length); i++) {
                    if (candidates.length >= spotifyFetchLimit) break;
                    const selectedPlaylist = shuffledPlaylists[i];
                    console.log(`[Spotify Strategy 1] Found playlist: "${selectedPlaylist.name}" (ID: ${selectedPlaylist.id}) from query "${playlistQuery}". Fetching tracks...`);
                    const tracksFromPlaylist = await fetchTracksFromSpecificPlaylist(selectedPlaylist.id, spotifyFetchLimit - candidates.length, token);
                    
                    // Add to candidates, avoiding duplicates by ID
                    const existingCandidateIds = new Set(candidates.map(tc => tc.id));
                    tracksFromPlaylist.forEach(track => {
                        if (!existingCandidateIds.has(track.id)) {
                            candidates.push(track);
                            existingCandidateIds.add(track.id);
                        }
                    });
                    console.log(`[Spotify Strategy 1] Added ${tracksFromPlaylist.length} tracks. Total candidates: ${candidates.length}`);
                }
            } else {
                console.log(`[Spotify Strategy 1] No playlists found for query "${playlistQuery}".`);
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data.error || error.response.data) : error.message;
            console.warn(`[Spotify Strategy 1] Error searching for playlist query "${playlistQuery}": ${errorMsg}.`);
        }
    }
    console.log(`[Spotify Strategy 1 - Top Playlists] Yielded ${candidates.length} candidates.`);
    return candidates;
}

// --- New Helper Function for Strategy 2: New Releases ---
async function fetchTracksFromNewReleasesStrategy(token, desiredTrackCount, initialFetchMultiplier) {
    console.log(`[Spotify Strategy 2 - New Releases] Fetching new releases (market: ${SPOTIFY_MARKET})...`);
    let candidates = [];
    const spotifyFetchLimit = desiredTrackCount * initialFetchMultiplier;

    try {
        const newReleasesResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/new-releases`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: { country: SPOTIFY_MARKET, limit: Math.max(10, Math.ceil(desiredTrackCount / 2)) } // Fetch enough albums
        });

        if (newReleasesResponse.data.albums.items && newReleasesResponse.data.albums.items.length > 0) {
            let albumTrackIds = [];
            // Collect track IDs from several new albums
            for (const album of newReleasesResponse.data.albums.items) {
                if (albumTrackIds.length >= spotifyFetchLimit) break;
                if (album.album_type === 'album' || album.album_type === 'single') { // Ensure it's an album or single
                    const albumTracksResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/albums/${album.id}/tracks`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                        params: { market: SPOTIFY_MARKET, limit: 50 }
                    });
                    if (albumTracksResponse.data.items) {
                        albumTrackIds.push(...albumTracksResponse.data.items
                            .filter(track => track && track.id) // Ensure track and track.id exist
                            .map(track => track.id));
                    }
                }
            }
            
            if (albumTrackIds.length > 0) {
                console.log(`[Spotify Strategy 2] Fetched ${albumTrackIds.length} track IDs from new release albums. Fetching details...`);
                const uniqueAlbumTrackIds = [...new Set(albumTrackIds)];
                const detailedTracks = await fetchFullTrackDetails(uniqueAlbumTrackIds.slice(0, spotifyFetchLimit), token);
                candidates = detailedTracks; // Replace or concat based on desired behavior
            }
        } else {
            console.warn(`[Spotify Strategy 2] No new album releases found for market ${SPOTIFY_MARKET}.`);
        }
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data.error || error.response.data) : error.message;
        console.error(`[Spotify Strategy 2 - New Releases] Failed: ${errorMsg}`);
    }
    console.log(`[Spotify Strategy 2 - New Releases] Yielded ${candidates.length} candidates.`);
    return candidates;
}



async function getTracksForDailyChallenge(desiredTrackCount = DAILY_SONG_COUNT) {
    const token = await getAccessToken(); // For Spotify calls
    if (!token) throw new Error('Missing Spotify access token for daily challenge.');

    let tracksForChallenge = [];
    let finalSpotifyTrackCandidates = [];
    const initialFetchMultiplier = 3;
    const spotifyRequestLimit = desiredTrackCount * initialFetchMultiplier;

    // --- New Primary Strategy: MusicBrainz by Genre, then enrich with Spotify ---
    // Pick a few genres randomly or have a rotating list
    const allPossibleGenres = ["pop", "rock", "electronic", "hip hop", "jazz", "classical", "folk", "r&b", "indie", "dance", "soul", "country"];
    const shuffledGenres = [...allPossibleGenres].sort(() => 0.5 - Math.random());
    const genresToFetch = shuffledGenres.slice(0, 3); // Fetch tracks from 3 random genres

    try {
        const musicBrainzTrackIdeas = await fetchTrackIdeasByGenreFromMusicBrainz(genresToFetch, 25, spotifyRequestLimit); // 25 tracks per genre
        if (musicBrainzTrackIdeas.length > 0) {
            console.log(`[Spotify Main] Enriching ${musicBrainzTrackIdeas.length} track ideas from MusicBrainz with Spotify details...`);
            for (const trackIdea of musicBrainzTrackIdeas) {
                if (finalSpotifyTrackCandidates.length >= spotifyRequestLimit) break;
                
                let searchQuery = `track:${trackIdea.title} artist:${trackIdea.artist}`;
                if (trackIdea.album) {
                    searchQuery += ` album:${trackIdea.album}`;
                }
                const spotifySearchResults = await searchTracksOnSpotify(searchQuery, 1, token);
                
                if (spotifySearchResults.length > 0) {
                    const foundSpotifyTrack = spotifySearchResults[0];
                    if (!finalSpotifyTrackCandidates.some(fc => fc.id === foundSpotifyTrack.id)) {
                        // Assuming searchTracksOnSpotify returns {id, title, artist}, we need full details
                        const detailedTracks = await fetchFullTrackDetails([foundSpotifyTrack.id], token);
                        if (detailedTracks.length > 0 && detailedTracks[0].duration_ms && detailedTracks[0].album_art_url) {
                            finalSpotifyTrackCandidates.push(detailedTracks[0]);
                        }
                    }
                }
            }
            console.log(`[Spotify Main] Enriched ${finalSpotifyTrackCandidates.length} candidates via MusicBrainz + Spotify.`);
        }
    } catch (e) {
        console.error("[Spotify Main] MusicBrainz strategy failed:", e.message);
    }

    // --- Fallback Strategy 1: TheAudioDB (if you implemented it and want to keep it) ---
    // if (finalSpotifyTrackCandidates.length < spotifyRequestLimit) {
    //     console.log(`[Spotify Main] MusicBrainz strategy yielded ${finalSpotifyTrackCandidates.length}. Trying TheAudioDB.`);
    //     const seedArtists = ["Taylor Swift", "Ed Sheeran", "Drake", /* ... more ... */];
    //     const audioDBTrackIdeas = await fetchPopularTracksFromTheAudioDB(seedArtists, 2, spotifyRequestLimit - finalSpotifyTrackCandidates.length);
    //     if (audioDBTrackIdeas.length > 0) { 
    //         try {
    //             const popularTrackIdeas = await fetchPopularTracksFromTheAudioDB(seedArtists, 3, spotifyRequestLimit); // Fetch up to spotifyRequestLimit raw ideas
    //             if (popularTrackIdeas.length > 0) {
    //                 console.log(`[Spotify Main] Enriching ${popularTrackIdeas.length} track ideas from TheAudioDB with Spotify details...`);
    //                 for (const trackIdea of popularTrackIdeas) {
    //                     if (finalSpotifyTrackCandidates.length >= spotifyRequestLimit) break;
                        
    //                     // Precise search on Spotify using title and artist
    //                     const spotifySearchResults = await searchTracksOnSpotify(`track:${trackIdea.title} artist:${trackIdea.artist}`, 1, token); // searchTracksOnSpotify now takes token
                        
    //                     if (spotifySearchResults.length > 0) {
    //                         const foundSpotifyTrack = spotifySearchResults[0];
    //                         // Ensure we have full details, searchTracksOnSpotify should return the mapped structure
    //                         // Check for duplicates before adding
    //                         if (!finalSpotifyTrackCandidates.some(fc => fc.id === foundSpotifyTrack.id)) {
    //                             // If searchTracksOnSpotify doesn't give full details like album_art_url, duration_ms,
    //                             // you might need to call fetchFullTrackDetails here.
    //                             // Assuming searchTracksOnSpotify now returns the detailed structure:
    //                             if (foundSpotifyTrack.duration_ms && foundSpotifyTrack.album_art_url) {
    //                                 finalSpotifyTrackCandidates.push(foundSpotifyTrack);
    //                             } else {
    //                                 // If basic search doesn't have all details, fetch full details
    //                                 const detailedTracks = await fetchFullTrackDetails([foundSpotifyTrack.id], token);
    //                                 if (detailedTracks.length > 0 && detailedTracks[0].duration_ms && detailedTracks[0].album_art_url) {
    //                                     finalSpotifyTrackCandidates.push(detailedTracks[0]);
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //                 console.log(`[Spotify Main] Enriched ${finalSpotifyTrackCandidates.length} candidates via TheAudioDB + Spotify.`);
    //             }
    //         } catch (e) {
    //             console.error("[Spotify Main] TheAudioDB strategy failed:", e.message);
    //         }
    //      }
    // }


    // --- Fallback Strategy 2: Spotify "Top Playlists" Search ---
    if (finalSpotifyTrackCandidates.length < spotifyRequestLimit) {
        console.log(`[Spotify Main] Still few candidates (${finalSpotifyTrackCandidates.length}). Trying Top Playlists on Spotify.`);
        const needed = spotifyRequestLimit - finalSpotifyTrackCandidates.length;
        const topPlaylistCandidates = await fetchTracksFromTopPlaylistsStrategy(token, Math.ceil(needed / initialFetchMultiplier) || desiredTrackCount, initialFetchMultiplier);
        const existingIds = new Set(finalSpotifyTrackCandidates.map(tc => tc.id));
        topPlaylistCandidates.forEach(track => {
            if (!existingIds.has(track.id) && track.duration_ms && track.album_art_url) {
                finalSpotifyTrackCandidates.push(track); existingIds.add(track.id);
            }
        });
        console.log(`[Spotify Main] After Top Playlists, total candidates: ${finalSpotifyTrackCandidates.length}`);
    }

    // --- Fallback Strategy 3: Spotify New Releases ---
    if (finalSpotifyTrackCandidates.length < spotifyRequestLimit) {
        console.log(`[Spotify Main] Still few candidates (${finalSpotifyTrackCandidates.length}). Trying New Releases on Spotify.`);
        const needed = spotifyRequestLimit - finalSpotifyTrackCandidates.length;
        const newReleaseCandidates = await fetchTracksFromNewReleasesStrategy(token, Math.ceil(needed / initialFetchMultiplier) || desiredTrackCount, initialFetchMultiplier);
        const existingIds = new Set(finalSpotifyTrackCandidates.map(tc => tc.id));
        newReleaseCandidates.forEach(track => {
            if (!existingIds.has(track.id) && track.duration_ms && track.album_art_url) {
                finalSpotifyTrackCandidates.push(track); existingIds.add(track.id);
            }
        });
        console.log(`[Spotify Main] After New Releases, total candidates: ${finalSpotifyTrackCandidates.length}`);
    }
    
    // Shuffle and get YouTube videos
    if (finalSpotifyTrackCandidates.length > 0) {
        finalSpotifyTrackCandidates.sort(() => 0.5 - Math.random());
        console.log(`[Spotify Main] Total ${finalSpotifyTrackCandidates.length} unique Spotify candidates. Processing for YouTube videos...`);
        for (const spotifyTrack of finalSpotifyTrackCandidates) {
            if (tracksForChallenge.length >= desiredTrackCount) break;
            console.log(`[Youtube Prep] Finding video for: ${spotifyTrack.artist} - ${spotifyTrack.title} (Spotify ID: ${spotifyTrack.id})`);
            const youtubeVideoId = await searchYouTubeVideo(spotifyTrack.title, spotifyTrack.artist, spotifyTrack.duration_ms);
            if (youtubeVideoId) {
                tracksForChallenge.push({
                    source_name: 'spotify_via_musicbrainz', // Indicate discovery source
                    track_id_from_source: spotifyTrack.id,
                    title: spotifyTrack.title,
                    artist: spotifyTrack.artist,
                    album_art_url: spotifyTrack.album_art_url,
                    duration_ms: spotifyTrack.duration_ms,
                    youtube_video_id: youtubeVideoId
                });
                console.log(`SUCCESS: Added to daily challenge: "${spotifyTrack.title}". Count: ${tracksForChallenge.length}/${desiredTrackCount}`);
            } else {
                console.warn(`SKIP (No YouTube Video): No suitable YouTube video found for ${spotifyTrack.artist} - ${spotifyTrack.title}.`);
            }
        }
    }
    
    if (tracksForChallenge.length === 0) {
        console.error('CRITICAL: Failed to get ANY tracks for daily challenge after all strategies.');
        throw new Error('Failed to curate any tracks for the daily challenge.');
    }
    if (tracksForChallenge.length < desiredTrackCount) {
        console.warn(`WARNING: Could only secure ${tracksForChallenge.length} tracks out of ${desiredTrackCount} desired.`);
    }
    return tracksForChallenge.slice(0, desiredTrackCount);
}

async function searchTracksOnSpotify(query, limit = 5, token) {
    if (!token) token = await getAccessToken();
    // ... rest of your existing searchTracksOnSpotify for autocomplete
    // This function should return the mapped structure {id, title, artist}
    // Ensure it's robust.
    if (!token) { console.error('Spotify autocomplete failed: Missing token.'); return []; }    
    try {
        const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: { q: query, type: 'track', market: SPOTIFY_MARKET, limit: limit }
        });
        if (response.data && response.data.tracks && response.data.tracks.items) {
            return response.data.tracks.items.map(track => ({
                id: track.id, title: track.name, artist: track.artists.map(a => a.name).join(', ')
            }));
        } return [];
    } catch (error) { console.error(`Error in searchTracksOnSpotify for query "${query}":`, error.message); return []; }
}

// New function to save suggestions to cache
async function saveSuggestionsToCache(suggestions) {
    if (!suggestions || suggestions.length === 0) {
        return;
    }
    const dbInstance = getDb();
    const insertSql = `
        INSERT OR IGNORE INTO song_suggestion_cache (spotify_track_id, title, artist) 
        VALUES (?, ?, ?)
    `;
    // Using a prepared statement for multiple inserts is more efficient
    const stmt = dbInstance.prepare(insertSql);
    let insertedCount = 0;
    suggestions.forEach(suggestion => {
        // Ensure suggestion has id, title, artist
        if (suggestion.id && suggestion.title && suggestion.artist) {
            stmt.run(suggestion.id, suggestion.title, suggestion.artist, function(err) {
                if (err) {
                    console.error("Error inserting suggestion to cache:", err.message, suggestion);
                } else if (this.changes > 0) {
                    insertedCount++;
                }
            });
        }
    });
    // Finalize the statement after all run calls have been made.
    // The run calls are asynchronous in their callbacks.
    // For bulk inserts, it's often better to wrap in a transaction if not already.
    // However, for autocomplete cache, individual failures are less critical.
    return new Promise((resolve, reject) => {
        stmt.finalize(err => {
            if (err) {
                console.error("Error finalizing statement for cache insertion:", err.message);
                reject(err); // Or just log and resolve
            } else {
                if (insertedCount > 0) {
                    console.log(`[Cache] Saved ${insertedCount} new suggestions to cache.`);
                }
                resolve();
            }
        });
    });
}

async function fetchPopularTracksFromTheAudioDB(seedArtistNames, tracksPerArtist = 3, desiredTotalTracks = 20) {
    if (!THEAUDIODB_API_KEY) {
        console.warn('[TheAudioDB] API key not configured or missing. Skipping this strategy.');
        return [];
    }
    if (!seedArtistNames || seedArtistNames.length === 0) {
        console.warn('[TheAudioDB] No seed artist names provided. Skipping this strategy.');
        return [];
    }

    console.log(`[TheAudioDB Strategy] Fetching top tracks for ${seedArtistNames.length} seed artists.`);
    let trackIdeas = []; // Will store { title: string, artist: string }

    // Shuffle artists to get variety if we don't go through all of them
    const shuffledArtists = [...seedArtistNames].sort(() => 0.5 - Math.random());

    for (const artistName of shuffledArtists) {
        if (trackIdeas.length >= desiredTotalTracks) {
            break; // Stop if we have enough ideas
        }
        try {
            // TheAudioDB endpoint for an artist's "most loved" tracks (often up to 10, sometimes more or less)
            // For free/public key '1' or '2', this might be what's available as "track-top10.php"
            const url = `${THEAUDIODB_API_BASE_URL}/${THEAUDIODB_API_KEY}/track-top10.php?s=${encodeURIComponent(artistName)}`;
            console.log(`[TheAudioDB] Fetching top tracks for "${artistName}" from ${url}`);
            const response = await axios.get(url);

            if (response.data && response.data.track && response.data.track.length > 0) {
                const artistTracks = response.data.track
                    .filter(t => t.strTrack && t.strArtist) // Ensure essential fields are present
                    .slice(0, tracksPerArtist) // Take specified number of tracks per artist
                    .map(t => ({
                        title: t.strTrack,
                        artist: t.strArtist // TheAudioDB usually returns the main artist here
                        // Note: TheAudioDB might also provide t.strMusicBrainzID or t.idSpotify
                        // If t.idSpotify is reliably present, that's a huge win!
                    }));
                
                console.log(`[TheAudioDB] Found ${artistTracks.length} tracks for "${artistName}".`);
                trackIdeas = trackIdeas.concat(artistTracks);
                // Simple duplicate check based on title and artist for now within this batch
                trackIdeas = trackIdeas.filter((track, index, self) =>
                    index === self.findIndex((t) => (
                        t.title === track.title && t.artist === track.artist
                    ))
                );

            } else {
                console.log(`[TheAudioDB] No tracks found for "${artistName}".`);
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.warn(`[TheAudioDB] Error fetching top tracks for "${artistName}": ${errorMsg}`);
            // Continue to next artist if one fails
        }
    }

    console.log(`[TheAudioDB Strategy] Yielded ${trackIdeas.length} raw track ideas.`);
    return trackIdeas.slice(0, desiredTotalTracks); // Return up to the desired total
}

async function fetchTrackIdeasByGenreFromMusicBrainz(seedGenres, tracksPerGenre = 20, desiredTotalTracks = 50) {
    if (!seedGenres || seedGenres.length === 0) {
        console.warn('[MusicBrainz] No seed genres provided. Skipping this strategy.');
        return [];
    }
    console.log(`[MusicBrainz Strategy] Fetching up to ${tracksPerGenre} tracks for genres: ${seedGenres.join(', ')}.`);
    let trackIdeas = []; // Will store { title: string, artist: string, album?: string }

    for (const genre of seedGenres) {
        if (trackIdeas.length >= desiredTotalTracks) break;
        try {
            const url = `${MUSICBRAINZ_API_BASE_URL}/recording?query=tag:${encodeURIComponent(genre)}&fmt=json&limit=${tracksPerGenre}&inc=artist-credits+release-groups`;
            console.log(`[MusicBrainz] Fetching tracks for genre "${genre}" from ${url}`);
            
            const response = await axios.get(url, {
                headers: { 'User-Agent': MB_USER_AGENT }
            });

            if (response.data && response.data.recordings && response.data.recordings.length > 0) {
                const genreTracks = response.data.recordings
                    .filter(r => r.title && r['artist-credit'] && r['artist-credit'].length > 0)
                    .map(r => {
                        const artistName = r['artist-credit'].map(ac => ac.name).join(' & ');
                        // Try to get an album title from the first release group if available
                        const albumTitle = (r['release-groups'] && r['release-groups'].length > 0) ? r['release-groups'][0].title : undefined;
                        return {
                            title: r.title,
                            artist: artistName,
                            album: albumTitle 
                            // MusicBrainz ID for track: r.id
                            // MusicBrainz ID for artist (first one): r['artist-credit'][0].artist.id
                        };
                    });
                
                console.log(`[MusicBrainz] Found ${genreTracks.length} tracks for genre "${genre}".`);
                
                trackIdeas = trackIdeas.concat(genreTracks);
                // Simple duplicate check
                trackIdeas = trackIdeas.filter((track, index, self) =>
                    index === self.findIndex((t) => (t.title === track.title && t.artist === track.artist))
                );
            } else {
                console.log(`[MusicBrainz] No tracks found for genre "${genre}".`);
            }
            await delay(1100); // Respect MusicBrainz rate limit (1 req/sec)
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.warn(`[MusicBrainz] Error fetching tracks for genre "${genre}": ${errorMsg}`);
            // Continue to next genre if one fails
        }
    }
    console.log(`[MusicBrainz Strategy] Yielded ${trackIdeas.length} raw track ideas.`);
    return trackIdeas.slice(0, desiredTotalTracks);
}



console.log('[MUSIC_SOURCE_DEBUG] Defining module.exports for music-source-service.');
module.exports = {
    getAccessToken,
    getTracksForDailyChallenge,
    searchTracksOnSpotify,
    saveSuggestionsToCache,
    fetchTrackIdeasByGenreFromMusicBrainz, // Exporting the new helper
    fetchFullTrackDetails,
    searchYouTubeVideo
    // Remove fetchPopularTracksFromTheAudioDB if replaced, or keep if used as fallback.
};
console.log('[MUSIC_SOURCE_DEBUG] music-source-service.js module.exports defined.');
