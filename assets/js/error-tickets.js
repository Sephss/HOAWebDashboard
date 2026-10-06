/* ============================================================
   error-tickets.js — Error Tickets & Feedback module
   DB structure: errorTicketing > userID > ticketID > {data}
   Status values are stored EXACTLY as the mobile app expects:
   "Pending", "In Progress", "Resolved", "Rejected"
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, update, DB_PATHS } from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal } from "./ui.js";
import { formatDate, formatDateTime, escapeHtml, printHTML } from "./utils.js";
import { logActivity } from "./activityLogger.js";

const adminProfile = await guardPage();
renderShell("tickets", adminProfile, { breadcrumb: "Error Tickets" });

/** value = exact string written to Firebase (must match the Android app). */
const STATUS_OPTIONS = [
  { value: "Pending", label: "Pending" },
  { value: "In Progress", label: "In Progress" },
  { value: "Resolved", label: "Resolved" },
  { value: "Rejected", label: "Rejected" },
];
const STATUS_ORDER = STATUS_OPTIONS.map((s) => s.value);

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug / Error" },
  { value: "suggestion", label: "Suggestion / Feature Request" },
];

/** Extra date field stamped when a status is set. */
const STATUS_DATE_FIELD = {
  "In Progress": "inProgressDate",
  Resolved: "resolvedDate",
  Rejected: "rejectedDate",
};

function normalizeStatus(raw) {
  const found = STATUS_OPTIONS.find(
    (s) => s.value.toLowerCase() === String(raw || "").toLowerCase(),
  );
  return found ? found.value : "Pending";
}

function statusBadgeClass(raw) {
  return `badge-${normalizeStatus(raw).toLowerCase().replace(/\s+/g, "_")}`;
  // -> badge-pending, badge-in_progress, badge-resolved, badge-rejected
}

function categoryType(raw) {
  return String(raw || "")
    .toLowerCase()
    .includes("bug")
    ? "bug"
    : "suggestion";
}

/** Reads timestamp (number/string, seconds or ms) into ms. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/** Human-readable "September 12, 2026 • 09:19 PM" for a ticket. */
function formatTicketDateTime(t) {
  // Prefer the readable values the mobile app already saved
  if (t.dateCreated) {
    return t.timeCreated
      ? `${t.dateCreated} • ${t.timeCreated}`
      : t.dateCreated;
  }
  // Fallback: convert the numeric timestamp
  const ms = toMs(t.timestamp);
  if (!ms) return "—";
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${date} • ${time}`;
}

/** "July 31, 2026, 11:00 AM" — for status-change dates. */
function formatAdminActionTimestamp(date = new Date()) {
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = date.getDate();
  const year = date.getFullYear();
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${month} ${day}, ${year}, ${hour}:${minute} ${period}`;
}

/** Flattens { userId: { ticketId: {...} } } into a flat array. */
function flattenTickets(root) {
  const out = [];
  if (!root) return out;
  Object.entries(root).forEach(([userId, tickets]) => {
    if (!tickets || typeof tickets !== "object") return;
    Object.entries(tickets).forEach(([ticketId, data]) => {
      if (!data || typeof data !== "object") return;
      out.push({
        ...data,
        id: `${userId}__${ticketId}`,
        userId: data.userId || userId,
        ticketId: data.ticketId || ticketId,
        _userKey: userId, // real path keys, used for updates
        _ticketKey: ticketId,
      });
    });
  });
  return out;
}

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Error Tickets</div>
      <div class="page-header__subtitle">Review bug reports and suggestions submitted by mobile users.</div>
    </div>
  </div>
  <div class="stat-grid" id="ticketStats"></div>
  <div class="card"><div id="ticketsTableRoot"></div></div>
`;

let allTickets = [];

const table = new DataTable({
  root: document.getElementById("ticketsTableRoot"),
  title: "Submitted Tickets",
  pageSize: 10,
  searchFields: [
    "title",
    "description",
    "submittedByName",
    "category",
    "ticketId",
  ],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "title",
      label: "Ticket",
      sortable: true,
      render: (r) =>
        `<div style="font-weight:600;">${escapeHtml(r.title || "Untitled")}</div>
         <div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.category || "")}</div>`,
    },
    {
      key: "submittedByName",
      label: "Submitted By",
      sortable: true,
      render: (r) => escapeHtml(r.submittedByName || "Unknown"),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      sortValue: (r) => STATUS_ORDER.indexOf(normalizeStatus(r.status)),
      render: (r) =>
        `<span class="badge ${statusBadgeClass(r.status)}">${escapeHtml(normalizeStatus(r.status))}</span>`,
    },
    {
      key: "timestamp",
      label: "Submitted",
      sortable: true,
      sortValue: (r) => toMs(r.timestamp),
      render: (r) => escapeHtml(formatTicketDateTime(r)),
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
      key: "status",
      label: "Status",
      options: STATUS_OPTIONS,
      match: (r, v) => normalizeStatus(r.status) === v,
    },
    {
      key: "category",
      label: "Category",
      options: CATEGORY_OPTIONS,
      match: (r, v) => categoryType(r.category) === v,
    },
  ],
  emptyTitle: "No tickets found",
  emptyDesc: "No tickets match your current filters.",
  onRowClick: (row) => openDetailModal(row),
});

onValue(ref(db, DB_PATHS.ErrorTicketing), (snap) => {
  allTickets = flattenTickets(snap.val());
  table.setData(allTickets);
  renderStats();
});

function renderStats() {
  const counts = {};
  STATUS_OPTIONS.forEach((s) => (counts[s.value] = 0));
  allTickets.forEach((t) => {
    counts[normalizeStatus(t.status)]++;
  });
  document.getElementById("ticketStats").innerHTML = [
    ["Total Tickets", allTickets.length],
    ...STATUS_OPTIONS.map((s) => [s.label, counts[s.value] || 0]),
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Tickets",
    subtitle: "Generate a printable list of tickets for a date range",
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
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="print">Generate & Print</button>
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
    if (!fromInput.value || !toInput.value) {
      toast({
        type: "warning",
        title: "Pick both dates",
        desc: "Select a From and a To date.",
      });
      return;
    }
    if (fromInput.value > toInput.value) {
      toast({
        type: "warning",
        title: "Invalid range",
        desc: "The From date must be on or before the To date.",
      });
      return;
    }
    printTicketRange(fromInput.value, toInput.value);
    overlay.close();
  });
}

function printTicketRange(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allTickets
    .filter((t) => {
      const ms = toMs(t.timestamp);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No tickets fall inside that date range.",
    });
    return;
  }

  const cols = [
    { label: "Title", value: (t) => t.title },
    { label: "Category", value: (t) => t.category },
    { label: "Submitted By", value: (t) => t.submittedByName },
    { label: "Status", value: (t) => normalizeStatus(t.status) },
    { label: "Submitted", value: (t) => formatTicketDateTime(t) }, // readable date + time
  ];

  const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (t) =>
        `<tr>${cols.map((c) => `<td>${escapeHtml(c.value(t) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");

  printHTML(
    `Error Tickets — ${formatDate(from)} to ${formatDate(to)}`,
    `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} ticket${rows.length === 1 ? "" : "s"} included.`,
  });
}

table.cfg.afterRender = (rows) => {
  document
    .querySelectorAll('[data-act="open"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openDetailModal(rows[i])),
    );
};

function openDetailModal(t) {
  const currentStatus = normalizeStatus(t.status);
  const overlay = openModal({
    title: t.title || "Ticket",
    subtitle: t.category || "Ticket",
    size: "modal-xl",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:24px;">
        <div>
          <div class="section-title" style="font-size:14px;">Ticket Details</div>
          <div class="detail-grid" style="margin-bottom:16px;">
            <div class="detail-item"><div class="label">Category</div><div class="value">${escapeHtml(t.category || "—")}</div></div>
            <div class="detail-item"><div class="label">Submitted By</div><div class="value">${escapeHtml(t.submittedByName || "Unknown")}</div></div>
          </div>
          <div class="detail-item" style="margin-bottom:16px;"><div class="label">Description</div><div class="value" style="font-weight:500;line-height:1.6;white-space:pre-wrap;">${escapeHtml(t.description || "—")}</div></div>
          ${
            t.imageUrl
              ? `<div class="detail-item" style="margin-bottom:16px;">
                  <div class="label">Attached Screenshot</div>
                  <a class="image-preview-trigger" href="${escapeHtml(t.imageUrl)}" target="_blank" rel="noopener">
                    <img src="${escapeHtml(t.imageUrl)}" alt="Ticket attachment">
                  </a>
                </div>`
              : ""
          }

          <div class="divider"></div>
          <div class="section-title" style="font-size:14px;">Admin Response</div>
          <div class="field">
            <label>Status</label>
            <select class="select" id="statusSelect">
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}" ${s.value === currentStatus ? "selected" : ""}>${s.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Admin Remarks</label>
            <textarea class="textarea" id="adminRemarksInput" placeholder="Add a note for the user…">${escapeHtml(t.adminRemarks || "")}</textarea>
          </div>
        </div>
        <div>
          <div class="section-title" style="font-size:14px;">Timeline</div>
          <div class="timeline">${buildTimeline(t)}</div>
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
      const newStatus = overlay.querySelector("#statusSelect").value;
      const adminRemarks = overlay
        .querySelector("#adminRemarksInput")
        .value.trim();

      const updates = { status: newStatus, adminRemarks };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField && newStatus !== currentStatus) {
        updates[dateField] = formatAdminActionTimestamp();
      }

      try {
        await update(
          ref(db, `${DB_PATHS.ErrorTicketing}/${t._userKey}/${t._ticketKey}`),
          updates,
        );
        toast({
          type: "success",
          title: "Ticket updated",
          desc: `Status set to ${newStatus}.`,
        });
        await logActivity(adminProfile, {
          action: "Updated Status",
          module: "Error Tickets",
          targetName: t.title || "Untitled Ticket",
          details: `Status changed from "${currentStatus}" to "${newStatus}"${adminRemarks ? ` — Remarks: ${adminRemarks}` : ""}`,
        });
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Update failed", desc: err.message });
      }
    });
}

function buildTimeline(t) {
  const submittedTs = formatTicketDateTime(t);
  const steps = [
    { label: "Submitted", ts: submittedTs, always: true },
    { label: "In Progress", ts: t.inProgressDate },
    { label: "Resolved", ts: t.resolvedDate },
    { label: "Rejected", ts: t.rejectedDate },
  ].filter((s) => s.always || s.ts);

  return steps
    .map(
      (s, i) => `
    <div class="timeline__item ${s.ts ? "done" : ""} ${i === steps.length - 1 ? "active" : ""}">
      <div class="timeline__dot"></div>
      <div class="timeline__title">${s.label}</div>
      <div class="timeline__meta">${escapeHtml(s.ts || "Pending")}</div>
    </div>`,
    )
    .join("");
}
