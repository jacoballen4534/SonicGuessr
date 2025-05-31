// src/app/components/layout/header/header.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common'; // For *ngIf, async pipe
import { RouterLink, RouterLinkActive } from '@angular/router'; // For navigation links
import { AuthService, User } from '../../../services/auth'; // Adjust path to your AuthService
import { Observable } from 'rxjs';

@Component({
  selector: 'app-header', // This is what you'll use in app.component.html
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.scss']
})
export class HeaderComponent implements OnInit {
  private authService = inject(AuthService);

  isAuthenticated$: Observable<boolean>;
  currentUser$: Observable<User | null>;

  // Example: App name or logo text
  appName: string = 'SonicGuessr';

  constructor() {
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    // You can log here if needed, but AuthService already logs on state change.
    // this.currentUser$.subscribe(user => {
    //   console.log('HeaderComponent: Current user state -', user ? user.display_name : 'Logged out');
    // });
  }

  login(): void {
    this.authService.loginWithGoogle();
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        console.log('HeaderComponent: Logout successful');
        // Optionally navigate to home or login page via Router if needed,
        // but AuthService might handle this or app state will just update.
      },
      error: err => console.error('HeaderComponent: Logout error', err)
    });
  }
}