// src/app/pages/leaderboard/leaderboard.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChallengeService, LeaderboardEntry } from '../../services/challenge'; // Adjust path

@Component({
  selector: 'app-leaderboard-page',
  standalone: true,
  imports: [CommonModule], // For *ngFor, *ngIf
  templateUrl: './leaderboard.html',
  styleUrls: ['./leaderboard.scss']
})
export class Leaderboard implements OnInit { // Assuming class name is Leaderboard
  private challengeService = inject(ChallengeService);

  leaderboardEntries: LeaderboardEntry[] = [];
  isLoading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.isLoading = true;
    this.error = null;
    this.challengeService.getDailyLeaderboard().subscribe({
      next: (data) => {
        this.leaderboardEntries = data;
        this.isLoading = false;
        console.log('Leaderboard data fetched:', data);
      },
      error: (err) => {
        console.error('Error fetching leaderboard:', err);
        this.error = 'Failed to load leaderboard. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  // Helper to display name (prefers custom username, falls back to Google display_name)
  getPlayerDisplayName(entry: LeaderboardEntry): string {
    return entry.username || entry.display_name;
  }
}