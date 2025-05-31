// src/app/services/auth.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, of, map } from 'rxjs';
import { environment } from '../../environments/environment'; // For backend base URL

// Define a User interface (you can expand this based on what /auth/profile returns)
export interface User {
  id: number; // <<< Ensure this is here
  username?: string;
  display_name: string;
  email?: string;
  profile_image_url?: string;
}

export interface UserProfileUpdatePayload {
  username?: string;
  profile_image_url?: string;
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
  private userProfileApiUrl = `${environment.apiBaseUrl}/user/profile`; // For PATCH endpoint under /api

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
    // Assuming backend sends { user: UserProfileData }
    return this.http.get<{ user: User }>(`${this.authApiBaseUrl}/profile`, { withCredentials: true }).pipe(
      tap(response => { // 'response' here is { user: UserProfileData }
        const user = response.user; // <<< CORRECTLY EXTRACTING HERE

        if (user && (user.display_name || user.username)) { // Check if user object exists and has a name field
          this.currentUserSubject.next(user); // <<< SHOULD BE EMITTING THE EXTRACTED 'user'
          this.isAuthenticatedSubject.next(true);
        } else {
          this.currentUserSubject.next(null); // Ensure null is emitted if user data is not valid
          this.isAuthenticatedSubject.next(false);
        }
      }),
      map(response => response.user), // Ensure the observable stream for downstream subscribers also gets the extracted user
      catchError(error => {
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        console.log('AuthService: User is not authenticated (error fetching profile). Status:', error.status);
        return of(null);
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

    updateUserProfile(payload: UserProfileUpdatePayload): Observable<User> {
    return this.http.patch<{ message: string, user: User }>(this.userProfileApiUrl, payload, { withCredentials: true }).pipe(
      tap(response => {
        const updatedUserProfile = response.user;
        // Update the current user BehaviorSubject
        const currentUser = this.currentUserSubject.value;
        if (currentUser) {
          // Merge, ensuring new values overwrite old, and existing values persist if not in updatedUserProfile
          const mergedUser = { 
            ...currentUser, 
            username: updatedUserProfile.username !== undefined ? updatedUserProfile.username : currentUser.username,
            profile_image_url: updatedUserProfile.profile_image_url !== undefined ? updatedUserProfile.profile_image_url : currentUser.profile_image_url,
            // display_name might not be in updatedUserProfile if not changed, keep existing
            display_name: updatedUserProfile.display_name || currentUser.display_name 
          };
          this.currentUserSubject.next(mergedUser);
        } else {
          // This case should ideally not happen if update is for an authenticated user
          this.currentUserSubject.next(updatedUserProfile);
        }
        console.log('AuthService: User profile updated successfully in service', this.currentUserSubject.value);
      }),
      map(response => response.user) // Return only the user part of the response
    );
  }
}