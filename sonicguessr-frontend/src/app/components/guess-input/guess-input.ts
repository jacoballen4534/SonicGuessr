// src/app/components/guess-input/guess-input.ts
import { Component, EventEmitter, Output, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Needed for ngModel
import { HttpClient } from '@angular/common/http'; // For direct API call or use a service
import { Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment'; // For API base URL

export interface AutocompleteSuggestion {
  id: string; // track_id_from_source
  title: string;
  artist: string;
}

@Component({
  selector: 'app-guess-input',
  standalone: true,
  imports: [CommonModule, FormsModule], // FormsModule is crucial for [(ngModel)]
  templateUrl: './guess-input.html',
  styleUrls: ['./guess-input.scss']
})
export class GuessInput implements OnDestroy {
  @Output() guessSubmitted = new EventEmitter<string>();

  currentGuess: string = '';
  suggestions: AutocompleteSuggestion[] = [];
  
  private searchTerms = new Subject<string>();
  private http = inject(HttpClient); // Or inject your existing ChallengeService/ApiService

  // Debounce autocomplete API calls
  private suggestions$ = this.searchTerms.pipe(
    debounceTime(300), // Wait for 300ms pause in events
    distinctUntilChanged(), // Ignore if next search term is same as previous
    switchMap((term: string) => {
      if (!term.trim() || term.length < 2) { // Minimum characters to search
        return new Observable<AutocompleteSuggestion[]>(observer => observer.next([])); // Return empty array
      }
      // Using HttpClient directly here for simplicity, ideally use a service
      return this.http.get<AutocompleteSuggestion[]>(`${environment.apiBaseUrl}/songs/autocomplete?query=${encodeURIComponent(term)}`)
        .pipe(
          tap(response => console.log('Autocomplete response:', response)),
          catchError(error => {
            console.error('Autocomplete error:', error);
            return new Observable<AutocompleteSuggestion[]>(observer => observer.next([])); // Return empty on error
          })
        );
    })
  ).subscribe(suggestions => {
    this.suggestions = suggestions;
  });

  onInputChange(term: string): void {
    this.currentGuess = term; // Keep currentGuess in sync if not just using it for display
    this.searchTerms.next(term);
  }

  selectSuggestion(suggestion: AutocompleteSuggestion): void {
    this.currentGuess = suggestion.title; // Set input to selected title
    this.suggestions = []; // Clear suggestions
    // Optionally submit directly or wait for user to click submit button
    // this.onSubmitGuess(); 
  }

  onSubmitGuess(): void {
    if (this.currentGuess.trim()) {
      console.log('GuessInput: Submitting guess:', this.currentGuess);
      this.guessSubmitted.emit(this.currentGuess.trim());
      this.currentGuess = ''; // Clear input after submit
      this.suggestions = []; // Clear suggestions
    }
  }

  ngOnDestroy(): void {
    this.suggestions$.unsubscribe(); // Clean up the subscription
    this.searchTerms.complete();
  }
}