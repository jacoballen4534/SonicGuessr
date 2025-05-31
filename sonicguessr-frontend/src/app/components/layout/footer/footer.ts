// src/app/components/layout/footer/footer.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common'; // For potential *ngIf or pipes if needed later

@Component({
  selector: 'app-footer', // This is what you'll use in app.component.html
  standalone: true,
  imports: [CommonModule],
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss']
})
export class FooterComponent {
  currentYear: number;

  constructor() {
    this.currentYear = new Date().getFullYear();
  }
}