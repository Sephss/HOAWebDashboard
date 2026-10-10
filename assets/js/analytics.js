/* ============================================================
   analytics.js — Analytics & reporting module
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, DB_PATHS } from "./firebase.js";
import { objectToArray, isYes, humanize, statusToken } from "./utils.js";
import {
  renderLineChart,
  renderBarChart,
  renderDonutChart,
  renderMiniBarList,
  PALETTE,
} from "./charts.js";

const adminProfile = await guardPage();
renderShell("analytics", adminProfile, { breadcrumb: "Analytics" });

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Analytics</div>
      <div class="page-header__subtitle">Community growth, request trends, and operational performance.</div>
    </div>
    <div class="page-header__actions">
      <div class="tabs" style="border:none;margin:0;" id="rangeTabs">
        <button class="tab-btn active" data-range="30">30 Days</button>
        <button class="tab-btn" data-range="90">90 Days</button>
        <button class="tab-btn" data-range="365">1 Year</button>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px;">
    <div class="card-body">
      <div class="kpi-row" id="kpiRow"></div>
    </div>
  </div>

  <div class="chart-grid">
    <!-- TEMPORARILY DISABLED: User Registrations chart. Remove this comment
         wrapper (and the matching one around renderRegistrations() below)
         to bring it back.
    <div class="card chart-card">
      <div class="chart-card__header">
        <div><div class="chart-card__title">User Registrations</div><div class="chart-card__subtitle">New resident sign-ups over time</div></div>
      </div>
      <div id="registrationsChart"></div>
    </div>
    -->
    <div class="card chart-card">
      <div class="chart-card__header">
        <div><div class="chart-card__title">Requests Over Time</div><div class="chart-card__subtitle">Documents, grievances & maintenance combined</div></div>
      </div>
      <div id="requestsOverTimeChart"></div>
      <div class="chart-card__legend">
        <span class="legend-item"><span class="legend-swatch" style="background:${PALETTE[0]}"></span>Documents</span>
        <span class="legend-item"><span class="legend-swatch" style="background:${PALETTE[1]}"></span>Grievances</span>
        <span class="legend-item"><span class="legend-swatch" style="background:${PALETTE[2]}"></span>Maintenance</span>
      </div>
    </div>
  </div>

  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Resident Types</div><div class="chart-card__subtitle">Homeowners vs renters</div></div></div>
      <div id="residentTypeChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Phase Distribution</div><div class="chart-card__subtitle">Residents by community phase</div></div></div>
      <div id="phaseChart"></div>
    </div>
    <!-- TEMPORARILY DISABLED: Document Request Status chart. Remove this
         comment wrapper (and the matching one around renderDocStatus()
         below) to bring it back.
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Document Request Status</div></div></div>
      <div id="docStatusChart"></div>
    </div>
    -->
  </div>

  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Top Requested Documents</div></div></div>
      <div id="topDocsChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Most Common Grievance Types</div></div></div>
      <div id="grievanceTypesChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Most Common Maintenance Types</div></div></div>
      <div id="maintTypesChart"></div>
    </div>
  </div>

  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Pending vs Completed</div><div class="chart-card__subtitle">Across all request modules</div></div></div>
      <div id="pendingCompletedChart"></div>
    </div>
    <!-- TEMPORARILY DISABLED: Monthly Growth chart. Remove this comment
         wrapper (and the matching one around renderMonthlyGrowth() below)
         to bring it back.
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Monthly Growth</div><div class="chart-card__subtitle">Total residents by month</div></div></div>
      <div id="monthlyGrowthChart"></div>
    </div>
    -->
  </div>
`;

/* ===== EXTENDED ANALYTICS — HTML (added after the original layout) ===== */
content.insertAdjacentHTML(
  "beforeend",
  `
  <div class="card" style="margin:24px 0 16px;">
    <div class="card-body">
      <div class="kpi-row" id="extraKpiRow"></div>
    </div>
  </div>

  <div class="section-title" style="margin:8px 0 12px;">Emergency Directory & HOA Rules</div>
  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Emergency Entries by Category</div><div class="chart-card__subtitle">Hospitals, police, fire, barangay and more</div></div></div>
      <div id="emergencyCategoryChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Emergency Entries Posted</div><div class="chart-card__subtitle">New directory entries over time</div></div></div>
      <div id="emergencyOverTimeChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">HOA Rules by Category</div><div class="chart-card__subtitle">Distribution of published rules</div></div></div>
      <div id="rulesCategoryChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">HOA Rules Posted</div><div class="chart-card__subtitle">New rules over time</div></div></div>
      <div id="rulesOverTimeChart"></div>
    </div>
  </div>

  <div class="section-title" style="margin:24px 0 12px;">Community Solicitation</div>
  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Solicitation Status</div><div class="chart-card__subtitle">Active vs closed drives</div></div></div>
      <div id="solicitStatusChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Contributions Over Time</div><div class="chart-card__subtitle">Contributions submitted by residents</div></div></div>
      <div id="solicitOverTimeChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Total Collected per Solicitation</div><div class="chart-card__subtitle">Top 6 by amount (₱)</div></div></div>
      <div id="solicitCollectedChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Contributors per Solicitation</div><div class="chart-card__subtitle">Top 6 by participation</div></div></div>
      <div id="solicitContributorsChart"></div>
    </div>
  </div>

  <div class="section-title" style="margin:24px 0 12px;">Error Tickets & Feedback</div>
  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Ticket Status</div><div class="chart-card__subtitle">Pending, in progress, resolved, rejected</div></div></div>
      <div id="ticketStatusChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Bugs vs Suggestions</div><div class="chart-card__subtitle">What residents are reporting</div></div></div>
      <div id="ticketCategoryChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Tickets Over Time</div><div class="chart-card__subtitle">Submissions per day</div></div></div>
      <div id="ticketsOverTimeChart"></div>
    </div>
  </div>

  <div class="section-title" style="margin:24px 0 12px;">Facilities Reservation</div>
  <div class="chart-grid">
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Reservation Status</div><div class="chart-card__subtitle">Pending, confirmed, denied, cancelled, refunded</div></div></div>
      <div id="bookingStatusChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Bookings Over Time</div><div class="chart-card__subtitle">Reservations made per day</div></div></div>
      <div id="bookingsOverTimeChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Most Booked Facilities</div></div></div>
      <div id="bookingFacilityChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Revenue by Facility</div><div class="chart-card__subtitle">Confirmed bookings only (₱)</div></div></div>
      <div id="bookingRevenueChart"></div>
    </div>
    <div class="card chart-card">
      <div class="chart-card__header"><div><div class="chart-card__title">Popular Time Slots</div></div></div>
      <div id="bookingSlotChart"></div>
    </div>
  </div>
`,
);

let dataStore = {
  users: [],
  docs: [],
  grievances: [],
  maintenance: [],
  announcements: [],
};

/** Separate store for the extended modules so dataStore stays untouched. */
const extraStore = {
  emergency: [],
  rules: [],
  solicits: [],
  tickets: [],
  bookings: [],
};

let rangeDays = 30;

document.getElementById("rangeTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-range]");
  if (!btn) return;
  document
    .querySelectorAll("#rangeTabs .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  rangeDays = Number(btn.dataset.range);
  renderAll();
});

function bindLive(path, key) {
  onValue(ref(db, path), (snap) => {
    dataStore[key] = objectToArray(snap.val());
    renderAll();
  });
}
bindLive(DB_PATHS.users, "users");
bindLive(DB_PATHS.documentRequests, "docs");
bindLive(DB_PATHS.grievanceReports, "grievances");
bindLive(DB_PATHS.maintenanceRequests, "maintenance");
bindLive(DB_PATHS.announcements, "announcements");

function bindExtra(path, key, transform) {
  onValue(ref(db, path), (snap) => {
    extraStore[key] = transform
      ? transform(snap.val())
      : objectToArray(snap.val());
    renderAll();
  });
}
bindExtra(DB_PATHS.emergencyDirectories, "emergency");
bindExtra(DB_PATHS.hoaRules, "rules");
bindExtra(DB_PATHS.communitySolicitations, "solicits");
bindExtra(DB_PATHS.bookings, "bookings");
// errorTicketing is nested: userID > ticketID > data, so flatten it first.
bindExtra(DB_PATHS.ErrorTicketing, "tickets", (root) => {
  const out = [];
  Object.values(root || {}).forEach((userTickets) => {
    if (!userTickets || typeof userTickets !== "object") return;
    Object.values(userTickets).forEach((t) => {
      if (t && typeof t === "object") out.push(t);
    });
  });
  return out;
});

window.addEventListener(
  "resize",
  debounceResize(() => renderAll(), 300),
);
function debounceResize(fn, wait) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, wait);
  };
}

function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

function dateBuckets(days) {
  const labels = [];
  const keys = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
    labels.push(
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    );
  }
  return { labels, keys };
}

function bucketCounts(items, tsField, days) {
  const { labels, keys } = dateBuckets(days);
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  items.forEach((it) => {
    const ms = toMs(it[tsField] ?? it.timestamp);
    if (!ms) return;
    const key = new Date(ms).toISOString().slice(0, 10);
    if (key in map) map[key]++;
  });
  return { labels, data: keys.map((k) => map[k]) };
}

function renderAll() {
  renderKPIs();
  // TEMPORARILY DISABLED — see matching HTML comment above. Uncomment to restore.
  // renderRegistrations();
  renderRequestsOverTime();
  renderResidentType();
  renderPhase();
  // TEMPORARILY DISABLED — see matching HTML comment above. Uncomment to restore.
  // renderDocStatus();
  renderTopDocs();
  renderGrievanceTypes();
  renderMaintTypes();
  renderPendingCompleted();
  // TEMPORARILY DISABLED — see matching HTML comment above. Uncomment to restore.
  // renderMonthlyGrowth();
  renderExtras();
}

function renderKPIs() {
  const users = dataStore.users;
  const total = users.length;
  const approved = users.filter((u) =>
    isYes(u.isAccountApprovedByAdmin),
  ).length;
  const approvalRate = total ? Math.round((approved / total) * 100) : 0;

  const allReqs = [
    ...dataStore.docs.map((d) => statusToken(d.requestStatus)),
    ...dataStore.grievances.map((d) => statusToken(d.incidentStatus)),
    ...dataStore.maintenance.map((d) => statusToken(d.maintenanceStatus)),
  ];
  const completed = allReqs.filter(
    (s) => s === "approved" || s === "resolved",
  ).length;
  const completionRate = allReqs.length
    ? Math.round((completed / allReqs.length) * 100)
    : 0;

  const kpis = [
    { value: total, label: "Total Residents" },
    { value: `${approvalRate}%`, label: "Approval Rate" },
    { value: `${completionRate}%`, label: "Completion Rate" },
    { value: dataStore.docs.length, label: "Document Requests" },
    { value: dataStore.grievances.length, label: "Grievance Reports" },
    { value: dataStore.maintenance.length, label: "Maintenance Requests" },
  ];
  document.getElementById("kpiRow").innerHTML = kpis
    .map(
      (k) =>
        `<div class="kpi-mini"><div class="kpi-mini__value">${k.value}</div><div class="kpi-mini__label">${k.label}</div></div>`,
    )
    .join("");
}

// TEMPORARILY DISABLED — paired with the commented-out "User Registrations"
// card above and the commented-out call in renderAll(). Function kept intact
// so restoring it later is just removing comments in three spots.
// function renderRegistrations() {
//   const { labels, data } = bucketCounts(
//     dataStore.users,
//     "dateRegistered",
//     rangeDays,
//   );
//   renderLineChart(document.getElementById("registrationsChart"), {
//     labels,
//     series: [{ name: "Registrations", data, color: PALETTE[0] }],
//   });
// }

function renderRequestsOverTime() {
  const docs = bucketCounts(dataStore.docs, "requstTimestamp", rangeDays).data;
  const grievances = bucketCounts(
    dataStore.grievances,
    "timestamp",
    rangeDays,
  ).data;
  const maint = bucketCounts(
    dataStore.maintenance,
    "timestamp",
    rangeDays,
  ).data;
  const { labels } = dateBuckets(rangeDays);
  renderLineChart(document.getElementById("requestsOverTimeChart"), {
    labels,
    series: [
      { name: "Documents", data: docs, color: PALETTE[0], area: false },
      { name: "Grievances", data: grievances, color: PALETTE[1], area: false },
      { name: "Maintenance", data: maint, color: PALETTE[2], area: false },
    ],
  });
}

function renderResidentType() {
  const counts = {};
  dataStore.users.forEach((u) => {
    const t = u.role || u.userType || "Unspecified";
    counts[t] = (counts[t] || 0) + 1;
  });
  const data = Object.entries(counts).map(([label, value], i) => ({
    label,
    value,
    color: PALETTE[i % PALETTE.length],
  }));
  if (!data.length) data.push({ label: "No data", value: 0 });
  renderDonutChart(document.getElementById("residentTypeChart"), { data });
}

function renderPhase() {
  const counts = {};
  dataStore.users.forEach((u) => {
    const p = u.phaseType || u.lavanyaPhaseType || "Unspecified";
    counts[p] = (counts[p] || 0) + 1;
  });
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
  renderMiniBarList(document.getElementById("phaseChart"), {
    data: data.length ? data : [{ label: "No data", value: 0 }],
    color: PALETTE[1],
  });
}

// TEMPORARILY DISABLED — paired with the commented-out "Document Request
// Status" card above and the commented-out call in renderAll(). Function
// kept intact so restoring it later is just removing comments in three spots.
// function renderDocStatus() {
//   const counts = {};
//   ["Pending", "Under Review", "Approved", "Rejected", "Cancelled"].forEach(
//     (s) => (counts[s] = 0),
//   );
//   dataStore.docs.forEach((d) => {
//     const s = d.requestStatus || "Pending";
//     counts[s] = (counts[s] || 0) + 1;
//   });
//   const data = Object.entries(counts).map(([label, value], i) => ({
//     label,
//     value,
//     color: PALETTE[i % PALETTE.length],
//   }));
//   renderDonutChart(document.getElementById("docStatusChart"), { data });
// }

function renderTopDocs() {
  const counts = {};
  dataStore.docs.forEach((d) => {
    const t = d.documentType || "Unspecified";
    counts[t] = (counts[t] || 0) + 1;
  });
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  renderMiniBarList(document.getElementById("topDocsChart"), {
    data: data.length ? data : [{ label: "No data", value: 0 }],
    color: PALETTE[0],
  });
}

function renderGrievanceTypes() {
  const counts = {};
  dataStore.grievances.forEach((g) => {
    const t = g.incidentType || "Unspecified";
    counts[t] = (counts[t] || 0) + 1;
  });
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  renderMiniBarList(document.getElementById("grievanceTypesChart"), {
    data: data.length ? data : [{ label: "No data", value: 0 }],
    color: PALETTE[3],
  });
}

function renderMaintTypes() {
  const counts = {};
  dataStore.maintenance.forEach((m) => {
    const t = m.maintenanceType || "Unspecified";
    counts[t] = (counts[t] || 0) + 1;
  });
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  renderMiniBarList(document.getElementById("maintTypesChart"), {
    data: data.length ? data : [{ label: "No data", value: 0 }],
    color: PALETTE[2],
  });
}

function renderPendingCompleted() {
  const groups = [
    {
      label: "Documents",
      items: dataStore.docs.map((d) => statusToken(d.requestStatus)),
    },
    {
      label: "Grievances",
      items: dataStore.grievances.map((d) => statusToken(d.incidentStatus)),
    },
    {
      label: "Maintenance",
      items: dataStore.maintenance.map((d) => statusToken(d.maintenanceStatus)),
    },
  ];
  const labels = groups.map((g) => g.label);
  const pending = groups.map(
    (g) => g.items.filter((s) => s === "pending").length,
  );
  const completed = groups.map(
    (g) => g.items.filter((s) => s === "approved" || s === "resolved").length,
  );

  const wrap = document.getElementById("pendingCompletedChart");
  wrap.innerHTML = "";
  const barsWrap = document.createElement("div");
  barsWrap.style.display = "flex";
  barsWrap.style.flexDirection = "column";
  barsWrap.style.gap = "16px";
  labels.forEach((label, i) => {
    const total = pending[i] + completed[i] || 1;
    barsWrap.innerHTML += `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:6px;"><span>${label}</span><span style="color:var(--color-grey);font-weight:600;">${pending[i]} pending · ${completed[i]} completed</span></div>
        <div style="display:flex;height:10px;border-radius:99px;overflow:hidden;background:var(--color-bg);">
          <div style="width:${(pending[i] / total) * 100}%;background:${PALETTE[6]};"></div>
          <div style="width:${(completed[i] / total) * 100}%;background:${PALETTE[3]};"></div>
        </div>
      </div>
    `;
  });
  wrap.appendChild(barsWrap);
  const legend = document.createElement("div");
  legend.className = "chart-card__legend";
  legend.innerHTML = `<span class="legend-item"><span class="legend-swatch" style="background:${PALETTE[6]}"></span>Pending</span><span class="legend-item"><span class="legend-swatch" style="background:${PALETTE[3]}"></span>Completed</span>`;
  wrap.appendChild(legend);
}

// TEMPORARILY DISABLED — paired with the commented-out "Monthly Growth" card
// above and the commented-out call in renderAll(). Function kept intact so
// restoring it later is just removing comments in three spots.
// function renderMonthlyGrowth() {
//   const months = [];
//   const now = new Date();
//   for (let i = 11; i >= 0; i--) {
//     const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
//     months.push({
//       key: `${d.getFullYear()}-${d.getMonth()}`,
//       label: d.toLocaleDateString("en-US", { month: "short" }),
//     });
//   }
//   const cumulative = [];
//   months.forEach((m, idx) => {
//     const cutoff = new Date(
//       now.getFullYear(),
//       now.getMonth() - (11 - idx) + 1,
//       1,
//     ).getTime();
//     const count = dataStore.users.filter((u) => {
//       const ms = toMs(u.dateRegistered || u.timestamp);
//       return ms && ms < cutoff;
//     }).length;
//     cumulative.push(count);
//   });
//   renderBarChart(document.getElementById("monthlyGrowthChart"), {
//     labels: months.map((m) => m.label),
//     data: cumulative,
//     color: PALETTE[0],
//   });
// }

/* ============================================================
   EXTENDED ANALYTICS — Emergency, HOA Rules, Solicitation,
   Error Tickets, Facilities Reservation.
   ============================================================ */

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

function countBy(items, getKey) {
  const counts = {};
  items.forEach((it) => {
    const k = getKey(it) || "Unspecified";
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

function donutFromCounts(counts) {
  const data = Object.entries(counts).map(([label, value], i) => ({
    label,
    value,
    color: PALETTE[i % PALETTE.length],
  }));
  return data.length ? data : [{ label: "No data", value: 0 }];
}

function miniBarFromCounts(counts, limit = 6) {
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
  return data.length ? data : [{ label: "No data", value: 0 }];
}

function ticketStatus(t) {
  const s = String(t.status || "Pending").toLowerCase();
  if (s === "in progress") return "In Progress";
  if (s === "resolved") return "Resolved";
  if (s === "rejected") return "Rejected";
  return "Pending";
}

function bookingStatusLabel(b) {
  const s = String(b.bookingStatus || "confirmed").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function bookingSlotLabel(b) {
  return b.requestBookingTimeIn && b.requestBookingsTimeOut
    ? `${b.requestBookingTimeIn} - ${b.requestBookingsTimeOut}`
    : b.slot || "Unspecified";
}

/** Flattens CommunitySolicitations > id > contributions > uid into one list. */
function allContributions() {
  const out = [];
  extraStore.solicits.forEach((s) => {
    objectToArray(s.contributions).forEach((c) =>
      out.push({ ...c, _solicitTitle: s.title || "Untitled" }),
    );
  });
  return out;
}

function solicitCollected(s) {
  return objectToArray(s.contributions).reduce(
    (sum, c) => sum + (Number(c.amountSent) || 0),
    0,
  );
}

function renderExtras() {
  const { emergency, rules, solicits, tickets, bookings } = extraStore;
  const contributions = allContributions();
  const { labels } = dateBuckets(rangeDays);

  // ---------- KPIs ----------
  const totalCollected = contributions.reduce(
    (sum, c) => sum + (Number(c.amountSent) || 0),
    0,
  );
  const activeSolicits = solicits.filter(
    (s) => (s.status || "active") === "active",
  ).length;
  const resolvedTickets = tickets.filter(
    (t) => ticketStatus(t) === "Resolved",
  ).length;
  const ticketResolutionRate = tickets.length
    ? Math.round((resolvedTickets / tickets.length) * 100)
    : 0;
  const confirmedBookings = bookings.filter(
    (b) => String(b.bookingStatus || "confirmed").toLowerCase() === "confirmed",
  );
  const bookingRevenue = confirmedBookings.reduce(
    (sum, b) => sum + (Number(b.bookingAmount) || 0),
    0,
  );

  const extraKpis = [
    { value: emergency.length, label: "Emergency Entries" },
    { value: rules.length, label: "HOA Rules" },
    { value: activeSolicits, label: "Active Solicitations" },
    { value: peso(totalCollected), label: "Total Collected" },
    { value: tickets.length, label: "Error Tickets" },
    { value: `${ticketResolutionRate}%`, label: "Ticket Resolution Rate" },
    { value: bookings.length, label: "Reservations" },
    { value: peso(bookingRevenue), label: "Reservation Revenue" },
  ];
  document.getElementById("extraKpiRow").innerHTML = extraKpis
    .map(
      (k) =>
        `<div class="kpi-mini"><div class="kpi-mini__value">${k.value}</div><div class="kpi-mini__label">${k.label}</div></div>`,
    )
    .join("");

  // ---------- Emergency Directory ----------
  renderMiniBarList(document.getElementById("emergencyCategoryChart"), {
    data: miniBarFromCounts(
      countBy(emergency, (e) => e.category),
      8,
    ),
    color: PALETTE[3],
  });
  renderBarChart(document.getElementById("emergencyOverTimeChart"), {
    labels,
    data: bucketCounts(emergency, "timestamp", rangeDays).data,
    color: PALETTE[3],
  });

  // ---------- HOA Rules ----------
  renderDonutChart(document.getElementById("rulesCategoryChart"), {
    data: donutFromCounts(countBy(rules, (r) => r.category)),
  });
  renderBarChart(document.getElementById("rulesOverTimeChart"), {
    labels,
    data: bucketCounts(rules, "timestamp", rangeDays).data,
    color: PALETTE[1],
  });

  // ---------- Community Solicitation ----------
  renderDonutChart(document.getElementById("solicitStatusChart"), {
    data: donutFromCounts(
      countBy(solicits, (s) =>
        (s.status || "active") === "active" ? "Active" : "Closed",
      ),
    ),
  });
  renderLineChart(document.getElementById("solicitOverTimeChart"), {
    labels,
    series: [
      {
        name: "Contributions",
        data: bucketCounts(contributions, "timestamp", rangeDays).data,
        color: PALETTE[0],
        area: false,
      },
    ],
  });
  const collectedData = solicits
    .map((s) => ({
      label: s.title || "Untitled",
      value: solicitCollected(s),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  renderMiniBarList(document.getElementById("solicitCollectedChart"), {
    data: collectedData.length
      ? collectedData
      : [{ label: "No data", value: 0 }],
    color: PALETTE[2],
  });
  const contributorData = solicits
    .map((s) => ({
      label: s.title || "Untitled",
      value: objectToArray(s.contributions).length,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  renderMiniBarList(document.getElementById("solicitContributorsChart"), {
    data: contributorData.length
      ? contributorData
      : [{ label: "No data", value: 0 }],
    color: PALETTE[4],
  });

  // ---------- Error Tickets ----------
  renderDonutChart(document.getElementById("ticketStatusChart"), {
    data: donutFromCounts(countBy(tickets, ticketStatus)),
  });
  renderDonutChart(document.getElementById("ticketCategoryChart"), {
    data: donutFromCounts(
      countBy(tickets, (t) =>
        String(t.category || "")
          .toLowerCase()
          .includes("bug")
          ? "Bug / Error"
          : "Suggestion / Feature",
      ),
    ),
  });
  renderLineChart(document.getElementById("ticketsOverTimeChart"), {
    labels,
    series: [
      {
        name: "Tickets",
        data: bucketCounts(tickets, "timestamp", rangeDays).data,
        color: PALETTE[1],
        area: false,
      },
    ],
  });

  // ---------- Facilities Reservation ----------
  renderDonutChart(document.getElementById("bookingStatusChart"), {
    data: donutFromCounts(countBy(bookings, bookingStatusLabel)),
  });
  renderLineChart(document.getElementById("bookingsOverTimeChart"), {
    labels,
    series: [
      {
        name: "Bookings",
        data: bucketCounts(bookings, "timestamp", rangeDays).data,
        color: PALETTE[0],
        area: false,
      },
    ],
  });
  renderMiniBarList(document.getElementById("bookingFacilityChart"), {
    data: miniBarFromCounts(
      countBy(bookings, (b) => b.bookerSport),
      6,
    ),
    color: PALETTE[0],
  });
  const revenueByFacility = {};
  confirmedBookings.forEach((b) => {
    const k = b.bookerSport || "Unspecified";
    revenueByFacility[k] =
      (revenueByFacility[k] || 0) + (Number(b.bookingAmount) || 0);
  });
  renderMiniBarList(document.getElementById("bookingRevenueChart"), {
    data: miniBarFromCounts(revenueByFacility, 6),
    color: PALETTE[2],
  });
  renderMiniBarList(document.getElementById("bookingSlotChart"), {
    data: miniBarFromCounts(countBy(bookings, bookingSlotLabel), 4),
    color: PALETTE[3],
  });
}
