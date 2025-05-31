// src/app/pages/profile-edit/profile-edit.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core'; // Added OnDestroy, inject
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService, User, UserProfileUpdatePayload } from '../../services/auth'; // Adjusted path assuming auth.service.ts is in services folder
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { FeedbackDisplay } from '../../components/feedback-display/feedback-display'; // Assuming this is the correct path

@Component({
  selector: 'app-profile-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, FeedbackDisplay], // Ensure FeedbackDisplay is imported
  templateUrl: './profile-edit.html',
  styleUrls: ['./profile-edit.scss']
})
export class ProfileEdit implements OnInit, OnDestroy { // Implement OnDestroy
  private authService = inject(AuthService);
  private router = inject(Router); // router is injected but not used in the provided code; keep if needed later
  private fb = inject(FormBuilder);

  profileForm!: FormGroup;
  currentUser: User | null = null;
  isLoading = false;
  
  // Properties for FeedbackDisplayComponent
  feedbackDisplay_message: string = '';
  feedbackDisplay_type: 'correct' | 'incorrect' | 'info' | null = null;
  // feedbackDisplay_points and feedbackDisplay_correctAnswer are not typically needed for profile update feedback

  private userSubscription!: Subscription;
  private updateSubscription!: Subscription; // For cleaning up the update profile subscription

  constructor() {
    this.profileForm = this.fb.group({
      // Use '|| '' in patchValue, so initial value here can be null or specific if needed
      username: ['', [Validators.minLength(3), Validators.maxLength(20)]],
      profile_image_url: ['', [Validators.pattern(/^https?:\/\/.+\..+$/)]] // Stricter URL pattern
    });
  }

  ngOnInit(): void {
    this.userSubscription = this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.profileForm.patchValue({
          username: user.username || '', 
          profile_image_url: user.profile_image_url || ''
        });
      } else {
        // Handle case where user becomes null (e.g., logged out while on page)
        // Optionally redirect or disable form
        this.profileForm.reset();
        this.profileForm.disable();
        this.feedbackDisplay_message = "User not logged in. Please log in to edit your profile.";
        this.feedbackDisplay_type = 'incorrect';
      }
    });
  }

  onSubmit(): void {
    // Clear previous feedback before submitting
    this.feedbackDisplay_message = '';
    this.feedbackDisplay_type = null;

    if (!this.currentUser) {
      this.feedbackDisplay_message = "You must be logged in to update your profile.";
      this.feedbackDisplay_type = 'incorrect';
      return;
    }
    
    // Mark all fields as touched to display validation messages if form is invalid on submit attempt
    this.profileForm.markAllAsTouched();

    if (this.profileForm.invalid) {
      this.feedbackDisplay_message = "Please correct the errors in the form.";
      this.feedbackDisplay_type = 'incorrect';
      return;
    }

    this.isLoading = true;

    const payload: UserProfileUpdatePayload = {};
    const formValues = this.profileForm.value;

    let changesMade = false;
    if (this.profileForm.get('username')?.dirty && this.profileForm.get('username')?.value.trim() !== (this.currentUser.username || '')) {
        payload.username = formValues.username.trim();
        changesMade = true;
    }
    // Check if profile_image_url is dirty (changed) and also different from current, or if it's newly provided and current was null/empty
    if (this.profileForm.get('profile_image_url')?.dirty && formValues.profile_image_url.trim() !== (this.currentUser.profile_image_url || '')) {
        payload.profile_image_url = formValues.profile_image_url.trim();
        // If URL is entered as empty string, and current wasn't empty, treat as a change to clear it
        if (payload.profile_image_url === '' && (this.currentUser.profile_image_url || '') !== '') {
           changesMade = true;
        } else if (payload.profile_image_url !== '') {
           changesMade = true;
        } else {
            delete payload.profile_image_url; // Don't send empty string if it wasn't a deliberate clear
        }
    }


    if (!changesMade && Object.keys(payload).length === 0) { // Check if any actual changes to send
      this.feedbackDisplay_message = "No changes detected to save.";
      this.feedbackDisplay_type = 'info';
      this.isLoading = false;
      return;
    }
    
    // If payload is empty but changes were made (e.g. field cleared to empty and that's a valid change)
    // This case should be handled by the specific logic above for populating payload.
    // The primary check is if Object.keys(payload).length === 0

    if (Object.keys(payload).length === 0) {
        this.feedbackDisplay_message = "No actual changes submitted to update.";
        this.feedbackDisplay_type = 'info';
        this.isLoading = false;
        return;
    }


    this.updateSubscription = this.authService.updateUserProfile(payload).subscribe({
      next: (updatedUser) => {
        this.isLoading = false;
        this.feedbackDisplay_message = 'Profile updated successfully!';
        this.feedbackDisplay_type = 'correct'; // Use 'correct' for success
        console.log('Profile updated by service, new user state:', updatedUser);
        this.profileForm.markAsPristine(); // Reset dirty state after successful save
      },
      error: (err) => {
        this.isLoading = false;
        this.feedbackDisplay_message = err.error?.error || 'Failed to update profile. Username might be taken or URL invalid.';
        this.feedbackDisplay_type = 'incorrect'; // Use 'incorrect' for error
        console.error('Profile update error:', err);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.updateSubscription) { // Unsubscribe from the update profile call if component is destroyed
        this.updateSubscription.unsubscribe();
    }
  }
}