// src/app/app.ts
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './components/layout/header/header';
import { FooterComponent } from './components/layout/footer/footer'; // <<< IMPORT FooterComponent
import { AuthService } from './services/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    HeaderComponent,
    FooterComponent // <<< ADD FooterComponent HERE
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  private authService = inject(AuthService);

  constructor() {
    console.log('Root App component constructor called');
  }

  ngOnInit(): void {
    console.log('Root App component ngOnInit called');
  }
}