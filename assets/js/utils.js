/* ============================================================
   utils.js — Generic, reusable helper functions
   No DOM/UI logic lives here; see ui.js for that.
   ============================================================ */

/** Debounce a function call by `wait` ms. */
export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Format a JS Date / timestamp into "Mon DD, YYYY". */
export function formatDate(input) {
  if (!input) return "—";
  const d = toDate(input);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Format a JS Date / timestamp into "Mon DD, YYYY · h:mm AM/PM". */
export function formatDateTime(input) {
  if (!input) return "—";
  const d = toDate(input);
  if (!d) return "—";
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Relative time, e.g. "3 hours ago". */
export function timeAgo(input) {
  if (!input) return "—";
  const d = toDate(input);
  if (!d) return "—";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return "just now";
  const steps = [
    ["year", 31536000], ["month", 2592000], ["week", 604800],
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [label, secs] of steps) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val} ${label}${val > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

/** Coerce timestamps (number, ISO string, or "MM/DD/YYYY" style) into a Date, or null. */
export function toDate(input) {
  if (input instanceof Date) return isNaN(input) ? null : input;
  if (typeof input === "number") return new Date(input);
  if (typeof input === "string") {
    const num = Number(input);
    if (!isNaN(num) && input.trim() !== "" && num > 1000000000) return new Date(num);
    const d = new Date(input);
    return isNaN(d) ? null : d;
  }
  return null;
}

/** Turn snake_case / camelCase into "Title Case". */
export function humanize(str = "") {
  if (!str) return "";
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize a status string to a CSS-safe token, e.g. "Under Review" -> "under_review". */
export function statusToken(status = "") {
  return String(status).trim().toLowerCase().replace(/\s+/g, "_");
}

/** Build a display name from firstName/middleName/lastName, with sensible fallbacks. */
export function getFullName(r = {}) {
  const first = (r.firstName || "").trim();
  const middle = (r.middleName || "").trim();
  const last = (r.lastName || "").trim();
  const combined = [first, middle, last].filter(Boolean).join(" ");
  if (combined) return combined;
  return r.fullName || r.name || "";
}

/** Generate initials from a name for avatar fallbacks. */
export function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Escape a value for safe HTML text-node insertion. */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Simple unique ID generator for client-side keys/toasts. */
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert an array of flat objects into a CSV string. */
export function toCSV(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(typeof c.value === "function" ? c.value(row) : row[c.value])).join(",")
  );
  return [header, ...lines].join("\r\n");
}

function csvEscape(val) {
  const str = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Trigger a browser download for a text blob. */
export function downloadFile(filename, content, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Open a print-friendly window for a table/report. */
export function printHTML(title, bodyHTML) {
  const win = window.open("", "_blank", "width=1000,height=800");
  win.document.write(`
    <!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#191C1E;padding:32px;}
      h1{font-size:20px;margin-bottom:4px;color:#013717;}
      .meta{font-size:12px;color:#5C5F61;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #E7EBEC;padding:8px 10px;text-align:left;}
      th{background:#F7F9FA;text-transform:uppercase;font-size:10px;letter-spacing:.04em;color:#5C5F61;}
      @media print { body{padding:0;} }
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Generated on ${escapeHtml(formatDateTime(new Date()))}</div>
    ${bodyHTML}
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/** Clamp a number between min/max. */
export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/** Read a nested object value by dotted path safely. */
export function getPath(obj, path, fallback = undefined) {
  if (!obj) return fallback;
  const val = path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  return val === undefined ? fallback : val;
}

/** Turn a Firebase object-of-objects into an array, injecting the key as `id`. */
export function objectToArray(obj, idField = "id") {
  if (!obj) return [];
  return Object.entries(obj).map(([key, value]) => ({ [idField]: key, ...value }));
}

/** Yes/no style Firebase field to boolean. */
export function isYes(v) {
  return String(v).trim().toLowerCase() === "yes";
}

/** Query param helpers */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
