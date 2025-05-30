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
    // SPOTIFY_PLAYLIST_IDS, // No longer directly used by getTracksForDailyChallenge's primary strategies
    YOUTUBE_API_KEY,      // Your YouTube Data API v3 Key
    DAILY_SONG_COUNT
} = require('../config');
const { getDb } = require('./database-service'); // If this service needs to access db directly

let spotifyAccessToken = null;
let tokenExpiryTime = 0;

async function getAccessToken() {
    if (spotifyAccessToken && Date.now() < tokenExpiryTime) {
        return spotifyAccessToken;
    }
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
        tokenExpiryTime = Date.now() + (response.data.expires_in - 300) * 1000; // -300s for buffer
        console.log('Spotify access token obtained.');
        return spotifyAccessToken;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error getting Spotify access token:', errorMsg);
        throw new Error('Could not authenticate with Spotify: ' + errorMsg);
    }
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
        throw new Error('YouTube API Key missing.');
    }

    const searchQueries = [
        `${artist} - ${title} Official Audio`,
        `${artist} - ${title} Lyric Video`,
        `${artist} - ${title} Audio`,
        `${artist} - ${title} Topic`, // "Topic" channels often have official audio
        `${artist} - ${title}` // Fallback
    ];

    const youtubeApiSearchUrl = 'https://www.googleapis.com/youtube/v3/search';
    const youtubeApiVideosUrl = 'https://www.googleapis.com/youtube/v3/videos';

    for (const query of searchQueries) {
        console.log(`[Youtube] Querying for: "${query}"`);
        try {
            const searchResponse = await axios.get(youtubeApiSearchUrl, {
                params: {
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    videoCategoryId: '10', // Music category
                    videoEmbeddable: 'true',
                    maxResults: 5, // Check top 5 results for each query type
                    key: YOUTUBE_API_KEY
                }
            });

            if (searchResponse.data.items && searchResponse.data.items.length > 0) {
                for (const item of searchResponse.data.items) {
                    const videoId = item.id.videoId;
                    const videoTitleLower = item.snippet.title.toLowerCase();
                    const channelTitleLower = item.snippet.channelTitle.toLowerCase();

                    // Enhanced Filtering Logic from the plan
                    const undesiredKeywords = ["live", "cover", "remix", "interview", "teaser", "reaction", "parody", "tutorial", "official video", "music video", "official music video", "live performance"];
                    if (undesiredKeywords.some(keyword => videoTitleLower.includes(keyword))) {
                        console.log(`[Youtube] Skipping video "${item.snippet.title}" due to undesired keywords.`);
                        continue;
                    }

                    // Prioritize based on title content
                    let isPreferredType = false;
                    if (videoTitleLower.includes("official audio")) isPreferredType = true;
                    else if (videoTitleLower.includes("lyric video") && query.toLowerCase().includes("lyric video")) isPreferredType = true;
                    else if (videoTitleLower.includes("audio") && query.toLowerCase().includes("audio")) isPreferredType = true;
                    else if (channelTitleLower.includes("topic") && query.toLowerCase().includes("topic")) isPreferredType = true;
                    else if (query === `${artist} - ${title}`) isPreferredType = true; // For the fallback query, be more lenient if it passed other filters

                    // Duration Check (Optional but recommended as per plan)
                    try {
                        const videoDetailsResponse = await axios.get(youtubeApiVideosUrl, {
                            params: {
                                part: 'contentDetails',
                                id: videoId,
                                key: YOUTUBE_API_KEY
                            }
                        });
                        if (videoDetailsResponse.data.items && videoDetailsResponse.data.items.length > 0) {
                            const durationISO = videoDetailsResponse.data.items[0].contentDetails.duration;
                            const youtubeDurationMs = parseISO8601Duration(durationISO);

                            // Allow some variance (e.g., +/- 30 seconds)
                            if (spotifyDurationMs && Math.abs(youtubeDurationMs - spotifyDurationMs) > 30000) {
                                console.log(`[Youtube] Skipping video "${item.snippet.title}" (YouTube: ${youtubeDurationMs}ms, Spotify: ${spotifyDurationMs}ms) due to significant duration mismatch.`);
                                continue;
                            }
                             console.log(`[Youtube] Video "${item.snippet.title}" duration check passed (YouTube: ${youtubeDurationMs}ms, Spotify: ${spotifyDurationMs}ms).`);
                        }
                    } catch (detailsError) {
                        console.warn(`[Youtube] Could not fetch video details for ${videoId} to check duration: ${detailsError.message}`);
                        // Proceed without duration check if details fetch fails
                    }


                    if (isPreferredType) {
                        console.log(`[Youtube] Found suitable match for "${query}": "${item.snippet.title}" (ID: ${videoId})`);
                        return videoId; // Return first suitable match
                    }
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
    console.warn(`[Youtube] No suitable YouTube video found for "${artist} - ${title}" after all query types.`);
    return null;
}

async function fetchTracksFromSpecificPlaylist(playlistId, trackLimit = 50) {
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token.');

    try {
        const response = await axios.get(`${SPOTIFY_API_BASE_URL}/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                fields: 'items(track(id,name,artists(name),album(images),duration_ms))', // Get essential metadata
                limit: trackLimit,
                market: SPOTIFY_MARKET
            }
        });

        const tracks = response.data.items
            .map(item => item.track)
            .filter(track => track && track.id && track.name && track.artists && track.artists.length > 0) // Basic validation
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

async function fetchFullTrackDetails(trackIds) {
    if (!trackIds || trackIds.length === 0) {
        return [];
    }
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token for full track details.');

    const MAX_IDS_PER_REQUEST = 50;
    let fetchedSpotifyTracks = [];

    for (let i = 0; i < trackIds.length; i += MAX_IDS_PER_REQUEST) {
        const batchIds = trackIds.slice(i, i + MAX_IDS_PER_REQUEST);
        try {
            const response = await axios.get(`${SPOTIFY_API_BASE_URL}/tracks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { ids: batchIds.join(','), market: SPOTIFY_MARKET }
            });
            if (response.data && response.data.tracks) {
                fetchedSpotifyTracks = fetchedSpotifyTracks.concat(
                    response.data.tracks.filter(t => t && t.id && t.name && t.artists && t.artists.length > 0)
                );
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[Spotify] Error fetching batch of full track details: ${errorMsg}`);
        }
    }
    
    console.log(`[Spotify] Received ${fetchedSpotifyTracks.length} valid Spotify track objects for ${trackIds.length} requested IDs.`);
    return fetchedSpotifyTracks.map(track => ({
        id: track.id,
        title: track.name,
        artist: track.artists.map(artist => artist.name).join(', '),
        album_art_url: track.album && track.album.images.length > 0 ? track.album.images[0].url : null,
        duration_ms: track.duration_ms
    }));
}

async function getTracksForDailyChallenge(desiredTrackCount = DAILY_SONG_COUNT) {
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token for daily challenge.');

    let tracksForChallenge = [];
    let spotifyTrackCandidates = [];
    // Fetch more Spotify tracks initially to account for YouTube misses and ensure variety.
    const initialFetchMultiplier = 5; 
    const spotifyFetchLimit = desiredTrackCount * initialFetchMultiplier;

    // Strategy 1: Try fetching from a dynamically selected category playlist
    try {
        console.log(`[Spotify Strategy 1] Dynamically selecting category (market: ${SPOTIFY_MARKET})...`);
        const categoriesResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/categories`, {
            headers: { 'Authorization': `Bearer ${token}`},
            params: { country: SPOTIFY_MARKET, limit: 20 }
        });

        if (categoriesResponse.data.categories.items && categoriesResponse.data.categories.items.length > 0) {
            const availableCategories = categoriesResponse.data.categories.items;
            const selectedCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];
            console.log(`[Spotify Strategy 1] Selected category: "${selectedCategory.name}" (ID: ${selectedCategory.id}). Fetching playlists...`);

            const categoryPlaylistsResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/categories/${selectedCategory.id}/playlists`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { country: SPOTIFY_MARKET, limit: 10 }
            });

            if (categoryPlaylistsResponse.data.playlists.items && categoryPlaylistsResponse.data.playlists.items.length > 0) {
                const playlists = categoryPlaylistsResponse.data.playlists.items;
                const selectedPlaylist = playlists[Math.floor(Math.random() * playlists.length)];
                console.log(`[Spotify Strategy 1] Selected playlist: "${selectedPlaylist.name}" (ID: ${selectedPlaylist.id}). Fetching ${spotifyFetchLimit} metadata entries...`);
                spotifyTrackCandidates = await fetchTracksFromSpecificPlaylist(selectedPlaylist.id, spotifyFetchLimit);
            } else {
                 console.warn(`[Spotify Strategy 1] No playlists found for category ${selectedCategory.id}.`);
            }
        } else {
            console.warn(`[Spotify Strategy 1] No categories found for market ${SPOTIFY_MARKET}.`);
        }
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.warn(`[Spotify Strategy 1] Failed: ${errorMsg}. Proceeding to fallback.`);
    }

    // Strategy 2: Fallback to New Releases if Strategy 1 yielded too few candidates
    if (spotifyTrackCandidates.length < desiredTrackCount) {
        console.log(`[Spotify Strategy 2] Fallback: Fetching new releases (market: ${SPOTIFY_MARKET}). Strategy 1 yielded ${spotifyTrackCandidates.length} candidates.`);
        try {
            const newReleasesResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/new-releases`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { country: SPOTIFY_MARKET, limit: Math.max(10, Math.ceil(desiredTrackCount / 2)) } // Fetch enough albums
            });

            if (newReleasesResponse.data.albums.items && newReleasesResponse.data.albums.items.length > 0) {
                let albumTrackIds = [];
                for (const album of newReleasesResponse.data.albums.items) { // Iterate through fetched albums
                    if (albumTrackIds.length >= spotifyFetchLimit) break;
                    const albumTracksResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/albums/${album.id}/tracks`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                        params: { market: SPOTIFY_MARKET, limit: 50 } // Get all tracks from album
                    });
                    if (albumTracksResponse.data.items) {
                        albumTrackIds.push(...albumTracksResponse.data.items.map(track => track.id).filter(id => id));
                    }
                }
                
                if (albumTrackIds.length > 0) {
                    console.log(`[Spotify Strategy 2] Fetched ${albumTrackIds.length} track IDs from new release albums. Fetching details...`);
                    // Fetch details only for needed amount to avoid excessive API calls
                    const uniqueAlbumTrackIds = [...new Set(albumTrackIds)]; // Ensure unique IDs
                    const detailedTracks = await fetchFullTrackDetails(uniqueAlbumTrackIds.slice(0, spotifyFetchLimit - spotifyTrackCandidates.length));
                    
                    // Add to candidates, avoid duplicates by ID
                    const existingCandidateIds = new Set(spotifyTrackCandidates.map(tc => tc.id));
                    detailedTracks.forEach(track => {
                        if (!existingCandidateIds.has(track.id)) {
                            spotifyTrackCandidates.push(track);
                            existingCandidateIds.add(track.id);
                        }
                    });
                }
                 console.log(`[Spotify Strategy 2] Total candidates after new releases: ${spotifyTrackCandidates.length}`);
            } else {
                console.warn(`[Spotify Strategy 2] No new album releases found for market ${SPOTIFY_MARKET}.`);
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[Spotify Strategy 2] Failed: ${errorMsg}`);
        }
    }
    
    // Shuffle candidates for variety before picking for Youtube
    if (spotifyTrackCandidates.length > 0) {
        for (let i = spotifyTrackCandidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [spotifyTrackCandidates[i], spotifyTrackCandidates[j]] = [spotifyTrackCandidates[j], spotifyTrackCandidates[i]];
        }
    }
    
    console.log(`Processing ${spotifyTrackCandidates.length} unique Spotify track candidates to find ${desiredTrackCount} YouTube videos.`);
    for (const spotifyTrack of spotifyTrackCandidates) {
        if (tracksForChallenge.length >= desiredTrackCount) {
            break; 
        }
        console.log(`Attempting to find YouTube video for: ${spotifyTrack.artist} - ${spotifyTrack.title} (Spotify ID: ${spotifyTrack.id})`);
        const youtubeVideoId = await searchYouTubeVideo(spotifyTrack.title, spotifyTrack.artist, spotifyTrack.duration_ms);

        if (youtubeVideoId) {
            tracksForChallenge.push({
                source_name: 'spotify', // Metadata source
                track_id_from_source: spotifyTrack.id,
                title: spotifyTrack.title,
                artist: spotifyTrack.artist,
                album_art_url: spotifyTrack.album_art_url,
                duration_ms: spotifyTrack.duration_ms,
                youtube_video_id: youtubeVideoId // Crucial new field
            });
            console.log(`SUCCESS: Added to daily challenge: "${spotifyTrack.title}" with YouTube ID ${youtubeVideoId}. Count: ${tracksForChallenge.length}/${desiredTrackCount}`);
        } else {
            console.warn(`SKIP: No suitable YouTube video for ${spotifyTrack.artist} - ${spotifyTrack.title}.`);
        }
    }

    if (tracksForChallenge.length === 0) {
        console.error('CRITICAL: Failed to get ANY tracks for daily challenge after all strategies and Youtube.');
        throw new Error('Failed to curate any tracks for the daily challenge.');
    }
    if (tracksForChallenge.length < desiredTrackCount) {
        console.warn(`WARNING: Could only secure ${tracksForChallenge.length} tracks with YouTube videos out of ${desiredTrackCount} desired.`);
    }

    return tracksForChallenge.slice(0, desiredTrackCount); // Ensure correct count is returned
}

async function searchTracksOnSpotify(query, limit = 5) {
    const token = await getAccessToken(); // Uses your existing getAccessToken function
    if (!token) {
        console.error('Spotify search failed: Missing access token.');
        throw new Error('Missing Spotify access token for search.');
    }

    // Ensure SPOTIFY_API_BASE_URL from your config is the correct live Spotify API URL
    // e.g., https://api.spotify.com/v1
    const spotifySearchUrl = `${SPOTIFY_API_BASE_URL}/search`;

    try {
        console.log(`[Spotify Search] Searching for query: "${query}" at URL: ${spotifySearchUrl}`);
        const response = await axios.get(spotifySearchUrl, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                q: query,
                type: 'track',
                market: SPOTIFY_MARKET, // From your config.js
                limit: limit
            }
        });

        if (response.data && response.data.tracks && response.data.tracks.items) {
            return response.data.tracks.items.map(track => ({
                id: track.id, // Spotify track ID
                title: track.name,
                artist: track.artists.map(artist => artist.name).join(', '),
                // You could include album_art_url if your frontend autocomplete can show it:
                // album_art_url: track.album && track.album.images && track.album.images.length > 0 ? track.album.images[0].url : null,
            }));
        }
        return []; // Return empty array if no tracks found or unexpected structure
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Spotify Search] Error searching tracks on Spotify for query "${query}": ${errorMsg}`);
        
        // Invalidate token if it's an auth error, so next call to getAccessToken tries to refresh
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            spotifyAccessToken = null; 
        }
        // Re-throw the error so the route handler can send a 500, or return empty array.
        // For autocomplete, often better to return [] on error than break the UI.
        // Let's return empty for robustness in autocomplete.
        return []; 
    }
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




module.exports = {
    getAccessToken,
    getTracksForDailyChallenge,
    searchTracksOnSpotify,
    saveSuggestionsToCache // Export the new function
};
