/* ============================================================
   sidebar.js — Renders the shared sidebar + topbar shell into
   every protected page, wires navigation, theme, notifications,
   profile menu, logout, and keyboard shortcuts.
   ============================================================ */
import { logout } from "./auth.js";
import {
  initTheme,
  toggleTheme,
  initDropdown,
  initBackToTop,
  toast,
} from "./ui.js";
import { initials, timeAgo } from "./utils.js";
import { db, ref, onValue, DB_PATHS } from "./firebase.js";
import { initBackgroundMusic } from "./audio.js";
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="9" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="12" width="8" height="9" rx="2"/><rect x="3" y="16" width="8" height="5" rx="2"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-linecap="round"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke-linecap="round"/></svg>`,
  documents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-linejoin="round"/><path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" stroke-linecap="round"/></svg>`,
  grievance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke-linecap="round"/></svg>`,
  maintenance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a4 4 0 11-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 015.4-5.4z" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  announcements: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l18-7v16l-18-7z" stroke-linejoin="round"/><path d="M11 16.5V20a2 2 0 002 2h1" stroke-linecap="round"/></svg>`,
  attendees: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  analytics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18" stroke-linecap="round"/><path d="M7 15l4-5 3 3 5-7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke-linecap="round"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-linejoin="round"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke-linecap="round"/></svg>`,
};

const NAV = [
  {
    section: "Overview",
    links: [
      {
        id: "dashboard",
        href: "index.html",
        label: "Dashboard",
        icon: ICONS.dashboard,
      },
      {
        id: "analytics",
        href: "analytics.html",
        label: "Analytics",
        icon: ICONS.analytics,
      },
    ],
  },
  {
    section: "Management",
    links: [
      {
        id: "users",
        href: "users.html",
        label: "Residents & Users",
        icon: ICONS.users,
        countKey: "pendingUsers",
      },
      {
        id: "documents",
        href: "documents.html",
        label: "Document Requests",
        icon: ICONS.documents,
        countKey: "pendingDocs",
      },
      {
        id: "grievances",
        href: "grievances.html",
        label: "Grievance Reports",
        icon: ICONS.grievance,
        countKey: "pendingGrievances",
      },
      {
        id: "maintenance",
        href: "maintenance.html",
        label: "Maintenance",
        icon: ICONS.maintenance,
        countKey: "pendingMaintenance",
      },
      {
        id: "reservations",
        href: "reservations.html",
        label: "Facilities Reservation",
        icon: ICONS.calendar,
      },
      {
        id: "announcements",
        href: "announcements.html",
        label: "Announcements",
        icon: ICONS.announcements,
      },
      {
        id: "attendees",
        href: "attendees.html",
        label: "Attendees",
        icon: ICONS.attendees,
      },
    ],
  },
  {
    section: "System",
    links: [
      {
        id: "settings",
        href: "settings.html",
        label: "Settings",
        icon: ICONS.settings,
      },
    ],
  },
];

let badgeCounts = {
  pendingUsers: 0,
  pendingDocs: 0,
  pendingGrievances: 0,
  pendingMaintenance: 0,
};

/**
 * Render the full app shell (sidebar + topbar) around the page's
 * existing `<main class="content" id="page-content">` element.
 * @param {string} activeId - matches a NAV link id
 * @param {Object} profile - the signed-in admin/official profile
 * @param {Object} opts - { breadcrumb: string }
 */
export function renderShell(activeId, profile, opts = {}) {
  initTheme();
  const shell = document.getElementById("app-shell");
  const content = document.getElementById("page-content");
  if (!shell || !content) return;

  const collapsedSaved = localStorage.getItem("hoa-sidebar-collapsed") === "1";

  const sidebar = document.createElement("aside");
  sidebar.className = `sidebar${collapsedSaved ? " collapsed" : ""}`;
  sidebar.innerHTML = `
    <div class="sidebar__brand">
      <div class="sidebar__brand-mark">HM</div>
      <div class="sidebar__brand-text">
        <div class="sidebar__brand-title">HOA Manager</div>
        <div class="sidebar__brand-sub">Admin Console</div>
      </div>
    </div>
    <nav class="sidebar__nav">
      ${NAV.map(
        (group) => `
        <div class="sidebar__section-label">${group.section}</div>
        ${group.links
          .map(
            (l) => `
          <a href="${l.href}" class="sidebar__link${l.id === activeId ? " active" : ""}" data-nav-id="${l.id}" title="${l.label}">
            ${l.icon}
            <span>${l.label}</span>
            ${l.countKey ? `<span class="badge-count hidden" data-count="${l.countKey}">0</span>` : ""}
          </a>
        `,
          )
          .join("")}
      `,
      ).join("")}
    </nav>
    <div class="sidebar__footer">
      <button class="sidebar__collapse-btn" id="sidebarCollapseBtn">
        ${ICONS.chevron}
        <span>Collapse</span>
      </button>
    </div>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";
  backdrop.id = "sidebarBackdrop";

  shell.prepend(backdrop);
  shell.prepend(sidebar);

  const mainCol = content.closest(".main-col") || content.parentElement;

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const activeLink = NAV.flatMap((g) => g.links).find((l) => l.id === activeId);
  topbar.innerHTML = `
    <div class="topbar__left">
      <button class="topbar__menu-btn" id="mobileMenuBtn" aria-label="Toggle menu">${ICONS.menu}</button>
      <div class="breadcrumb">
        <span class="breadcrumb__current">${opts.breadcrumb || activeLink?.label || "Dashboard"}</span>
      </div>
    </div>
    <div class="topbar__right">
      <button class="icon-btn" id="themeToggleBtn" aria-label="Toggle dark mode" title="Toggle theme">
        ${document.documentElement.getAttribute("data-theme") === "dark" ? ICONS.sun : ICONS.moon}
      </button>
      <div class="dropdown">
        <button class="profile-trigger" data-dropdown-trigger>
          <div class="avatar">${initials([profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.email)}</div>
          <div class="profile-trigger__meta">
            <div class="profile-trigger__name">${[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Admin"}</div>
            <div class="profile-trigger__role">${profile?.role || "Administrator"}</div>
          </div>
          ${ICONS.chevron}
        </button>
        <div class="dropdown__menu">
          <div class="dropdown__label">Signed in as</div>
          <div style="padding:2px 10px 10px;font-size:13px;color:var(--color-black);font-weight:600;word-break:break-all;">${profile?.email || ""}</div>
          <div class="dropdown__divider"></div>
          <button class="dropdown__item danger" id="logoutBtn">${ICONS.logout}Sign out</button>
        </div>
      </div>
    </div>
  `;
  mainCol.insertBefore(topbar, content);

  // --- collapse toggle (desktop) ---
  const collapseBtn = sidebar.querySelector("#sidebarCollapseBtn");
  collapseBtn.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    localStorage.setItem("hoa-sidebar-collapsed", collapsed ? "1" : "0");
  });

  // --- mobile menu toggle ---
  const mobileBtn = topbar.querySelector("#mobileMenuBtn");
  mobileBtn.addEventListener("click", () => {
    sidebar.classList.toggle("mobile-open");
    backdrop.classList.toggle("show");
  });
  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("mobile-open");
    backdrop.classList.remove("show");
  });

  // --- theme toggle ---
  topbar.querySelector("#themeToggleBtn").addEventListener("click", (e) => {
    const next = toggleTheme();
    e.currentTarget.innerHTML = next === "dark" ? ICONS.sun : ICONS.moon;
  });

  // --- dropdowns ---
  shell.querySelectorAll(".dropdown").forEach(initDropdown);

  // --- logout ---
  topbar.querySelector("#logoutBtn").addEventListener("click", async () => {
    toast({ type: "info", title: "Signing out…", duration: 1200 });
    await logout();
  });

  initBackToTop();
  bindBadgeCounts(shell);
  // --- theme toggle ---
  topbar.querySelector("#themeToggleBtn").addEventListener("click", (e) => {
    const next = toggleTheme();
    e.currentTarget.innerHTML = next === "dark" ? ICONS.sun : ICONS.moon;
  });

  // --- background music toggle, placed right after the theme toggle ---
  const musicBtn = initBackgroundMusic();
  if (musicBtn) {
    topbar
      .querySelector("#themeToggleBtn")
      .insertAdjacentElement("afterend", musicBtn);
  }
  const loader = document.getElementById("pageLoader");
  if (loader) setTimeout(() => loader.remove(), 180);
}

/** Live-update sidebar badge counts (pending items) from Firebase. */
function bindBadgeCounts(shell) {
  const applyCounts = () => {
    shell.querySelectorAll("[data-count]").forEach((el) => {
      const key = el.dataset.count;
      const val = badgeCounts[key] || 0;
      el.textContent = val > 99 ? "99+" : val;
      el.classList.toggle("hidden", val === 0);
    });
  };

  onValue(ref(db, DB_PATHS.users), (snap) => {
    let pending = 0;
    snap.forEach((child) => {
      const v = child.val();
      if (String(v.isAccountApprovedByAdmin).toLowerCase() !== "yes") pending++;
    });
    badgeCounts.pendingUsers = pending;
    applyCounts();
  });

  onValue(ref(db, DB_PATHS.documentRequests), (snap) => {
    let pending = 0;
    snap.forEach((child) => {
      if (isPendingStatus(child.val().requestStatus)) pending++;
    });
    badgeCounts.pendingDocs = pending;
    applyCounts();
  });

  onValue(ref(db, DB_PATHS.grievanceReports), (snap) => {
    let pending = 0;
    snap.forEach((child) => {
      if (isPendingStatus(child.val().incidentStatus)) pending++;
    });
    badgeCounts.pendingGrievances = pending;
    applyCounts();
  });

  onValue(ref(db, DB_PATHS.maintenanceRequests), (snap) => {
    let pending = 0;
    snap.forEach((child) => {
      if (isPendingStatus(child.val().maintenanceStatus)) pending++;
    });
    badgeCounts.pendingMaintenance = pending;
    applyCounts();
  });
}

function isPendingStatus(status) {
  return (
    String(status || "")
      .toLowerCase()
      .trim() === "pending"
  );
}
