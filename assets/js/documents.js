/* ============================================================
   documents.js — Document Requests module
   Status values are stored in the database as snake_case tokens
   (pending, under_review, approved, rejected, cancelled) so the
   mobile app can match them directly. Each transition also stamps
   its matching *DateTime field with a human-readable string like
   "July 30, 2026, 11:00 AM" — matching DocumentRequestModel exactly.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, update, push, set, DB_PATHS } from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal } from "./ui.js";
import {
  objectToArray,
  initials,
  formatDate,
  formatDateTime,
  statusToken,
  escapeHtml,
  getQueryParam,
  printHTML,
} from "./utils.js";

const adminProfile = await guardPage();
renderShell("documents", adminProfile, { breadcrumb: "Document Requests" });

/** Canonical status list — value is exactly what gets written to Firebase. */
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];
const STATUS_ORDER = STATUS_OPTIONS.map((s) => s.value);
const STATUS_DATE_FIELD = {
  under_review: "underReviewDateTime",
  approved: "approvedDateTime",
  rejected: "rejectedDateTime",
  cancelled: "cancelledDateTime",
};

function statusLabel(raw) {
  const token = statusToken(raw || "pending");
  return (
    STATUS_OPTIONS.find((s) => s.value === token)?.label || raw || "Pending"
  );
}

/** Generic placeholder user icon — shown whenever requesterImage is "none" or missing. */
const PLACEHOLDER_AVATAR_ICON = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
`;

/** Returns the avatar inner HTML: real image, or a placeholder icon if requesterImage is "none"/missing. */
function avatarContent(r) {
  const hasRealImage = r.requesterImage && r.requesterImage !== "none";
  if (hasRealImage) return `<img src="${escapeHtml(r.requesterImage)}" alt="">`;
  return PLACEHOLDER_AVATAR_ICON;
}

/** Mirrors the switch-case in the Android app's setUpStatusUpdate(). The
 * default branch matches Android's fallback ("Your document request has
 * been updated.") for any status not explicitly listed, e.g. "cancelled". */
function documentNotifMessage(newStatus, documentType) {
  switch (newStatus) {
    case "under_review":
      return `Your ${documentType} request is now under review.`;
    case "approved":
      return `Your ${documentType} request has been approved.`;
    case "rejected":
      return `Your ${documentType} request has been rejected. Please review the remarks for more information.`;
    default:
      return "Your document request has been updated.";
  }
}

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
async function notifyRequester(r, newStatus, remarks) {
  const documentType = r.documentType || "document";
  const notifMessage = documentNotifMessage(newStatus, documentType);
  const now = new Date();

  const notifRef = push(ref(db, DB_PATHS.notifications));
  const data = {
    notificationID: notifRef.key,
    receiverID: r.requesterID || "",
    title: "",
    message: remarks,
    notificationType: r.documentType || "",
    action: newStatus,
    date: formatManilaDate(now),
    time: formatManilaTime(now),
    referenceID: r.requestID || r.id,
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
      <div class="page-header__title">Document Requests</div>
      <div class="page-header__subtitle">Track, review, and respond to resident document requests.</div>
    </div>
  </div>
  <div class="stat-grid" id="docStats"></div>
  <div class="card"><div id="docsTableRoot"></div></div>
`;

let allDocs = [];

const table = new DataTable({
  root: document.getElementById("docsTableRoot"),
  title: "Document Requests",
  pageSize: 10,
  searchFields: [
    "requesterName",
    "requestTicket",
    "documentType",
    "requestCategory",
    "requesterEmail",
  ],
  defaultSort: "requstTimestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "requestTicket",
      label: "Ticket",
      sortable: true,
      render: (r) =>
        `<span class="mono" style="font-weight:700;">${escapeHtml(r.requestTicket || r.requestID || r.id)}</span>`,
    },
    {
      key: "requesterName",
      label: "Requester",
      sortable: true,
      render: (r) => `
        <div class="cell-user">
          <div class="avatar" style="width:32px;height:32px;font-size:11px;">${avatarContent(r)}</div>
          <div><div class="cell-user__name">${escapeHtml(r.requesterName || "—")}</div><div class="cell-user__sub">${escapeHtml(r.requesterBlock || "")} ${escapeHtml(r.requesterLot || "")}</div></div>
        </div>`,
    },
    {
      key: "documentType",
      label: "Document",
      sortable: true,
      render: (r) =>
        `${escapeHtml(r.documentType || "—")}<div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.requestCategory || "")}</div>`,
    },
    {
      key: "requestStatus",
      label: "Status",
      sortable: true,
      sortValue: (r) =>
        STATUS_ORDER.indexOf(statusToken(r.requestStatus || "pending")),
      render: (r) =>
        `<span class="badge badge-${statusToken(r.requestStatus || "pending")}">${escapeHtml(statusLabel(r.requestStatus))}</span>`,
    },
    {
      key: "requestDate",
      label: "Submitted",
      sortable: true,
      sortValue: (r) => toMs(r.requstTimestamp),
      render: (r) => formatDate(r.requstTimestamp || r.requestDate),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      csv: false,
      render: (r) =>
        `<div class="row-actions" data-stop-row-click><button class="btn btn-secondary btn-sm" data-act="open">View</button></div>`,
    },
  ],
  filters: [
    {
      key: "requestStatus",
      label: "Status",
      options: STATUS_OPTIONS,
      match: (r, v) => statusToken(r.requestStatus || "pending") === v,
    },
  ],
  emptyTitle: "No document requests",
  emptyDesc: "No requests match your current filters.",
  onRowClick: (row) => openDetailModal(row),
});

onValue(ref(db, DB_PATHS.documentRequests), (snap) => {
  allDocs = objectToArray(snap.val(), "id").map((d) => ({
    ...d,
    requestID: d.requestID || d.id,
  }));
  table.setData(allDocs);
  renderStats();
});

const filterParam = getQueryParam("filter");
if (filterParam === "pending") table.activeFilters.requestStatus = "pending";

function renderStats() {
  const counts = {};
  STATUS_OPTIONS.forEach((s) => (counts[s.value] = 0));
  allDocs.forEach((d) => {
    const token = statusToken(d.requestStatus || "pending");
    counts[token] = (counts[token] || 0) + 1;
  });
  document.getElementById("docStats").innerHTML = [
    ["Total Requests", allDocs.length],
    ...STATUS_OPTIONS.map((s) => [s.label, counts[s.value] || 0]),
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

table.cfg.afterRender = (rows) => {
  document.querySelectorAll('[data-act="open"]').forEach((btn, i) => {
    btn.addEventListener("click", () => openDetailModal(rows[i]));
  });
};

function openDetailModal(r) {
  const currentToken = statusToken(r.requestStatus || "pending");
  const overlay = openModal({
    title: `Request ${r.requestTicket || r.requestID}`,
    subtitle: r.documentType || "Document Request",
    size: "modal-xl",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:24px;">
        <div>
          <div class="section-title" style="font-size:14px;">Request Details</div>
          <div class="detail-grid" style="margin-bottom:20px;">
            <div class="detail-item"><div class="label">Requester</div><div class="value">${escapeHtml(r.requesterName || "—")}</div></div>
            <div class="detail-item"><div class="label">Email</div><div class="value">${escapeHtml(r.requesterEmail || "—")}</div></div>
            <div class="detail-item"><div class="label">Block / Lot / Street</div><div class="value">${escapeHtml(r.requesterBlock || "—")} / ${escapeHtml(r.requesterLot || "—")} / ${escapeHtml(r.requesterStreet || "—")}</div></div>
            <div class="detail-item"><div class="label">Resident Type</div><div class="value">${escapeHtml(r.requesterResidentType || "—")}</div></div>
            <div class="detail-item"><div class="label">Category</div><div class="value">${escapeHtml(r.requestCategory || "—")}</div></div>
            <div class="detail-item"><div class="label">Document Type</div><div class="value">${escapeHtml(r.documentType || "—")}</div></div>
          </div>
          <div class="detail-item" style="margin-bottom:16px;"><div class="label">Purpose</div><div class="value" style="font-weight:500;">${escapeHtml(r.purpose || "—")}</div></div>
          <div class="detail-item" style="margin-bottom:16px;"><div class="label">Remarks</div><div class="value" style="font-weight:500;">${escapeHtml(r.remarks || "—")}</div></div>
          ${r.link ? `<div class="detail-item" style="margin-bottom:16px;"><div class="label">Attached Link</div><div class="value"><a href="${escapeHtml(r.link)}" target="_blank" rel="noopener" style="color:var(--color-primary);text-decoration:underline;">${escapeHtml(r.link)}</a></div></div>` : ""}

          <div class="divider"></div>
          <div class="section-title" style="font-size:14px;">Admin Response</div>
          <div class="field">
            <label>Status</label>
            <select class="select" id="statusSelect">
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}" ${s.value === currentToken ? "selected" : ""}>${s.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Admin Note</label>
            <textarea class="textarea" id="adminNoteInput" placeholder="Add a note for the requester…">${escapeHtml(r.adminNote || "")}</textarea>
          </div>
          <div class="field">
            <label>Response Link (optional)</label>
            <input class="input" id="adminLinkInput" placeholder="https://…" value="${escapeHtml(r.adminLinkResponse || "")}">
          </div>
        </div>
        <div>
          <div class="section-title" style="font-size:14px;">Timeline</div>
          <div class="timeline">${buildDocTimeline(r)}</div>
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
      const newStatus = overlay.querySelector("#statusSelect").value; // already snake_case, e.g. "under_review"
      const adminNote = overlay.querySelector("#adminNoteInput").value.trim();
      const adminLinkResponse = overlay
        .querySelector("#adminLinkInput")
        .value.trim();

      const updates = {
        requestStatus: newStatus,
        adminNote,
        adminLinkResponse,
        adminName: adminProfile.fullName || adminProfile.name || "Admin",
        adminRole: adminProfile.role || "Admin",
      };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField && newStatus !== currentToken)
        updates[dateField] = formatAdminActionTimestamp();

      try {
        await update(ref(db, `${DB_PATHS.documentRequests}/${r.id}`), updates);

        // Notify the requester, same as the Android app — only when the
        // status actually changed.
        if (newStatus !== currentToken) {
          try {
            await notifyRequester(r, newStatus, adminNote);
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

function buildDocTimeline(r) {
  const steps = [
    {
      label: "Submitted",
      ts: r.requstTimestamp || r.requestDate,
      always: true,
    },
    { label: "Under Review", ts: r.underReviewDateTime },
    { label: "Approved", ts: r.approvedDateTime },
    { label: "Rejected", ts: r.rejectedDateTime },
    { label: "Cancelled", ts: r.cancelledDateTime },
  ].filter((s) => s.always || s.ts);

  return steps
    .map(
      (s, i) => `
    <div class="timeline__item ${s.ts ? "done" : ""} ${i === steps.length - 1 ? "active" : ""}">
      <div class="timeline__dot"></div>
      <div class="timeline__title">${s.label}</div>
      <div class="timeline__meta">${s.ts ? (s.label === "Submitted" ? formatDateTime(s.ts) : s.ts) : "Pending"}</div>
      ${s.label === "Submitted" && r.adminNote ? `<div class="timeline__note">${escapeHtml(r.adminNote)}</div>` : ""}
    </div>
  `,
    )
    .join("");
}

/* ============================================================
   PRINT — Approved requests within a chosen date range.
   Filters strictly by requstTimestamp (the reliable numeric
   field already stored on every request) and requestStatus
   === "approved" only.
   ============================================================ */

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Approved Requests",
    subtitle:
      "Generate a printable list of approved document requests for a date range",
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
        Only requests with status <strong style="color:var(--color-black);">Approved</strong> and a submission date inside this range will be included.
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
    printApprovedDocuments(fromVal, toVal);
    overlay.close();
  });
}

function printApprovedDocuments(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allDocs
    .filter((d) => statusToken(d.requestStatus) === "approved")
    .filter((d) => {
      const ms = toMs(d.requstTimestamp);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.requstTimestamp) - toMs(b.requstTimestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No approved requests fall inside that date range.",
    });
    return;
  }

  const cols = [
    { label: "Requester", value: (r) => r.requesterName },
    { label: "Document Type", value: (r) => r.documentType },
    { label: "Purpose", value: (r) => r.purpose },
    { label: "Date", value: (r) => r.requestDate },
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
    `Approved Document Requests — ${formatDate(from)} to ${formatDate(to)}`,
    bodyHTML,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} approved request${rows.length === 1 ? "" : "s"} included.`,
  });
}

/** Reads requstTimestamp (a numeric string, unix seconds or ms) into a real ms number. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/** Matches DocumentRequestModel's *DateTime fields, e.g. "July 30, 2026, 11:00 AM". */
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
