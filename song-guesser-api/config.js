// Description: Loads environment variables and defines application constants.
require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    DATABASE_FILE: process.env.DATABASE_FILE || './song_guesser.sqlite',
    SESSION_DATABASE_FILE: process.env.SESSION_DATABASE_FILE || './sessions.sqlite',
    DAILY_SONG_COUNT: parseInt(process.env.DAILY_SONG_COUNT, 10) || 10,

    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ACCOUNTS_URL: 'https://accounts.spotify.com/api/token',
    SPOTIFY_API_BASE_URL: 'https://api.spotify.com/v1',
    SPOTIFY_MARKET: process.env.SPOTIFY_MARKET || 'US',
    SPOTIFY_PLAYLIST_IDS: process.env.SPOTIFY_PLAYLIST_IDS ? process.env.SPOTIFY_PLAYLIST_IDS.split(',').map(id => id.trim()) : [],

    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY, // <<< ADD THIS LINE
    YOUTUBE_API_KEYS: process.env.YOUTUBE_API_KEYS 
                        ? process.env.YOUTUBE_API_KEYS.split(',').map(key => key.trim()).filter(key => key) 
                        : [], // Parse into array, trim whitespace, filter out empty strings

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    SESSION_SECRET: process.env.SESSION_SECRET || 'please_change_this_secret',

    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:4200',

    THEAUDIODB_API_KEY: process.env.THEAUDIODB_API_KEY || '1', // Default to public key '1'
    THEAUDIODB_API_BASE_URL: 'https://www.theaudiodb.com/api/v1/json', // Base URL for TheAudioDB

    MUSICBRAINZ_API_BASE_URL: 'https://musicbrainz.org/ws/2',
    MUSICBRAINZ_APP_NAME: process.env.MUSICBRAINZ_APP_NAME || 'DefaultAppName',
    MUSICBRAINZ_APP_VERSION: process.env.MUSICBRAINZ_APP_VERSION || '1.0.0',
    MUSICBRAINZ_CONTACT_EMAIL: process.env.MUSICBRAINZ_CONTACT_EMAIL || '', // Or a link to your project

};