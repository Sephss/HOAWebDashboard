/* ============================================================
   dashboard.js — Dashboard home page controller
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, DB_PATHS } from "./firebase.js";
import {
  objectToArray,
  isYes,
  getFullName,
  formatDate,
  formatDateTime,
  timeAgo,
  statusToken,
  humanize,
  escapeHtml,
  printHTML,
} from "./utils.js";
import { toast, openModal } from "./ui.js";

const profile = await guardPage();
renderShell("dashboard", profile, { breadcrumb: "Dashboard" });

const content = document.getElementById("page-content");

content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Welcome back, ${firstName(profile)}!</div>
      <div class="page-header__subtitle">Here's what's happening across your association today.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-secondary" id="printReportBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Print Report
      </button>
      <button class="btn btn-secondary" id="refreshBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
      </button>
      <span class="badge badge-neutral" id="autoRefreshBadge">Auto-refresh: 60s</span>
    </div>
  </div>

  <div class="stat-grid" id="userStatGrid"></div>
  <div class="stat-grid" id="moduleStatGrid"></div>

  <div class="card">
    <div class="card-header">
      <h3>Recent activity</h3>
      <span class="badge badge-neutral" id="activityCount">0 events</span>
    </div>
    <div class="card-body" style="padding-top:20px;">
      <div class="timeline" id="activityTimeline"></div>
    </div>
  </div>
`;

document.getElementById("refreshBtn").addEventListener("click", () => {
  toast({ type: "success", title: "Dashboard refreshed", duration: 1800 });
  loadAll();
});

document
  .getElementById("printReportBtn")
  .addEventListener("click", () => openReportModal());

let dataStore = {
  users: [],
  docs: [],
  grievances: [],
  maintenance: [],
  announcements: [],
};

function bindLive(path, key) {
  onValue(ref(db, path), (snap) => {
    dataStore[key] = objectToArray(snap.val());
    render();
  });
}
function loadAll() {
  bindLive(DB_PATHS.users, "users");
  bindLive(DB_PATHS.documentRequests, "docs");
  bindLive(DB_PATHS.grievanceReports, "grievances");
  bindLive(DB_PATHS.maintenanceRequests, "maintenance");
  bindLive(DB_PATHS.announcements, "announcements");
}
loadAll();

// Auto-refresh visual pulse every 60s (data is already live via onValue).
setInterval(() => {
  const badge = document.getElementById("autoRefreshBadge");
  if (badge) {
    badge.textContent = "Synced just now";
    setTimeout(() => (badge.textContent = "Auto-refresh: 60s"), 2000);
  }
}, 60000);

function render() {
  renderUserStats();
  renderModuleStats();
  renderActivity();
}

function renderUserStats() {
  const users = dataStore.users;
  const total = users.length;
  const approved = users.filter((u) =>
    isYes(u.isAccountApprovedByAdmin),
  ).length;
  const pending = total - approved;
  const disabled = users.filter((u) => isYes(u.isAccountDisabled)).length;
  const banned = users.filter((u) => isYes(u.isAccountBanned)).length;

  const cards = [
    { label: "Total Users", value: total, icon: iconUsers(), trend: null },
    { label: "Approved Users", value: approved, icon: iconCheck(), tone: "up" },
    {
      label: "Pending Approval",
      value: pending,
      icon: iconClock(),
      tone: pending > 0 ? "down" : null,
    },
    { label: "Disabled Users", value: disabled, icon: iconSlash() },
    { label: "Banned Users", value: banned, icon: iconBan() },
  ];
  document.getElementById("userStatGrid").innerHTML = cards
    .map(statCardHTML)
    .join("");
}

function renderModuleStats() {
  const cards = [
    {
      label: "Document Requests",
      value: dataStore.docs.length,
      icon: iconDoc(),
    },
    {
      label: "Grievance Reports",
      value: dataStore.grievances.length,
      icon: iconGrievance(),
    },
    {
      label: "Maintenance Requests",
      value: dataStore.maintenance.length,
      icon: iconMaint(),
    },
    {
      label: "Announcements",
      value: dataStore.announcements.length,
      icon: iconAnnounce(),
    },
  ];
  document.getElementById("moduleStatGrid").innerHTML = cards
    .map(statCardHTML)
    .join("");
}

function renderActivity() {
  const events = [];
  dataStore.users.forEach((u) =>
    events.push({
      type: "user",
      label: `${u.fullName || u.name || "New resident"} registered`,
      ts: u.dateRegistered || u.timestamp || u.createdAt,
      status: isYes(u.isAccountApprovedByAdmin) ? "approved" : "pending",
    }),
  );
  dataStore.docs.forEach((d) =>
    events.push({
      type: "doc",
      label: `Document request — ${humanize(d.documentType || "Request")} by ${d.requesterName || "resident"}`,
      ts: d.requstTimestamp || d.requestDate,
      status: statusToken(d.requestStatus),
    }),
  );
  dataStore.grievances.forEach((g) =>
    events.push({
      type: "grievance",
      label: `Grievance reported — ${g.incidentTitle || "Untitled"}`,
      ts: g.timestamp || g.dateSubmitted,
      status: statusToken(g.incidentStatus),
    }),
  );
  dataStore.maintenance.forEach((m) =>
    events.push({
      type: "maintenance",
      label: `Maintenance request — ${m.maintenanceTitle || "Untitled"}`,
      ts: m.timestamp || m.dateSubmitted,
      status: statusToken(m.maintenanceStatus),
    }),
  );
  dataStore.announcements.forEach((a) =>
    events.push({
      type: "announcement",
      label: `Announcement published — ${a.title || "Untitled"}`,
      ts: a.timestamp || a.dateCreated,
      status: "approved",
    }),
  );

  events.sort((a, b) => (toMs(b.ts) || 0) - (toMs(a.ts) || 0));
  const top = events.slice(0, 10);

  document.getElementById("activityCount").textContent =
    `${events.length} events`;

  const el = document.getElementById("activityTimeline");
  if (!top.length) {
    el.innerHTML = `<div style="color:var(--color-grey);font-size:13px;padding:20px 0;text-align:center;">No recent activity yet.</div>`;
    return;
  }
  el.innerHTML = top
    .map(
      (e, i) => `
    <div class="timeline__item ${i === 0 ? "active" : e.status === "approved" || e.status === "resolved" ? "done" : ""}">
      <div class="timeline__dot"></div>
      <div class="timeline__title">${e.label}</div>
      <div class="timeline__meta">${timeAgo(e.ts)} · ${formatDateTime(e.ts)}</div>
    </div>
  `,
    )
    .join("");
}

/* ============================================================
   PRINT REPORT — Today / This Week / This Month / Custom Range
   Filters by the child's timestamp field (string, unix seconds)
   and only includes the specific "done" status per module:
   documents -> requestStatus "approved"
   grievances -> incidentStatus "resolved"
   maintenance -> maintenanceStatus "completed"
   ============================================================ */

function openReportModal() {
  const overlay = openModal({
    title: "Print Report",
    subtitle: "Generate a printable summary of completed requests",
    bodyHTML: `
      <div class="field">
        <label>Report Range</label>
        <select class="select" id="reportRangeSelect">
          <option value="today">Today</option>
          <option value="week">This Week (Sun – today)</option>
          <option value="month">This Month</option>
          <option value="custom">Custom Range…</option>
        </select>
        <span class="hint">Filtered using each record's submission date.</span>
      </div>

      <div id="customRangeFields" class="hidden" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:-4px;margin-bottom:20px;">
        <div class="field" style="margin-bottom:0;">
          <label>From</label>
          <input type="date" class="input" id="customFromInput">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>To</label>
          <input type="date" class="input" id="customToInput">
        </div>
      </div>

      <div class="field">
        <label>Include</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;">
          <label class="checkbox-row"><input type="checkbox" id="includeDocs" checked> Document Requests — <strong style="color:var(--color-black);">Approved</strong> only</label>
          <label class="checkbox-row"><input type="checkbox" id="includeGrievances" checked> Grievance Reports — <strong style="color:var(--color-black);">Resolved</strong> only</label>
          <label class="checkbox-row"><input type="checkbox" id="includeMaintenance" checked> Maintenance Requests — <strong style="color:var(--color-black);">Completed</strong> only</label>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="generate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Generate & Print
      </button>
    `,
  });

  const rangeSelect = overlay.querySelector("#reportRangeSelect");
  const customFields = overlay.querySelector("#customRangeFields");
  const fromInput = overlay.querySelector("#customFromInput");
  const toInput = overlay.querySelector("#customToInput");

  rangeSelect.addEventListener("change", () => {
    customFields.classList.toggle("hidden", rangeSelect.value !== "custom");
  });

  // Keep "To" from being set earlier than "From".
  fromInput.addEventListener("change", () => {
    toInput.min = fromInput.value;
    if (toInput.value && toInput.value < fromInput.value)
      toInput.value = fromInput.value;
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="generate"]')
    .addEventListener("click", () => {
      const range = rangeSelect.value;
      const includes = {
        docs: overlay.querySelector("#includeDocs").checked,
        grievances: overlay.querySelector("#includeGrievances").checked,
        maintenance: overlay.querySelector("#includeMaintenance").checked,
      };
      if (!includes.docs && !includes.grievances && !includes.maintenance) {
        toast({
          type: "warning",
          title: "Nothing selected",
          desc: "Choose at least one report type to include.",
        });
        return;
      }

      let customRange = null;
      if (range === "custom") {
        const fromVal = fromInput.value;
        const toVal = toInput.value;
        if (!fromVal || !toVal) {
          toast({
            type: "warning",
            title: "Pick both dates",
            desc: "Select a From and a To date for the custom range.",
          });
          return;
        }
        if (fromVal > toVal) {
          toast({
            type: "warning",
            title: "Invalid range",
            desc: "The From date must be on or before the To date.",
          });
          return;
        }
        customRange = { from: fromVal, to: toVal };
      }

      generateReport(range, includes, customRange);
      overlay.close();
    });
}

/**
 * Returns { from, to } Date bounds.
 * - "today" / "week" / "month": rolling bounds capped at end-of-today.
 * - "custom": exact bounds from the picked From/To dates (YYYY-MM-DD strings),
 *   not capped at "now", so past date ranges print fully and predictably.
 */
function getRangeBounds(range, customRange) {
  if (range === "custom" && customRange) {
    const from = new Date(`${customRange.from}T00:00:00`);
    const to = new Date(`${customRange.to}T23:59:59.999`);
    return { from, to };
  }

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (range === "week") from.setDate(from.getDate() - from.getDay());
  if (range === "month") from.setDate(1);

  const to = new Date();
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

const RANGE_LABELS = { today: "Today", week: "This Week", month: "This Month" };

/** Case/whitespace-insensitive status comparison (all status fields are stored as strings). */
function statusIs(value, expected) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === expected
  );
}

/**
 * Resolve a record's day (as ms) for range filtering.
 * Prefers the human-readable date string (e.g. "July 12, 2026") since it's
 * the field you actually edit/verify, and it's exactly day-precision — which
 * is all Today/Week/Month/Custom bucketing needs. Falls back to the numeric
 * timestamp field only if the date string is missing or unparseable, so a
 * stale/out-of-sync timestamp can no longer silently break a range while
 * another range happens to still pass.
 */
function resolveRecordMs(record, dateField, tsField) {
  const dateStr = record[dateField];
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed.getTime();
    }
  }
  return toMs(record[tsField]);
}

function generateReport(range, includes, customRange) {
  const { from, to } = getRangeBounds(range, customRange);
  const rangeLabel =
    range === "custom"
      ? `${formatDate(from)} – ${formatDate(to)}`
      : RANGE_LABELS[range] || "Report";
  const inRange = (ms) => ms >= from.getTime() && ms <= to.getTime();

  const docs = includes.docs
    ? dataStore.docs.filter(
        (d) =>
          statusIs(d.requestStatus, "approved") &&
          inRange(resolveRecordMs(d, "requestDate", "requstTimestamp")),
      )
    : [];
  const grievances = includes.grievances
    ? dataStore.grievances.filter(
        (g) =>
          statusIs(g.incidentStatus, "resolved") &&
          inRange(resolveRecordMs(g, "dateSubmitted", "timestamp")),
      )
    : [];
  const maintenance = includes.maintenance
    ? dataStore.maintenance.filter(
        (m) =>
          statusIs(m.maintenanceStatus, "completed") &&
          inRange(resolveRecordMs(m, "dateSubmitted", "timestamp")),
      )
    : [];

  const sections = [];

  if (includes.docs) {
    sections.push(
      reportSection({
        title: `Document Requests — Approved (${docs.length})`,
        rows: docs,
        columns: [
          {
            label: "Ticket",
            value: (r) => r.requestTicket || r.requestID || r.id,
          },
          { label: "Requester", value: (r) => r.requesterName },
          { label: "Document Type", value: (r) => r.documentType },
          { label: "Purpose", value: (r) => r.purpose },
          { label: "Date", value: (r) => r.requestDate },
        ],
        emptyText: `No approved document requests for ${rangeLabel}.`,
      }),
    );
  }

  if (includes.grievances) {
    sections.push(
      reportSection({
        title: `Grievance Reports — Resolved (${grievances.length})`,
        rows: grievances,
        columns: [
          {
            label: "Ticket",
            value: (r) => r.incidentTicket || r.incidentReportID || r.id,
          },
          { label: "Incident", value: (r) => r.incidentTitle },
          { label: "Type", value: (r) => r.incidentType },
          { label: "Location", value: (r) => r.incidentExactLocation },
          { label: "Date", value: (r) => r.dateSubmitted },
        ],
        emptyText: `No resolved grievance reports for ${rangeLabel}.`,
      }),
    );
  }

  if (includes.maintenance) {
    sections.push(
      reportSection({
        title: `Maintenance Requests — Completed (${maintenance.length})`,
        rows: maintenance,
        columns: [
          {
            label: "Ticket",
            value: (r) => r.maintenanceTicket || r.maintenanceID || r.id,
          },
          { label: "Request", value: (r) => r.maintenanceTitle },
          { label: "Type", value: (r) => r.maintenanceType },
          { label: "Location", value: (r) => r.exactLocation },
          { label: "Date", value: (r) => r.dateSubmitted },
        ],
        emptyText: `No completed maintenance requests for ${rangeLabel}.`,
      }),
    );
  }

  const totalCount = docs.length + grievances.length + maintenance.length;
  const summaryHTML = `
    <div style="display:flex;gap:24px;margin-bottom:24px;padding:14px 16px;background:#F7F9FA;border-radius:8px;">
      ${includes.docs ? `<div><div style="font-size:20px;font-weight:800;color:#013717;">${docs.length}</div><div style="font-size:11px;color:#5C5F61;">Approved Documents</div></div>` : ""}
      ${includes.grievances ? `<div><div style="font-size:20px;font-weight:800;color:#013717;">${grievances.length}</div><div style="font-size:11px;color:#5C5F61;">Resolved Grievances</div></div>` : ""}
      ${includes.maintenance ? `<div><div style="font-size:20px;font-weight:800;color:#013717;">${maintenance.length}</div><div style="font-size:11px;color:#5C5F61;">Completed Maintenance</div></div>` : ""}
      <div><div style="font-size:20px;font-weight:800;color:#013717;">${totalCount}</div><div style="font-size:11px;color:#5C5F61;">Total Records</div></div>
    </div>
  `;

  printHTML(`HOA Report — ${rangeLabel}`, summaryHTML + sections.join(""));
  toast({
    type: "success",
    title: "Report ready",
    desc: `${totalCount} record${totalCount === 1 ? "" : "s"} included — opening print preview.`,
  });
}

/** Build one <h2> + <table> section's HTML for the print window. */
function reportSection({ title, rows, columns, emptyText }) {
  if (!rows.length) {
    return `
      <h2 style="font-size:14px;color:#013717;margin:24px 0 8px;">${escapeHtml(title)}</h2>
      <div style="font-size:12px;color:#5C5F61;padding:10px 0 4px;">${escapeHtml(emptyText)}</div>
    `;
  }
  const thead = `<tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(c.value(r) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");
  return `
    <h2 style="font-size:14px;color:#013717;margin:24px 0 8px;">${escapeHtml(title)}</h2>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  `;
}

function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

function statCardHTML(c) {
  return `
    <div class="stat-card">
      <div class="stat-card__accent-bar"></div>
      <div class="stat-card__top">
        <div class="stat-card__icon">${c.icon}</div>
        ${c.tone ? `<div class="stat-card__trend ${c.tone}">${c.tone === "up" ? "▲" : "▼"}</div>` : ""}
      </div>
      <div class="stat-card__value">${c.value}</div>
      <div class="stat-card__label">${c.label}</div>
    </div>
  `;
}

function firstName(p) {
  const name = getFullName(p);
  return name ? name.split(" ")[0] : "Admin";
}

/* ---- inline icon helpers ---- */
function iconUsers() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-linecap="round"/><circle cx="9" cy="7" r="4"/></svg>`;
}
function iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function iconClock() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>`;
}
function iconSlash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2" stroke-linecap="round"/></svg>`;
}
function iconBan() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8" stroke-linecap="round"/></svg>`;
}
function iconDoc() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-linejoin="round"/><path d="M14 2v6h6"/></svg>`;
}
function iconGrievance() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke-linecap="round"/></svg>`;
}
function iconMaint() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a4 4 0 11-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 015.4-5.4z" stroke-linejoin="round"/></svg>`;
}
function iconAnnounce() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l18-7v16l-18-7z" stroke-linejoin="round"/></svg>`;
}
