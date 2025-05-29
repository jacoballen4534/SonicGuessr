// Example: src/app/pages/home/home.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-home-page', // Ensure selector is unique if needed, or not used if only routed
  standalone: true,
  imports: [], // Add CommonModule if you use *ngIf, *ngFor, etc.
  templateUrl: './home.html',
  styleUrls: ['./home.scss']
})
export class Home {
  constructor() {
    console.log('Home component initialized and being routed to!');
  }
}