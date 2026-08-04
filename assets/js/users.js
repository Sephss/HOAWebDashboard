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
          <div class="avatar" style="width:34px;height:34px;font-size:12px;">${avatarInnerHTML(r)}</div>
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
        humanize(r.residentType || r.userType || r.accountType || r.role || ""),
    },
    { key: "block", label: "Block" },
    { key: "lot", label: "Lot" },
    { key: "street", label: "Street" },
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
        { value: "archived", label: "Archived" },
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
        if (v === "archived") return isYes(r.isArchived);
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
          r.role ||
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

/**
 * Archived residents (isArchived: "yes") are excluded from the table by
 * default. They only appear when the "Archived" status filter is
 * explicitly selected. This wraps the DataTable's internal _apply() so the
 * base dataset is recomputed from the *full* allUsers list every time a
 * search/sort/filter change triggers a re-apply — otherwise switching the
 * status filter to "Archived" would have nothing to show, since the
 * archived rows would already have been excluded from table.allRows.
 */
const originalApply = table._apply.bind(table);
table._apply = () => {
  const statusFilter = table.activeFilters.status;
  table.allRows =
    statusFilter === "archived"
      ? allUsers.filter((u) => isYes(u.isArchived))
      : allUsers.filter((u) => !isYes(u.isArchived));
  originalApply();
};

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

/** Stats reflect only active (non-archived) accounts, matching what the
 * table shows by default. */
function renderSummary() {
  const activeUsers = allUsers.filter((u) => !isYes(u.isArchived));
  const total = activeUsers.length;
  const approved = activeUsers.filter((u) =>
    isYes(u.isAccountApprovedByAdmin),
  ).length;
  const pending = total - approved;
  const disabled = activeUsers.filter((u) => isYes(u.isAccountDisabled)).length;
  const banned = activeUsers.filter((u) => isYes(u.isAccountBanned)).length;
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
    (u) => !isYes(u.isArchived) && !isYes(u.isAccountApprovedByAdmin),
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
  if (isYes(r.isArchived))
    badges.push(`<span class="badge badge-neutral">Archived</span>`);
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
  const archived = isYes(r.isArchived);
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
    ${
      archived
        ? `<button class="dropdown__item" data-act="unarchive">${svgCheck()}Unarchive account</button>`
        : `<button class="dropdown__item" data-act="archive">${svgArchive()}Archive account</button>`
    }
    <!-- Delete account temporarily disabled — do not re-enable without checking with the team.
    <button class="dropdown__item danger" data-act="delete">${svgTrash()}Delete account</button>
    -->
  `;
}

function wireActionMenu(menu, row) {
  menu.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.classList.remove("open");
      const act = btn.dataset.act;
      if (act === "view") return openProfileModal(row);
      if (act === "archive") return openArchiveReasonModal(row);
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
    unarchive: {
      title: "Unarchive account",
      message: `Restore <strong>${escapeHtml(name)}</strong>'s account from the archive? It will reappear in the main resident list.`,
      tone: "success",
      confirmLabel: "Unarchive",
    },
    /* Delete account temporarily disabled — do not re-enable without checking with the team.
    delete: {
      title: "Delete account",
      message: `Permanently delete <strong>${escapeHtml(name)}</strong>'s account record? This cannot be undone.`,
      tone: "danger",
      confirmLabel: "Delete Permanently",
    },
    */
  };
  const cfg = confirmMap[act];
  const ok = await confirmDialog(cfg);
  if (!ok) return;

  try {
    /* Delete account temporarily disabled — do not re-enable without checking with the team.
    if (act === "delete") {
      await remove(ref(db, `${DB_PATHS.users}/${row.id}`));
      toast({
        type: "success",
        title: "Account deleted",
        desc: `${name}'s account record was removed.`,
      });
      return;
    }
    */
    const updates = {
      approve: { isAccountApprovedByAdmin: "yes" },
      disable: { isAccountDisabled: "yes" },
      enable: { isAccountDisabled: "no" },
      ban: { isAccountBanned: "yes" },
      unban: { isAccountBanned: "no" },
      unarchive: {
        isArchived: "no",
        archivedAt: "none",
        archivedBy: "none",
        archivedReason: "none",
      },
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

/** Archiving requires a reason, so it gets its own modal instead of the
 * generic confirmDialog used by the other account actions. */
function openArchiveReasonModal(row) {
  const name = getFullName(row) || "this user";
  const overlay = openModal({
    title: "Archive account",
    subtitle: `Archive ${name}'s account`,
    bodyHTML: `
      <div class="field" id="archiveReasonField">
        <label>Reason for archiving</label>
        <textarea class="textarea" id="archiveReasonInput" placeholder="e.g. Moved out, duplicate account, resident's request…"></textarea>
        <span class="field-error">Please enter a reason.</span>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-danger" data-act="confirm">Archive Account</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());

  overlay
    .querySelector('[data-act="confirm"]')
    .addEventListener("click", async () => {
      const field = overlay.querySelector("#archiveReasonField");
      const reason = overlay.querySelector("#archiveReasonInput").value.trim();
      field.classList.remove("has-error");
      if (!reason) {
        field.classList.add("has-error");
        return;
      }

      try {
        await update(ref(db, `${DB_PATHS.users}/${row.id}`), {
          isArchived: "yes",
          archivedAt: formatAdminActionTimestamp(),
          archivedBy: adminProfile.role || "Admin",
          archivedReason: reason,
        });
        toast({
          type: "success",
          title: "Account archived",
          desc: `${name}'s account was archived.`,
        });
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Archive failed", desc: err.message });
      }
    });
}

/** Matches the "MMMM dd, yyyy, hh:mm a" style used for status-change
 * timestamps elsewhere in this dashboard (e.g. documents.js). */
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

function openProfileModal(r) {
  const approved = isYes(r.isAccountApprovedByAdmin);
  const disabled = isYes(r.isAccountDisabled);
  const banned = isYes(r.isAccountBanned);
  const archived = isYes(r.isArchived);

  const overlay = openModal({
    title: "Resident Profile",
    size: "modal-lg",
    bodyHTML: `
      <div class="profile-hero">
        <div class="avatar">${avatarInnerHTML(r)}</div>
        <div>
          <div class="profile-hero__name">${escapeHtml(getFullName(r) || "Unnamed Resident")}</div>
          <div class="profile-hero__email">${escapeHtml(r.email || "No email on file")}</div>
          <div class="profile-hero__badges">
            <span class="badge badge-neutral">${escapeHtml(humanize(r.residentType || r.userType || r.accountType || "Resident"))}</span>
            ${!approved ? `<span class="badge badge-pending">Pending</span>` : `<span class="badge badge-approved">Approved</span>`}
            ${disabled ? `<span class="badge badge-neutral">Disabled</span>` : ""}
            ${banned ? `<span class="badge badge-danger">Banned</span>` : ""}
            ${archived ? `<span class="badge badge-neutral">Archived</span>` : ""}
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
       
        <div class="detail-item"><div class="label">Account UID</div><div class="value mono" style="font-size:11px;word-break:break-all;">${escapeHtml(r.id || r.uid || "—")}</div></div>
        ${
          archived
            ? `
        <div class="detail-item"><div class="label">Archived At</div><div class="value">${escapeHtml(r.archivedAt || "—")}</div></div>
        <div class="detail-item"><div class="label">Archived By</div><div class="value">${escapeHtml(r.archivedBy || "—")}</div></div>
        <div class="detail-item"><div class="label">Archived Reason</div><div class="value">${escapeHtml(r.archivedReason || "—")}</div></div>
        `
            : ""
        }
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      ${!approved ? `<button class="btn btn-success" data-act="approve">Approve Registration</button>` : ""}
      ${banned ? `<button class="btn btn-success" data-act="unban">Unban Account</button>` : `<button class="btn btn-danger" data-act="ban">Ban Account</button>`}
      ${archived ? `<button class="btn btn-success" data-act="unarchive">Unarchive Account</button>` : `<button class="btn btn-secondary" data-act="archive">Archive Account</button>`}
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
  overlay
    .querySelector('[data-act="archive"]')
    ?.addEventListener("click", () => {
      overlay.close();
      openArchiveReasonModal(r);
    });
  overlay
    .querySelector('[data-act="unarchive"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await handleUserAction("unarchive", r);
    });
}

/**
 * Resolve the resident's avatar markup.
 * The DB stores an `imageUrl` child that is either a real image URL or the
 * literal string "none" when the resident hasn't uploaded a photo. Only
 * treat it as a real image when it's present and isn't "none" — anything
 * else falls back to the existing initials avatar.
 */
function avatarInnerHTML(r) {
  const url = String(r.imageUrl || "").trim();
  if (url && url.toLowerCase() !== "none") {
    return `<img src="${escapeHtml(url)}" alt="">`;
  }
  return initials(getFullName(r));
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
function svgArchive() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h22v5H1z" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12h4" stroke-linecap="round"/></svg>`;
}
function svgTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
