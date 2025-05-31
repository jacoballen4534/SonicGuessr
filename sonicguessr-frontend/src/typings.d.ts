// src/typings.d.ts
import 'express'; // Ensures you are augmenting the 'express' module
import { User as MyAppUser } from './app/services/auth'; // Path to your User interface definition

declare global {
  namespace Express {
    // Augment the Request interface to include properties added by Passport.js
    export interface Request {
      user?: MyAppUser; // Use your application's User type
      isAuthenticated?(): boolean;
      login?(user: MyAppUser, done: (err: any) => void): void;
      logout?(options?: any, done?: (err: any) => void): void; // Adjusted based on common Passport usage
                                                             // Check exact signature if needed
    }
  }
}