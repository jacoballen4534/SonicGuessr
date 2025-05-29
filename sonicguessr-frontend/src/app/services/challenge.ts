// src/app/services/challenge.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DailyChallengeSong } from '../models/daily-song.model'; // Adjust path if needed
import { environment } from '../../environments/environment'; // For API base URL

@Injectable({
  providedIn: 'root'
})
export class ChallengeService {
  private apiUrl = `${environment.apiBaseUrl}/daily-challenge/songs`; // From your environment config

  constructor(private http: HttpClient) { }

  getDailySongs(): Observable<DailyChallengeSong[]> {
    return this.http.get<DailyChallengeSong[]>(this.apiUrl);
  }
}