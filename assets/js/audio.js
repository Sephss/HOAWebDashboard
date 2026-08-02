/* ============================================================
   audio.js — Looping background music for authenticated pages.
   initBackgroundMusic() is called once by sidebar.js's renderShell(),
   which only ever runs after guardPage() confirms a signed-in admin/
   official — so this never plays on login.html or for signed-out
   visitors.
   ============================================================ */

// TODO: update this to match the actual file you placed in /assets/audio/
const TRACK_SRC = "audio/theojt-peaceful-fantasy-music.mp3";
const VOLUME = 0.35;
const MUTE_KEY = "hoa-music-muted";

let audioEl = null;

export function initBackgroundMusic() {
  if (audioEl) return null; // already initialized on this page

  audioEl = new Audio(TRACK_SRC);
  audioEl.loop = true;
  audioEl.volume = VOLUME;
  audioEl.preload = "auto";

  const startMuted = localStorage.getItem(MUTE_KEY) === "1";
  audioEl.muted = startMuted;

  attemptPlay();
  return buildToggleButton(startMuted);
}

function attemptPlay() {
  const playPromise = audioEl.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Most browsers block audio autoplay until the user interacts with
      // the page. Fall back to starting playback on the first click/key
      // press on this page — still feels instant in practice.
      const startOnInteraction = () => {
        audioEl.play().catch(() => {});
        document.removeEventListener("click", startOnInteraction);
        document.removeEventListener("keydown", startOnInteraction);
      };
      document.addEventListener("click", startOnInteraction, { once: true });
      document.addEventListener("keydown", startOnInteraction, { once: true });
    });
  }
}

function buildToggleButton(initiallyMuted) {
  const btn = document.createElement("button");
  btn.className = "icon-btn music-toggle-btn";
  btn.id = "musicToggleBtn";
  btn.setAttribute(
    "aria-label",
    initiallyMuted ? "Unmute background music" : "Mute background music",
  );
  btn.title = initiallyMuted
    ? "Unmute background music"
    : "Mute background music";
  btn.innerHTML = initiallyMuted ? muteIcon() : soundIcon();

  btn.addEventListener("click", () => {
    audioEl.muted = !audioEl.muted;
    localStorage.setItem(MUTE_KEY, audioEl.muted ? "1" : "0");
    btn.innerHTML = audioEl.muted ? muteIcon() : soundIcon();
    btn.title = audioEl.muted
      ? "Unmute background music"
      : "Mute background music";
    if (!audioEl.muted) audioEl.play().catch(() => {});
  });

  return btn;
}

function soundIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" stroke-linecap="round"/></svg>`;
}
function muteIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linejoin="round"/><path d="M23 9l-6 6M17 9l6 6" stroke-linecap="round"/></svg>`;
}
