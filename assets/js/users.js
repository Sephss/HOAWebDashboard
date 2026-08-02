/* ============================================================
   users.js — Residents & Users management module
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, update, remove, DB_PATHS } from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal, confirmDialog, initDropdown } from "./ui.js";
import {
  objectToArray,
  isYes,
  initials,
  getFullName,
  humanize,
  formatDate,
  formatDateTime,
  getQueryParam,
  escapeHtml,
} from "./utils.js";

const adminProfile = await guardPage();
renderShell("users", adminProfile, { breadcrumb: "Residents & Users" });

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Residents & Users</div>
      <div class="page-header__subtitle">Approve registrations, manage account status, and review resident profiles.</div>
    </div>
    <div class="page-header__actions">
      <span class="badge badge-warning" id="pendingBadge">0 pending</span>
    </div>
  </div>

  <div class="stat-grid" id="userSummaryStats"></div>

  <div class="card">
    <div id="usersTableRoot"></div>
  </div>
`;

let allUsers = [];

const table = new DataTable({
  root: document.getElementById("usersTableRoot"),
  title: "Users",
  pageSize: 10,
  searchFields: [
    "firstName",
    "middleName",
    "lastName",
    "fullName",
    "email",
    "block",
    "lot",
    "street",
    "residentType",
  ],
  defaultSort: "fullName",
  columns: [
    {
      key: "fullName",
      label: "Resident",
      sortable: true,
      sortValue: (r) => getFullName(r).toLowerCase(),
      render: (r) => `
        <div class="cell-user">
          <div class="avatar" style="width:34px;height:34px;font-size:12px;">${r.profileImage ? `<img src="${escapeHtml(r.profileImage)}" alt="">` : initials(getFullName(r))}</div>
          <div>
            <div class="cell-user__name">${escapeHtml(getFullName(r) || "Unnamed")}</div>
            <div class="cell-user__sub">${escapeHtml(r.email || "")}</div>
          </div>
        </div>`,
    },
    {
      key: "role",
      label: "Type",
      sortable: true,
      render: (r) =>
        `<span class="badge badge-neutral">${escapeHtml(humanize(r.role || "—"))}</span>`,
    },
    {
      key: "block",
      label: "Block / Lot / Street",
      sortable: false,
      render: (r) =>
        `${escapeHtml(r.block || "—")} / ${escapeHtml(r.lot || "—")} / ${escapeHtml(r.street || "—")}`,
    },
    {
      key: "phaseType",
      label: "Phase",
      sortable: true,
      render: (r) => escapeHtml(r.phaseType || r.lavanyaPhaseType || "—"),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      sortValue: (r) => statusRank(r),
      render: (r) => statusBadges(r),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      csv: false,
      render: (r) => rowActionsHTML(r),
    },
  ],
  csvColumns: [
    { key: "fullName", label: "Name", csvValue: (r) => getFullName(r) },
    { key: "email", label: "Email" },
    {
      key: "residentType",
      label: "Resident Type",
      csvValue: (r) =>
        humanize(r.residentType || r.userType || r.accountType || ""),
    },
    { key: "block", label: "Block" },
    { key: "lot", label: "Lot" },
    { key: "street", label: "Street" },
    { key: "isAccountApprovedByAdmin", label: "Approved" },
    { key: "isAccountDisabled", label: "Disabled" },
    { key: "isAccountBanned", label: "Banned" },
    {
      key: "dateRegistered",
      label: "Registered",
      csvValue: (r) => formatDate(r.dateRegistered || r.timestamp),
    },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "pending", label: "Pending Approval" },
        { value: "approved", label: "Approved" },
        { value: "disabled", label: "Disabled" },
        { value: "banned", label: "Banned" },
      ],
      match: (r, v) => {
        if (v === "pending") return !isYes(r.isAccountApprovedByAdmin);
        if (v === "approved")
          return (
            isYes(r.isAccountApprovedByAdmin) &&
            !isYes(r.isAccountDisabled) &&
            !isYes(r.isAccountBanned)
          );
        if (v === "disabled") return isYes(r.isAccountDisabled);
        if (v === "banned") return isYes(r.isAccountBanned);
        return true;
      },
    },
    {
      key: "residentType",
      label: "Resident Type",
      options: [
        { value: "owner", label: "Home Owners" },
        { value: "renter", label: "Renters" },
      ],
      match: (r, v) => {
        const role = (
          r.role ||
          r.residentType ||
          r.userType ||
          r.accountType ||
          ""
        )
          .toLowerCase()
          .trim();

        if (v === "owner") return role === "home owners";
        if (v === "renter") return role === "renters";

        return true;
      },
    },
  ],
  emptyTitle: "No residents found",
  emptyDesc: "No user accounts match your current search or filters.",
  onRowClick: (row) => openProfileModal(row),
});

onValue(ref(db, DB_PATHS.users), (snap) => {
  allUsers = objectToArray(snap.val());
  table.setData(allUsers);
  renderSummary();
  updatePendingBadge();
});

// Deep-link support: ?filter=pending or ?q=search
const filterParam = getQueryParam("filter");
const qParam = getQueryParam("q");
if (filterParam === "pending") table.activeFilters.status = "pending";
if (qParam) {
  document.querySelector('[data-role="search"]').value = qParam;
  table.search = qParam.toLowerCase();
}

function renderSummary() {
  const total = allUsers.length;
  const approved = allUsers.filter((u) =>
    isYes(u.isAccountApprovedByAdmin),
  ).length;
  const pending = total - approved;
  const disabled = allUsers.filter((u) => isYes(u.isAccountDisabled)).length;
  const banned = allUsers.filter((u) => isYes(u.isAccountBanned)).length;
  document.getElementById("userSummaryStats").innerHTML = [
    ["Total Users", total],
    ["Approved", approved],
    ["Pending Approval", pending],
    ["Disabled", disabled],
    ["Banned", banned],
  ]
    .map(
      ([label, value]) => `
    <div class="stat-card"><div class="stat-card__accent-bar"></div>
      <div class="stat-card__value">${value}</div>
      <div class="stat-card__label">${label}</div>
    </div>`,
    )
    .join("");
}

function updatePendingBadge() {
  const pending = allUsers.filter(
    (u) => !isYes(u.isAccountApprovedByAdmin),
  ).length;
  const badge = document.getElementById("pendingBadge");
  badge.textContent = `${pending} pending approval`;
  badge.className = `badge ${pending > 0 ? "badge-warning" : "badge-success"}`;
}

function statusRank(r) {
  if (isYes(r.isAccountBanned)) return 0;
  if (isYes(r.isAccountDisabled)) return 1;
  if (!isYes(r.isAccountApprovedByAdmin)) return 2;
  return 3;
}

function statusBadges(r) {
  const badges = [];
  if (!isYes(r.isAccountApprovedByAdmin))
    badges.push(`<span class="badge badge-pending">Pending</span>`);
  else badges.push(`<span class="badge badge-approved">Approved</span>`);
  if (isYes(r.isAccountDisabled))
    badges.push(`<span class="badge badge-neutral">Disabled</span>`);
  if (isYes(r.isAccountBanned))
    badges.push(`<span class="badge badge-danger">Banned</span>`);
  return `<div style="display:flex;gap:4px;flex-wrap:wrap;">${badges.join("")}</div>`;
}

function rowActionsHTML(r) {
  return `
    <div class="row-actions" data-stop-row-click>
      <div class="dropdown">
        <button class="icon-btn btn-icon-only" data-dropdown-trigger aria-label="Row actions">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg>
        </button>
        <div class="dropdown__menu" data-user-id="${r.id}"></div>
      </div>
    </div>
  `;
}

// Build dropdown contents + wire actions after each render.
table.cfg.afterRender = (rows) => {
  document.querySelectorAll(".dropdown__menu[data-user-id]").forEach((menu) => {
    const id = menu.dataset.userId;
    const row = rows.find((r) => String(r.id) === id);
    if (!row) return;
    menu.innerHTML = buildActionMenu(row);
    wireActionMenu(menu, row);
  });
  document
    .querySelectorAll(".row-actions .dropdown")
    .forEach((dd) => initDropdown(dd));
};
table._apply(); // trigger one re-apply now that afterRender is wired

function buildActionMenu(r) {
  const approved = isYes(r.isAccountApprovedByAdmin);
  const disabled = isYes(r.isAccountDisabled);
  const banned = isYes(r.isAccountBanned);
  return `
    <button class="dropdown__item" data-act="view">${svgEye()}View profile</button>
    <div class="dropdown__divider"></div>
    ${!approved ? `<button class="dropdown__item" data-act="approve">${svgCheck()}Approve registration</button>` : ""}
    ${
      disabled
        ? `<button class="dropdown__item" data-act="enable">${svgCheck()}Enable account</button>`
        : `<button class="dropdown__item" data-act="disable">${svgSlash()}Disable account</button>`
    }
    ${
      banned
        ? `<button class="dropdown__item" data-act="unban">${svgCheck()}Unban account</button>`
        : `<button class="dropdown__item danger" data-act="ban">${svgBan()}Ban account</button>`
    }
    <div class="dropdown__divider"></div>
    <button class="dropdown__item danger" data-act="delete">${svgTrash()}Delete account</button>
  `;
}

function wireActionMenu(menu, row) {
  menu.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.classList.remove("open");
      const act = btn.dataset.act;
      if (act === "view") return openProfileModal(row);
      await handleUserAction(act, row);
    });
  });
}

async function handleUserAction(act, row) {
  const name = getFullName(row) || "this user";
  const confirmMap = {
    approve: {
      title: "Approve registration",
      message: `Approve <strong>${escapeHtml(name)}</strong>'s account registration? They will gain full access to the resident app.`,
      tone: "success",
      confirmLabel: "Approve",
    },
    disable: {
      title: "Disable account",
      message: `Disable <strong>${escapeHtml(name)}</strong>'s account? They won't be able to sign in until re-enabled.`,
      tone: "warning",
      confirmLabel: "Disable",
    },
    enable: {
      title: "Enable account",
      message: `Re-enable <strong>${escapeHtml(name)}</strong>'s account?`,
      tone: "success",
      confirmLabel: "Enable",
    },
    ban: {
      title: "Ban account",
      message: `Ban <strong>${escapeHtml(name)}</strong>? This is a serious action that blocks all access.`,
      tone: "danger",
      confirmLabel: "Ban Account",
    },
    unban: {
      title: "Unban account",
      message: `Remove the ban on <strong>${escapeHtml(name)}</strong>'s account?`,
      tone: "success",
      confirmLabel: "Unban",
    },
    delete: {
      title: "Delete account",
      message: `Permanently delete <strong>${escapeHtml(name)}</strong>'s account record? This cannot be undone.`,
      tone: "danger",
      confirmLabel: "Delete Permanently",
    },
  };
  const cfg = confirmMap[act];
  const ok = await confirmDialog(cfg);
  if (!ok) return;

  try {
    if (act === "delete") {
      await remove(ref(db, `${DB_PATHS.users}/${row.id}`));
      toast({
        type: "success",
        title: "Account deleted",
        desc: `${name}'s account record was removed.`,
      });
      return;
    }
    const updates = {
      approve: { isAccountApprovedByAdmin: "yes" },
      disable: { isAccountDisabled: "yes" },
      enable: { isAccountDisabled: "no" },
      ban: { isAccountBanned: "yes" },
      unban: { isAccountBanned: "no" },
    }[act];
    await update(ref(db, `${DB_PATHS.users}/${row.id}`), updates);
    toast({
      type: "success",
      title: "Account updated",
      desc: `${name}'s status was updated successfully.`,
    });
  } catch (err) {
    toast({ type: "danger", title: "Update failed", desc: err.message });
  }
}

function openProfileModal(r) {
  const approved = isYes(r.isAccountApprovedByAdmin);
  const disabled = isYes(r.isAccountDisabled);
  const banned = isYes(r.isAccountBanned);

  const overlay = openModal({
    title: "Resident Profile",
    size: "modal-lg",
    bodyHTML: `
      <div class="profile-hero">
        <div class="avatar">${r.profileImage ? `<img src="${escapeHtml(r.profileImage)}" alt="">` : initials(getFullName(r))}</div>
        <div>
          <div class="profile-hero__name">${escapeHtml(getFullName(r) || "Unnamed Resident")}</div>
          <div class="profile-hero__email">${escapeHtml(r.email || "No email on file")}</div>
          <div class="profile-hero__badges">
            <span class="badge badge-neutral">${escapeHtml(humanize(r.residentType || r.userType || r.accountType || "Resident"))}</span>
            ${!approved ? `<span class="badge badge-pending">Pending</span>` : `<span class="badge badge-approved">Approved</span>`}
            ${disabled ? `<span class="badge badge-neutral">Disabled</span>` : ""}
            ${banned ? `<span class="badge badge-danger">Banned</span>` : ""}
          </div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Phone Number</div><div class="value">${escapeHtml(r.phoneNumber || r.contactNumber || "—")}</div></div>
        <div class="detail-item"><div class="label">Resident Type</div><div class="value">${escapeHtml(humanize(r.role || r.userType || r.accountType || "—"))}</div></div>
        <div class="detail-item"><div class="label">Block</div><div class="value">${escapeHtml(r.block || "—")}</div></div>
        <div class="detail-item"><div class="label">Lot</div><div class="value">${escapeHtml(r.lot || "—")}</div></div>
        <div class="detail-item"><div class="label">Street</div><div class="value">${escapeHtml(r.street || "—")}</div></div>
        <div class="detail-item"><div class="label">Phase Type</div><div class="value">${escapeHtml(r.phaseType || r.lavanyaPhaseType || "—")}</div></div>
        <div class="detail-item"><div class="label">Date Registered</div><div class="value">${formatDateTime(r.dateRegistered || r.timestamp)}</div></div>
        <div class="detail-item"><div class="label">Account UID</div><div class="value mono" style="font-size:11px;word-break:break-all;">${escapeHtml(r.id || r.uid || "—")}</div></div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      ${!approved ? `<button class="btn btn-success" data-act="approve">Approve Registration</button>` : ""}
      ${banned ? `<button class="btn btn-success" data-act="unban">Unban Account</button>` : `<button class="btn btn-danger" data-act="ban">Ban Account</button>`}
    `,
  });
  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="approve"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await handleUserAction("approve", r);
    });
  overlay
    .querySelector('[data-act="ban"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await handleUserAction("ban", r);
    });
  overlay
    .querySelector('[data-act="unban"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await handleUserAction("unban", r);
    });
}

/* ---- small inline icons for dropdown items ---- */
function svgEye() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function svgCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function svgSlash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2" stroke-linecap="round"/></svg>`;
}
function svgBan() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8" stroke-linecap="round"/></svg>`;
}
function svgTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
