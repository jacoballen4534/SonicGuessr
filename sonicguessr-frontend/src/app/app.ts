// src/app/app.ts
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService, User } from './services/auth';
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App implements OnInit {
  private authService = inject(AuthService);

  isAuthenticated$: Observable<boolean>;
  currentUser$: Observable<User | null>;

  constructor() {
    // These just assign the observables, subscription happens in template via async pipe or in ngOnInit
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {

    this.authService.currentUser$.subscribe(userFromAuthService => {
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