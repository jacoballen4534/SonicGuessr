import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router'; // Import router directives

@Component({
  selector: 'app-root', // This is the selector used in index.html
  standalone: true,     // Mark the root component as standalone
  imports: [
    RouterOutlet,     // Necessary for <router-outlet>
    RouterLink,       // For using routerLink attribute in navigation
    RouterLinkActive  // For styling active router links (optional)
  ],
  templateUrl: './app.html', // Your root component's template
  styleUrls: ['./app.scss']  // Your root component's styles
})
export class App { // Your class name
  title = 'SonicGuessr Frontend'; // An example property
}