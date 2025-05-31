// src/app/services/auth.service.ts
import { Injectable, inject, PLATFORM_ID, Optional, makeStateKey, TransferState} from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http'; // Import HttpHeaders
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { isPlatformServer, isPlatformBrowser } from '@angular/common';

import {REQUEST, RESPONSE} from '../../express.token'

import type { Request } from 'express';

export interface User {
  id: number;
  username?: string;
  display_name: string;
  email?: string;
  profile_image_url?: string;
}

export interface UserProfileUpdatePayload {
  username?: string;
  profile_image_url?: string;
}

// Define a State Key for TransferState
const USER_STATE_KEY = makeStateKey<User | null>('loggedInUser');

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private transferState = inject(TransferState);
  private http = inject(HttpClient);

  private request = inject(REQUEST, { optional: true });

  private apiBackendBaseUrl = environment.apiBaseUrl ? environment.apiBaseUrl.replace('/api', '') : 'http://localhost:3000';

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
    if (isPlatformServer(this.platformId)) {
      // SERVER-SIDE: Fetch profile from API backend, forwarding original browser cookies
      console.log('AuthService (SSR): Constructor. Injected request object (via custom token):', this.request ? 'Exists' : 'NULL_OR_UNDEFINED');
      // The 'user' property is added by Passport.js. Augment Express.Request via typings.d.ts for type safety.
      if (this.request && (this.request as any).user) {
        const serverUser = this.normalizeUser((this.request as any).user);
        console.log('AuthService (SSR): User found on injected request:', serverUser);
        this.currentUserSubject.next(serverUser);
        this.isAuthenticatedSubject.next(!!serverUser);
        if (serverUser) {
          this.transferState.set(USER_STATE_KEY, serverUser);
        }
      } else {
        console.log('AuthService (SSR): No user found on injected Express request or request object is null.');
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
      }
    } else if (isPlatformBrowser(this.platformId)) {
      // CLIENT-SIDE: Try to get user from TransferState first
      const transferredUser = this.transferState.get(USER_STATE_KEY, null);
      if (transferredUser) {
        console.log('AuthService (Client): Initializing with user from TransferState:', transferredUser);
        this.currentUserSubject.next(transferredUser);
        this.isAuthenticatedSubject.next(true);
        this.transferState.remove(USER_STATE_KEY);
      } else {
        console.log('AuthService (Client): No user in TransferState, calling checkAuthState API.');
        this.checkAuthState().subscribe();
      }
    }
  }

  // Helper to ensure user object matches User interface
  private normalizeUser(userDataFromBackend: any): User | null {
    if (!userDataFromBackend || !userDataFromBackend.id) { // 'id' is essential
        return null;
    }
    return {
        id: userDataFromBackend.id,
        username: userDataFromBackend.username,
        display_name: userDataFromBackend.display_name,
        email: userDataFromBackend.email,
        profile_image_url: userDataFromBackend.profile_image_url
    };
  }


  public get currentUserValue(): User | null { return this.currentUserSubject.value; }
  public get isAuthenticatedValue(): boolean { return this.isAuthenticatedSubject.value; }

    private fetchProfileFromServerContext(): Observable<User | null> {
    if (!this.request || !this.request.headers || !this.request.headers.cookie) {
      console.warn('AuthService (SSR): No Express request object or no cookies found on it to forward.');
      return of(null);
    }

    const headers = new HttpHeaders({
      'Cookie': this.request.headers.cookie // Forward all cookies from original browser request
      // You might need to be selective or ensure other headers aren't inadvertently causing issues
    });
    
    const profileUrl = `${this.apiBackendBaseUrl}/auth/profile`;

    console.log(`AuthService (SSR): Fetching profile from API at ${profileUrl} with forwarded cookies.`);
    return this.http.get<{ user: User }>(profileUrl, { headers: headers }).pipe( // No withCredentials needed when sending cookie header manually
      map(response => this.normalizeUser(response.user)),
      tap(user => console.log('AuthService (SSR): Profile fetched from API backend during SSR:', user)),
      catchError(error => {
        console.error(`AuthService (SSR): Error fetching profile from API backend (${profileUrl}):`, error.status, error.message);
        return of(null);
      })
    );
  }



  // checkAuthState is now primarily for explicit client-side checks or if TransferState missed.
  checkAuthState(): Observable<User | null> {
    // This should only be called on the browser if not already set by TransferState or SSR direct inject
    if (isPlatformServer(this.platformId)) {
      // This shouldn't typically be called on server if constructor handles it, but as a safeguard:
      console.warn("AuthService (SSR): checkAuthState() called on server; should rely on constructor fetch.");
      return of(this.currentUserSubject.value);
    }

    console.log('AuthService (Client): checkAuthState() making API call to /auth/profile');
    return this.http.get<{ user: any }>(`${this.authApiBaseUrl}/profile`, { withCredentials: true }).pipe(
      map(response => this.normalizeUser(response.user)), // Extract and normalize user
      tap(user => {
        console.log('[Angular AuthService DEBUG] User from /auth/profile API:', user);
        if (user) {
          this.currentUserSubject.next(user);
          this.isAuthenticatedSubject.next(true);
        } else {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
        }
      }),
      catchError(error => {
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        console.log('AuthService: Error fetching profile, user not authenticated. Status:', error.status);
        return of(null);
      })
    );
  }

  // Initiate Google Login
  loginWithGoogle(): void {
    // This still redirects to your API backend for the OAuth dance
    const backendGoogleLoginUrl = `${this.apiBackendBaseUrl}/auth/google`;
    console.log('AuthService: Redirecting to Google login via API backend:', backendGoogleLoginUrl);
    if (isPlatformBrowser(this.platformId)) { // Redirect only happens on client
        window.location.href = backendGoogleLoginUrl;
    }
  }


  // Handle Logout
  logout(): Observable<any> { /* ... same as before, but ensure it updates subjects ... */ 
    return this.http.post(`${this.authApiBaseUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => {
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        if (isPlatformBrowser(this.platformId)) { // Only clear specific transfer state on client
            this.transferState.remove(USER_STATE_KEY);
        }
        console.log('AuthService: User logged out successfully.');
      }),
      catchError(error => {
        // ... existing error handling, ensure subjects are updated ...
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        if (isPlatformBrowser(this.platformId)) {
            this.transferState.remove(USER_STATE_KEY);
        }
        throw error;
      })
    );
  }

  updateUserProfile(payload: UserProfileUpdatePayload): Observable<User | null> {
    return this.http.patch<{ message: string, user: any }>(`${this.authApiBaseUrl.replace('/auth','/api')}/user/profile`, payload, { withCredentials: true }).pipe(
      map(response => this.normalizeUser(response.user)),
      tap(updatedUser => {
        if (updatedUser) {
          // If an update is successful and we get a valid user object back,
          // update the main currentUserSubject.
          const currentUser = this.currentUserSubject.value;
          // Merge, preferring new values from updatedUser, but keeping existing ones if not present in updatedUser
          const mergedUser = currentUser ? { 
            ...currentUser, 
            username: updatedUser.username !== undefined ? updatedUser.username : currentUser.username,
            profile_image_url: updatedUser.profile_image_url !== undefined ? updatedUser.profile_image_url : currentUser.profile_image_url,
            // Ensure all properties of User are considered
            display_name: updatedUser.display_name || currentUser.display_name,
            email: updatedUser.email || currentUser.email,
            id: updatedUser.id // id should always come from updatedUser if present
          } : updatedUser;
          
          this.currentUserSubject.next(mergedUser);
          this.isAuthenticatedSubject.next(true); // Assume still authenticated

          // Update TransferState for consistency if on server/browser
          if (isPlatformBrowser(this.platformId)) {
            this.transferState.set(USER_STATE_KEY, mergedUser);
          } else if (isPlatformServer(this.platformId)) {
            this.transferState.set(USER_STATE_KEY, mergedUser);
          }
          console.log('AuthService: User profile updated in service. New state:', this.currentUserSubject.value);
        } else {
          // If normalizeUser returns null, it implies the backend response after update was invalid or incomplete.
          // We might not want to set currentUserSubject to null here unless the user is truly gone or invalid.
          // For now, if updatedUser is null, the observable stream will emit null,
          // and the component subscribing will handle it. We don't change the BehaviorSubject here on null from update.
          console.warn('AuthService: User profile update result (after normalization) was null. currentUserSubject not changed based on this null.');
        }
      })
    );
  }
}