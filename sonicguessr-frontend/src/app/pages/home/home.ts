import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common'; // For *ngIf, *ngFor, etc.
import { Router, RouterLink } from '@angular/router'; // Import RouterLink for navigation links

// Optional: If you create a service to fetch stats for the home page
// import { HomeDataService } from '../../services/home-data.service';

@Component({
  selector: 'app-home-page', // Or 'app-home' if you prefer
  standalone: true,
  imports: [
    CommonModule,
    RouterLink // Needed because the example home.html uses <a routerLink="...">
  ],
  templateUrl: './home.html', // Following your file naming convention
  styleUrls: ['./home.scss']  // Following your file naming convention
})
export class Home implements OnInit {
  private router = inject(Router);
  // private homeDataService = inject(HomeDataService); // Example for fetching dynamic data

  // Property to control visibility of the secondary info widgets section
  showExtraInfo: boolean = true;

  // Property to hold the number of songs for today's challenge (example)
  // This would ideally come from a configuration or a quick API call.
  // For now, we can hardcode it or fetch it if you have an endpoint.
  dailySongCount: number = 10; // Placeholder - adjust as needed or make dynamic

  // You could add more properties here if your home page widgets need them, e.g.:
  // todaysTopScore: number = 0;

  constructor() {
    console.log('HomeComponent constructor: Initializing home page.');
    // If you have a service to fetch initial simple data for the home page,
    // you could call it here or in ngOnInit.
    // For example, fetching DAILY_SONG_COUNT from a shared config service.
    // For now, dailySongCount is set with a default value.
  }

  ngOnInit(): void {
    console.log('HomeComponent ngOnInit: Home page is ready.');
    // Example: If you wanted to fetch dynamic data for the widgets:
    // this.homeDataService.getHomePageStats().subscribe(stats => {
    //   this.dailySongCount = stats.dailySongCount;
    //   this.todaysTopScore = stats.todaysTopScore;
    // });
  }

  // Method to navigate to the daily challenge page
  navigateToDailyChallenge(): void {
    this.router.navigate(['/daily-challenge']);
  }

  // You can add other methods here if your home page has more interactivity
}