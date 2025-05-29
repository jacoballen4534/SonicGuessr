// Description: Loads environment variables and defines application constants.
require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    DATABASE_FILE: process.env.DATABASE_FILE || './song_guesser.sqlite',
    DAILY_SONG_COUNT: parseInt(process.env.DAILY_SONG_COUNT, 10) || 10,

    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ACCOUNTS_URL: 'https://accounts.spotify.com/api/token',
    SPOTIFY_API_BASE_URL: 'https://api.spotify.com/v1',
    SPOTIFY_MARKET: process.env.SPOTIFY_MARKET || 'US',

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    SESSION_SECRET: process.env.SESSION_SECRET || 'please_change_this_secret',

    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:4200',
};
