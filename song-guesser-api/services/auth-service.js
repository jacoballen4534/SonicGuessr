// File: services/auth-service.js
// Description: Handles user authentication logic using Passport.js.
// Changes:
// - `initializePassport` now accepts `getDb` function to get the db instance.
// - Uses `db` instance obtained from `getDb()`.

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
// `db` will be obtained via getDb()
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = require('../config');

function initializePassport(app, getDb) { // Accept getDb
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.warn('Google OAuth credentials are not configured. Google Sign-In will not work.');
        return;
    }

    const db = getDb(); // Get the db instance

    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            db.get('SELECT * FROM users WHERE google_id = ?', [profile.id], (err, row) => {
                if (err) { return done(err); }
                if (row) {
                    return done(null, row);
                } else {
                    const newUser = {
                        google_id: profile.id,
                        display_name: profile.displayName,
                        email: profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null,
                        profile_image_url: profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null,
                    };
                    db.run(
                        'INSERT INTO users (google_id, display_name, email, profile_image_url) VALUES (?, ?, ?, ?)',
                        [newUser.google_id, newUser.display_name, newUser.email, newUser.profile_image_url],
                        function (insertErr) {
                            if (insertErr) { return done(insertErr); }
                            newUser.id = this.lastID;
                            return done(null, newUser);
                        }
                    );
                }
            });
        } catch (error) {
            return done(error);
        }
    }));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser((id, done) => {
    const dbInstance = getDb(); // Ensure getDb() is accessible here
    dbInstance.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            return done(err);
        }
        if (!user) {
            return done(null, false); // Or done(new Error('User not found from session'));
        }
        done(null, user);
        });
    });

}

module.exports = { initializePassport };