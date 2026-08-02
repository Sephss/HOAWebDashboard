/* ============================================================
   ui.js — Reusable UI primitives (toasts, modals, dropdowns,
   theme toggle, confirm dialogs). Import what you need.
   ============================================================ */
import { uid, escapeHtml } from "./utils.js";

/* ---------------------------------------------------------
   TOASTS
   --------------------------------------------------------- */
let toastStack = null;
function getToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

const TOAST_ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2L12 3z" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke-linecap="round"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M11 12h1v5h1" stroke-linecap="round"/></svg>`,
};

/**
 * Show a toast notification.
 * @param {Object} opts { type: 'success'|'danger'|'warning'|'info', title, desc, duration }
 */
export function toast({ type = "info", title, desc = "", duration = 4200 } = {}) {
  const stack = getToastStack();
  const el = document.createElement("div");
  const id = uid("toast");
  el.className = `toast toast-${type}`;
  el.id = id;
  el.innerHTML = `
    <span class="toast__icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <div style="flex:1;min-width:0;">
      <div class="toast__title">${escapeHtml(title)}</div>
      ${desc ? `<div class="toast__desc">${escapeHtml(desc)}</div>` : ""}
    </div>
    <button class="toast__close" aria-label="Dismiss">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
    </button>
  `;
  stack.appendChild(el);
  const remove = () => {
    el.classList.add("removing");
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector(".toast__close").addEventListener("click", remove);
  if (duration > 0) setTimeout(remove, duration);
  return id;
}

/* ---------------------------------------------------------
   MODALS
   --------------------------------------------------------- */
let activeOverlay = null;

/**
 * Open a modal built from HTML content. Returns the overlay element
 * so the caller can wire up its own footer button listeners.
 */
export function openModal({ title, subtitle = "", bodyHTML = "", footerHTML = "", size = "" , onClose } = {}) {
  closeModal(); // enforce single modal at a time
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal__header">
        <div>
          <div class="modal__title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="modal__subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        <button class="modal__close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal__footer">${footerHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlay.classList.add("open"));

  const close = () => {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => {
      overlay.remove();
      if (activeOverlay === overlay) activeOverlay = null;
      if (onClose) onClose();
    }, 200);
  };
  overlay.querySelector(".modal__close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  const escHandler = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); } };
  document.addEventListener("keydown", escHandler);

  overlay.close = close;
  activeOverlay = overlay;
  return overlay;
}

export function closeModal() {
  if (activeOverlay && activeOverlay.close) activeOverlay.close();
}

/**
 * Confirmation dialog. Resolves `true` if confirmed, `false` if cancelled.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger" } = {}) {
  return new Promise((resolve) => {
    const iconClass = tone === "danger" ? "" : tone === "warning" ? "warn" : "success";
    const btnClass = tone === "danger" ? "btn-danger" : tone === "warning" ? "btn-accent" : "btn-success";
    const overlay = openModal({
      title,
      bodyHTML: `
        <div class="modal-icon-badge ${iconClass}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4M12 17h.01" stroke-linecap="round"/><circle cx="12" cy="12" r="9"/>
          </svg>
        </div>
        <p style="font-size:14px;color:var(--color-grey);line-height:1.6;">${message}</p>
      `,
      footerHTML: `
        <button class="btn btn-secondary" data-act="cancel">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${btnClass}" data-act="confirm">${escapeHtml(confirmLabel)}</button>
      `,
      onClose: () => resolve(false),
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => overlay.close());
    overlay.querySelector('[data-act="confirm"]').addEventListener("click", () => {
      resolve(true);
      overlay.onClose = null;
      overlay.close();
      // prevent double resolve from onClose
      overlay.close = () => {
        overlay.classList.remove("open");
        setTimeout(() => overlay.remove(), 200);
      };
    });
  });
}

/* ---------------------------------------------------------
   DROPDOWNS
   --------------------------------------------------------- */
document.addEventListener("click", (e) => {
  document.querySelectorAll(".dropdown__menu.open").forEach((menu) => {
    const trigger = menu.closest(".dropdown")?.querySelector("[data-dropdown-trigger]");
    if (!menu.contains(e.target) && e.target !== trigger && !trigger?.contains(e.target)) {
      menu.classList.remove("open");
    }
  });
});

export function initDropdown(dropdownEl) {
  const trigger = dropdownEl.querySelector("[data-dropdown-trigger]");
  const menu = dropdownEl.querySelector(".dropdown__menu");
  if (!trigger || !menu) return;
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".dropdown__menu.open").forEach((m) => { if (m !== menu) m.classList.remove("open"); });
    menu.classList.toggle("open");
  });
}

/* ---------------------------------------------------------
   THEME (dark mode)
   --------------------------------------------------------- */
export function initTheme() {
  const saved = localStorage.getItem("hoa-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  return saved;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("hoa-theme", next);
  return next;
}

/* ---------------------------------------------------------
   SKELETON HELPERS
   --------------------------------------------------------- */
export function skeletonRows(count = 5, cols = 5) {
  return Array.from({ length: count })
    .map(
      () => `<tr>${Array.from({ length: cols }).map(() => `<td><div class="skeleton skeleton-text" style="width:${60 + Math.random() * 30}%"></div></td>`).join("")}</tr>`
    )
    .join("");
}

export function emptyState({ icon = defaultEmptyIcon(), title, desc = "", actionHTML = "" }) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">${icon}</div>
      <div class="empty-state__title">${escapeHtml(title)}</div>
      ${desc ? `<div class="empty-state__desc">${escapeHtml(desc)}</div>` : ""}
      ${actionHTML}
    </div>
  `;
}

function defaultEmptyIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18"/></svg>`;
}

/* ---------------------------------------------------------
   BACK TO TOP
   --------------------------------------------------------- */
export function initBackToTop() {
  const btn = document.createElement("button");
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(btn);
  const content = document.querySelector(".content") || window;
  const target = document.querySelector(".content");
  const onScroll = () => {
    const y = target ? target.scrollTop : window.scrollY;
    btn.classList.toggle("show", y > 400);
  };
  (target || window).addEventListener("scroll", onScroll);
  btn.addEventListener("click", () => (target || window).scrollTo({ top: 0, behavior: "smooth" }));
}
