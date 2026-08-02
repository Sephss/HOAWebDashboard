/* ============================================================
   firebase.js — Firebase app initialization
   Single source of truth for the Firebase SDK instances used
   across the entire dashboard. Every other module imports the
   `auth` and `db` instances from here instead of re-initializing.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  child,
  query,
  orderByChild,
  onValue,
  off,
  equalTo,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDHbQNSAdR9P7FYTz7jLgNyLmfTtliQlk",
  authDomain: "hoa-management-system-db762.firebaseapp.com",
  databaseURL:
    "https://hoa-management-system-db762-default-rtdb.firebaseio.com",
  projectId: "hoa-management-system-db762",
  storageBucket: "hoa-management-system-db762.firebasestorage.app",
  messagingSenderId: "939014493527",
  appId: "1:939014493527:web:45279d04c036482f355a12",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  ref,
  get,
  set,
  update,
  remove,
  push,
  child,
  query,
  orderByChild,
  onValue,
  off,
  equalTo,
};

/** Database path constants — keep every module's paths in sync. */
export const DB_PATHS = {
  users: "users",
  documentRequests: "document_requests",
  grievanceReports: "Grievance",
  maintenanceRequests: "Maintenance",
  announcements: "announcements",
  appSettings: "appSettings",
  notifications: "Notifications",
  bookings: "Bookings",
  bookingSlots: "BookingSlots",
  bookingsSlot: "BookingSlots",
};

/** Roles allowed to sign in to this dashboard. */
export const ALLOWED_ROLES = ["Admin", "HOA Official", "HOA Officials"];

/** Roles explicitly denied dashboard access. */
export const DENIED_ROLES = ["Home Owners", "Renters", "Homeowner", "Renter"];
