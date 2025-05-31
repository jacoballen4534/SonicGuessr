// src/app/pages/profile-edit/profile-edit.ts (Simplified example)
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService, User, UserProfileUpdatePayload } from '../../services/auth'; // Adjust path
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-profile-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule], // Import ReactiveFormsModule
  templateUrl: './profile-edit.html',
  styleUrls: ['./profile-edit.scss']
})
export class ProfileEdit implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  profileForm!: FormGroup;
  currentUser: User | null = null;
  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  private userSubscription!: Subscription;

  constructor() {
    this.profileForm = this.fb.group({
      username: ['', [Validators.minLength(3), Validators.maxLength(20)]],
      profile_image_url: ['', [Validators.pattern('https?://.+')]] // Basic URL pattern
    });
  }

  ngOnInit(): void {
    this.userSubscription = this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.profileForm.patchValue({
          username: user.username || '', // Use custom username if set, else Google display_name
          profile_image_url: user.profile_image_url || ''
        });
      }
    });
  }

  onSubmit(): void {
    if (this.profileForm.invalid) {
      this.errorMessage = "Please correct the form errors.";
      return;
    }
    if (!this.currentUser) {
        this.errorMessage = "You must be logged in to update your profile.";
        return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const payload: UserProfileUpdatePayload = {};
    const formValues = this.profileForm.value;

    // Only include fields if they have been touched/changed and are valid, or have a value
    if (formValues.username && formValues.username.trim() !== (this.currentUser.username || '')) {
        payload.username = formValues.username.trim();
    }
    if (formValues.profile_image_url && formValues.profile_image_url.trim() !== (this.currentUser.profile_image_url || '')) {
        payload.profile_image_url = formValues.profile_image_url.trim();
    }

    if (Object.keys(payload).length === 0) {
        this.successMessage = "No changes to save.";
        this.isLoading = false;
        return;
    }


    this.authService.updateUserProfile(payload).subscribe({
      next: (updatedUser) => {
        this.isLoading = false;
        this.successMessage = 'Profile updated successfully!';
        console.log('Profile updated:', updatedUser);
        // Optionally navigate away or refresh data
        // this.router.navigate(['/some-other-page']);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.error || 'Failed to update profile. Please try again.';
        console.error('Profile update error:', err);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }
}