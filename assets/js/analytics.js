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

let dataStore = {
  users: [],
  docs: [],
  grievances: [],
  maintenance: [],
  announcements: [],
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
