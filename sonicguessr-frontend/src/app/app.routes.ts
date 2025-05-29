// Example: src/app/app.routes.ts
import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { DailyChallenge } from './pages/daily-challenge/daily-challenge';
import { Leaderboard } from './pages/leaderboard/leaderboard';
import { Login } from './pages/login/login';

export const routes: Routes = [
  { path: '', component: Home, pathMatch: 'full' },
  { path: 'daily-challenge', component: DailyChallenge },
  { path: 'leaderboard', component: Leaderboard },
  { path: 'login', component: Login },
  { path: '**', redirectTo: '' } // Or a 404 component
];