// src/app/pages/practice-mode/practice-mode.ts
import { Component, OnInit, inject, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { ChallengeService } from '../../services/challenge';
import { DailyChallengeSong } from '../../models/daily-song.model';

import { AudioPlayer } from '../../components/audio-player/audio-player';
import { GuessInput } from '../../components/guess-input/guess-input';
import { FeedbackDisplay } from '../../components/feedback-display/feedback-display';
import {snippetLevelsData} from '../daily-challenge/daily-challenge'

@Component({
  selector: 'app-practice-mode',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AudioPlayer,
    GuessInput,
    FeedbackDisplay
  ],
  templateUrl: './practice-mode.html',
  styleUrls: ['./practice-mode.scss']
})
export class PracticeModeComponent implements OnInit {
  private fb = inject(FormBuilder);
  private challengeService = inject(ChallengeService);

  // Form for year selection
  yearSelectionForm!: FormGroup;

  // Game state
  isLoadingSong = false;
  activeSong: DailyChallengeSong | null = null;
  error: string | null = null;
  
  // Snippet and feedback state
  snippetLevels = snippetLevelsData;

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
    const currentYear = new Date().getFullYear();
    this.yearSelectionForm = this.fb.group({
      startYear: [currentYear, [Validators.required, Validators.min(1960), Validators.max(currentYear)]],
      endYear: [currentYear, [Validators.required, Validators.min(1960), Validators.max(currentYear)]]
    });
  }

  ngOnInit(): void { }

  fetchNewPracticeSong(): void {
    if (this.yearSelectionForm.invalid) {
      this.feedbackDisplay_message = 'Please select a valid year or year range.';
      this.feedbackDisplay_type = 'incorrect';
      return;
    }

    this.isLoadingSong = true;
    this.activeSong = null;
    this.error = null;
    this.feedbackDisplay_message = 'Finding a random song...';
    this.feedbackDisplay_type = 'info';

    const { startYear, endYear } = this.yearSelectionForm.value;

    this.challengeService.getRandomSongForPractice(startYear, endYear).subscribe({
      next: (song) => {
        this.isLoadingSong = false;
        this.activeSong = song;
        this.currentSnippetLevelIndex = 0; // Reset snippet level
        this.feedbackDisplay_message = ''; // Clear loading message
        this.feedbackDisplay_type = null;
        this.playCurrentSnippet(); // Automatically play first snippet
      },
      error: (err) => {
        this.isLoadingSong = false;
        this.error = err.error?.message || 'An error occurred while fetching a song. Please try again.';
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
      
      setTimeout(() => {
        if (this.audioPlayerRef) this.audioPlayerRef.playSnippet();
      }, 0);
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

    const normalizedGuess = guess.trim().toLowerCase();
    const normalizedTitle = this.activeSong.title.trim().toLowerCase();

    if (normalizedGuess === normalizedTitle) {
      this.feedbackDisplay_message = `Correct! It was "${this.activeSong.title}". Get another song when you're ready!`;
      this.feedbackDisplay_type = 'correct';
      this.activeSong = null; // Clear song so user can fetch a new one
    } else {
      this.feedbackDisplay_message = 'Incorrect. Try the next snippet or guess again!';
      this.feedbackDisplay_type = 'incorrect';
    }
  }
}
