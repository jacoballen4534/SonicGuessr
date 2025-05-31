// src/app/services/challenge.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DailyChallengeSong } from '../models/daily-song.model';
import { environment } from '../../environments/environment';

// Interface for the guess payload
export interface GuessPayload {
  daily_challenge_song_id: number; // This is the 'id' from the 'daily_challenges' table
  guess: string;
  currentLevel: number; // Represents the attempt number or snippet level (e.g., 0 for first snippet, 1 for second)
}

// Interface for the expected response from the backend guess endpoint
export interface GuessResponse {
  correct: boolean;
  songTitle?: string; // Sent if correct or game over for song
  artist?: string;    // Sent if correct or game over for song
  message: string;
  pointsAwarded?: number;
  nextLevel?: number;        // If incorrect, but more attempts available
  gameOverForSong?: boolean; // If incorrect and no more attempts
}

// Add interface for Leaderboard Entry
export interface LeaderboardEntry {
  user_id: number; // From u.id
  username: string | null;
  display_name: string;
  total_score: number;
  rank: number; // From RANK()
}

export interface LeaderboardResponse {
  topEntries: LeaderboardEntry[];
  currentUserEntry: LeaderboardEntry | null;
}

@Injectable({
  providedIn: 'root'
})
export class ChallengeService {
  private songsApiUrl = `${environment.apiBaseUrl}/daily-challenge/songs`;
  private guessApiUrl = `${environment.apiBaseUrl}/daily-challenge/guess`; // New API URL
  private leaderboardApiUrl = `${environment.apiBaseUrl}/leaderboard/daily`; // New API URL

  constructor(private http: HttpClient) { }

  getDailySongs(): Observable<DailyChallengeSong[]> {
    return this.http.get<DailyChallengeSong[]>(this.songsApiUrl);
  }

  // New method to submit a guess
  submitGuess(payload: GuessPayload): Observable<GuessResponse> {
    return this.http.post<GuessResponse>(this.guessApiUrl, payload, {
      withCredentials: true // Important if your backend uses session-based authentication
    });
  }

    // New method to fetch daily leaderboard
  getDailyLeaderboard(): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(this.leaderboardApiUrl, {
      withCredentials: true // <<< ENSURE THIS OPTION IS PRESENT AND TRUE
    });
  }
}