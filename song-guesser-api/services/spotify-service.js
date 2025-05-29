// File: services/spotify-service.js
// Description: Handles interactions with the Spotify Web API.
// Changes:
// - `getTracksForDailyChallenge`:
//   - Strategy 1 now dynamically fetches available categories for the market and picks one randomly.
//   - Added more logging in Strategy 2 (New Releases fallback) to track progress.
// - `fetchFullTrackDetails`:
//   - Added logging to show how many raw tracks were fetched vs. how many had preview_urls.

const axios = require('axios');
const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ACCOUNTS_URL,
    SPOTIFY_API_BASE_URL,
    SPOTIFY_MARKET
} = require('../config');

// getAccessToken and fetchTracksFromSpecificPlaylist functions remain the same
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
        tokenExpiryTime = Date.now() + (response.data.expires_in - 300) * 1000;
        console.log('Spotify access token obtained.');
        return spotifyAccessToken;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error getting Spotify access token:', errorMsg);
        throw new Error('Could not authenticate with Spotify: ' + errorMsg);
    }
}

async function fetchTracksFromSpecificPlaylist(playlistId, trackLimit = 20) {
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token.');

    try {
        const response = await axios.get(`${SPOTIFY_API_BASE_URL}/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                fields: 'items(track(id,name,artists(name),album(images),preview_url,duration_ms))',
                limit: trackLimit,
                market: SPOTIFY_MARKET
            }
        });

        const tracks = response.data.items
            .map(item => item.track)
            .filter(track => track && track.id && track.preview_url) 
            .map(track => ({
                id: track.id,
                title: track.name,
                artist: track.artists.map(artist => artist.name).join(', '),
                preview_url: track.preview_url,
                album_art_url: track.album && track.album.images.length > 0 ? track.album.images[0].url : null,
                duration_ms: track.duration_ms
            }));
        
        console.log(`Fetched ${tracks.length} tracks with previews from specific playlist ${playlistId}.`);
        return tracks;

    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error fetching tracks from specific playlist ${playlistId}: ${errorMsg}`);
        return [];
    }
}

async function fetchFullTrackDetails(trackIds) {
    if (!trackIds || trackIds.length === 0) {
        console.log('fetchFullTrackDetails: No track IDs provided.');
        return [];
    }
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token for fetching full track details.');

    const MAX_IDS_PER_REQUEST = 50;
    let fetchedFullTracks = []; // All tracks returned by Spotify API for the IDs

    console.log(`fetchFullTrackDetails: Attempting to fetch full details for ${trackIds.length} track IDs.`);
    for (let i = 0; i < trackIds.length; i += MAX_IDS_PER_REQUEST) {
        const batchIds = trackIds.slice(i, i + MAX_IDS_PER_REQUEST);
        try {
            console.log(`fetchFullTrackDetails: Fetching batch of ${batchIds.length} IDs: ${batchIds.join(',')}`);
            console.log('*** TOKEN ', token);
            
            const response = await axios.get(`${SPOTIFY_API_BASE_URL}/tracks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    ids: batchIds.join(','),
                    market: SPOTIFY_MARKET
                }
            });
            if (response.data && response.data.tracks) {
                fetchedFullTracks = fetchedFullTracks.concat(response.data.tracks.filter(t => t)); // Filter out null tracks if any
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`fetchFullTrackDetails: Error fetching batch of full track details: ${errorMsg}`);
        }
    }
    
    console.log(`fetchFullTrackDetails: Received ${fetchedFullTracks.length} full track objects from Spotify for ${trackIds.length} requested IDs.`);

    const tracksWithPreviews = fetchedFullTracks
        .filter(track => track && track.id && track.preview_url)
        .map(track => ({
            id: track.id,
            title: track.name,
            artist: track.artists.map(artist => artist.name).join(', '),
            preview_url: track.preview_url,
            album_art_url: track.album && track.album.images.length > 0 ? track.album.images[0].url : null,
            duration_ms: track.duration_ms
        }));
    
    console.log(`fetchFullTrackDetails: Filtered down to ${tracksWithPreviews.length} tracks with preview URLs.`);
    return tracksWithPreviews;
}

async function getTracksForDailyChallenge(desiredTrackCount = 10) {
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token for daily challenge initial call.');

    let tracksForChallenge = [];
    let selectedCategoryId = null;

    // Strategy 1: Try fetching from a dynamically selected category playlist
    try {
        console.log(`Attempting Strategy 1: Dynamically selecting a category for market: ${SPOTIFY_MARKET}...`);
        const categoriesResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/categories`, {
            headers: { 'Authorization': `Bearer ${token}`},
            params: {
                country: SPOTIFY_MARKET,
                limit: 20 // Fetch a decent number of categories to pick from
            }
        });

        if (categoriesResponse.data.categories.items && categoriesResponse.data.categories.items.length > 0) {
            const availableCategories = categoriesResponse.data.categories.items;
            selectedCategoryId = availableCategories[Math.floor(Math.random() * availableCategories.length)].id;
            console.log(`Dynamically selected category: "${selectedCategoryId}" for market: ${SPOTIFY_MARKET}. Fetching its playlists...`);

            const categoryPlaylistsResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/categories/${selectedCategoryId}/playlists`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    country: SPOTIFY_MARKET,
                    limit: 10 
                }
            });

            if (categoryPlaylistsResponse.data.playlists.items && categoryPlaylistsResponse.data.playlists.items.length > 0) {
                const playlists = categoryPlaylistsResponse.data.playlists.items;
                const selectedPlaylist = playlists[Math.floor(Math.random() * playlists.length)];
                console.log(`Selected playlist: "${selectedPlaylist.name}" (ID: ${selectedPlaylist.id}) from category "${selectedCategoryId}" for daily tracks.`);
                
                tracksForChallenge = await fetchTracksFromSpecificPlaylist(selectedPlaylist.id, desiredTrackCount * 3); // Fetch more initially
                tracksForChallenge = tracksForChallenge.slice(0, desiredTrackCount); // Trim to desired count
            } else {
                console.warn(`No playlists found for dynamically selected category ${selectedCategoryId} in market ${SPOTIFY_MARKET}.`);
            }
        } else {
            console.warn(`No categories found for market ${SPOTIFY_MARKET} to select from.`);
        }
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.warn(`Strategy 1 (Dynamic Category Playlists) failed: ${errorMsg}. Proceeding to fallback.`);
    }

    // Strategy 2: Fallback to New Releases if Strategy 1 yielded too few or no tracks
    if (tracksForChallenge.length < desiredTrackCount) {
        console.log(`Attempting Strategy 2 (Fallback): Fetching new releases for market ${SPOTIFY_MARKET} as Strategy 1 yielded ${tracksForChallenge.length} tracks...`);
        try {
            const newReleasesResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/browse/new-releases`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { 
                    country: SPOTIFY_MARKET,
                    limit: 20 // Fetch more new albums to increase chances
                }
            });

            if (newReleasesResponse.data.albums.items && newReleasesResponse.data.albums.items.length > 0) {
                const albums = newReleasesResponse.data.albums.items;
                let potentialFallbackTracks = [];
                
                // Try up to 3 random new albums to find tracks with previews
                for (let i = 0; i < Math.min(albums.length, 3); i++) {
                    if (tracksForChallenge.length >= desiredTrackCount) break; // Stop if we have enough

                    const randomAlbumIndex = Math.floor(Math.random() * albums.length);
                    const selectedAlbum = albums.splice(randomAlbumIndex, 1)[0]; // Pick and remove to avoid re-picking
                    
                    console.log(`Fallback: Processing new release album "${selectedAlbum.name}" (ID: ${selectedAlbum.id}).`);

                    const albumTracksResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/albums/${selectedAlbum.id}/tracks`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                        params: { market: SPOTIFY_MARKET, limit: 50 }
                    });
                    
                    if (albumTracksResponse.data.items && albumTracksResponse.data.items.length > 0) {
                        const trackIdsFromAlbum = albumTracksResponse.data.items.map(track => track.id).filter(id => id);
                        if (trackIdsFromAlbum.length > 0) {
                            const fullTrackDetails = await fetchFullTrackDetails(trackIdsFromAlbum);
                            console.log(`Fallback: Album "${selectedAlbum.name}" yielded ${fullTrackDetails.length} tracks with previews.`);
                            for (const track of fullTrackDetails) {
                                if (tracksForChallenge.length >= desiredTrackCount) break;
                                if (!tracksForChallenge.some(existingTrack => existingTrack.id === track.id)) {
                                    tracksForChallenge.push(track);
                                }
                            }
                        } else {
                            console.log(`Fallback: No track IDs found in album "${selectedAlbum.name}".`);
                        }
                    } else {
                         console.warn(`Fallback: No track items found in selected new release album: "${selectedAlbum.name}".`);
                    }
                }
                console.log(`Fallback: After processing new releases, collected ${tracksForChallenge.length} total tracks.`);
            } else {
                console.warn(`Fallback: No new album releases found for market ${SPOTIFY_MARKET}.`);
            }
        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`Strategy 2 (New Releases Fallback) also failed: ${errorMsg}`);
        }
    }
    
    if (tracksForChallenge.length === 0) {
        throw new Error('Failed to get any tracks for daily challenge after all strategies.');
    }
    if (tracksForChallenge.length < desiredTrackCount) {
        console.warn(`Could only secure ${tracksForChallenge.length} tracks out of ${desiredTrackCount} desired for the daily challenge.`);
    }

    return tracksForChallenge.slice(0, desiredTrackCount);
}

module.exports = {
    getAccessToken,
    getTracksForDailyChallenge 
};