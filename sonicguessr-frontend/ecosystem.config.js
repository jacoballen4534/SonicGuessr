// <ANGULAR_PROJECT_ROOT>/ecosystem.config.js
// Example: /var/www/sonicguessr-frontend/ecosystem.config.js
const path = require('path');

module.exports = {
  apps : [{
    name   : "sonicguessr-ssr-frontend",
    script : "server.mjs", // The script name to run
    cwd    : path.join(__dirname, "dist/sonicguessr-frontend/server/"), // Set CWD to where main.mjs is located
                                                                      // __dirname will be the project root where this ecosystem file is.
    args   : "", // Any arguments to pass to main.mjs, if needed
    interpreter: "node", // Specify Node.js interpreter
    watch  : false,      // Set to true or specific paths if you want PM2 to auto-restart on file changes (more for dev)
    env_production: {    // Environment variables for production mode
       NODE_ENV: "production",
       PORT: 4000,       // Port for the Angular SSR server to listen on
       // Example: If your AuthService running on SSR needs to know the API backend URL:
       API_BACKEND_URL_FOR_SSR: "http://localhost:3000" // Assuming API runs on port 3000 on the same Pi
                                                       // This would be used by environment.ts on server-side if configured
    }
  }]
};
