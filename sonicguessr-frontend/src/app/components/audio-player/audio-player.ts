// src/app/components/audio-player/audio-player.ts
import { Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy,
    PLATFORM_ID, // Import PLATFORM_ID
  inject        // Import inject
 } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common'; // Import isPlatformBrowser

declare global {
  interface Window {
    YT: any; // Tells TypeScript that window can have a YT object of type any
    onYouTubeIframeAPIReady?: () => void; // Also declare the callback if you assign to it directly on window
  }
}

@Component({
  selector: 'app-audio-player',
  standalone: true,
  imports: [CommonModule,],
  templateUrl: './audio-player.html',
  styleUrls: ['./audio-player.scss']
})
export class AudioPlayer implements AfterViewInit, OnChanges, OnDestroy {
  @Input() videoId: string | null = null;
  @Input() startSeconds: number = 0;
  @Input() endSeconds: number | undefined;

  @ViewChild('player') playerElementRef!: ElementRef<HTMLDivElement>;
  private player: any; // YT.Player instance
  private apiLoadedAndReady = false; // Combined flag for API loaded and global callback fired
  private playerInstanceReady = false; // Flag for individual player instance onReady event

  private platformId = inject(PLATFORM_ID); // Inject PLATFORM_ID using inject()

  private static youtubeApiScriptInjected = false; // Static flag to inject script once
  private static youtubeApiReadyCallbacks: (() => void)[] = [];
  private static isYoutubeApiGloballyReady = false;

  private snippetTimeoutId: any = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadYouTubeApiScriptIfNeeded();
    }
  }

  ngAfterViewInit(): void {
    // Player setup will be triggered once API is loaded and videoId is available via ngOnChanges or direct call
    if (isPlatformBrowser(this.platformId) && this.videoId) {
      this.initializePlayerWhenApiReady();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (isPlatformBrowser(this.platformId)) {
      // If videoId changes, and API is ready, re-initialize the player
      if (changes['videoId'] && this.videoId) {
        this.initializePlayerWhenApiReady();
      } else if (this.playerInstanceReady && (changes['startSeconds'] || changes['endSeconds'])) {
        // If only time changes and player is ready, perhaps just call playSnippet if appropriate
        // This depends on desired behavior - for now, major changes re-init player
      }
    }
  }

  private loadYouTubeApiScriptIfNeeded() {
    if (!isPlatformBrowser(this.platformId) || AudioPlayer.youtubeApiScriptInjected) {
      if (AudioPlayer.isYoutubeApiGloballyReady && this.videoId) {
        this.initializePlayer(); // API script already loaded and API is ready
      }
      return;
    }

    console.log('AudioPlayer: Attempting to load YouTube Iframe API script.');
    AudioPlayer.youtubeApiScriptInjected = true; // Set flag immediately

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api'; // Placeholder URL
    document.head.appendChild(tag); // Append to head is common

    (window as any)['onYouTubeIframeAPIReady'] = () => {
      console.log('YouTube Iframe API is globally ready (onYouTubeIframeAPIReady fired).');
      AudioPlayer.isYoutubeApiGloballyReady = true;
      AudioPlayer.youtubeApiReadyCallbacks.forEach(callback => callback());
      AudioPlayer.youtubeApiReadyCallbacks = []; // Clear callbacks
    };
  }

  private initializePlayerWhenApiReady() {
    if (!isPlatformBrowser(this.platformId) || !this.videoId) return;

    if (AudioPlayer.isYoutubeApiGloballyReady) {
      this.initializePlayer();
    } else {
      console.log('AudioPlayer: YouTube API not globally ready yet, queuing player initialization.');
      // Ensure script has been initiated
      this.loadYouTubeApiScriptIfNeeded(); 
      AudioPlayer.youtubeApiReadyCallbacks.push(() => this.initializePlayer());
    }
  }
  
  private initializePlayer(): void {
    if (!isPlatformBrowser(this.platformId) || !this.videoId || !this.playerElementRef?.nativeElement || !AudioPlayer.isYoutubeApiGloballyReady) {
      console.warn('AudioPlayer: Prerequisites for initializing YT.Player not met.', {
        platform: isPlatformBrowser(this.platformId),
        videoId: !!this.videoId,
        elementRef: !!this.playerElementRef?.nativeElement,
        apiReady: AudioPlayer.isYoutubeApiGloballyReady
      });
      return;
    }
     if (!window.YT || !window.YT.Player) {
      console.error('AudioPlayer: YT object or YT.Player is not available. API might not have loaded correctly.');
      return;
    }


    // Destroy existing player if it exists
    if (this.player && typeof this.player.destroy === 'function') {
      this.player.destroy();
      this.player = null;
      this.playerInstanceReady = false;
    }
    
    console.log(`AudioPlayer: Initializing YT.Player for videoId: ${this.videoId}`);
    try {
      this.player = new window.YT.Player(this.playerElementRef.nativeElement, {
        height: '0', // Hidden player
        width: '0',
        videoId: this.videoId, // Initial video to load
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin // Important for some security contexts
        },
        events: {
          'onReady': this.onPlayerReady.bind(this),
          'onStateChange': this.onPlayerStateChange.bind(this),
          'onError': this.onPlayerError.bind(this)
        }
      });
    } catch(e) {
      console.error("Error creating YT.Player:", e);
    }
  }

  onPlayerReady(event: any): void {
    console.log('AudioPlayer: Individual player instance is ready for video:', this.videoId);
    this.playerInstanceReady = true;
    
    // Now that the player instance is ready, if videoId and snippet times are set,
    // it means there's likely an expectation to play.
    // Calling playSnippet() here ensures it attempts to play.
    if (this.videoId && this.endSeconds !== undefined && this.startSeconds !== undefined) {
      console.log('AudioPlayer: Player is ready, now attempting to play the snippet (from onPlayerReady).');
      this.playSnippet(); 
    }
  }

  onPlayerStateChange(event: any): void {
    if (!isPlatformBrowser(this.platformId)) return;
    console.log(`AudioPlayer: Player state changed to ${event.data} for video ${this.videoId}`);

    if (this.snippetTimeoutId) {
      clearTimeout(this.snippetTimeoutId);
      this.snippetTimeoutId = null;
    }

    if (event.data === window.YT.PlayerState.PLAYING) {
      if (this.endSeconds !== undefined && this.startSeconds !== undefined && this.endSeconds > this.startSeconds) {
        const snippetDurationMs = (this.endSeconds - this.startSeconds) * 1000;
        if (snippetDurationMs > 0) {
          console.log(`AudioPlayer: Snippet playing. Will stop in ${snippetDurationMs / 1000} seconds.`);
          this.snippetTimeoutId = setTimeout(() => {
            if (this.player && typeof this.player.pauseVideo === 'function') {
              console.log(`AudioPlayer: Snippet ended. Pausing video.`);
              this.player.pauseVideo();
            }
          }, snippetDurationMs);
        } else {
           console.warn("AudioPlayer: Invalid snippet duration calculated.", {start: this.startSeconds, end: this.endSeconds});
        }
      }
    }
  }
  
  onPlayerError(event: any): void {
    console.error('AudioPlayer: YouTube Player Error:', event.data, `for videoId: ${this.videoId}`);
    // Handle different error codes: 2 (invalid parameter), 5, 100, 101, 150
  }

  public playSnippet(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (this.playerInstanceReady && this.player && typeof this.player.seekTo === 'function' && typeof this.player.playVideo === 'function') {
      if (this.snippetTimeoutId) {
        clearTimeout(this.snippetTimeoutId);
        this.snippetTimeoutId = null;
      }
      console.log(`AudioPlayer: playSnippet() called. Seeking to ${this.startSeconds}s and playing video ${this.videoId}.`);
      this.player.seekTo(this.startSeconds, true);
      this.player.playVideo();
    } else {
      console.warn('AudioPlayer: playSnippet() called, but player not ready or not available. Attempting to initialize.', {
        playerInstanceReady: this.playerInstanceReady,
        playerExists: !!this.player,
        videoId: this.videoId
      });
      if (this.videoId) {
        this.initializePlayerWhenApiReady();
      }
    }
  }

  // Add pauseVideo and stopVideo if needed to be called from parent
  public pauseVideo(): void {
    if (isPlatformBrowser(this.platformId) && this.playerInstanceReady && this.player && typeof this.player.pauseVideo === 'function') {
      this.player.pauseVideo();
    }
  }

  public stopVideo(): void {
     if (isPlatformBrowser(this.platformId) && this.playerInstanceReady && this.player && typeof this.player.stopVideo === 'function') {
      this.player.stopVideo();
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.snippetTimeoutId) {
        clearTimeout(this.snippetTimeoutId);
      }
      if (this.player && typeof this.player.destroy === 'function') {
        console.log("AudioPlayer: Destroying player instance.");
        this.player.destroy();
        this.player = null;
      }
    }
    // Note: Cleaning up the global onYouTubeIframeAPIReady and static flags is more complex
    // if multiple AudioPlayer instances could be created/destroyed independently and frequently.
    // For a single player on a page, this is less critical. A service is better for managing the global API state.
  }
}
