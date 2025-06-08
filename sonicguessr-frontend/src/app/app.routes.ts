// src/app/app.routes.ts
import { Routes } from '@angular/router';

// Import your existing standalone page component classes
import { Home } from './pages/home/home'; // Assuming this exists
import { DailyChallenge } from './pages/daily-challenge/daily-challenge';
import { Leaderboard } from './pages/leaderboard/leaderboard'; // Assuming this exists
import { Login } from './pages/login/login'; // Assuming this exists
import { ProfileEdit } from './pages/profile-edit/profile-edit'; // <<< IMPORT YOUR NEW COMPONENT
import { PracticeModeComponent } from './pages/practice-mode/practice-mode'; // <<< IMPORT

export const routes: Routes = [
  { path: '', component: Home, pathMatch: 'full' },
  { path: 'daily-challenge', component: DailyChallenge },
  { path: 'leaderboard', component: Leaderboard },
  { path: 'login', component: Login },
  { path: 'profile/edit', component: ProfileEdit }, // <<< ADD ROUTE FOR PROFILE EDIT
  { path: 'practice', component: PracticeModeComponent }, // <<< ADD ROUTE

  // Example of a route that might require authentication (you'd add a guard later)
  // { path: 'profile/edit', component: ProfileEdit, canActivate: [AuthGuard] }, 
  { path: '**', redirectTo: '' } // Or a 404 component
];