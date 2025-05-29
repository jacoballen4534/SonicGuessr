// src/app/models/daily-song.model.ts
export interface DailyChallengeSong {
  id: number;
  challenge_date: string;
  song_order: number;
  source_name: string;
  track_id_from_source: string;
  title: string;
  artist: string;
  album_art_url?: string; // Optional if it might be missing
  duration_ms: number;
  youtube_video_id: string;
}