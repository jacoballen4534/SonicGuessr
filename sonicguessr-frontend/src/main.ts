// src/main.ts

import { ApplicationRef } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app'; // Ensure this path and class name are correct
import { appConfig } from './app/app.config'; // Ensure this path is correct
import { config as serverAppConfig } from './app/app.config.server'; // <<< This imports the 'config' you just defined

// Define a function that performs the bootstrap and returns the Promise<ApplicationRef>
// This function will be our default export for the server, and can also be called on the client.
const bootstrap = (): Promise<ApplicationRef> => {
  return bootstrapApplication(App, serverAppConfig)
    .then(appRef => {
      // Optional: expose appRef for debugging in the browser console
      if (typeof window !== 'undefined') {
        (window as any).ngAppRef = appRef;
      }
      return appRef; // Return the ApplicationRef for the server if it needs it
    })
    .catch(err => {
      console.error(err); // Log the actual error object
      throw err; // Re-throw the error so the promise is properly rejected
    });
};

// Export the bootstrap function as the default export
// This is what `angular:main-server` is likely expecting.
export default bootstrap;

// To ensure this bootstrap logic runs on the client side for your current development and testing:
// (The server-side rendering process will call the default exported 'bootstrap' function itself.
// This check ensures it also runs if this main.ts is the direct entry for the browser.)
if (typeof window !== 'undefined' && // Are we in a browser environment?
    document.readyState === 'loading') { // A simple check to run it early
    document.addEventListener('DOMContentLoaded', bootstrap);
} else if (typeof window !== 'undefined') {
    // If DOM is already loaded or it's a non-SSR direct browser scenario
    bootstrap();
}