import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig as clientAppConfig } from './app.config'; // Your existing client-side application config from src/app/app.config.ts

// Import provideClientHydration, and withEventReplay if you use it on the client
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

// Define server-specific providers
const serverSpecificProviders: ApplicationConfig = {
  providers: [
    provideServerRendering(), // Essential for SSR
    provideClientHydration(withEventReplay()) // For enabling hydration features on the server render
    // If you don't use withEventReplay() on the client, you can just use provideClientHydration()
    
    // You can add other server-only providers here if your application needs them
  ]
};

// Merge the client application config with the server-specific providers
export const config: ApplicationConfig = mergeApplicationConfig(clientAppConfig, serverSpecificProviders);