// src/app/pages/daily-challenge/daily-challenge.ts
import { Component, OnInit, inject, ViewChild, AfterViewInit } from '@angular/core'; // Added ViewChild, AfterViewInit
import { CommonModule } from '@angular/common';
import { ChallengeService, GuessPayload, GuessResponse } from '../../services/challenge';
import { DailyChallengeSong } from '../../models/daily-song.model';
import { AudioPlayer } from '../../components/audio-player/audio-player'; // Assuming this is its class name
import { GuessInput } from '../../components/guess-input/guess-input'; // Adjust path
import { FeedbackDisplay } from '../../components/feedback-display/feedback-display';

const snippetLevelsData = [
  { id: 1, start: 0, end: 0.3, durationText: '0.3 seconds' },  // Level 1
  { id: 2, start: 0, end: 1, durationText: '1 seconds' },  // Level 2
  { id: 3, start: 0, end: 3, durationText: '3 seconds' }, // Level 3
  { id: 4, start: 0, end: 8, durationText: '8 seconds' },  // Level 4
  { id: 5, start: 0, end: 15, durationText: '15 seconds' },  // Level 5
  { id: 6, start: 0, end: 30, durationText: '30 seconds' },  // Level 6
];

@Component({
  selector: 'app-daily-challenge-page',
  standalone: true,
  imports: [
    CommonModule,
    AudioPlayer,
    GuessInput,
    FeedbackDisplay,
  ],
  templateUrl: './daily-challenge.html',
  styleUrls: ['./daily-challenge.scss']
})
export class DailyChallenge implements OnInit, AfterViewInit { // Implemented AfterViewInit
  
  private challengeService = inject(ChallengeService);
  dailySongs: DailyChallengeSong[] = [];
  isLoading = true;
  error: string | null = null;

  feedbackDisplay_message: string = '';
  feedbackDisplay_type: 'correct' | 'incorrect' | 'info' | null = null;
  feedbackDisplay_points: number = 0;
  feedbackDisplay_correctAnswer: { title: string, artist: string } | null = null;


  // Property to track total score for the daily challenge
  totalDailyScore: number = 0;

  // Game State for current song and snippet
  activeSong: DailyChallengeSong | null = null;
  activeSongIndex: number = -1;
  currentSnippetLevelIndex: number = 0; // Index for SNIPPET_LEVELS array
  SNIPPET_LEVELS = snippetLevelsData ;

  // Properties to bind to AudioPlayerComponent's inputs
  playbackVideoId: string | null = null;
  playbackStartSeconds: number = 0;
  playbackEndSeconds: number = 0;

  // Get a reference to the AudioPlayerComponent instance
  @ViewChild(AudioPlayer) audioPlayerRef!: AudioPlayer;

  ngOnInit(): void {
    console.log('DailyChallenge component initialized, fetching songs...');
    this.challengeService.getDailySongs().subscribe({
      next: (songs) => {
        this.dailySongs = songs;
        this.isLoading = false;
        console.log('Daily songs fetched:', this.dailySongs);
        if (this.dailySongs.length > 0) {
          this.startChallengeWithFirstSong(); // Or wait for user action
        }
      },
      error: (err) => {
        console.error('Error fetching daily songs:', err);
        this.error = 'Failed to load songs. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    // The audioPlayerRef will be available here
    // You can log it to ensure it's being picked up:
    // console.log('Audio Player Ref:', this.audioPlayerRef);
  }

  startChallengeWithFirstSong(): void {
    this.setActiveSong(0);
  }

  setActiveSong(index: number): void {
    if (this.dailySongs && index >= 0 && index < this.dailySongs.length) {
      this.activeSongIndex = index;
      this.activeSong = this.dailySongs[index];
      this.currentSnippetLevelIndex = 0; // Reset to the first snippet level for a new song
      this.playCurrentSnippet();
    } else {
      console.warn('Attempted to set invalid active song index:', index);
      this.activeSong = null;
      this.playbackVideoId = null; // Clear playback if song is invalid
    }
  }

  handleUserGuess(guess: string): void {
    if (!this.activeSong) {
      this.feedbackDisplay_message = "Error: No active song selected to guess against.";
      this.feedbackDisplay_type = 'incorrect';
      console.error("handleUserGuess called with no active song.");
      return;
    }

    this.feedbackDisplay_message = 'Submitting your guess...';
    this.feedbackDisplay_type = 'info';
    this.feedbackDisplay_points = 0;
    this.feedbackDisplay_correctAnswer = null;

    const payload: GuessPayload = {
      daily_challenge_song_id: this.activeSong.id,
      guess: guess,
      currentLevel: this.currentSnippetLevelIndex + 1 // Assuming backend expects 1-based
    };

    console.log('Submitting guess with payload:', payload);

    this.challengeService.submitGuess(payload).subscribe({
      next: (response: GuessResponse) => {
        console.log('Backend Guess Response FULL:', JSON.stringify(response, null, 2));
        this.feedbackDisplay_message = response.message; // Initial message from backend

        if (response.correct) {
          this.feedbackDisplay_type = 'correct';
          this.feedbackDisplay_points = response.pointsAwarded || 0;
          this.totalDailyScore += this.feedbackDisplay_points;
          
          console.log(`Correct! You scored ${this.feedbackDisplay_points}. Total score: ${this.totalDailyScore}`);
          
          setTimeout(() => {
            this.feedbackDisplay_message = `Correct! "${response.songTitle || this.activeSong?.title}". Moving to the next song...`;
            this.nextSong();
          }, 2500); // Delay before moving to next song

        } else { // Incorrect guess
          this.feedbackDisplay_type = 'incorrect';
          
          if (response.gameOverForSong) {
            // Backend says game over for this song (e.g., max attempts reached server-side)
            this.feedbackDisplay_correctAnswer = { title: response.songTitle!, artist: response.artist! };
            this.feedbackDisplay_message = response.message; // Use backend's game over message
            console.log(`Incorrect. Game over for this song (from backend). It was: ${response.songTitle}`);
            setTimeout(() => {
              this.nextSong();
            }, 4000);
          } else { 
            // Incorrect, but backend implies more attempts might be possible (e.g., response.nextLevel is present)
            // Now, check if we have more snippet levels defined on the client-side.
            if (this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
              this.feedbackDisplay_message = response.message + " Playing a longer snippet..."; // Update feedback
              console.log('Incorrect guess. Automatically playing next snippet level.');
              // Optional: short delay for user to read feedback before new snippet plays
              setTimeout(() => {
                this.playNextSnippetLevel(); // This method increments level and plays
              }, 1500); // 1.5 second delay, adjust as needed
            } else {
              // Client-side has no more defined snippet levels, even if backend didn't explicitly say "gameOverForSong"
              // Treat as game over for this song from client's perspective.
              console.log('Incorrect guess: No more client-side snippet levels. Treating as game over for song.');
              this.feedbackDisplay_correctAnswer = this.activeSong ? { title: this.activeSong.title, artist: this.activeSong.artist } : null;
              this.feedbackDisplay_message = response.message + ` The song was: ${this.activeSong?.title || 'Unknown'}. Moving to the next song...`;
              setTimeout(() => {
                this.nextSong();
              }, 4000);
            }
          }
        }
      },
      error: (err) => {
        console.error('Error submitting guess:', err);
        this.feedbackDisplay_type = 'incorrect';
        this.feedbackDisplay_points = 0;
        this.feedbackDisplay_correctAnswer = null;
        this.feedbackDisplay_message = err.error?.message || 'An error occurred while submitting your guess. Please try again.';
        if (err.status === 401) {
            this.feedbackDisplay_message = "You need to be logged in to submit a guess. Please log in.";
        }
      }
    });
  }

  playNextSnippetLevel(): void {
    if (!this.activeSong) {
      console.warn('No active song to play next snippet level for.');
      this.feedbackDisplay_message = 'No active song.'; // Update feedback
      this.feedbackDisplay_type = 'incorrect';
      return;
    }
    // Use 'this.SNIPPET_LEVELS'
    if (this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++;
      this.feedbackDisplay_message = `Playing snippet level ${this.currentSnippetLevelIndex + 1}...`; // Update feedback
      this.feedbackDisplay_type = 'info';
      this.playCurrentSnippet(); // This will play the new currentSnippetLevelIndex
    } else {
      // This case means the user tried to play next snippet but was already at the last one.
      // The handleUserGuess logic should ideally prevent reaching here if it treats last level fail as game over.
      // But if called directly (e.g. from a button that wasn't disabled), provide feedback.
      this.feedbackDisplay_message = `You're already at the last snippet level for "${this.activeSong.title}"!`;
      this.feedbackDisplay_type = 'info';
      console.log('Already at the last snippet level (client-side check in playNextSnippetLevel).');
      // You might want to re-play the current (last) snippet if they click a button, or do nothing.
      // For now, just a message. The game over logic is primarily in handleUserGuess.
    }
  }

  // Ensure your nextSong method is also using the `feedbackDisplay_` prefixed variables
  // and resets relevant states for the new song.
  nextSong(): void {
    // Reset feedback state for the new song
    this.feedbackDisplay_message = '';
    this.feedbackDisplay_type = null;
    this.feedbackDisplay_points = 0;
    this.feedbackDisplay_correctAnswer = null;
  
    if (this.activeSongIndex < this.dailySongs.length - 1) {
      this.setActiveSong(this.activeSongIndex + 1); // This will set new activeSong, reset snippetLevelIndex, and call playCurrentSnippet
    } else {
      console.log('End of daily challenge songs.');
      this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
      this.feedbackDisplay_type = 'info'; 
      this.activeSong = null; 
      this.playbackVideoId = null; 
      // Maybe also clear currentSnippetLevelIndex or set activeSongIndex to an invalid state
      this.currentSnippetLevelIndex = 0; 
      this.activeSongIndex = -1; // Or some indicator that challenge is over
    }
  }
  
    skipToNextSnippet(): void {
    if (!this.activeSong) {
      this.feedbackDisplay_message = 'No active song to skip snippet for.';
      this.feedbackDisplay_type = 'info';
      console.warn('Skip action: No active song.');
      return;
    }

    // Check if there's a next snippet level available based on client-side SNIPPET_LEVELS
    if (this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++; // Advance to the next snippet level

      // Update feedback and play the new current snippet
      this.feedbackDisplay_message = `Playing next snippet (level ${this.currentSnippetLevelIndex + 1}: ${this.SNIPPET_LEVELS[this.currentSnippetLevelIndex].durationText})...`;
      this.feedbackDisplay_type = 'info';
      this.feedbackDisplay_points = 0; // No points for skipping
      this.feedbackDisplay_correctAnswer = null; // Clear any previous correct answer display

      console.log(`User skipped to snippet level <span class="math-inline">\{this\.currentSnippetLevelIndex \+ 1\} for song "</span>{this.activeSong.title}"`);
      this.playCurrentSnippet(); // This method already sets up and plays the current level
    } else {
      this.feedbackDisplay_message = 'You are already at the longest snippet for this song!';
      this.feedbackDisplay_type = 'info';
      console.log('Skip action: Already at the last snippet level.');
    }
  }


  playCurrentSnippet(): void {
    if (this.activeSong && this.SNIPPET_LEVELS[this.currentSnippetLevelIndex]) {
      const levelConfig = this.SNIPPET_LEVELS[this.currentSnippetLevelIndex];
      
      this.playbackVideoId = this.activeSong.youtube_video_id;
      this.playbackStartSeconds = levelConfig.start;
      this.playbackEndSeconds = levelConfig.end;
      
      console.log(`Setting up to play snippet for "${this.activeSong.title}", Level ${levelConfig.id} (${levelConfig.durationText})`);
      console.log(`VideoID: ${this.playbackVideoId}, Start: ${this.playbackStartSeconds}, End: ${this.playbackEndSeconds}`);

      // The <app-audio-player> in the template will get these new input values.
      // Its ngOnChanges should handle loading/re-loading the video.
      // To explicitly tell the player to play after inputs are set (if ngOnChanges doesn't auto-play):
      // We need to ensure audioPlayerRef is initialized and player is ready.
      // A slight delay might be needed for inputs to propagate if not using a more reactive approach.
      setTimeout(() => {
        if (this.audioPlayerRef) {
          this.audioPlayerRef.playSnippet(); 
        } else {
          console.error('AudioPlayer reference not available to play snippet.');
        }
      }, 0);

    } else {
      console.warn('No active song or current snippet level configuration to play.');
      this.playbackVideoId = null;
    }
  }
}