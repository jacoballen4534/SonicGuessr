import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import { dirname, join, resolve } from 'node:path';
import bootstrapAppFn from './main'; // Typically exports () => bootstrapApplication(App, serverConfig)
import { fileURLToPath } from 'node:url';

console.log('[SSR Server] server.ts starting...');

const browserDistFolder = join(import.meta.dirname, '../browser');
const serverDistFolder = dirname(fileURLToPath(import.meta.url));

console.log(`[SSR Server] Calculated serverDistFolder: ${serverDistFolder}`);
console.log(`[SSR Server] Calculated browserDistFolder: ${browserDistFolder}`);

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

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

/**
 * Optional: Debug middleware to see what req object Angular Engine gets
 */
app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    console.log(`[SSR Server] Request received by Angular handler: ${req.method} ${req.originalUrl}`);
    // If you had session/passport here, you could log req.user.
    // Without it, req.user won't be populated by this Express instance.
    next();
});


/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});


// app.get('*', (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
//   console.log(`[SSR Server] Attempting to render: ${req.originalUrl} with AngularNodeAppEngine.`);
//   angularApp
//     .handle(req) // Pass the Express req object
//     .then((response) => {
//       if (response) {
//         writeResponseToNodeResponse(response, res);
//       } else {
//         // If angularApp.handle doesn't produce a response (e.g. for non-GET or if it chooses not to handle)
//         next();
//       }
//     })
//     .catch((err) => {
//       console.error("[SSR Server] Error during angularApp.handle():", err);
//       next(err);
//     });
// });


/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
