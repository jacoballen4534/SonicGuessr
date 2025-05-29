// Description: Routes for handling user authentication (Google Sign-In).
// This is a placeholder and will be expanded in Phase 4.
const express = require('express');
const passport = require('passport');
const { FRONTEND_URL } = require('../config');
const router = express.Router();

// Initiates Google OAuth flow
router.get('/google',
    (req, res, next) => {
        // Store the intended redirect URL from query param if present
        // e.g., /auth/google?returnTo=/profile
        // req.session.returnTo = req.query.returnTo || '/'; 
        // For now, we'll always redirect to frontend root after login
        next();
    },
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback URL
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }), // Redirect to frontend login page on failure
    (req, res) => {
        // Successful authentication
        // const returnTo = req.session.returnTo || '/';
        // delete req.session.returnTo;
        // Redirect to the frontend, which can then fetch user profile
        res.redirect(FRONTEND_URL); // Or FRONTEND_URL + '/some-path-after-login'
    }
);

// Get current user profile (if authenticated)
router.get('/profile', (req, res) => {
    if (req.isAuthenticated()) {
        // Exclude sensitive info if necessary before sending
        const { google_id, ...userProfile } = req.user;
        res.json({ user: userProfile });
    } else {
        res.status(401).json({ message: 'Not authenticated' });
    }
});

// Logout
router.post('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ message: 'Could not log out, please try again.' });
            }
            res.clearCookie('connect.sid'); // connect.sid is the default session cookie name
            res.status(200).json({ message: 'Logged out successfully' });
        });
    });
});

module.exports = router;
