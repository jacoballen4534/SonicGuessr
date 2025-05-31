// src/server.ts (Angular Frontend SSR Server - Simplified)
import {
  AngularNodeAppEngine,
  CommonEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrapServerApp from './main'; // This path points to your server-side main Angular bootstrap

import { REQUEST, RESPONSE } from './express.token'; // <<<< ADJUST PATH if tokens.ts is elsewhere

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html'); // Usually index.server.html for SSR


const app = express();

// Initialize Angular App Engine
const angularApp = new AngularNodeAppEngine();
// const commonEngine = new CommonEngine();

// No express-session or passport middleware here directly for the SSR server's own session handling.
// The API backend (server.js) handles that.

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// app.get('*.*', express.static(browserDistFolder, { maxAge: '1y', index: false }));

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  // Log incoming request to SSR server for debugging if needed
  console.log(`[SSR Server - Before Angular Handle] Path: ${req.originalUrl}, IsAuth: ${req.isAuthenticated ? req.isAuthenticated() : 'N/A'}, UserID: ${req.user ? (req.user as any).id : 'None'}`);
  console.log(`[SSR Server] Incoming request for: ${req.originalUrl}`);
  console.log(`[SSR Server] Cookies received by SSR server: ${req.headers.cookie || 'None'}`);

  angularApp
    .handle(req) // Pass the original Express req; AngularNodeAppEngine handles it
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);

});

// app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
//   const { protocol, originalUrl, baseUrl, headers } = req; // Common way to reconstruct URL for engine

//   commonEngine
//     .render({
//       bootstrap: bootstrapServerApp, // Your Angular server bootstrap
//       documentFilePath: indexHtml,   // Path to your index.server.html
//       url: `${protocol}://${headers.host}${originalUrl}`, // URL for Angular to render
//       publicPath: browserDistFolder,
//       providers: [ // <<< THIS IS THE KEY PART: PROVIDE YOUR TOKENS
//         { provide: REQUEST, useValue: req },
//         { provide: RESPONSE, useValue: res },
//       ],
//     })
//     .then((html) => res.send(html))
//     .catch((err) => {
//       console.error("[SSR Server] CommonEngine render error:", err);
//       next(err);
//     });
// });


/**
 * Start the server if this module is the main entry point.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000; // Angular SSR typically runs on its own port
  app.listen(port, () => {
    console.log(`Node Express server (Angular SSR) listening on http://localhost:${port}`);
  });
}

/**
 * Request handler
 */
export const reqHandler = createNodeRequestHandler(app);