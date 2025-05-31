// src/app/app.ts
import { Component, OnInit, inject } from '@angular/core'; // Add inject
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService, User } from './services/auth'; // Import AuthService and User
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common'; // For async pipe and *ngIf

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule], // Add CommonModule
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  private authService = inject(AuthService); // Inject AuthService

  isAuthenticated$: Observable<boolean>;
  currentUser$: Observable<User | null>;

  constructor() {
    console.log('Root App component constructor called');
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    console.log('Root App component ngOnInit called');
    // AuthService constructor already calls checkAuthState()
    // You can subscribe here if you need to react to the initial auth check completing
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        console.log('Root App: User logged in on init/refresh:', user.display_name);
      } else {
        console.log('Root App: No user logged in on init/refresh.');
      }
    });
  }

  login(): void {
    this.authService.loginWithGoogle();
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => console.log('Logged out from AppComponent'),
      error: err => console.error('Logout error from AppComponent', err)
    });
  }
}