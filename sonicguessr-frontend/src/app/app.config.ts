// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withEnabledBlockingInitialNavigation } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http'; // Import this

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withEnabledBlockingInitialNavigation()),
    // provideClientHydration(withEventReplay()), // For SSR
    provideHttpClient(withFetch()) // Add this line to enable HttpClient with fetch
    // provideHttpClient() // Or just this if you don't want to specify withFetch yet
  ]
};