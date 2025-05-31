// src/app/pages/leaderboard/leaderboard.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChallengeService, LeaderboardEntry, LeaderboardResponse } from '../../services/challenge'; // Import new types
import { AuthService, User } from '../../services/auth'; // Import AuthService & User
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-leaderboard-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './leaderboard.html',
  styleUrls: ['./leaderboard.scss']
})
export class Leaderboard implements OnInit {
  private challengeService = inject(ChallengeService);
  private authService = inject(AuthService); // Inject AuthService

  topEntries: LeaderboardEntry[] = [];
  currentUserEntry: LeaderboardEntry | null = null;
  loggedInUser: User | null = null; // Store logged-in user details

  isLoading = true;
  error: string | null = null;
  private userSubscription!: Subscription;


  ngOnInit(): void {
    this.userSubscription = this.authService.currentUser$.subscribe(user => {
      this.loggedInUser = user;
      // Fetch leaderboard data after we know who the user is (or if they are null)
      this.fetchLeaderboard(); 
    });
  }

  fetchLeaderboard(): void {
    this.isLoading = true;
    this.error = null;
    this.challengeService.getDailyLeaderboard().subscribe({
      next: (response: LeaderboardResponse) => {
        this.topEntries = response.topEntries;
        this.currentUserEntry = response.currentUserEntry;
        this.isLoading = false;
        console.log('Leaderboard response fetched:', response);
      },
      error: (err) => {
        console.error('Error fetching leaderboard:', err);
        this.error = 'Failed to load leaderboard. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  getPlayerDisplayName(entry: LeaderboardEntry): string {
    return entry.username || entry.display_name;
  }

  isCurrentUser(entryUserId: number): boolean {
    return !!this.loggedInUser && this.loggedInUser.id === entryUserId;
  }

  // Check if current user is in the top 10 list already
  isCurrentUserInTopTen(): boolean {
    if (!this.loggedInUser || !this.topEntries || !this.currentUserEntry) return false;
    // currentUserEntry from backend will be one of the topEntries if they are in top 10
    // Or, more simply, if currentUserEntry exists and its rank <= 10 (and it's not null)
    return this.topEntries.some(entry => entry.user_id === this.loggedInUser!.id);
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}