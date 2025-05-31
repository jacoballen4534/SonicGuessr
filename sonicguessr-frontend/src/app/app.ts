// src/app/app.ts
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/layout/header/header'; // Import HeaderComponent
// import { FooterComponent } from './components/layout/footer/footer'; // If you create a FooterComponent
import { AuthService } from './services/auth'; // Still inject if needed for initial check or other reasons
import { CommonModule } from '@angular/common';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, // If you use *ngIf etc. directly in app.html still
    RouterOutlet,
    HeaderComponent // <<< Add HeaderComponent here
    // FooterComponent // If you have one
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  // AuthService is injected here to ensure it's instantiated early and checkAuthState runs.
  // Alternatively, if AuthService is truly only used by HeaderComponent for display,
  // and HeaderComponent is always present, injecting it only there might suffice.
  // But for app-wide auth state check on load, injecting in root is common.
  private authService = inject(AuthService);

  constructor() {
    console.log('Root App component constructor called');
    // AuthService constructor calls checkAuthState()
  }

  ngOnInit(): void {
    console.log('Root App component ngOnInit called');
    // You can subscribe to authService.currentUser$ here if AppComponent
    // needs to react directly to user changes for reasons other than header display.
    // Otherwise, HeaderComponent handles its own subscription for display purposes.
  }
  getYear() { return new Date().getFullYear(); }
}