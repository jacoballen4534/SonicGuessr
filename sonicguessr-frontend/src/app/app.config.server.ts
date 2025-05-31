// src/app/app.config.server.ts
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config'; // Your existing client-side application config

// Merge the client app config with server-specific providers
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    // You can add other server-specific providers here if needed
    // For example, providers for your SERVER_REQUEST_TOKEN if you are not doing it in server.ts render options
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);