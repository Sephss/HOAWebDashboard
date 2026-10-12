/* ============================================================
   admin-accounts.js — Admin Accounts module
   Lists every account whose role is an admin-tier role and lets an
   admin create, edit and delete them. Saved at users > {uid} > {details}.

   Creating the Firebase Auth login uses a temporary SECONDARY Firebase
   app instance. Calling createUserWithEmailAndPassword on the main
   app would sign the new user in and log the current admin out; the
   secondary app keeps the current admin's session untouched.

   Every create / update / delete is written to the Activity Log.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import {
  db,
  ref,
  onValue,
  set,
  update,
  remove,
  DB_PATHS,
  initializeApp,
  getApp,
  deleteApp,
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
} from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal, confirmDialog } from "./ui.js";
import {
  objectToArray,
  isYes,
  initials,
  getFullName,
  escapeHtml,
} from "./utils.js";
import { uploadImage } from "./imageUpload.js";
import { logActivity } from "./activityLogger.js";

const adminProfile = await guardPage();
renderShell("adminAccounts", adminProfile, { breadcrumb: "Admin Accounts" });

/** Admin-tier roles — same list used by the Activity Log. */
const ADMIN_ROLES = [
  "Admin",
  "admin",
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
];

const PHASE_OPTIONS = ["3A", "3B", "3C"];

const uidOf = (r) => r.uid || r.id || "";

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Admin Accounts</div>
      <div class="page-header__subtitle">Create and manage accounts for HOA officers and administrators.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-primary" id="newAdminBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
        New Admin Account
      </button>
    </div>
  </div>
  <div class="stat-grid" id="adminStats"></div>
  <div class="card"><div id="adminTableRoot"></div></div>
`;

document
  .getElementById("newAdminBtn")
  .addEventListener("click", () => openCreateModal());

let allAdmins = [];

function avatarInnerHTML(r) {
  const url = String(r.imageUrl || "").trim();
  if (url && url.toLowerCase() !== "none") {
    return `<img src="${escapeHtml(url)}" alt="">`;
  }
  return initials(getFullName(r));
}

function hasImage(r) {
  const url = String(r?.imageUrl || "").trim();
  return !!url && url.toLowerCase() !== "none";
}

function isInactive(r) {
  return (
    isYes(r.isAccountBanned) ||
    isYes(r.isAccountDisabled) ||
    isYes(r.isArchived)
  );
}

function statusBadge(r) {
  if (isYes(r.isArchived))
    return `<span class="badge badge-neutral">Archived</span>`;
  if (isYes(r.isAccountBanned))
    return `<span class="badge badge-danger">Banned</span>`;
  if (isYes(r.isAccountDisabled))
    return `<span class="badge badge-neutral">Disabled</span>`;
  return `<span class="badge badge-approved">Active</span>`;
}

const table = new DataTable({
  root: document.getElementById("adminTableRoot"),
  title: "Admin Accounts",
  pageSize: 10,
  searchFields: [
    "firstName",
    "middleName",
    "lastName",
    "email",
    "role",
    "phoneNumber",
  ],
  defaultSort: "fullName",
  showExportCsv: false,
  columns: [
    {
      key: "fullName",
      label: "Admin",
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
      label: "Role",
      sortable: true,
      render: (r) =>
        `<span class="badge badge-neutral">${escapeHtml(r.role || "—")}</span>`,
    },
    {
      key: "phoneNumber",
      label: "Phone",
      sortable: false,
      render: (r) => escapeHtml(r.phoneNumber || "—"),
    },
    {
      key: "block",
      label: "Block / Lot / Street",
      sortable: false,
      render: (r) =>
        `${escapeHtml(r.block || "—")} / ${escapeHtml(r.lot || "—")} / ${escapeHtml(r.street || "—")}`,
    },
    {
      key: "lavanyaPhaseType",
      label: "Phase",
      sortable: true,
      render: (r) => escapeHtml(r.lavanyaPhaseType || "—"),
    },
    {
      key: "status",
      label: "Status",
      sortable: false,
      render: (r) => statusBadge(r),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      csv: false,
      render: () => `
        <div class="row-actions" data-stop-row-click>
          <button class="icon-btn btn-icon-only" data-act="open" title="View">${svgEye()}</button>
          <button class="icon-btn btn-icon-only" data-act="edit" title="Edit">${svgEdit()}</button>
          <button class="icon-btn btn-icon-only" data-act="delete" title="Delete">${svgTrash()}</button>
        </div>`,
    },
  ],
  filters: [
    {
      key: "role",
      label: "Role",
      options: ADMIN_ROLES.filter((r) => r !== "admin").map((r) => ({
        value: r,
        label: r,
      })),
      match: (r, v) => (r.role || "").toLowerCase() === v.toLowerCase(),
    },
  ],
  emptyTitle: "No admin accounts found",
  emptyDesc: "No admin accounts match your search or filters.",
  onRowClick: (row) => openProfileModal(row),
});

onValue(ref(db, DB_PATHS.users), (snap) => {
  allAdmins = objectToArray(snap.val(), "id").filter((u) =>
    ADMIN_ROLES.includes(u.role),
  );
  table.setData(allAdmins);
  renderStats();
});

table.cfg.afterRender = (rows) => {
  document
    .querySelectorAll('[data-act="open"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openProfileModal(rows[i])),
    );
  document
    .querySelectorAll('[data-act="edit"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openEditModal(rows[i])),
    );
  document
    .querySelectorAll('[data-act="delete"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => deleteAdmin(rows[i])),
    );
};

function renderStats() {
  const total = allAdmins.length;
  const inactive = allAdmins.filter(isInactive).length;
  document.getElementById("adminStats").innerHTML = [
    ["Total Admin Accounts", total],
    ["Active", total - inactive],
    ["Inactive", inactive],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

/* ============================================================
   PROFILE (read-only) — with Edit / Delete shortcuts
   ============================================================ */
function openProfileModal(r) {
  const overlay = openModal({
    title: "Admin Profile",
    size: "modal-lg",
    bodyHTML: `
      <div class="profile-hero">
        <div class="avatar">${avatarInnerHTML(r)}</div>
        <div>
          <div class="profile-hero__name">${escapeHtml(getFullName(r) || "Unnamed")}</div>
          <div class="profile-hero__email">${escapeHtml(r.email || "No email on file")}</div>
          <div class="profile-hero__badges">
            <span class="badge badge-neutral">${escapeHtml(r.role || "—")}</span>
            ${statusBadge(r)}
          </div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Phone Number</div><div class="value">${escapeHtml(r.phoneNumber || "—")}</div></div>
        <div class="detail-item"><div class="label">Lavanya Phase</div><div class="value">${escapeHtml(r.lavanyaPhaseType || "—")}</div></div>
        <div class="detail-item"><div class="label">Block</div><div class="value">${escapeHtml(r.block || "—")}</div></div>
        <div class="detail-item"><div class="label">Lot</div><div class="value">${escapeHtml(r.lot || "—")}</div></div>
        <div class="detail-item"><div class="label">Street</div><div class="value">${escapeHtml(r.street || "—")}</div></div>
        <div class="detail-item"><div class="label">Account UID</div><div class="value mono" style="font-size:11px;word-break:break-all;">${escapeHtml(uidOf(r) || "—")}</div></div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      <button class="btn btn-danger" data-act="delete">Delete</button>
      <button class="btn btn-primary" data-act="edit">Edit</button>
    `,
  });
  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay.querySelector('[data-act="edit"]').addEventListener("click", () => {
    overlay.close();
    openEditModal(r);
  });
  overlay
    .querySelector('[data-act="delete"]')
    .addEventListener("click", async () => {
      overlay.close();
      await deleteAdmin(r);
    });
}

/* ============================================================
   SHARED FORM (used by Create + Edit)
   ============================================================ */
function roleOptionsFor(existing) {
  // "admin" (lowercase) is a legacy duplicate; only offer it if the account already has it.
  return ADMIN_ROLES.filter((r) => r !== "admin" || existing?.role === "admin");
}

function formHTML(existing) {
  const isEdit = !!existing;
  const v = (k) => escapeHtml(existing?.[k] || "");
  const imgSrc = hasImage(existing) ? escapeHtml(existing.imageUrl) : "";
  const isSelf = isEdit && uidOf(existing) === adminProfile.uid;

  return `
    <div class="field" id="imageField">
      <label>Profile Picture ${isEdit ? "" : '<span style="color:var(--color-danger,#d33);">*</span>'}</label>
      <input type="file" accept="image/*" class="input" id="imageInput">
      <div id="imagePreviewWrap" style="margin-top:10px;${imgSrc ? "" : "display:none;"}">
        <img id="imagePreview" src="${imgSrc}" alt="Profile picture" style="width:96px;height:96px;object-fit:cover;border-radius:50%;display:block;">
      </div>
      <span class="field-error">Profile picture is required.</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
      <div class="field" id="firstNameField">
        <label>First Name</label>
        <input class="input" id="firstNameInput" placeholder="e.g. Juan" value="${v("firstName")}">
        <span class="field-error">First name is required.</span>
      </div>
      <div class="field" id="middleNameField">
        <label>Middle Name</label>
        <input class="input" id="middleNameInput" placeholder="Optional" value="${v("middleName")}">
      </div>
      <div class="field" id="lastNameField">
        <label>Last Name</label>
        <input class="input" id="lastNameInput" placeholder="e.g. Dela Cruz" value="${v("lastName")}">
        <span class="field-error">Last name is required.</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="field" id="phoneField">
        <label>Phone Number</label>
        <input class="input" id="phoneInput" placeholder="e.g. 09123456789" value="${v("phoneNumber")}">
        <span class="field-error">Enter a valid phone number.</span>
      </div>
      <div class="field" id="roleField">
        <label>Role${isSelf ? " (you can't change your own role)" : ""}</label>
        <select class="select" id="roleInput" ${isSelf ? "disabled" : ""}>
          <option value="">Select role</option>
          ${roleOptionsFor(existing)
            .map(
              (r) =>
                `<option value="${escapeHtml(r)}" ${existing?.role === r ? "selected" : ""}>${escapeHtml(r)}</option>`,
            )
            .join("")}
        </select>
        <span class="field-error">Select a role.</span>
      </div>
    </div>

    ${
      isEdit
        ? `<div class="field">
            <label>Email Address</label>
            <input class="input" value="${v("email")}" disabled>
            <div style="font-size:12px;color:var(--color-grey);margin-top:4px;">Email and password can't be changed here.</div>
          </div>`
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="field" id="emailField">
              <label>Email Address</label>
              <input type="email" class="input" id="emailInput" placeholder="name@example.com" autocomplete="off">
              <span class="field-error">Enter a valid email address.</span>
            </div>
            <div class="field" id="passwordField">
              <label>Password</label>
              <input type="password" class="input" id="passwordInput" placeholder="At least 6 characters" autocomplete="new-password">
              <span class="field-error">Password must be at least 6 characters.</span>
            </div>
          </div>`
    }

    <div class="divider"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">
      <div class="field" id="blockField">
        <label>Block</label>
        <input class="input" id="blockInput" value="${v("block")}">
        <span class="field-error">Required.</span>
      </div>
      <div class="field" id="lotField">
        <label>Lot</label>
        <input class="input" id="lotInput" value="${v("lot")}">
        <span class="field-error">Required.</span>
      </div>
      <div class="field" id="streetField">
        <label>Street</label>
        <input class="input" id="streetInput" value="${v("street")}">
        <span class="field-error">Required.</span>
      </div>
      <div class="field" id="phaseField">
        <label>Lavanya Phase</label>
        <select class="select" id="phaseInput">
          <option value="">Select</option>
          ${PHASE_OPTIONS.map((p) => `<option value="${p}" ${existing?.lavanyaPhaseType === p ? "selected" : ""}>${p}</option>`).join("")}
        </select>
        <span class="field-error">Select a phase.</span>
      </div>
    </div>
  `;
}

/** Wires the image picker + preview. Returns a getter for the chosen file. */
function wireImagePicker(overlay) {
  let selectedFile = null;
  const input = overlay.querySelector("#imageInput");
  const wrap = overlay.querySelector("#imagePreviewWrap");
  const preview = overlay.querySelector("#imagePreview");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      input.value = "";
      selectedFile = null;
      toast({
        type: "warning",
        title: "Invalid file",
        desc: "Please choose an image file.",
      });
      return;
    }
    selectedFile = file;
    overlay.querySelector("#imageField").classList.remove("has-error");
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      wrap.style.display = "";
    };
    reader.readAsDataURL(file);
  });

  return () => selectedFile;
}

/** Reads + validates the shared fields. Returns null if invalid. */
function readForm(
  overlay,
  { isEdit, hasExistingImage, selectedFile, existing },
) {
  overlay
    .querySelectorAll(".field.has-error")
    .forEach((f) => f.classList.remove("has-error"));

  const val = (sel) => overlay.querySelector(sel).value.trim();
  const isSelf = isEdit && uidOf(existing) === adminProfile.uid;

  const data = {
    firstName: val("#firstNameInput"),
    middleName: val("#middleNameInput"),
    lastName: val("#lastNameInput"),
    phoneNumber: val("#phoneInput"),
    // A disabled select still has a value, but fall back to the existing role for safety.
    role: isSelf ? existing.role : val("#roleInput"),
    block: val("#blockInput"),
    lot: val("#lotInput"),
    street: val("#streetInput"),
    lavanyaPhaseType: val("#phaseInput"),
  };
  if (!isEdit) {
    data.email = val("#emailInput").toLowerCase();
    data.password = overlay.querySelector("#passwordInput").value;
  }

  let hasError = false;
  const require = (ok, id) => {
    if (!ok) {
      overlay.querySelector(`#${id}`)?.classList.add("has-error");
      hasError = true;
    }
  };
  require(selectedFile || hasExistingImage, "imageField");
  require(data.firstName, "firstNameField");
  require(data.lastName, "lastNameField");
  require(/^[+\d][\d\s-]{6,}$/.test(data.phoneNumber), "phoneField");
  require(ADMIN_ROLES.includes(data.role), "roleField");
  if (!isEdit) {
    require(/^\S+@\S+\.\S+$/.test(data.email), "emailField");
    require(data.password.length >= 6, "passwordField");
  }
  require(data.block, "blockField");
  require(data.lot, "lotField");
  require(data.street, "streetField");
  require(PHASE_OPTIONS.includes(data.lavanyaPhaseType), "phaseField");

  return hasError ? null : data;
}

/* ============================================================
   CREATE
   ============================================================ */
function openCreateModal() {
  const overlay = openModal({
    title: "New Admin Account",
    subtitle: "Creates a login and saves the profile under users.",
    size: "modal-lg",
    bodyHTML: formHTML(null),
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="save">Create Account</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());

  const getFile = wireImagePicker(overlay);

  overlay
    .querySelector('[data-act="save"]')
    .addEventListener("click", async () => {
      const form = readForm(overlay, {
        isEdit: false,
        hasExistingImage: false,
        selectedFile: getFile(),
      });
      if (!form) return;

      const saveBtn = overlay.querySelector('[data-act="save"]');
      saveBtn.disabled = true;

      try {
        // Upload first — if it fails, no Auth user has been created yet.
        saveBtn.textContent = "Uploading photo…";
        let imageUrl;
        try {
          imageUrl = await uploadImage(getFile());
        } catch (uploadErr) {
          toast({
            type: "danger",
            title: "Image upload failed",
            desc: uploadErr.message,
          });
          saveBtn.disabled = false;
          saveBtn.textContent = "Create Account";
          return;
        }

        saveBtn.textContent = "Creating account…";
        await createAdminAccount({ ...form, imageUrl });

        toast({
          type: "success",
          title: "Admin account created",
          desc: `${form.firstName} ${form.lastName} can now sign in as ${form.role}.`,
        });
        await logActivity(adminProfile, {
          action: "Created",
          module: "Admin Accounts",
          targetName: `${form.firstName} ${form.lastName}`,
          details: `Created ${form.role} account (${form.email})`,
        });
        overlay.close();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Create Account";
        toast({
          type: "danger",
          title: "Could not create account",
          desc: friendlyError(err),
        });
      }
    });
}

/**
 * 1. Creates the Auth login on a temporary secondary app (so the current
 *    admin stays signed in).
 * 2. Writes users/{uid} with the main app's database connection.
 * 3. If the database write fails, deletes the just-created login so there
 *    is no orphaned account.
 */
async function createAdminAccount(form) {
  const secondaryApp = initializeApp(
    getApp().options,
    `AdminCreator-${Date.now()}`,
  );
  const secondaryAuth = getAuth(secondaryApp);
  let credential = null;

  try {
    credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      form.email,
      form.password,
    );
    const uid = credential.user.uid;

    await set(ref(db, `${DB_PATHS.users}/${uid}`), {
      archivedAt: "none",
      archivedBy: "none",
      archivedReason: "none",
      block: form.block,
      email: form.email,
      firstName: form.firstName,
      imageUrl: form.imageUrl,
      isAccountApprovedByAdmin: "yes",
      isAccountBanned: "no",
      isArchived: "no",
      lastName: form.lastName,
      lavanyaPhaseType: form.lavanyaPhaseType,
      lot: form.lot,
      middleName: form.middleName,
      phoneNumber: form.phoneNumber,
      role: form.role,
      street: form.street,
      uid,
    });
  } catch (err) {
    if (credential?.user) {
      try {
        await credential.user.delete();
      } catch (cleanupErr) {
        console.error("Failed to clean up orphaned auth user:", cleanupErr);
      }
    }
    throw err;
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch (_) {
      /* ignore */
    }
    await deleteApp(secondaryApp);
  }
}

/* ============================================================
   EDIT (everything except email + password)
   ============================================================ */
const FIELD_LABELS = {
  firstName: "first name",
  middleName: "middle name",
  lastName: "last name",
  phoneNumber: "phone number",
  role: "role",
  block: "block",
  lot: "lot",
  street: "street",
  lavanyaPhaseType: "phase",
  imageUrl: "profile picture",
};

function openEditModal(r) {
  const overlay = openModal({
    title: "Edit Admin Account",
    subtitle: `Editing ${getFullName(r) || r.email || "account"}`,
    size: "modal-lg",
    bodyHTML: formHTML(r),
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-danger" data-act="delete">Delete</button>
      <button class="btn btn-primary" data-act="save">Save Changes</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="delete"]')
    .addEventListener("click", async () => {
      overlay.close();
      await deleteAdmin(r);
    });

  const getFile = wireImagePicker(overlay);

  overlay
    .querySelector('[data-act="save"]')
    .addEventListener("click", async () => {
      const form = readForm(overlay, {
        isEdit: true,
        hasExistingImage: hasImage(r),
        selectedFile: getFile(),
        existing: r,
      });
      if (!form) return;

      const saveBtn = overlay.querySelector('[data-act="save"]');
      const originalLabel = saveBtn.textContent;
      saveBtn.disabled = true;

      const payload = { ...form };

      if (getFile()) {
        saveBtn.textContent = "Uploading photo…";
        try {
          payload.imageUrl = await uploadImage(getFile());
        } catch (uploadErr) {
          toast({
            type: "danger",
            title: "Image upload failed",
            desc: uploadErr.message,
          });
          saveBtn.disabled = false;
          saveBtn.textContent = originalLabel;
          return;
        }
      }

      // Work out what actually changed, for the activity log.
      const changed = Object.keys(payload).filter(
        (k) => String(payload[k] ?? "") !== String(r[k] ?? ""),
      );
      if (!changed.length) {
        toast({ type: "info", title: "No changes to save" });
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
        return;
      }

      saveBtn.textContent = "Saving…";
      try {
        await update(ref(db, `${DB_PATHS.users}/${uidOf(r)}`), payload);
        toast({ type: "success", title: "Admin account updated" });
        await logActivity(adminProfile, {
          action: "Edited",
          module: "Admin Accounts",
          targetName: `${payload.firstName} ${payload.lastName}`,
          details: `Updated ${changed.map((k) => FIELD_LABELS[k] || k).join(", ")}`,
        });
        overlay.close();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
        toast({ type: "danger", title: "Save failed", desc: err.message });
      }
    });
}

/* ============================================================
   DELETE
   ============================================================ */
async function deleteAdmin(r) {
  if (uidOf(r) === adminProfile.uid) {
    toast({
      type: "warning",
      title: "Can't delete your own account",
      desc: "Ask another admin to remove it.",
    });
    return;
  }

  const name = getFullName(r) || r.email || "this account";
  const ok = await confirmDialog({
    title: "Delete admin account",
    message: `Delete "<strong>${escapeHtml(name)}</strong>"? This removes their profile and cannot be undone.`,
    tone: "danger",
    confirmLabel: "Delete",
  });
  if (!ok) return;

  try {
    await remove(ref(db, `${DB_PATHS.users}/${uidOf(r)}`));
    toast({ type: "success", title: "Admin account deleted" });
    await logActivity(adminProfile, {
      action: "Deleted",
      module: "Admin Accounts",
      targetName: name,
      details: `Deleted ${r.role || "admin"} account (${r.email || "no email"})`,
    });
  } catch (err) {
    toast({ type: "danger", title: "Delete failed", desc: err.message });
  }
}

function friendlyError(err) {
  switch (err?.code) {
    case "auth/email-already-in-use":
      return "That email address is already registered.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return err?.message || "Something went wrong.";
  }
}

function svgEye() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function svgEdit() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function svgTrash() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
