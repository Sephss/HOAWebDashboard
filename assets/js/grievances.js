/* ============================================================
   grievances.js — Grievance Reports module
   Status values are stored in the database as snake_case tokens:
   pending, under_investigation, resolved — so the mobile app can
   match them directly.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, update, push, set, DB_PATHS } from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal } from "./ui.js";
import {
  objectToArray,
  formatDate,
  formatDateTime,
  statusToken,
  escapeHtml,
  getQueryParam,
  printHTML,
} from "./utils.js";

const adminProfile = await guardPage();
renderShell("grievances", adminProfile, { breadcrumb: "Grievance Reports" });

/** Canonical status list — value is exactly what gets written to Firebase. */
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "under_investigation", label: "Under Investigation" },
  { value: "resolved", label: "Resolved" },
];
const STATUS_ORDER = STATUS_OPTIONS.map((s) => s.value);
const STATUS_DATE_FIELD = {
  under_investigation: "underInvestigationDate",
  resolved: "resolvedDate",
};

function statusLabel(raw) {
  const token = statusToken(raw || "pending");
  return (
    STATUS_OPTIONS.find((s) => s.value === token)?.label || raw || "Pending"
  );
}

/** Mirrors the switch-case in the Android app's updateStatus(). No entry for
 * "pending" — matches the mobile app, which never notifies on that status. */
const NOTIF_MESSAGES = {
  under_investigation: "Your incident report is now under investigation.",
  resolved: "Your incident report has been marked as resolved.",
};

/** Matches Android's SimpleDateFormat("MMMM dd, yyyy") in the Asia/Manila timezone. */
function formatManilaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Matches Android's SimpleDateFormat("hh:mm a") in the Asia/Manila timezone. */
function formatManilaTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Writes a NotificationModel-shaped record to DB_PATHS.notifications,
 * mirroring FirebaseNotificationManager.createNotification() on Android.
 */
async function notifyReporter(r, newStatus, remarks) {
  const notifMessage =
    NOTIF_MESSAGES[newStatus] || "Your incident report has been updated.";
  const now = new Date();

  const notifRef = push(ref(db, DB_PATHS.notifications));
  const data = {
    notificationID: notifRef.key,
    receiverID: r.incidentReporterID || "",
    title: "",
    message: remarks,
    notificationType: r.incidentType || "",
    action: newStatus,
    date: formatManilaDate(now),
    time: formatManilaTime(now),
    referenceID: r.incidentReportID || r.id,
    isRead: "no",
    timestamp: String(now.getTime()),
    notifMessage,
  };

  await set(notifRef, data);
}

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Grievance Reports</div>
      <div class="page-header__subtitle">Investigate and resolve resident-reported incidents.</div>
    </div>
  </div>
  <div class="stat-grid" id="grievanceStats"></div>
  <div class="card"><div id="grievancesTableRoot"></div></div>
`;

let allReports = [];

const table = new DataTable({
  root: document.getElementById("grievancesTableRoot"),
  title: "Grievance Reports",
  pageSize: 10,
  searchFields: [
    "incidentTitle",
    "incidentTicket",
    "incidentType",
    "incidentExactLocation",
  ],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "incidentTicket",
      label: "Ticket",
      sortable: true,
      render: (r) =>
        `<span class="mono" style="font-weight:700;">${escapeHtml(r.incidentTicket || r.incidentReportID || r.id)}</span>`,
    },
    {
      key: "incidentTitle",
      label: "Incident",
      sortable: true,
      render: (r) =>
        `${escapeHtml(r.incidentTitle || "Untitled")}<div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.incidentType || "")}</div>`,
    },
    {
      key: "incidentExactLocation",
      label: "Location",
      sortable: false,
      render: (r) => escapeHtml(r.incidentExactLocation || "—"),
    },
    {
      key: "incidentStatus",
      label: "Status",
      sortable: true,
      sortValue: (r) =>
        STATUS_ORDER.indexOf(statusToken(r.incidentStatus || "pending")),
      render: (r) =>
        `<span class="badge badge-${statusToken(r.incidentStatus || "pending")}">${escapeHtml(statusLabel(r.incidentStatus))}</span>`,
    },
    {
      key: "dateSubmitted",
      label: "Submitted",
      sortable: true,
      sortValue: (r) => toMs(r.timestamp),
      render: (r) => formatDate(r.timestamp || r.dateSubmitted),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      csv: false,
      render: () =>
        `<div class="row-actions" data-stop-row-click><button class="btn btn-secondary btn-sm" data-act="open">View</button></div>`,
    },
  ],
  filters: [
    {
      key: "incidentStatus",
      label: "Status",
      options: STATUS_OPTIONS,
      match: (r, v) => statusToken(r.incidentStatus || "pending") === v,
    },
  ],
  emptyTitle: "No grievance reports",
  emptyDesc: "No reports match your current filters.",
  onRowClick: (row) => openDetailModal(row),
});

onValue(ref(db, DB_PATHS.grievanceReports), (snap) => {
  allReports = objectToArray(snap.val(), "id");
  table.setData(allReports);
  renderStats();
});

const filterParam = getQueryParam("filter");
if (filterParam === "pending") table.activeFilters.incidentStatus = "pending";

function renderStats() {
  const counts = {};
  STATUS_OPTIONS.forEach((s) => (counts[s.value] = 0));
  allReports.forEach((r) => {
    const token = statusToken(r.incidentStatus || "pending");
    counts[token] = (counts[token] || 0) + 1;
  });
  document.getElementById("grievanceStats").innerHTML = [
    ["Total Reports", allReports.length],
    ...STATUS_OPTIONS.map((s) => [s.label, counts[s.value] || 0]),
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

table.cfg.afterRender = (rows) => {
  document
    .querySelectorAll('[data-act="open"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openDetailModal(rows[i])),
    );
};

function openDetailModal(r) {
  const currentToken = statusToken(r.incidentStatus || "pending");
  const overlay = openModal({
    title: `Report ${r.incidentTicket || r.incidentReportID}`,
    subtitle: r.incidentType || "Grievance Report",
    size: "modal-xl",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:24px;">
        <div>
          <div class="section-title" style="font-size:14px;">Incident Details</div>
          <div class="detail-grid" style="margin-bottom:16px;">
            <div class="detail-item"><div class="label">Type</div><div class="value">${escapeHtml(r.incidentType || "—")}</div></div>
            <div class="detail-item"><div class="label">Location</div><div class="value">${escapeHtml(r.incidentExactLocation || "—")}</div></div>
          </div>
          <div class="detail-item" style="margin-bottom:16px;"><div class="label">Description</div><div class="value" style="font-weight:500;line-height:1.6;">${escapeHtml(r.incidentDescription || "—")}</div></div>
          ${
            r.incidentImageUrl
              ? `
            <div class="detail-item" style="margin-bottom:16px;">
              <div class="label">Photo Evidence</div>
              <a class="image-preview-trigger" href="${escapeHtml(r.incidentImageUrl)}" target="_blank" rel="noopener">
                <img src="${escapeHtml(r.incidentImageUrl)}" alt="Incident photo">
              </a>
            </div>`
              : ""
          }

          <div class="divider"></div>
          <div class="section-title" style="font-size:14px;">Admin Response</div>
          <div class="field">
            <label>Status</label>
            <select class="select" id="statusSelect">
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}" ${s.value === currentToken ? "selected" : ""}>${s.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Admin Remarks</label>
            <textarea class="textarea" id="adminRemarksInput" placeholder="Add investigation notes…">${escapeHtml(r.adminRemarks || "")}</textarea>
          </div>
        </div>
        <div>
          <div class="section-title" style="font-size:14px;">Timeline</div>
          <div class="timeline">${buildTimeline(r)}</div>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Close</button>
      <button class="btn btn-primary" data-act="save">Save Changes</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="save"]')
    .addEventListener("click", async () => {
      const newStatus = overlay.querySelector("#statusSelect").value; // already snake_case, e.g. "under_investigation"
      const adminRemarks = overlay
        .querySelector("#adminRemarksInput")
        .value.trim();
      const updates = { incidentStatus: newStatus, adminRemarks };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField && newStatus !== currentToken)
        updates[dateField] = formatAdminActionTimestamp();
      try {
        await update(ref(db, `${DB_PATHS.grievanceReports}/${r.id}`), updates);

        // Notify the reporter, same as the Android app — only when the
        // status actually changed and it's one of the notifiable statuses.
        if (newStatus !== currentToken && NOTIF_MESSAGES[newStatus]) {
          try {
            await notifyReporter(r, newStatus, adminRemarks);
          } catch (notifErr) {
            console.error("Failed to create notification:", notifErr);
          }
        }

        toast({
          type: "success",
          title: "Report updated",
          desc: `Status set to ${statusLabel(newStatus)}.`,
        });
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Update failed", desc: err.message });
      }
    });
}

function buildTimeline(r) {
  const steps = [
    { label: "Submitted", ts: r.timestamp || r.dateSubmitted, always: true },
    { label: "Under Investigation", ts: r.underInvestigationDate },
    { label: "Resolved", ts: r.resolvedDate },
  ].filter((s) => s.always || s.ts);
  return steps
    .map(
      (s, i) => `
    <div class="timeline__item ${s.ts ? "done" : ""} ${i === steps.length - 1 ? "active" : ""}">
      <div class="timeline__dot"></div>
      <div class="timeline__title">${s.label}</div>
      <div class="timeline__meta">${s.ts ? (s.label === "Submitted" ? formatDateTime(s.ts) : s.ts) : "Pending"}</div>
    </div>
  `,
    )
    .join("");
}

/* ============================================================
   PRINT — All grievance reports within a chosen date range.
   ============================================================ */

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Grievance Reports",
    subtitle: "Generate a printable list of reports for a date range",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field" style="margin-bottom:0;">
          <label>From</label>
          <input type="date" class="input" id="printFromInput">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>To</label>
          <input type="date" class="input" id="printToInput">
        </div>
      </div>
      <p style="font-size:12px;color:var(--color-grey);margin-top:12px;line-height:1.6;">
        Every report submitted inside this range will be included, regardless of status.
      </p>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="print">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Generate & Print
      </button>
    `,
  });

  const fromInput = overlay.querySelector("#printFromInput");
  const toInput = overlay.querySelector("#printToInput");
  fromInput.addEventListener("change", () => {
    toInput.min = fromInput.value;
    if (toInput.value && toInput.value < fromInput.value)
      toInput.value = fromInput.value;
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay.querySelector('[data-act="print"]').addEventListener("click", () => {
    const fromVal = fromInput.value;
    const toVal = toInput.value;
    if (!fromVal || !toVal) {
      toast({
        type: "warning",
        title: "Pick both dates",
        desc: "Select a From and a To date.",
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
    printGrievanceRange(fromVal, toVal);
    overlay.close();
  });
}

function printGrievanceRange(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allReports
    .filter((r) => {
      const ms = toMs(r.timestamp || r.dateSubmitted);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No reports fall inside that date range.",
    });
    return;
  }

  const cols = [
    {
      label: "Ticket",
      value: (r) => r.incidentTicket || r.incidentReportID || r.id,
    },
    { label: "Incident", value: (r) => r.incidentTitle },
    { label: "Type", value: (r) => r.incidentType },
    { label: "Location", value: (r) => r.incidentExactLocation },
    { label: "Status", value: (r) => statusLabel(r.incidentStatus) },
    { label: "Date", value: (r) => formatDate(r.timestamp || r.dateSubmitted) },
  ];
  const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${cols.map((c) => `<td>${escapeHtml(c.value(r) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");
  const bodyHTML = `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;

  printHTML(
    `Grievance Reports — ${formatDate(from)} to ${formatDate(to)}`,
    bodyHTML,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} report${rows.length === 1 ? "" : "s"} included.`,
  });
}

/** Reads timestamp (may be a numeric string or number, unix seconds or ms) into a real ms number. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/** Formats a status-change moment as "July 31, 2026, 11:00 AM" — used for underInvestigationDate/resolvedDate. */
function formatAdminActionTimestamp(date = new Date()) {
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = date.getDate();
  const year = date.getFullYear();
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${month} ${day}, ${year}, ${hour}:${minute} ${period}`;
}
