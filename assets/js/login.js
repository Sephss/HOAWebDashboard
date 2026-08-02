/* ============================================================
   login.js — Login page controller
   ============================================================ */
import { handleLogin, requestPasswordReset } from "./auth.js";
import { onAuthStateChanged, auth } from "./firebase.js";
import { getQueryParam } from "./utils.js";

const form = document.getElementById("loginForm");
const alertBox = document.getElementById("loginAlert");
const alertText = document.getElementById("loginAlertText");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const submitBtn = document.getElementById("loginSubmitBtn");
const togglePwBtn = document.getElementById("togglePasswordBtn");
const rememberInput = document.getElementById("rememberMeInput");
const forgotBtn = document.getElementById("forgotPasswordBtn");

const REASON_MESSAGES = {
  unauthorized: "You are not authorized to access this dashboard.",
  restricted: "Your account access has been restricted. Please contact an administrator.",
};

// If a redirect reason is present in the URL, surface it.
const reason = getQueryParam("reason");
if (reason && REASON_MESSAGES[reason]) {
  showAlert(REASON_MESSAGES[reason]);
}

// If already authenticated with a valid session, skip straight to dashboard.
onAuthStateChanged(auth, (user) => {
  if (user && !reason) {
    window.location.href = "index.html";
  }
});

togglePwBtn.addEventListener("click", () => {
  const isPw = passwordInput.type === "password";
  passwordInput.type = isPw ? "text" : "password";
  togglePwBtn.innerHTML = isPw ? eyeOffIcon() : eyeIcon();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  clearFieldErrors();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  let hasError = false;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    setFieldError(emailInput, "Enter a valid email address.");
    hasError = true;
  }
  if (!password) {
    setFieldError(passwordInput, "Enter your password.");
    hasError = true;
  }
  if (hasError) return;

  setLoading(true);
  try {
    await handleLogin(email, password, rememberInput.checked);
    window.location.href = "index.html";
  } catch (err) {
    showAlert(err.message || "Unable to sign in. Please try again.");
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential" || err.code === "auth/invalid-login-credentials") {
      setFieldError(passwordInput, "");
    }
  } finally {
    setLoading(false);
  }
});

forgotBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    setFieldError(emailInput, "Enter your email above first, then click “Forgot password”.");
    return;
  }
  try {
    await requestPasswordReset(email);
    showAlert(`A password reset link has been sent to ${email}.`, "info");
  } catch (err) {
    showAlert(err.message);
  }
});

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.innerHTML = isLoading
    ? `<span class="spinner"></span> Signing in…`
    : `Sign In <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function showAlert(msg, tone = "danger") {
  alertText.textContent = msg;
  alertBox.classList.add("show");
  alertBox.style.background = tone === "info" ? "var(--color-info-bg)" : "var(--color-danger-bg)";
  alertBox.style.color = tone === "info" ? "#1a4faa" : "#8f2323";
}
function hideAlert() {
  alertBox.classList.remove("show");
}

function setFieldError(input, msg) {
  const field = input.closest(".field");
  field.classList.add("has-error");
  const errEl = field.querySelector(".field-error");
  if (errEl && msg) errEl.textContent = msg;
}
function clearFieldErrors() {
  document.querySelectorAll(".field.has-error").forEach((f) => f.classList.remove("has-error"));
}

function eyeIcon() {
  return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function eyeOffIcon() {
  return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a20.3 20.3 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 7 11 7a20.3 20.3 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 1l22 22" stroke-linecap="round"/></svg>`;
}
