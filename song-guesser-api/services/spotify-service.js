// Description: Handles interactions with the Spotify Web API.
const axios = require('axios');
const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ACCOUNTS_URL,
    SPOTIFY_API_BASE_URL
} = require('../config');

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
        tokenExpiryTime = Date.now() + (response.data.expires_in - 300) * 1000; // 5 min buffer
        console.log('Spotify access token obtained.');
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify access token:', error.response ? error.response.data : error.message);
        throw new Error('Could not authenticate with Spotify.');
    }
}

// Example: Fetch tracks from "Today's Top Hits" playlist on Spotify
// Playlist ID for "Today's Top Hits" can change, so this is an example.
// A more robust approach might involve searching for a playlist by name or using other criteria.
const EXAMPLE_PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M'; // Example: Today's Top Hits

async function getTracksFromPlaylist(playlistId = EXAMPLE_PLAYLIST_ID, limit = 20) {
    const token = await getAccessToken();
    if (!token) throw new Error('Missing Spotify access token.');

    try {
        const response = await axios.get(`${SPOTIFY_API_BASE_URL}/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                fields: 'items(track(id,name,artists(name),album(images),preview_url,duration_ms))',
                limit: limit // Fetch a bit more to filter those without preview_url
            }
        });

        const tracks = response.data.items
            .map(item => item.track)
            .filter(track => track && track.id && track.preview_url) // Ensure track exists, has ID and a preview
            .map(track => ({
                id: track.id,
                title: track.name,
                artist: track.artists.map(artist => artist.name).join(', '),
                preview_url: track.preview_url,
                album_art_url: track.album && track.album.images.length > 0 ? track.album.images[0].url : null,
                duration_ms: track.duration_ms
            }));
        
        console.log(`Fetched ${tracks.length} tracks with previews from playlist ${playlistId}.`);
        return tracks;

    } catch (error) {
        console.error(`Error fetching tracks from playlist ${playlistId}:`, error.response ? error.response.data : error.message);
        return [];
    }
}

module.exports = {
    getAccessToken,
    getTracksFromPlaylist
};
