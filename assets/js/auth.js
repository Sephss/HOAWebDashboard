/* ============================================================
   auth.js — Firebase Authentication + role-based route guard.
   Every protected page calls `guardPage()` on load; the login
   page calls `handleLogin()` on form submit.
   ============================================================ */
import {
  auth,
  db,
  ref,
  get,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  DB_PATHS,
  ALLOWED_ROLES,
  DENIED_ROLES,
} from "./firebase.js";
import { initBackgroundMusic } from "./audio.js";
const SESSION_KEY = "hoa_admin_profile";

/** Normalize a role string for comparison. */
function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isAllowedRole(role) {
  const r = normalizeRole(role);
  return (
    ALLOWED_ROLES.some((a) => normalizeRole(a) === r) ||
    r === "admin" ||
    r.includes("official")
  );
}

function isDeniedRole(role) {
  const r = normalizeRole(role);
  return (
    DENIED_ROLES.some((d) => normalizeRole(d) === r) ||
    r === "home owner" ||
    r === "homeowner" ||
    r === "renter" ||
    r === "renters"
  );
}

/**
 * Fetch a user's profile record from Realtime Database by UID.
 */
export async function fetchUserProfile(uid) {
  const snap = await get(ref(db, `${DB_PATHS.users}/${uid}`));
  return snap.exists() ? { uid, ...snap.val() } : null;
}

/**
 * Attempt sign in with email/password, then verify role authorization.
 * Throws a friendly Error with a `.code` string on failure.
 */
export async function handleLogin(email, password, remember = true) {
  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence,
  );

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw mapAuthError(err);
  }

  const uidVal = credential.user.uid;
  const profile = await fetchUserProfile(uidVal);

  if (!profile) {
    await signOut(auth);
    const e = new Error(
      "We couldn't find an account record for this login. Please contact your system administrator.",
    );
    e.code = "profile/not-found";
    throw e;
  }

  const role = profile.role || profile.userRole || profile.accountType || "";

  if (isDeniedRole(role) || !isAllowedRole(role)) {
    await signOut(auth);
    const e = new Error("You are not authorized to access this dashboard.");
    e.code = "auth/not-authorized";
    throw e;
  }

  if (String(profile.isAccountDisabled).toLowerCase() === "yes") {
    await signOut(auth);
    const e = new Error(
      "Your account has been disabled. Please contact a system administrator.",
    );
    e.code = "auth/disabled";
    throw e;
  }

  if (String(profile.isAccountBanned).toLowerCase() === "yes") {
    await signOut(auth);
    const e = new Error("Your account has been banned from this system.");
    e.code = "auth/banned";
    throw e;
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  return profile;
}

/** Human-friendly Firebase Auth error mapping. */
function mapAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with this email address.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password. Please try again.",
    "auth/invalid-login-credentials":
      "Incorrect email or password. Please try again.",
    "auth/too-many-requests":
      "Too many failed attempts. Please wait a moment and try again.",
    "auth/network-request-failed":
      "Network error. Please check your connection and try again.",
    "auth/missing-password": "Please enter your password.",
  };
  const e = new Error(
    map[code] ||
      "Unable to sign in. Please check your credentials and try again.",
  );
  e.code = code || "auth/unknown";
  return e;
}

export async function requestPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  await signOut(auth);
  window.location.href = "login.html";
}

/** Synchronously read the cached profile from this session (fast path for UI paint). */
export function getCachedProfile() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Protect a dashboard page. Resolves with the authorized user profile,
 * or redirects to login.html and never resolves.
 */
export function guardPage() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        redirectToLogin();
        return;
      }
      let profile = getCachedProfile();
      if (!profile || profile.uid !== user.uid) {
        profile = await fetchUserProfile(user.uid);
      }
      const role =
        profile?.role || profile?.userRole || profile?.accountType || "";

      if (!profile || isDeniedRole(role) || !isAllowedRole(role)) {
        await signOut(auth);
        redirectToLogin("unauthorized");
        return;
      }
      if (
        String(profile.isAccountDisabled).toLowerCase() === "yes" ||
        String(profile.isAccountBanned).toLowerCase() === "yes"
      ) {
        await signOut(auth);
        redirectToLogin("restricted");
        return;
      }
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ uid: user.uid, ...profile }),
      );
      resolve({ uid: user.uid, ...profile });
    });
  });
}

function redirectToLogin(reason) {
  const suffix = reason ? `?reason=${reason}` : "";
  window.location.href = `login.html${suffix}`;
}
