// src/app/components/feedback-display/feedback-display.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common'; // For *ngIf, ngClass

@Component({
  selector: 'app-feedback-display',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback-display.html',
  styleUrls: ['./feedback-display.scss']
})
export class FeedbackDisplay {
  @Input() message: string = '';
  @Input() type: 'correct' | 'incorrect' | 'info' | null = null;
  @Input() pointsAwarded: number = 0;
  @Input() correctAnswer: { title: string, artist: string } | null = null;

  constructor() { }
}