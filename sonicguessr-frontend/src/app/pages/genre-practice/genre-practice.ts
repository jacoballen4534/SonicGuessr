// src/app/pages/genre-practice/genre-practice.ts
import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Observable } from 'rxjs';

import { ChallengeService, Genre } from '../../services/challenge';
import { DailyChallengeSong } from '../../models/daily-song.model';

import { AudioPlayer } from '../../components/audio-player/audio-player';
import { GuessInput } from '../../components/guess-input/guess-input';
import { FeedbackDisplay } from '../../components/feedback-display/feedback-display';
import {snippetLevelsData} from '../daily-challenge/daily-challenge'

@Component({
  selector: 'app-genre-practice',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AudioPlayer,
    GuessInput,
    FeedbackDisplay
  ],
  templateUrl: './genre-practice.html',
  styleUrls: ['./genre-practice.scss']
})
export class GenrePracticeComponent implements OnInit {
  private fb = inject(FormBuilder);
  private challengeService = inject(ChallengeService);

  // Form and data for genre selection
  genreSelectionForm!: FormGroup;
  availableGenres$: Observable<Genre[]>;
  
  // Game state
  isLoadingSong = false;
  activeSong: DailyChallengeSong | null = null;
  error: string | null = null;

  // Snippet levels and current state
  snippetLevels = snippetLevelsData
  currentSnippetLevelIndex = 0;

  // Feedback display properties
  feedbackDisplay_message: string | null = '';
  feedbackDisplay_type: 'correct' | 'incorrect' | 'info' | null = null;
  feedbackDisplay_correctAnswer: { title: string, artist: string } | null = null;

  // Audio player properties
  @ViewChild(AudioPlayer) audioPlayerRef!: AudioPlayer;
  playbackVideoId: string | null = null;
  playbackStartSeconds: number = 0;
  playbackEndSeconds: number = 0;

  constructor() {
    this.genreSelectionForm = this.fb.group({
      genreId: ['', Validators.required]
    });
    this.availableGenres$ = this.challengeService.getAvailableGenres();
  }

  ngOnInit(): void { }

  fetchNewSongByGenre(): void {
    if (this.genreSelectionForm.invalid) {
      this.feedbackDisplay_message = 'Please select a genre first!';
      this.feedbackDisplay_type = 'incorrect';
      return;
    }

    this.isLoadingSong = true;
    this.activeSong = null;
    this.error = null;
    this.feedbackDisplay_message = 'Finding a random song from your selected genre...';
    this.feedbackDisplay_type = 'info';
    this.feedbackDisplay_correctAnswer = null;

    const selectedGenreId = this.genreSelectionForm.value.genreId;

    this.challengeService.getRandomSongByGenre(selectedGenreId).subscribe({
      next: (song) => {
        this.isLoadingSong = false;
        this.activeSong = song;
        this.currentSnippetLevelIndex = 0;
        this.feedbackDisplay_message = '';
        this.feedbackDisplay_type = null;
        this.playCurrentSnippet();
      },
      error: (err) => {
        this.isLoadingSong = false;
        this.error = err.error?.message || 'An error occurred fetching a song. Please try another genre.';
        this.feedbackDisplay_message = this.error;
        this.feedbackDisplay_type = 'incorrect';
      }
    });
  }

  playCurrentSnippet(): void {
    if (this.activeSong && this.snippetLevels[this.currentSnippetLevelIndex]) {
      const level = this.snippetLevels[this.currentSnippetLevelIndex];
      this.playbackVideoId = this.activeSong.youtube_video_id;
      this.playbackStartSeconds = level.start;
      this.playbackEndSeconds = level.end;
      setTimeout(() => { if (this.audioPlayerRef) this.audioPlayerRef.playSnippet(); }, 0);
    }
  }

  playNextSnippetLevel(): void {
    if (this.activeSong && this.currentSnippetLevelIndex < this.snippetLevels.length - 1) {
      this.currentSnippetLevelIndex++;
      this.feedbackDisplay_message = `Playing a longer snippet...`;
      this.feedbackDisplay_type = 'info';
      this.playCurrentSnippet();
    } else {
      this.feedbackDisplay_message = 'You are at the longest snippet!';
      this.feedbackDisplay_type = 'info';
    }
  }

  handleUserGuess(guess: string): void {
    if (!this.activeSong) return;

    if (guess.trim().toLowerCase() === this.activeSong.title.trim().toLowerCase()) {
      this.feedbackDisplay_message = `Correct! It was "${this.activeSong.title}". Get another song when you're ready!`;
      this.feedbackDisplay_type = 'correct';
      this.feedbackDisplay_correctAnswer = { title: this.activeSong.title, artist: this.activeSong.artist };
      this.activeSong = null; // Clear song
    } else {
      if (this.currentSnippetLevelIndex < this.snippetLevels.length - 1) {
        this.feedbackDisplay_message = 'Not quite! Playing a longer snippet...';
        this.feedbackDisplay_type = 'incorrect';
        setTimeout(() => this.playNextSnippetLevel(), 1500);
      } else {
        this.feedbackDisplay_message = `That was the last try! The song was "${this.activeSong.title}".`;
        this.feedbackDisplay_type = 'incorrect';
        this.feedbackDisplay_correctAnswer = { title: this.activeSong.title, artist: this.activeSong.artist };
        this.activeSong = null;
      }
    }
  }
}