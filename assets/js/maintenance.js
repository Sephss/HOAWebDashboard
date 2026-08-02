/* ============================================================
   maintenance.js — Maintenance Requests module
   Priority (urgencyLevel) values submitted by the mobile app:
   "routine", "moderate", "urgent".
   Status values are stored in the database as snake_case tokens:
   pending, repair_in_progress, completed — renamed on the admin
   side from "Pending" / "Under Investigation" / "Resolved" to
   "Pending" / "Repair In Progress" / "Completed".
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
renderShell("maintenance", adminProfile, {
  breadcrumb: "Maintenance Requests",
});

/** Canonical status list — value is exactly what gets written to Firebase. */
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "repair_in_progress", label: "Repair In Progress" },
  { value: "completed", label: "Completed" },
];
const STATUS_ORDER = STATUS_OPTIONS.map((s) => s.value);
const STATUS_DATE_FIELD = {
  repair_in_progress: "underInvestigationDate",
  completed: "resolvedDate",
};

function statusLabel(raw) {
  const token = statusToken(raw || "pending");
  return (
    STATUS_OPTIONS.find((s) => s.value === token)?.label || raw || "Pending"
  );
}

/** Canonical priority list — value is exactly what the mobile app submits. */
const PRIORITY_OPTIONS = [
  { value: "routine", label: "Routine" },
  { value: "moderate", label: "Moderate" },
  { value: "urgent", label: "Urgent" },
];
const PRIORITY_ORDER = PRIORITY_OPTIONS.map((p) => p.value);

function priorityToken(raw) {
  return String(raw || "routine")
    .trim()
    .toLowerCase();
}
function priorityLabel(raw) {
  const token = priorityToken(raw);
  return (
    PRIORITY_OPTIONS.find((p) => p.value === token)?.label || raw || "Routine"
  );
}
function priorityRank(level) {
  const i = PRIORITY_ORDER.indexOf(priorityToken(level));
  return i === -1 ? 0 : i;
}

/** Mirrors the switch-case in the Android app's updateStatus(). No entry for
 * "pending" — matches the mobile app, which never notifies on that status. */
const NOTIF_MESSAGES = {
  repair_in_progress: "Your maintenance request is now in progress.",
  completed: "Your maintenance request has been marked as completed.",
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
async function notifySubmitter(r, newStatus, remarks) {
  const notifMessage =
    NOTIF_MESSAGES[newStatus] || "Your maintenance request has been updated.";
  const now = new Date();

  const notifRef = push(ref(db, DB_PATHS.notifications));
  const data = {
    notificationID: notifRef.key,
    receiverID: r.submitterID || r.submitterId || "",
    title: "",
    message: remarks,
    notificationType: r.maintenanceType || "",
    action: newStatus,
    date: formatManilaDate(now),
    time: formatManilaTime(now),
    referenceID: r.maintenanceID || r.id,
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
      <div class="page-header__title">Maintenance Requests</div>
      <div class="page-header__subtitle">Dispatch and track facility & unit maintenance tickets.</div>
    </div>
  </div>
  <div class="stat-grid" id="maintStats"></div>
  <div class="card"><div id="maintTableRoot"></div></div>
`;

let allRequests = [];

const table = new DataTable({
  root: document.getElementById("maintTableRoot"),
  title: "Maintenance Requests",
  pageSize: 10,
  searchFields: [
    "maintenanceTitle",
    "maintenanceTicket",
    "maintenanceType",
    "submitterName",
    "exactLocation",
  ],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "maintenanceTicket",
      label: "Ticket",
      sortable: true,
      render: (r) =>
        `<span class="mono" style="font-weight:700;">${escapeHtml(r.maintenanceTicket || r.maintenanceID || r.id)}</span>`,
    },
    {
      key: "maintenanceTitle",
      label: "Request",
      sortable: true,
      render: (r) =>
        `${escapeHtml(r.maintenanceTitle || "Untitled")}<div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.maintenanceType || "")} · ${escapeHtml(r.submitterName || "")}</div>`,
    },
    {
      key: "urgencyLevel",
      label: "Priority",
      sortable: true,
      sortValue: (r) => priorityRank(r.urgencyLevel),
      render: (r) =>
        `<span class="badge badge-priority-${priorityToken(r.urgencyLevel)}">${escapeHtml(priorityLabel(r.urgencyLevel))}</span>`,
    },
    {
      key: "exactLocation",
      label: "Location",
      sortable: false,
      render: (r) => escapeHtml(r.exactLocation || "—"),
    },
    {
      key: "maintenanceStatus",
      label: "Status",
      sortable: true,
      sortValue: (r) =>
        STATUS_ORDER.indexOf(statusToken(r.maintenanceStatus || "pending")),
      render: (r) =>
        `<span class="badge badge-${statusToken(r.maintenanceStatus || "pending")}">${escapeHtml(statusLabel(r.maintenanceStatus))}</span>`,
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
      key: "maintenanceStatus",
      label: "Status",
      options: STATUS_OPTIONS,
      match: (r, v) => statusToken(r.maintenanceStatus || "pending") === v,
    },
    {
      key: "urgencyLevel",
      label: "Priority",
      options: PRIORITY_OPTIONS,
      match: (r, v) => priorityToken(r.urgencyLevel) === v,
    },
  ],
  emptyTitle: "No maintenance requests",
  emptyDesc: "No requests match your current filters.",
  onRowClick: (row) => openDetailModal(row),
});

onValue(ref(db, DB_PATHS.maintenanceRequests), (snap) => {
  allRequests = objectToArray(snap.val(), "id");
  table.setData(allRequests);
  renderStats();
});

const filterParam = getQueryParam("filter");
if (filterParam === "pending")
  table.activeFilters.maintenanceStatus = "pending";

function renderStats() {
  const counts = {};
  STATUS_OPTIONS.forEach((s) => (counts[s.value] = 0));
  allRequests.forEach((r) => {
    const token = statusToken(r.maintenanceStatus || "pending");
    counts[token] = (counts[token] || 0) + 1;
  });
  const urgent = allRequests.filter(
    (r) => priorityToken(r.urgencyLevel) === "urgent",
  ).length;
  document.getElementById("maintStats").innerHTML = [
    ["Total Requests", allRequests.length],
    ...STATUS_OPTIONS.map((s) => [s.label, counts[s.value] || 0]),
    ["Urgent Priority", urgent],
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
  const currentToken = statusToken(r.maintenanceStatus || "pending");
  const overlay = openModal({
    title: `Request ${r.maintenanceTicket || r.maintenanceID}`,
    subtitle: r.maintenanceType || "Maintenance Request",
    size: "modal-xl",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:24px;">
        <div>
          <div class="section-title" style="font-size:14px;">Request Details</div>
          <div class="detail-grid" style="margin-bottom:16px;">
            <div class="detail-item"><div class="label">Submitted By</div><div class="value">${escapeHtml(r.submitterName || "—")}</div></div>
            <div class="detail-item"><div class="label">Priority</div><div class="value"><span class="badge badge-priority-${priorityToken(r.urgencyLevel)}">${escapeHtml(priorityLabel(r.urgencyLevel))}</span></div></div>
            <div class="detail-item"><div class="label">Type</div><div class="value">${escapeHtml(r.maintenanceType || "—")}</div></div>
            <div class="detail-item"><div class="label">Location</div><div class="value">${escapeHtml(r.exactLocation || "—")}</div></div>
          </div>
          <div class="detail-item" style="margin-bottom:16px;"><div class="label">Full Description</div><div class="value" style="font-weight:500;line-height:1.6;">${escapeHtml(r.fullDescription || "—")}</div></div>
          ${
            r.photoEvidence
              ? `
            <div class="detail-item" style="margin-bottom:16px;">
              <div class="label">Photo Evidence</div>
              <a class="image-preview-trigger" href="${escapeHtml(r.photoEvidence)}" target="_blank" rel="noopener">
                <img src="${escapeHtml(r.photoEvidence)}" alt="Maintenance photo">
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
            <textarea class="textarea" id="adminRemarksInput" placeholder="Add dispatch or repair notes…">${escapeHtml(r.adminRemarks || "")}</textarea>
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
      const newStatus = overlay.querySelector("#statusSelect").value; // already snake_case, e.g. "repair_in_progress"
      const adminRemarks = overlay
        .querySelector("#adminRemarksInput")
        .value.trim();
      const updates = { maintenanceStatus: newStatus, adminRemarks };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField && newStatus !== currentToken)
        updates[dateField] = formatAdminActionTimestamp();
      try {
        await update(
          ref(db, `${DB_PATHS.maintenanceRequests}/${r.id}`),
          updates,
        );

        // Notify the resident, same as the Android app — only when the
        // status actually changed and it's one of the notifiable statuses.
        if (newStatus !== currentToken && NOTIF_MESSAGES[newStatus]) {
          try {
            await notifySubmitter(r, newStatus, adminRemarks);
          } catch (notifErr) {
            console.error("Failed to create notification:", notifErr);
          }
        }

        toast({
          type: "success",
          title: "Request updated",
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
    { label: "Repair In Progress", ts: r.underInvestigationDate },
    { label: "Completed", ts: r.resolvedDate },
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
   PRINT — All maintenance requests within a chosen date range.
   ============================================================ */

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Maintenance Requests",
    subtitle: "Generate a printable list of requests for a date range",
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
        Every request submitted inside this range will be included, regardless of status.
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
    printMaintenanceRange(fromVal, toVal);
    overlay.close();
  });
}

function printMaintenanceRange(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allRequests
    .filter((r) => {
      const ms = toMs(r.timestamp || r.dateSubmitted);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No requests fall inside that date range.",
    });
    return;
  }

  const cols = [
    {
      label: "Ticket",
      value: (r) => r.maintenanceTicket || r.maintenanceID || r.id,
    },
    { label: "Request", value: (r) => r.maintenanceTitle },
    { label: "Type", value: (r) => r.maintenanceType },
    { label: "Priority", value: (r) => priorityLabel(r.urgencyLevel) },
    { label: "Submitted By", value: (r) => r.submitterName },
    { label: "Location", value: (r) => r.exactLocation },
    { label: "Status", value: (r) => statusLabel(r.maintenanceStatus) },
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
    `Maintenance Requests — ${formatDate(from)} to ${formatDate(to)}`,
    bodyHTML,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} request${rows.length === 1 ? "" : "s"} included.`,
  });
}

/** Reads timestamp (may be a numeric string or number, unix seconds or ms) into a real ms number. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/** Matches DocumentRequestModel-style *Date fields, e.g. "July 31, 2026, 11:00 AM". */
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
