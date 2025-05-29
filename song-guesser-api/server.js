// File: server.js
// Description: Main server file for the Express application.
// Changes:
// - Imports `dbInitializationPromise` and `getDb`.
// - `app.listen` is called only after `dbInitializationPromise` resolves.
// - Updated session store configuration for clarity.
// - Passer `getDb()` to auth-service for passport strategy.

const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const SQLiteStore = require('connect-sqlite3')(session);

const { PORT, FRONTEND_URL, SESSION_SECRET, DATABASE_FILE } = require('./config');
const { dbInitializationPromise, getDb } = require('./services/database-service'); // Updated import
const { initializePassport } = require('./services/auth-service');
const authRoutes = require('./routes/auth-routes');
const apiRoutes = require('./routes/api-routes');
const { startDailyJob } = require('./jobs/daily-song-curator');

async function main() {
    await dbInitializationPromise; // Ensure DB is initialized before starting the app
    console.log("Database initialization complete. Starting server setup...");

    const app = express();

    const corsOptions = {
        origin: FRONTEND_URL,
        credentials: true
    };
    app.use(cors(corsOptions));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use(session({
        store: new SQLiteStore({
            db: DATABASE_FILE.split('/').pop(),
            dir: path.dirname(DATABASE_FILE) || '.', // Ensure directory exists or is cwd
            table: 'sessions',
            concurrentDB: true // Recommended for connect-sqlite3
        }),
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            // sameSite: 'lax' // Consider for CSRF protection
        }
    }));

    initializePassport(app, getDb); // Pass the getDb function or db instance
    
    app.use('/auth', authRoutes);
    app.use('/api', apiRoutes);

    // Placeholder for serving Angular static files in production (Phase 6)
    // const angularAppPath = path.join(__dirname, 'path-to-angular-dist');
    // app.use(express.static(angularAppPath));
    // app.get('*', (req, res) => {
    //   if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) {
    //     res.sendFile(path.join(angularAppPath, 'index.html'));
    //   } else {
    //     next(); // Important to call next() if not handled
    //   }
    // });


    app.use((err, req, res, next) => {
        console.error("Unhandled error:", err);
        res.status(err.status || 500).json({
            message: err.message || 'An unexpected error occurred.',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    });

    app.listen(PORT, () => {
        console.log(`Backend server is running on http://localhost:${PORT}`);
        console.log(`Accepting requests from frontend at ${FRONTEND_URL}`);
        startDailyJob(); // Start daily job scheduler (it also awaits db internally for its startup run)
    });
}

main().catch(error => {
    console.error("Failed to start the server:", error);
    process.exit(1);
});