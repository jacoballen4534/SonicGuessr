// src/app/pages/daily-challenge/daily-challenge.ts
import { Component, OnInit, inject, ViewChild, AfterViewInit, isDevMode, PLATFORM_ID, OnDestroy } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChallengeService, GuessPayload, GuessResponse, DailyChallengeResponse } from '../../services/challenge'; // Ensure DailyChallengeResponse is imported
import { DailyChallengeSong } from '../../models/daily-song.model';
import { AudioPlayer } from '../../components/audio-player/audio-player';
import { GuessInput } from '../../components/guess-input/guess-input';
import { FeedbackDisplay } from '../../components/feedback-display/feedback-display';
import { AuthService } from '../../services/auth'; // For isAuthenticated
import { Subscription } from 'rxjs';



export const snippetLevelsData = [
  { id: 1, start: 0, end: 0.1, durationText: '0.1 seconds' },  // Level 1
  { id: 2, start: 0, end: 0.5, durationText: '0.5 seconds' },  // Level 2
  { id: 3, start: 0, end: 2, durationText: '2 seconds' }, // Level 3
  { id: 4, start: 0, end: 4, durationText: '4 seconds' },  // Level 4
  { id: 5, start: 0, end: 8, durationText: '8 seconds' },  // Level 5
  { id: 6, start: 0, end: 15, durationText: '15 seconds' },  // Level 6
  { id: 7, start: 0, end: 30, durationText: '30 seconds' },  // Level 7
];

const STORAGE_KEY_PREFIX = 'sonicGuessrDailyState_';
const GUEST_COMPLETED_KEY_PREFIX = 'sonicGuessrGuestCompleted_'; // For guest completion

@Component({
  selector: 'app-daily-challenge-page',
  standalone: true,
  imports: [ CommonModule, AudioPlayer, GuessInput, FeedbackDisplay ],
  templateUrl: './daily-challenge.html',
  styleUrls: ['./daily-challenge.scss']
})
export class DailyChallenge implements OnInit, AfterViewInit, OnDestroy {
  
  private challengeService = inject(ChallengeService);
  private authService = inject(AuthService);
  private platformId = inject(PLATFORM_ID);
  
  dailySongs: DailyChallengeSong[] = [];
  isLoading = true;
  error: string | null = null;
  private proceedToNextSongOnLoad: boolean = false;

  feedbackDisplay_message: string = '';
  feedbackDisplay_type: 'correct' | 'incorrect' | 'info' | null = null;
  feedbackDisplay_points: number = 0;
  feedbackDisplay_correctAnswer: { title: string, artist: string } | null = null;
  
  private todayDateString: string = '';
  public isDev: boolean = false;
  public albumArtStyle: string = '';
  public isAlbumArtLoading: boolean = false;
  // public isAudioPlaying: boolean = false; // Not in your provided TS, keep out unless you added it for play/pause

  totalDailyScore: number = 0;
  activeSong: DailyChallengeSong | null = null;
  activeSongIndex: number = -1;
  currentSnippetLevelIndex: number = 0;
  public SNIPPET_LEVELS = snippetLevelsData;

  playbackVideoId: string | null = null;
  playbackStartSeconds: number = 0;
  playbackEndSeconds: number = 0;

  @ViewChild(AudioPlayer) audioPlayerRef!: AudioPlayer;

  public challengeCompletedTodayByPlayer: boolean = false; // Will be true if auth user played OR guest played (in this session)
  public isAuthenticated: boolean = false;

  private subscriptions = new Subscription();

  constructor() {
    this.isDev = false &&isDevMode();
    if (isPlatformBrowser(this.platformId)) {
      this.todayDateString = this.getTodayDateString();
    }
  }

  getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    console.log('DailyChallenge component initialized...');
    this.subscriptions.add(
      this.authService.isAuthenticated$.subscribe(isAuth => {
        this.isAuthenticated = isAuth;
        if (isPlatformBrowser(this.platformId)) {
            this.fetchSongsAndSetInitialState();
        }
      })
    );

    if (!isPlatformBrowser(this.platformId)) {
        this.isLoading = false; 
        console.log('DailyChallenge SSR: Song fetch and state load deferred to client.');
    }
  }
    
  fetchSongsAndSetInitialState(): void {
    this.isLoading = true;
    this.error = null;
    this.feedbackDisplay_message = ''; 
    this.feedbackDisplay_type = null;

    this.subscriptions.add(
      this.challengeService.getDailySongs().subscribe({
        next: (response: DailyChallengeResponse) => {
          this.dailySongs = response.songs || [];
          this.isLoading = false;
          // console.log('Daily songs response:', response);

          if (this.isAuthenticated) {
            this.challengeCompletedTodayByPlayer = response.challengeCompletedToday;
          } else {
            // For guests, check localStorage
            this.challengeCompletedTodayByPlayer = this.checkGuestCompletionLocalStorage();
          }
          console.log('Challenge completed today status:', this.challengeCompletedTodayByPlayer);

          if (this.challengeCompletedTodayByPlayer) {
            this.feedbackDisplay_message = this.isAuthenticated ? 
                "You've already completed today's challenge! Check the leaderboard or come back tomorrow." :
                "You've completed today's guest session! Log in to save scores or come back tomorrow.";
            this.feedbackDisplay_type = 'info';
            this.activeSong = null; 
            this.activeSongIndex = -1;
            if (isPlatformBrowser(this.platformId) && !this.isAuthenticated) { // Clear guest progress if completed
                localStorage.removeItem(this.getStorageKey());
            }
          } else if (this.dailySongs.length > 0) {
            this.loadGameStateOrDefault();
          } else {
            this.feedbackDisplay_message = "No songs available for today's challenge. Please check back later.";
            this.feedbackDisplay_type = 'info';
          }
        },
        error: (err) => {
          console.error('Error fetching daily songs:', err);
          this.error = 'Failed to load songs. Please try again later.';
          this.isLoading = false;
        }
      })
    );
  }

  private getGuestStorageKey(): string {
    return `${GUEST_COMPLETED_KEY_PREFIX}${this.todayDateString}`;
  }


  ngAfterViewInit(): void {
    // The audioPlayerRef will be available here
    // You can log it to ensure it's being picked up:
    // console.log('Audio Player Ref:', this.audioPlayerRef);
  }

  private getStorageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this.todayDateString}`;
  }

  private checkGuestCompletionLocalStorage(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return localStorage.getItem(this.getGuestStorageKey()) === 'true';
  }

  private markGuestCompletionInLocalStorage(): void {
    if (!isPlatformBrowser(this.platformId) || this.isAuthenticated) return; // Only for guests
    localStorage.setItem(this.getGuestStorageKey(), 'true');
    console.log("Guest completion marked in localStorage for today.");
  }

  private loadGameStateOrDefault(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // If challenge is already marked as completed for this session (auth or guest), don't load.
    if (this.challengeCompletedTodayByPlayer) {
        console.log("Not loading saved game state: challenge already marked as completed for today.");
        return;
    }

    const savedStateString = localStorage.getItem(this.getStorageKey());
    if (savedStateString) {
      try {
        const savedState = JSON.parse(savedStateString);
        if (savedState && typeof savedState.activeSongIndex === 'number' && this.dailySongs.length > 0) {
          this.activeSongIndex = savedState.activeSongIndex;
          this.currentSnippetLevelIndex = savedState.currentSnippetLevelIndex || 0;
          this.totalDailyScore = this.isAuthenticated ? (savedState.totalDailyScore || 0) : 0; // Guests score 0
          this.proceedToNextSongOnLoad = savedState.proceedToNextSongOnLoad || false;
          console.log('Loaded game state:', savedState);

          if (this.proceedToNextSongOnLoad) {
            this.proceedToNextSongOnLoad = false; 
            this.saveGameState(); 
            this.nextSong();
          } else if (this.activeSongIndex === -1 && this.dailySongs.length > 0) { 
            this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
            this.feedbackDisplay_type = 'info';
            this.activeSong = null;
            this.playbackVideoId = null;
          } else if (this.dailySongs.length > 0 && this.activeSongIndex >= 0 && this.activeSongIndex < this.dailySongs.length) { // Added dailySongs.length check
            this.activeSong = this.dailySongs[this.activeSongIndex];
            this.updateAlbumArtBlur(); 
            this.playCurrentSnippet();
          } else {
            this.startChallengeWithFirstSong();
          }
          return; 
        } 
      } catch (e) { localStorage.removeItem(this.getStorageKey());}
    }
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
    // Check if challenge already completed (for auth user or guest)
    if (this.challengeCompletedTodayByPlayer) {
      if (!this.feedbackDisplay_message) { // Set feedback if not already set by fetchSongsAndInitialState
        this.feedbackDisplay_message = this.isAuthenticated ? 
            "You've already played today's challenge!" : 
            "You've completed today's guest session!";
        this.feedbackDisplay_type = 'info';
      }
      return;
    }
    if (this.dailySongs.length === 0 && !this.isLoading) {
        this.feedbackDisplay_message = "No songs loaded to start the challenge.";
        this.feedbackDisplay_type = 'info';
        return;
    }    
    this.totalDailyScore = 0; // Guests will always have 0, auth users reset here
    this.currentSnippetLevelIndex = 0;
    this.proceedToNextSongOnLoad = false;
    this.feedbackDisplay_message = ''; 
    this.feedbackDisplay_type = null;
    this.setActiveSong(0);
  }
  

  setActiveSong(index: number): void {
    if (this.dailySongs && index >= 0 && index < this.dailySongs.length) {

      if (!this.activeSong || this.activeSong.id !== this.dailySongs[index].id) {
        const newSong = this.dailySongs[index];
        if (newSong.album_art_url) {
          this.isAlbumArtLoading = true; // <<< Set loading true for the NEW album art
        } else {
          this.isAlbumArtLoading = false; // No art to load for the new song
        }

        // Pre-set blur to max for the container before new image source is bound
        // updateAlbumArtBlur will be called again in playCurrentSnippet with correct level 0 blur
        this.albumArtStyle = `blur(${this.SNIPPET_LEVELS.length > 0 ? 20 : 0}px)`; // Default high blur, or 0 if no levels
      }

      this.activeSongIndex = index;
      this.activeSong = this.dailySongs[index];
      this.currentSnippetLevelIndex = 0; // Reset to first snippet level for new song

      // Clear any previous song's specific guess feedback before playing new snippet
      this.feedbackDisplay_message = '';
      this.feedbackDisplay_type = null;
      this.feedbackDisplay_points = 0;
      this.feedbackDisplay_correctAnswer = null;

      this.updateAlbumArtBlur(); // <<< CALL BLUR UPDATE
      this.playCurrentSnippet(); // This will set up playback vars and save state
    } else if (index >= this.dailySongs.length) {
        this.nextSong(); 
    } else {
      console.warn('Attempted to set invalid active song index:', index);
      this.activeSong = null;
      this.albumArtStyle = 'blur(0px)';
      this.isAlbumArtLoading = false; // No image to load
      this.saveGameState();
    }
  }

  onAlbumArtLoaded(): void {
    this.isAlbumArtLoading = false;
    console.log('New album art image loaded.');
  }

  private updateAlbumArtBlur(): void {
    if (!this.activeSong || !this.activeSong.album_art_url || !isPlatformBrowser(this.platformId)) {
      this.albumArtStyle = 'blur(0px)'; // Default to no blur or clear if no art/not browser
      this.isAlbumArtLoading = false; // Ensure loading is false if no art
      return;
    }

    const maxBlurPx = 20; // Maximum blur in pixels
    const minBlurPx = 0;  // No blur
    const totalSnippetLevels = this.SNIPPET_LEVELS.length;

    // Ensure currentSnippetLevelIndex is valid for calculation
    const effectiveLevel = Math.max(0, Math.min(this.currentSnippetLevelIndex, totalSnippetLevels - 1));

    let blurAmount = maxBlurPx;

    if (totalSnippetLevels > 1) {
      // Linear interpolation: blur decreases as level increases
      blurAmount = maxBlurPx - (effectiveLevel / (totalSnippetLevels - 1)) * (maxBlurPx - minBlurPx);
    } else {
      // If only one level (or zero levels), show clearly or max blur based on preference
      blurAmount = minBlurPx; // Show clearly if only one level
    }
    
    // Ensure blurAmount is a finite number and within bounds
    blurAmount = Math.max(minBlurPx, Math.min(maxBlurPx, blurAmount));
    if (!isFinite(blurAmount)) {
        blurAmount = minBlurPx; // Fallback to clear if calculation error
    }

    this.albumArtStyle = `blur(${blurAmount.toFixed(1)}px)`;
    console.log(`Album art blur set for snippet level index ${this.currentSnippetLevelIndex}: ${this.albumArtStyle}`);
  }



  handleUserGuess(guess: string): void {
    if (this.challengeCompletedTodayByPlayer && !this.isAuthenticated) { // Allow auth users to submit to see if backend 403s them
      this.feedbackDisplay_message = "You've already completed today's guest session. Log in to save scores.";
      this.feedbackDisplay_type = 'info';
      return;
    }

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

    this.subscriptions.add( // Add to subscriptions
      this.challengeService.submitGuess(payload).subscribe({
        next: (response: GuessResponse) => {
          this.feedbackDisplay_message = response.message;
          let songIsOver = false; 

          if (response.correct) {
            this.feedbackDisplay_type = 'correct';
            this.feedbackDisplay_points = response.pointsAwarded || 0;
            this.totalDailyScore += this.feedbackDisplay_points;
            songIsOver = true;
          } else { 
            this.feedbackDisplay_type = 'incorrect';
            if (response.gameOverForSong || (this.currentSnippetLevelIndex >= this.SNIPPET_LEVELS.length - 1)) {
              songIsOver = true;
              this.feedbackDisplay_correctAnswer = { 
                title: response.songTitle || this.activeSong?.title || 'Unknown', 
                artist: response.artist || this.activeSong?.artist || 'Unknown' 
              };
              if (!response.gameOverForSong) { 
                  this.feedbackDisplay_message = response.message + ` That was the last snippet. The song was: ${this.activeSong?.title || 'Unknown'}.`;
              }
            } else { 
              this.feedbackDisplay_message = response.message + " Preparing next snippet...";
              if (this.advanceToNextSnippetLevel()) { 
                this.saveGameState(); 
                setTimeout(() => { this.playCurrentSnippet(); }, 1500);
              } else { 
                songIsOver = true; 
                this.feedbackDisplay_message = "No more snippets. Game over for this song.";
              }
            }
          }

          if (songIsOver) {
            this.proceedToNextSongOnLoad = true; 
            // Check if this was the last song of the daily challenge
            if (this.activeSongIndex >= this.dailySongs.length - 1) {
                this.challengeCompletedTodayByPlayer = true; // Challenge fully completed
            }
            this.saveGameState(); 
            const delay = response.correct ? 2500 : 4000;
            setTimeout(() => { this.nextSong(); }, delay);
          }
        },
        error: (err) => {
          this.feedbackDisplay_type = 'incorrect';
          if (err.status === 403 && err.error?.message?.includes("already completed today's challenge")) {
            this.feedbackDisplay_message = err.error.message;
            this.challengeCompletedTodayByPlayer = true; // Mark as completed based on backend
            this.activeSong = null; 
            this.activeSongIndex = -1;
            this.saveGameState(); 
          } else {
            this.feedbackDisplay_message = err.error?.message || 'Failed to submit guess.';
          }
        }
      })
    );
  }

  playNextSnippetLevel(): void {
    if (!this.activeSong) {
      console.warn('No active song to play next snippet level for.');
      this.feedbackDisplay_message = 'No active song.'; // Update feedback
      this.feedbackDisplay_type = 'incorrect';
      return;
    }
    if (this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++;
      this.feedbackDisplay_message = `Playing snippet level ${this.currentSnippetLevelIndex + 1}...`;
      this.feedbackDisplay_type = 'info';
      this.playCurrentSnippet(); 
    } else {
      this.feedbackDisplay_message = `You're already at the last snippet level for this song!`;
      this.feedbackDisplay_type = 'info';
    }
  }

  nextSong(): void {
    this.proceedToNextSongOnLoad = false; 
    this.feedbackDisplay_message = ''; 
    this.feedbackDisplay_type = null;
    this.feedbackDisplay_points = 0;
    this.feedbackDisplay_correctAnswer = null;

    if (this.activeSong && this.activeSongIndex < this.dailySongs.length - 1) {
      this.setActiveSong(this.activeSongIndex + 1);
    } else { 
      console.log('End of daily challenge songs.');
      this.activeSong = null; 
      this.activeSongIndex = -1; 
      this.currentSnippetLevelIndex = 0;
      this.playbackVideoId = null; 
      this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
      this.feedbackDisplay_type = 'info'; 
      this.challengeCompletedTodayByPlayer = true; // <<< ENSURE THIS IS SET
      this.albumArtStyle = 'blur(0px)';
      this.saveGameState(); 
    }


    if (this.activeSong === null && this.activeSongIndex === -1) { // End of challenge
      this.challengeCompletedTodayByPlayer = true; // Mark as completed
      if (!this.isAuthenticated) {
          this.markGuestCompletionInLocalStorage();
          this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}. Log in to save future scores!`;
      } else {
          this.feedbackDisplay_message = `You have completed all songs for today! Your total score: ${this.totalDailyScore}`;
      }
      this.feedbackDisplay_type = 'info'; 
      this.saveGameState(); 
    }

  }

  skipToNextSnippet(): void {
    if (!this.activeSong) {
      this.feedbackDisplay_message = 'No active song to skip snippet for.';
      this.feedbackDisplay_type = 'info';
      return;
    }
    if (this.advanceToNextSnippetLevel()) { 
      this.feedbackDisplay_message = `Playing snippet level ${this.currentSnippetLevelIndex + 1} (${this.SNIPPET_LEVELS[this.currentSnippetLevelIndex].durationText})...`;
      this.feedbackDisplay_type = 'info';
      this.playCurrentSnippet();
    } else {
      this.feedbackDisplay_message = 'You are already at the longest snippet for this song!';
      this.feedbackDisplay_type = 'info';
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
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

  public playCurrentSnippet(): void { // Public as called by template
    if (this.activeSong && this.SNIPPET_LEVELS[this.currentSnippetLevelIndex]) {
      const levelConfig = this.SNIPPET_LEVELS[this.currentSnippetLevelIndex];
      if (this.playbackVideoId !== this.activeSong.youtube_video_id || !this.isAlbumArtLoading) { 
        if (this.activeSong.album_art_url) {
          this.isAlbumArtLoading = true;
        }
      }
      this.playbackVideoId = this.activeSong.youtube_video_id;
      this.playbackStartSeconds = levelConfig.start;
      this.playbackEndSeconds = levelConfig.end;
      // console.log(`Prepared to play snippet for "${this.activeSong.title}", Level ${levelConfig.id} (${levelConfig.durationText})`);
      this.updateAlbumArtBlur();
      setTimeout(() => {
        if (this.audioPlayerRef) {
          this.audioPlayerRef.playSnippet(); 
        } else {
          console.error('AudioPlayer reference not available to play snippet.');
        }
      }, 0);
      this.saveGameState();
    } else {
      this.playbackVideoId = null;
      this.albumArtStyle = 'blur(0px)';
      this.isAlbumArtLoading = false;
      this.saveGameState(); 
    }
  }

  private advanceToNextSnippetLevel(): boolean { // Private helper
    if (this.activeSong && this.currentSnippetLevelIndex < this.SNIPPET_LEVELS.length - 1) {
      this.currentSnippetLevelIndex++;
      console.log(`Advanced to snippet level index: ${this.currentSnippetLevelIndex}`);
      return true;
    }
    return false;
  }

}