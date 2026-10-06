/* ============================================================
   activity-log.js — Activity Log module
   Read-only viewer for admin actions. Writes come from
   activityLogger.js, called by each module (users.js, grievances.js,
   etc.) whenever an admin-role user performs a tracked action.

   DB structure: ActivityLogs > logId > {
     adminId, adminName, adminRole,
     action        e.g. "Approved", "Rejected", "Updated Status", "Posted", "Deleted"
     module        e.g. "Users", "Grievance Reports", "Error Tickets"
     targetName    human-readable label of what was acted on
     details       optional longer description
     dateCreated, timeCreated, timestamp
   }
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, DB_PATHS } from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast } from "./ui.js";
import { objectToArray, formatDate, escapeHtml, printHTML } from "./utils.js";

const adminProfile = await guardPage();
renderShell("activityLog", adminProfile, { breadcrumb: "Activity Log" });

/** Admin-tier roles responsible for web administration — mirrors the roles array used across the app. */
const ADMIN_ROLES = [
  "Admin",
  "admin",
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
];

const ROLE_FILTER_OPTIONS = [
  { value: "President", label: "President" },
  { value: "Vice President", label: "Vice President" },
  { value: "Secretary", label: "Secretary" },
  { value: "Treasurer", label: "Treasurer" },
  { value: "Auditor", label: "Auditor" },
  { value: "Admin", label: "Admin" },
];

/** Reads timestamp (number/string, seconds or ms) into ms. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

function formatLogDateTime(entry) {
  if (entry.dateCreated) {
    return entry.timeCreated
      ? `${entry.dateCreated} • ${entry.timeCreated}`
      : entry.dateCreated;
  }
  const ms = toMs(entry.timestamp);
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

function actionBadgeClass(action) {
  const a = String(action || "").toLowerCase();
  if (a.includes("delet") || a.includes("reject")) return "badge-danger";
  if (a.includes("approv") || a.includes("resolv") || a.includes("post"))
    return "badge-success";
  if (a.includes("updat") || a.includes("edit") || a.includes("status"))
    return "badge-accent";
  return "badge-neutral";
}

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Activity Log</div>
      <div class="page-header__subtitle">Tracks admin-level actions across the system — who did what, and when.</div>
    </div>
  </div>
  <div class="stat-grid" id="logStats"></div>
  <div class="card"><div id="logTableRoot"></div></div>
`;

let allLogs = [];

const table = new DataTable({
  root: document.getElementById("logTableRoot"),
  title: "Activity Log",
  pageSize: 15,
  searchFields: ["adminName", "action", "module", "targetName", "details"],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => printLog(),
  columns: [
    {
      key: "adminName",
      label: "Admin",
      sortable: true,
      render: (r) =>
        `<div style="font-weight:600;">${escapeHtml(r.adminName || "Unknown")}</div>
         <div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.adminRole || "—")}</div>`,
    },
    {
      key: "action",
      label: "Action",
      sortable: true,
      render: (r) =>
        `<span class="badge ${actionBadgeClass(r.action)}">${escapeHtml(r.action || "—")}</span>`,
    },
    {
      key: "module",
      label: "Module",
      sortable: true,
      render: (r) => escapeHtml(r.module || "—"),
    },
    {
      key: "targetName",
      label: "Details",
      sortable: false,
      render: (r) =>
        `${escapeHtml(r.targetName || "—")}${r.details ? `<div class="cell-user__sub" style="margin-top:2px;">${escapeHtml(r.details)}</div>` : ""}`,
    },
    {
      key: "timestamp",
      label: "Date & Time",
      sortable: true,
      sortValue: (r) => toMs(r.timestamp),
      render: (r) => escapeHtml(formatLogDateTime(r)),
    },
  ],
  filters: [
    {
      key: "adminRole",
      label: "Role",
      options: ROLE_FILTER_OPTIONS,
      match: (r, v) => (r.adminRole || "") === v,
    },
    {
      key: "module",
      label: "Module",
      options: [], // populated dynamically once data loads
      match: (r, v) => (r.module || "") === v,
    },
  ],
  emptyTitle: "No activity recorded yet",
  emptyDesc:
    "Admin actions — approvals, status updates, posts, deletions — will appear here as they happen.",
});

onValue(ref(db, DB_PATHS.activityLogs), (snap) => {
  allLogs = objectToArray(snap.val(), "id").sort(
    (a, b) => toMs(b.timestamp) - toMs(a.timestamp),
  );

  // Populate the Module filter dynamically from whatever modules have actually logged something
  const moduleNames = [
    ...new Set(allLogs.map((l) => l.module).filter(Boolean)),
  ].sort();
  const moduleFilter = table.cfg.filters.find((f) => f.key === "module");
  if (moduleFilter) {
    moduleFilter.options = moduleNames.map((m) => ({ value: m, label: m }));
  }

  table.setData(allLogs);
  renderStats();
});

function renderStats() {
  const today = new Date();
  const todayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(today);

  const todayCount = allLogs.filter(
    (l) => (l.dateCreated || "") === todayStr,
  ).length;
  const uniqueAdmins = new Set(allLogs.map((l) => l.adminId).filter(Boolean))
    .size;

  document.getElementById("logStats").innerHTML = [
    ["Total Logged Actions", allLogs.length],
    ["Today", todayCount],
    ["Active Admins", uniqueAdmins],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

function printLog() {
  if (!allLogs.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No activity has been recorded yet.",
    });
    return;
  }

  const cols = [
    { label: "Admin", value: (r) => r.adminName },
    { label: "Role", value: (r) => r.adminRole },
    { label: "Action", value: (r) => r.action },
    { label: "Module", value: (r) => r.module },
    { label: "Details", value: (r) => r.targetName },
    { label: "Date & Time", value: (r) => formatLogDateTime(r) },
  ];
  const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = allLogs
    .map(
      (r) =>
        `<tr>${cols.map((c) => `<td>${escapeHtml(c.value(r) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");

  printHTML(
    "Activity Log",
    `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${allLogs.length} entries included.`,
  });
}
