// src/app/components/feedback-display/feedback-display.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-feedback-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="message" class="feedback-container" 
         [ngClass]="{
           'feedback-correct': type === 'correct', 
           'feedback-incorrect': type === 'incorrect',
           'feedback-info': type === 'info'
         }">
      <p>{{ message }}</p>
      <p *ngIf="pointsAwarded > 0">Points: +{{ pointsAwarded }}</p>
      <div *ngIf="correctAnswer">
        <p>The song was: <strong>{{ correctAnswer.title }}</strong> by <em>{{ correctAnswer.artist }}</em></p>
      </div>
    </div>
  `,
  styles: [`
    .feedback-container { margin-top: 15px; padding: 10px; border-radius: 5px; text-align: center; border: 1px solid #ccc; }
    .feedback-correct { color: var(--success-text-color, green); background-color: var(--success-bg-color, #e6ffe6); border-color: var(--success-border-color, green); }
    .feedback-incorrect { color: var(--error-text-color, red); background-color: var(--error-bg-color, #ffe6e6); border-color: var(--error-border-color, red); }
    .feedback-info { color: var(--info-text-color, #333); background-color: var(--info-bg-color, #e7f3fe); border-color: var(--info-border-color, #2196F3); }
    p { margin-bottom: 5px; }
  `]
})
export class FeedbackDisplay {
  @Input() message: string = '';
  @Input() type: 'correct' | 'incorrect' | 'info' | null = null;
  @Input() pointsAwarded: number = 0;
  @Input() correctAnswer: { title: string, artist: string } | null = null;
}