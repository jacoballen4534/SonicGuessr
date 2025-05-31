// src/app/pages/daily-challenge/daily-challenge.ts
import { Component, OnInit, inject, ViewChild, AfterViewInit, PLATFORM_ID } from '@angular/core'; // Added ViewChild, AfterViewInit
import { CommonModule, isPlatformBrowser } from '@angular/common';
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

const STORAGE_KEY_PREFIX = 'sonicGuessrDailyState_';

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
  private proceedToNextSongOnLoad: boolean = false; // New flag

  feedbackDisplay_message: string = '';
  feedbackDisplay_type: 'correct' | 'incorrect' | 'info' | null = null;
  feedbackDisplay_points: number = 0;
  feedbackDisplay_correctAnswer: { title: string, artist: string } | null = null;
  private todayDateString: string = ''; // To store YYYY-MM-DD


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

  private platformId = inject(PLATFORM_ID); // Inject PLATFORM_ID using inject()

  getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    this.todayDateString = this.getTodayDateString()
    console.log('DailyChallenge component initialized, fetching songs...');
    this.challengeService.getDailySongs().subscribe({
      next: (songs) => {
        this.dailySongs = songs;
        this.isLoading = false;
        console.log('Daily songs fetched:', this.dailySongs);
        if (this.dailySongs.length > 0) {
          this.loadGameStateOrDefault(); // Load saved state or start fresh
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

  private getStorageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this.todayDateString}`;
  }

  private loadGameStateOrDefault(): void {
    if (!isPlatformBrowser(this.platformId)) return; // Ensure save only on browser

    const savedStateString = localStorage.getItem(this.getStorageKey());
    if (savedStateString) {
      try {
        const savedState = JSON.parse(savedStateString);
        // Basic validation: ensure it has expected properties
        if (savedState && typeof savedState.activeSongIndex === 'number' &&
            typeof savedState.currentSnippetLevelIndex === 'number' &&
            typeof savedState.totalDailyScore === 'number') {
                
          this.activeSongIndex = savedState.activeSongIndex;
          this.currentSnippetLevelIndex = savedState.currentSnippetLevelIndex || 0;
          this.totalDailyScore = savedState.totalDailyScore || 0;
          this.proceedToNextSongOnLoad = savedState.proceedToNextSongOnLoad || false; // <<< LOAD THE FLAG

          console.log('Loaded game state:', savedState);

          if (this.proceedToNextSongOnLoad) {
            console.log('Proceeding to next song due to saved flag.');
            this.proceedToNextSongOnLoad = false; // Reset flag for current session
            // Save state immediately to persist the reset flag, before nextSong might save again
            this.saveGameState(); 
            this.nextSong(); // Call nextSong to handle the transition
          } else if (this.activeSongIndex === -1 && this.dailySongs.length > 0) { 
            // Indicates challenge was previously completed fully
            this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
            this.feedbackDisplay_type = 'info';
            this.activeSong = null;
            this.playbackVideoId = null;
          } else if (this.dailySongs && this.activeSongIndex >= 0 && this.activeSongIndex < this.dailySongs.length) {
            this.activeSong = this.dailySongs[this.activeSongIndex];
            this.playCurrentSnippet(); // This will use the loaded currentSnippetLevelIndex & save state
          } else {
            this.startChallengeWithFirstSong(); // Fallback
          }
          return; // Exit after loading saved state
        } else {
          console.warn('Invalid saved game state structure found. Starting fresh.');
          localStorage.removeItem(this.getStorageKey()); // Clear invalid state
        }
      } catch (e) {
        console.error('Error parsing saved game state. Starting fresh.', e);
        localStorage.removeItem(this.getStorageKey()); // Clear corrupted state
      }
    }
    // No valid saved state, start fresh with the first song
    this.startChallengeWithFirstSong();
  }

  private saveGameState(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Logic to clear storage if challenge is truly complete
    if (this.dailySongs.length > 0 && this.activeSong === null && 
        this.activeSongIndex === -1 && /* some condition indicating all songs done */
        this.feedbackDisplay_message.includes("completed all songs")) {
      console.log('Challenge fully completed, clearing saved game state.');
      localStorage.removeItem(this.getStorageKey());
      return;
    }

    const stateToSave = {
      activeSongIndex: this.activeSongIndex,
      currentSnippetLevelIndex: this.currentSnippetLevelIndex,
      totalDailyScore: this.totalDailyScore,
      proceedToNextSongOnLoad: this.proceedToNextSongOnLoad // <<< SAVE THE FLAG
      // Potentially save feedback messages if they should persist briefly after reload
    };
    console.log('Saving game state:', stateToSave, 'for key:', this.getStorageKey());
    localStorage.setItem(this.getStorageKey(), JSON.stringify(stateToSave));
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
      this.feedbackDisplay_message = "Error: No active song selected.";
      this.feedbackDisplay_type = 'incorrect';
      return;
    }

    this.feedbackDisplay_message = 'Submitting guess...';
    this.feedbackDisplay_type = 'info';
    this.feedbackDisplay_points = 0;
    this.feedbackDisplay_correctAnswer = null;

    const payload: GuessPayload = {
      daily_challenge_song_id: this.activeSong.id,
      guess: guess,
      currentLevel: this.currentSnippetLevelIndex + 1
    };

    this.challengeService.submitGuess(payload).subscribe({
      next: (response: GuessResponse) => {
        this.feedbackDisplay_message = response.message;
        let songIsOver = false; // Flag to determine if current song is ending

        if (response.correct) {
          this.feedbackDisplay_type = 'correct';
          this.feedbackDisplay_points = response.pointsAwarded || 0;
          this.totalDailyScore += this.feedbackDisplay_points;
          songIsOver = true;
        } else { // Incorrect guess
          this.feedbackDisplay_type = 'incorrect';
          if (response.gameOverForSong || (this.currentSnippetLevelIndex >= this.SNIPPET_LEVELS.length - 1)) {
            songIsOver = true;
            this.feedbackDisplay_correctAnswer = { 
              title: response.songTitle || this.activeSong?.title || 'Unknown', 
              artist: response.artist || this.activeSong?.artist || 'Unknown' 
            };
            if (!response.gameOverForSong) { // Client determined game over
                this.feedbackDisplay_message = response.message + ` That was the last snippet. The song was: ${this.activeSong?.title || 'Unknown'}.`;
            }
          } else { // Incorrect, but more snippet levels are available
            this.feedbackDisplay_message = response.message + " Preparing next snippet...";
            if (this.advanceToNextSnippetLevel()) { // Advances index
              this.saveGameState(); // Save new snippet level
              setTimeout(() => { this.playCurrentSnippet(); }, 1500);
            } else { 
              // Should not happen if advanceToNextSnippetLevel logic is sound with outer check
              // but as a fallback, treat as game over.
              songIsOver = true; 
              this.feedbackDisplay_message = "No more snippets. Game over for this song.";
            }
          }
        }

        // If the song is determined to be over (correct guess or game over from incorrect)
        if (songIsOver) {
          this.proceedToNextSongOnLoad = true; // <<< SET FLAG
          this.saveGameState();                // <<< SAVE STATE (with flag and final score for this song)

          const delay = response.correct ? 2500 : 4000;
          setTimeout(() => {
            // this.proceedToNextSongOnLoad = false; // Reset before calling nextSong
            // this.saveGameState(); // Save the reset flag
            // No, nextSong() itself should handle resetting this flag for the *new* state it establishes
            this.nextSong();
          }, delay);
        }
        // If !songIsOver and it was an incorrect guess with next snippet, that path already saved and has its own timeout
      },
      error: (err) => {
        this.feedbackDisplay_type = 'incorrect';
        this.feedbackDisplay_message = err.error?.message || 'Failed to submit guess.';
        // Potentially save state here if relevant, e.g., an attempt was made.
        // For now, just showing error.
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

  // (getStorageKey, loadGameStateOrDefault, nextSong, etc. remain crucial)
  // Ensure nextSong also calls saveGameState or appropriately clears it when challenge is over.
  nextSong(): void {
    this.proceedToNextSongOnLoad = false; // <<< RESET FLAG for the state of the upcoming song

    // Reset other feedback for the new song attempt
    this.feedbackDisplay_message = '';
    this.feedbackDisplay_type = null;
    this.feedbackDisplay_points = 0;
    this.feedbackDisplay_correctAnswer = null;

    let nextSongFound = false;
    if (this.activeSongIndex < this.dailySongs.length - 1) {
      this.setActiveSong(this.activeSongIndex + 1); // This calls playCurrentSnippet -> saveGameState
      nextSongFound = true;
    } else {
      // All songs completed
      console.log('End of daily challenge songs.');
      this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
      this.feedbackDisplay_type = 'info'; 
      this.activeSong = null; 
      this.activeSongIndex = -1; // Indicate challenge is done
      this.currentSnippetLevelIndex = 0;
      this.playbackVideoId = null; 
      // Final save, which might include proceedToNextSongOnLoad: false and activeSongIndex: -1
      // Or, the saveGameState has logic to clear storage upon true completion.
      this.saveGameState(); 
    }
  }

  skipToNextSnippet(): void {
    if (!this.activeSong) {
      this.feedbackDisplay_message = 'No active song to skip snippet for.';
      this.feedbackDisplay_type = 'info';
      return;
    }
    if (this.advanceToNextSnippetLevel()) { // Advances index
      this.feedbackDisplay_message = `Playing snippet level ${this.currentSnippetLevelIndex + 1} (${this.SNIPPET_LEVELS[this.currentSnippetLevelIndex].durationText})...`;
      this.feedbackDisplay_type = 'info';
      // playCurrentSnippet will be called, which saves state.
      // No, playCurrentSnippet is NOT automatically called by advanceToNextSnippetLevel anymore.
      this.playCurrentSnippet(); // Explicitly call to play and save the new state
    } else {
      this.feedbackDisplay_message = 'You are already at the longest snippet for this song!';
      this.feedbackDisplay_type = 'info';
    }
  }

  // playNextSnippetLevel is now primarily for explicit UI calls if needed, or can be removed if skip and auto-advance cover all cases.
  // For auto-advance after wrong guess, we now use advanceToNextSnippetLevel() then playCurrentSnippet().
  // If you still want a button for "Play Next Snippet", it can call this:
  triggerPlayNextSnippetLevelButton(): void {
      if(this.advanceToNextSnippetLevel()){
          this.playCurrentSnippet();
      } else {
          this.feedbackDisplay_message = 'Already at the last snippet level!';
          this.feedbackDisplay_type = 'info';
      }
  }

  playCurrentSnippet(): void {
    if (this.activeSong && this.SNIPPET_LEVELS[this.currentSnippetLevelIndex]) {
      const levelConfig = this.SNIPPET_LEVELS[this.currentSnippetLevelIndex];
      
      this.playbackVideoId = this.activeSong.youtube_video_id;
      this.playbackStartSeconds = levelConfig.start;
      this.playbackEndSeconds = levelConfig.end;
      
      console.log(`Prepared to play snippet for "${this.activeSong.title}", Level ${levelConfig.id} (${levelConfig.durationText})`);

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
      this.saveGameState(); // Save state after preparing a new snippet

    } else {
      console.warn('No active song or current snippet level configuration to play.');
      this.playbackVideoId = null;
    }
  }

  private advanceToNextSnippetLevel(): boolean {
    if (this.activeSong && this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++;
      console.log(`Advanced to snippet level index: ${this.currentSnippetLevelIndex}`);
      return true;
    }
    return false;
  }

}