// src/app/pages/daily-challenge/daily-challenge.ts
import { Component, OnInit, inject } from '@angular/core'; // Import inject
import { CommonModule } from '@angular/common'; // Import CommonModule for *ngFor, etc.
import { ChallengeService } from '../../services/challenge'; // Adjust path
import { DailyChallengeSong } from '../../models/daily-song.model'; // Adjust path

@Component({
  selector: 'app-daily-challenge-page', // Or your chosen selector
  standalone: true,
  imports: [
    CommonModule // Add CommonModule for *ngIf, *ngFor, async pipe etc.
  ],
  templateUrl: './daily-challenge.html', // Your template file
  styleUrls: ['./daily-challenge.scss']  // Your style file
})
export class DailyChallenge implements OnInit { // Assuming class name is DailyChallenge
  
  private challengeService = inject(ChallengeService); // Modern way to inject
  dailySongs: DailyChallengeSong[] = [];
  isLoading = true;
  error: string | null = null;

  // Or traditional constructor injection:
  // constructor(private challengeService: ChallengeService) {}

  ngOnInit(): void {
    console.log('DailyChallenge component initialized, fetching songs...');
    this.challengeService.getDailySongs().subscribe({
      next: (songs) => {
        this.dailySongs = songs;
        this.isLoading = false;
        console.log('Daily songs fetched:', this.dailySongs);
      },
      error: (err) => {
        console.error('Error fetching daily songs:', err);
        this.error = 'Failed to load songs. Please try again later.';
        this.isLoading = false;
      }
    });
  }
}