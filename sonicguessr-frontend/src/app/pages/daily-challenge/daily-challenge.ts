// src/app/pages/daily-challenge/daily-challenge.ts
import { Component, OnInit, inject, ViewChild, AfterViewInit } from '@angular/core'; // Added ViewChild, AfterViewInit
import { CommonModule } from '@angular/common';
import { ChallengeService, GuessPayload, GuessResponse } from '../../services/challenge';
import { DailyChallengeSong } from '../../models/daily-song.model';
import { AudioPlayer } from '../../components/audio-player/audio-player'; // Assuming this is its class name
import { GuessInput } from '../../components/guess-input/guess-input'; // Adjust path

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
  ],
  templateUrl: './daily-challenge.html',
  styleUrls: ['./daily-challenge.scss']
})
export class DailyChallenge implements OnInit, AfterViewInit { // Implemented AfterViewInit
  
  private challengeService = inject(ChallengeService);
  dailySongs: DailyChallengeSong[] = [];
  isLoading = true;
  error: string | null = null;

  lastGuessResult: string = ''; // To display feedback
  feedbackMessage: string = ''; // More structured feedback
  isGuessCorrect: boolean | null = null;
  pointsScoredThisGuess: number = 0;

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
      console.error("No active song to guess against.");
      this.feedbackMessage = "Error: No active song selected.";
      return;
    }

    console.log(`DailyChallengeComponent: Received guess: "<span class="math-inline">\{guess\}" for song\: "</span>{this.activeSong.title}" at level ${this.currentSnippetLevelIndex}`);
    this.feedbackMessage = ''; // Clear previous feedback
    this.isGuessCorrect = null;
    this.pointsScoredThisGuess = 0;

    const payload: GuessPayload = {
      daily_challenge_song_id: this.activeSong.id, // Ensure your DailyChallengeSong interface has the 'id' from the DB
      guess: guess,
      currentLevel: this.currentSnippetLevelIndex + 1 // Backend might expect 1-based level
    };

    this.challengeService.submitGuess(payload).subscribe({
      next: (response: GuessResponse) => {
        console.log('Guess response from backend:', response);
        this.feedbackMessage = response.message;

        if (response.correct) {
          this.isGuessCorrect = true;
          this.pointsScoredThisGuess = response.pointsAwarded || 0;
          // TODO: Update total score
          alert(`Correct! ${response.message} You scored ${response.pointsAwarded} points.`);
          // Optionally, wait a bit before moving to the next song to show feedback
          setTimeout(() => {
            this.nextSong();
          }, 2000); // Move to next song after 2 seconds
        } else {
          this.isGuessCorrect = false;
          if (response.gameOverForSong) {
            // TODO: Show correct answer (response.songTitle, response.artist)
            alert(`Incorrect. Game over for this song. The song was: ${response.songTitle} by ${response.artist}.`);
            // Optionally, wait a bit
            setTimeout(() => {
              this.nextSong();
            }, 3000);
          } else if (response.nextLevel) {
            // The backend implies a nextLevel, but our snippet levels are client-driven by SNIPPET_LEVELS.
            // We can use this to decide if we should offer to play the next snippet level.
            // Or, the backend's currentLevel could be the number of attempts.
            // For now, let's allow playing next snippet if available.
            alert(`Incorrect. ${response.message}`);
            // We can enable a "Play Next Snippet" button or automatically play it if desired.
            // The `playNextSnippetLevel()` method already handles checking bounds.
          }
        }
      },
      error: (err) => {
        console.error('Error submitting guess:', err);
        this.feedbackMessage = err.error?.message || 'Failed to submit guess. Please check your connection or try again.';
         if (err.status === 401) { // Unauthorized
            this.feedbackMessage = "You need to be logged in to submit a guess. Please log in.";
            // TODO: Redirect to login or show login prompt
        }
      }
    });
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

  playNextSnippetLevel(): void {
    if (!this.activeSong) {
      console.warn('No active song to play next snippet level for.');
      return;
    }
    if (this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++;
      this.playCurrentSnippet();
    } else {
      console.log('Already at the last snippet level for this song.');
      // Here you might reveal the song or handle "no more attempts" for this song.
      alert(`No more snippets! The song was: ${this.activeSong.title} by ${this.activeSong.artist}`);
    }
  }

  // Call this method to move to the next song in the challenge
  nextSong(): void {
    if (this.activeSongIndex < this.dailySongs.length - 1) {
      this.setActiveSong(this.activeSongIndex + 1);
    } else {
      console.log('End of daily challenge songs.');
      alert('You have completed all songs for today!');
      this.activeSong = null; // Clear active song
      this.playbackVideoId = null;
    }
  }
}