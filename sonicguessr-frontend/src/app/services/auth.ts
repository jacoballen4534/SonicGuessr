// src/app/services/auth.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment'; // For backend base URL

// Define a User interface (you can expand this based on what /auth/profile returns)
export interface User {
  display_name: string;
  email?: string;
  profile_image_url?: string;
  // Add other fields your backend's /auth/profile might return
  // (excluding sensitive ones like google_id which your backend filters out)
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  
  // Construct the base URL for auth routes.
  // Assumes your backend is at http://localhost:3000 and auth routes are at /auth
  // Adjust if your environment.ts has a different base URL structure.
  // If environment.apiBaseUrl is 'http://localhost:3000/api', then authBaseUrl could be 'http://localhost:3000/auth'
  private authApiBaseUrl = environment.apiBaseUrl.replace('/api', '/auth'); // Example adjustment

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor() {
    // Check auth state when service is initialized (e.g., on app load)
    this.checkAuthState().subscribe();
  }

  public get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  public get IsAuthenticatedValue(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  // Check current authentication state by fetching user profile
  checkAuthState(): Observable<User | null> {
    return this.http.get<User>(`${this.authApiBaseUrl}/profile`, { withCredentials: true }).pipe(
      tap(user => {
        if (user) {
          this.currentUserSubject.next(user);
          this.isAuthenticatedSubject.next(true);
          console.log('AuthService: User is authenticated', user);
        } else {
          // This case might not happen if /auth/profile returns 401 for non-auth users
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          console.log('AuthService: User is not authenticated (no user data)');
        }
      }),
      catchError(error => {
        // If /auth/profile returns 401 or other error, user is not authenticated
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        console.log('AuthService: User is not authenticated (error fetching profile)', error.status);
        return of(null); // Return an observable of null to keep the stream alive
      })
    );
  }

  // Initiate Google Login
  loginWithGoogle(): void {
    // Redirect the browser to the backend's Google OAuth endpoint
    // Ensure your backend (server.js or config.js) base URL is correct here.
    // This assumes your backend is running on http://localhost:3000
    const backendGoogleLoginUrl = `${environment.apiBaseUrl.replace('/api', '')}/auth/google`;
    console.log('AuthService: Redirecting to Google login:', backendGoogleLoginUrl);
    window.location.href = backendGoogleLoginUrl;
  }

  // Handle Logout
  logout(): Observable<any> {
    return this.http.post(`${this.authApiBaseUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => {
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        console.log('AuthService: User logged out successfully.');
        // Optionally, navigate to home or login page after logout
        // this.router.navigate(['/']);
      }),
      catchError(error => {
        console.error('AuthService: Logout failed', error);
        // Still clear local state even if backend logout fails for some reason
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        throw error; // Re-throw error to be handled by the caller
      })
    );
  }
}