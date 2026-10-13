/* ============================================================
   resident-accounts.js — Resident Accounts module (Home Owners & Renters)
   - users > {uid}                          profile + extended details
   - OccupancyInformation > {uid} > {occupancyID}   Home Owners only, max 10

   Required (admin must fill to create): first/last name, phone, email,
   password, block, lot, street, profile picture, Lavanya phase, role.
   Everything else is optional and can be filled later through Edit.

   The Firebase Auth login is created on a temporary SECONDARY app
   so the current admin stays signed in.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import {
  db,
  ref,
  get,
  onValue,
  set,
  update,
  remove,
  push,
  DB_PATHS,
  initializeApp,
  getApp,
  deleteApp,
  getAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
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
renderShell("residentAccounts", adminProfile, {
  breadcrumb: "Resident Accounts",
});

/* ---------- constants ---------- */
const ROLES = ["Home Owners", "Renters"];
const PHASES = ["3A", "3B", "3C"];
const GENDERS = ["Male", "Female", "Other"];
const CIVIL_STATUS = [
  "Single",
  "Married",
  "Widow/Widower",
  "I choose not to disclose",
];
const COMMUNICATION = ["Call", "SMS", "Email", "Messenger"];
const OCC_RELATIONS = [
  "Self",
  "Spouse",
  "Child",
  "Parent",
  "Tenant",
  "Caretaker",
];
const VEHICLE_TYPES = ["Car", "Motorcycle", "Tricycle", "E-bike"];
const PET_TYPES = ["Dog", "Cat", "Others"];
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const MAX_OCCUPANTS = 10;

const TEXT_KEYS = [
  "firstName",
  "middleName",
  "lastName",
  "phoneNumber",
  "block",
  "lot",
  "street",
  "lavanyaPhaseType",
  "role",
  "gender",
  "civilStatus",
  "preferredCommunication",
  "messengerName",
  "propertyNotes",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactNumber",
  "tenantName",
  "tenantContact",
  "tenantNumberOfOccupants",
  "numberOfVehicles",
  "vehicleType",
  "plateNumber",
  "vehicleMake",
  "vehicleModel",
  "vehicleColor",
  "petType",
  "petOtherType",
  "numberOfPets",
  "petVaccinated",
  "petNeutered",
  "supportsPetWelfare",
  "supportsStrayProgram",
];
const DATE_KEYS = [
  "birthday",
  "dateOccupied",
  "dateAcquired",
  "leaseStart",
  "leaseEnd",
];

const IMAGE_FIELDS = [
  { key: "imageUrl", label: "Profile Picture", required: true },
  {
    key: "proofOfOwnershipUrl",
    label: "Proof of Ownership",
    help: "Transfer Certificate of Title, Deed of Sale, Contract to Sell, or other acceptable proof.",
  },
  {
    key: "validIdUrl",
    label: "Valid Government-Issued ID",
    help: "One (1) valid government-issued identification card.",
  },
  {
    key: "authorizationLetterUrl",
    label: "Authorization Letter / Special Power of Attorney (SPA)",
    help: "Only if the form is submitted by an authorized representative on behalf of the homeowner.",
  },
  {
    key: "leaseContractUrl",
    label: "Lease Contract / Proof of Tenancy",
    help: "If the property is occupied by a tenant (if available).",
  },
];
const IMAGE_KEYS = IMAGE_FIELDS.map((f) => f.key);
const EDITABLE_KEYS = [...TEXT_KEYS, ...DATE_KEYS, ...IMAGE_KEYS];

const LABELS = {
  firstName: "First Name",
  middleName: "Middle Name",
  lastName: "Last Name",
  phoneNumber: "Phone Number",
  block: "Block",
  lot: "Lot",
  street: "Street",
  lavanyaPhaseType: "Lavanya Phase",
  role: "Role",
  gender: "Gender",
  civilStatus: "Civil Status",
  preferredCommunication: "Preferred Communication",
  messengerName: "Messenger Name",
  birthday: "Birthday",
  dateOccupied: "Date Occupied",
  dateAcquired: "Date Acquired",
  propertyNotes: "Property Notes",
  emergencyContactName: "Emergency Contact Names",
  emergencyContactRelationship: "Emergency Contact Relationships",
  emergencyContactNumber: "Emergency Contact Numbers",
  tenantName: "Tenant Name",
  tenantContact: "Tenant Contact",
  tenantNumberOfOccupants: "Tenant Occupants",
  leaseStart: "Lease Start",
  leaseEnd: "Lease End",
  numberOfVehicles: "Number of Vehicles",
  vehicleType: "Vehicle Type",
  plateNumber: "Plate Number",
  vehicleMake: "Vehicle Make",
  vehicleModel: "Vehicle Model",
  vehicleColor: "Vehicle Color",
  petType: "Pet Type",
  petOtherType: "Other Pet",
  numberOfPets: "Number of Pets",
  petVaccinated: "Pet Vaccinated",
  petNeutered: "Pet Neutered",
  supportsPetWelfare: "Pet Welfare Participation",
  supportsStrayProgram: "Stray Program Support",
  imageUrl: "Profile Picture",
  proofOfOwnershipUrl: "Proof of Ownership",
  validIdUrl: "Valid ID",
  authorizationLetterUrl: "Authorization Letter",
  leaseContractUrl: "Lease Contract",
};

/* ---------- page shell ---------- */
const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Resident Accounts</div>
      <div class="page-header__subtitle">Create and update Home Owner and Renter accounts, including household details.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-primary" id="newResidentBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
        New Resident Account
      </button>
    </div>
  </div>
  <div class="stat-grid" id="residentStats"></div>
  <div class="card"><div id="residentTableRoot"></div></div>
`;
document
  .getElementById("newResidentBtn")
  .addEventListener("click", () => openFormModal(null));

/* ---------- helpers ---------- */
const esc = escapeHtml;
const uidOf = (r) => r.uid || r.id;
function hasImage(url) {
  const u = String(url || "").trim();
  return !!u && u.toLowerCase() !== "none";
}
function avatarInnerHTML(r) {
  return hasImage(r.imageUrl)
    ? `<img src="${esc(r.imageUrl)}" alt="">`
    : initials(getFullName(r));
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
  if (!isYes(r.isAccountApprovedByAdmin))
    return `<span class="badge badge-pending">Pending</span>`;
  return `<span class="badge badge-approved">Active</span>`;
}

/** "2026-07-05" -> "July 05, 2026" (same format the mobile app stores). */
function formatDateMDY(dateVal) {
  if (!dateVal) return "";
  const d = new Date(`${dateVal}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`;
}
/** "July 05, 2026" -> "2026-07-05" for <input type="date">. */
function toDateInputValue(str) {
  if (!str) return "";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const norm = (list) =>
  list.map((i) => (typeof i === "string" ? { value: i, label: i } : i));

function inputHTML(key, label, value, o = {}) {
  const {
    type = "text",
    placeholder = "",
    required = false,
    hidden = false,
    min,
  } = o;
  return `<div class="field" id="${key}Field" style="${hidden ? "display:none;" : ""}">
    <label>${label}${required ? " *" : ""}</label>
    <input type="${type}" class="input" id="${key}Input" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" ${min !== undefined ? `min="${min}"` : ""}>
    <span class="field-error">${esc(o.error || "Required.")}</span>
  </div>`;
}
function selectHTML(key, label, list, value, o = {}) {
  const { required = false, hidden = false } = o;
  return `<div class="field" id="${key}Field" style="${hidden ? "display:none;" : ""}">
    <label>${label}${required ? " *" : ""}</label>
    <select class="select" id="${key}Input">
      <option value="">Select</option>
      ${norm(list)
        .map(
          (i) =>
            `<option value="${esc(i.value)}" ${i.value === value ? "selected" : ""}>${esc(i.label)}</option>`,
        )
        .join("")}
    </select>
    <span class="field-error">Required.</span>
  </div>`;
}
function textareaHTML(key, label, value, o = {}) {
  return `<div class="field" id="${key}Field">
    <label>${label}</label>
    <textarea class="textarea" id="${key}Input" rows="${o.rows || 7}" style="min-height:${o.rows ? o.rows * 22 : 150}px;" placeholder="${esc(o.placeholder || "")}">${esc(value ?? "")}</textarea>
  </div>`;
}
function imageFieldHTML(spec, currentUrl) {
  const has = hasImage(currentUrl);
  return `<div class="field" id="${spec.key}Field">
    <label>${spec.label}${spec.required ? " *" : ""}</label>
    ${spec.help ? `<div style="font-size:12px;color:var(--color-grey);margin-bottom:6px;">${esc(spec.help)}</div>` : ""}
    <input type="file" accept="image/*" class="input" data-file-key="${spec.key}">
    <div data-preview-wrap="${spec.key}" style="margin-top:10px;${has ? "" : "display:none;"}">
      <img data-preview="${spec.key}" src="${has ? esc(currentUrl) : ""}" alt="" style="max-width:100%;max-height:160px;border-radius:8px;display:block;">
      ${spec.required ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-remove-file="${spec.key}" style="margin-top:8px;">Remove</button>`}
    </div>
    <span class="field-error">${spec.required ? "A profile picture is required." : ""}</span>
  </div>`;
}

/* ---------- list ---------- */
let allResidents = [];

const table = new DataTable({
  root: document.getElementById("residentTableRoot"),
  title: "Resident Accounts",
  pageSize: 10,
  searchFields: [
    "firstName",
    "middleName",
    "lastName",
    "email",
    "role",
    "phoneNumber",
    "block",
    "lot",
    "street",
  ],
  defaultSort: "fullName",
  showExportCsv: false,
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
            <div class="cell-user__name">${esc(getFullName(r) || "Unnamed")}</div>
            <div class="cell-user__sub">${esc(r.email || "")}</div>
          </div>
        </div>`,
    },
    {
      key: "role",
      label: "Type",
      sortable: true,
      render: (r) =>
        `<span class="badge badge-neutral">${esc(r.role || "—")}</span>`,
    },
    {
      key: "phoneNumber",
      label: "Phone",
      sortable: false,
      render: (r) => esc(r.phoneNumber || "—"),
    },
    {
      key: "block",
      label: "Block / Lot / Street",
      sortable: false,
      render: (r) =>
        `${esc(r.block || "—")} / ${esc(r.lot || "—")} / ${esc(r.street || "—")}`,
    },
    {
      key: "lavanyaPhaseType",
      label: "Phase",
      sortable: true,
      render: (r) => esc(r.lavanyaPhaseType || "—"),
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
        <div class="row-actions" data-stop-row-click style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" data-act="open">View</button>
          <button class="btn btn-secondary btn-sm" data-act="edit">Edit</button>
        </div>`,
    },
  ],
  filters: [
    {
      key: "role",
      label: "Type",
      options: ROLES.map((r) => ({ value: r, label: r })),
      match: (r, v) => r.role === v,
    },
  ],
  emptyTitle: "No resident accounts found",
  emptyDesc: "No Home Owner or Renter accounts match your search or filters.",
  onRowClick: (row) => openViewModal(row),
});

onValue(ref(db, DB_PATHS.users), (snap) => {
  allResidents = objectToArray(snap.val()).filter((u) =>
    ROLES.includes(u.role),
  );
  table.setData(allResidents);
  renderStats();
});

table.cfg.afterRender = (rows) => {
  const wire = (act, fn) =>
    document
      .querySelectorAll(`[data-act="${act}"]`)
      .forEach((btn, i) => btn.addEventListener("click", () => fn(rows[i])));
  wire("open", openViewModal);
  wire("edit", (r) => openFormModal(r));
};

function renderStats() {
  const owners = allResidents.filter((r) => r.role === "Home Owners").length;
  const renters = allResidents.filter((r) => r.role === "Renters").length;
  const inactive = allResidents.filter(isInactive).length;
  document.getElementById("residentStats").innerHTML = [
    ["Total Residents", allResidents.length],
    ["Home Owners", owners],
    ["Renters", renters],
    ["Inactive", inactive],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

/* ============================================================
   OCCUPANCY (separate node)
   ============================================================ */
async function fetchOccupants(uid) {
  const snap = await get(ref(db, `${DB_PATHS.occupancyInformation}/${uid}`));
  const val = snap.val() || {};
  return Object.entries(val).map(([id, o]) => ({
    ...o,
    occupancyID: o.occupancyID || id,
  }));
}

/* ============================================================
   VIEW (read-only)
   ============================================================ */
const VIEW_SECTIONS = [
  [
    "Homeowner Information",
    [
      ["birthday", "Birthday"],
      ["gender", "Gender"],
      ["civilStatus", "Civil Status"],
      ["preferredCommunication", "Preferred Communication"],
      ["messengerName", "Messenger / Facebook Name"],
    ],
  ],
  [
    "Property Information",
    [
      ["dateOccupied", "Date Occupied"],
      ["dateAcquired", "Date Acquired"],
      ["propertyNotes", "Notes"],
    ],
  ],
  [
    "Emergency Contact",
    [
      ["emergencyContactName", "Names"],
      ["emergencyContactRelationship", "Relationships"],
      ["emergencyContactNumber", "Contact Numbers"],
    ],
  ],
  [
    "Tenant Information",
    [
      ["tenantName", "Tenant Name"],
      ["tenantContact", "Contact"],
      ["leaseStart", "Lease Start"],
      ["leaseEnd", "Lease End"],
      ["tenantNumberOfOccupants", "Number of Occupants"],
    ],
  ],
  [
    "Vehicle Information",
    [
      ["numberOfVehicles", "Number of Vehicles"],
      ["vehicleType", "Type"],
      ["plateNumber", "Plate Number"],
      ["vehicleMake", "Make"],
      ["vehicleModel", "Model"],
      ["vehicleColor", "Color"],
    ],
  ],
  [
    "Pet Information",
    [
      ["petType", "Pet"],
      ["petOtherType", "Other Pet"],
      ["numberOfPets", "Number of Pets"],
      ["petVaccinated", "Vaccinated (Anti-Rabies)"],
      ["petNeutered", "Neutered / Castrated"],
      ["supportsPetWelfare", "Supports Pet Welfare Programs"],
      ["supportsStrayProgram", "Favors Stray Animal Program"],
    ],
  ],
];

function displayValue(val) {
  const s = String(val ?? "").trim();
  if (!s) return "—";
  if (s === "yes") return "Yes";
  if (s === "no") return "No";
  return s;
}

async function openViewModal(r) {
  const uid = uidOf(r);
  let occupants = [];
  if (r.role === "Home Owners") {
    try {
      occupants = await fetchOccupants(uid);
    } catch (e) {
      console.error("Failed to load occupancy:", e);
    }
  }

  const sectionsHTML = VIEW_SECTIONS.map(([title, fields]) => {
    const rows = fields.filter(([k]) => String(r[k] ?? "").trim());
    if (!rows.length) return "";
    return `<div class="section-title" style="font-size:14px;margin-top:20px;">${title}</div>
      <div class="detail-grid">${rows
        .map(
          ([k, label]) =>
            `<div class="detail-item"><div class="label">${label}</div><div class="value" style="white-space:pre-wrap;">${esc(displayValue(r[k]))}</div></div>`,
        )
        .join("")}</div>`;
  }).join("");

  const docs = IMAGE_FIELDS.filter(
    (f) => f.key !== "imageUrl" && hasImage(r[f.key]),
  );
  const docsHTML = docs.length
    ? `<div class="section-title" style="font-size:14px;margin-top:20px;">Supporting Documents</div>
       <div style="display:flex;gap:12px;flex-wrap:wrap;">${docs
         .map(
           (f) =>
             `<a href="${esc(r[f.key])}" target="_blank" rel="noopener" style="display:block;width:150px;font-size:12px;"><img src="${esc(r[f.key])}" alt="" style="width:150px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--color-border,#e5e7eb);"><div style="margin-top:4px;">${esc(f.label)}</div></a>`,
         )
         .join("")}</div>`
    : "";

  const occHTML = occupants.length
    ? `<div class="section-title" style="font-size:14px;margin-top:20px;">Occupancy Information (${occupants.length})</div>
       <div class="table-scroll"><table class="data-table"><thead><tr><th>Full Name</th><th>Relationship</th><th>Age</th><th>Contact</th></tr></thead><tbody>
       ${occupants.map((o) => `<tr><td>${esc(o.fullName || "—")}</td><td>${esc(o.relationshipToOwner || "—")}</td><td>${esc(o.age || "—")}</td><td>${esc(o.contactInformation || "—")}</td></tr>`).join("")}
       </tbody></table></div>`
    : "";

  const overlay = openModal({
    title: "Resident Profile",
    size: "modal-xl",
    bodyHTML: `
      <div class="profile-hero">
        <div class="avatar">${avatarInnerHTML(r)}</div>
        <div>
          <div class="profile-hero__name">${esc(getFullName(r) || "Unnamed")}</div>
          <div class="profile-hero__email">${esc(r.email || "No email on file")}</div>
          <div class="profile-hero__badges"><span class="badge badge-neutral">${esc(r.role || "—")}</span>${statusBadge(r)}</div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Phone Number</div><div class="value">${esc(r.phoneNumber || "—")}</div></div>
        <div class="detail-item"><div class="label">Lavanya Phase</div><div class="value">${esc(r.lavanyaPhaseType || "—")}</div></div>
        <div class="detail-item"><div class="label">Block / Lot / Street</div><div class="value">${esc(r.block || "—")} / ${esc(r.lot || "—")} / ${esc(r.street || "—")}</div></div>
        <div class="detail-item"><div class="label">Account UID</div><div class="value mono" style="font-size:11px;word-break:break-all;">${esc(uid || "—")}</div></div>
      </div>
      ${sectionsHTML}${docsHTML}${occHTML}
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      <button class="btn btn-primary" data-act="edit">Edit</button>
    `,
  });
  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay.querySelector('[data-act="edit"]').addEventListener("click", () => {
    overlay.close();
    openFormModal(r);
  });
}

/* ============================================================
   CREATE / EDIT FORM
   ============================================================ */
async function openFormModal(existing) {
  const isEdit = !!existing;
  const uid = isEdit ? uidOf(existing) : null;
  const get_ = (k) => existing?.[k] ?? "";

  let occupants = [];
  let initialOccupants = [];
  if (isEdit && existing.role === "Home Owners") {
    try {
      occupants = await fetchOccupants(uid);
    } catch (e) {
      console.error("Failed to load occupancy:", e);
      toast({ type: "danger", title: "Could not load occupancy records" });
      return;
    }
    initialOccupants = occupants.map((o) => ({ ...o }));
  }

  const files = {};
  const removed = {};

  const TABS = [
    ["account", "Account"],
    ["personal", "Personal"],
    ["property", "Property"],
    ["emergency", "Emergency Contact"],
    ["occupancy", "Occupancy"],
    ["tenant", "Tenant"],
    ["documents", "Documents"],
    ["vehicle", "Vehicle"],
    ["pets", "Pets"],
  ];

  const petType = get_("petType");
  const showVaxFields = petType === "Dog" || petType === "Cat";

  const panes = {
    account: `
      <div style="font-size:12px;color:var(--color-grey);margin-bottom:12px;">Fields marked * are required to create the account.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        ${inputHTML("firstName", "First Name", get_("firstName"), { required: true })}
        ${inputHTML("middleName", "Middle Name", get_("middleName"), { error: "" })}
        ${inputHTML("lastName", "Last Name", get_("lastName"), { required: true })}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${inputHTML("phoneNumber", "Phone Number", get_("phoneNumber"), { required: true, placeholder: "e.g. 09123456789", error: "Enter a valid phone number." })}
        ${selectHTML("role", "Role", ROLES, get_("role"), { required: true })}
      </div>
      ${
        isEdit
          ? `<div class="field"><label>Email Address</label><input class="input" value="${esc(get_("email"))}" disabled><small style="color:var(--color-grey);">The login email can't be changed from this page.</small></div>`
          : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              ${inputHTML("email", "Email Address", "", { type: "email", required: true, placeholder: "name@example.com", error: "Enter a valid email address." })}
              ${inputHTML("password", "Password", "", { type: "password", required: true, placeholder: "At least 6 characters", error: "Password must be at least 6 characters." })}
            </div>`
      }
      <div class="divider"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">
        ${inputHTML("block", "Block", get_("block"), { required: true })}
        ${inputHTML("lot", "Lot", get_("lot"), { required: true })}
        ${inputHTML("street", "Street", get_("street"), { required: true })}
        ${selectHTML("lavanyaPhaseType", "Lavanya Phase", PHASES, get_("lavanyaPhaseType"), { required: true })}
      </div>
      ${imageFieldHTML(IMAGE_FIELDS[0], existing?.imageUrl)}
    `,
    personal: `
      <div class="section-title" style="font-size:14px;">Homeowner Information (Primary Member)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${inputHTML("birthday", "Birthday", toDateInputValue(get_("birthday")), { type: "date" })}
        ${selectHTML("gender", "Gender", GENDERS, get_("gender"))}
        ${selectHTML("civilStatus", "Civil Status", CIVIL_STATUS, get_("civilStatus"))}
        ${selectHTML("preferredCommunication", "Preferred Method of Communication", COMMUNICATION, get_("preferredCommunication"))}
      </div>
      ${inputHTML("messengerName", "Messenger / Facebook Account Name", get_("messengerName"), { hidden: get_("preferredCommunication") !== "Messenger", placeholder: "Name of the Messenger or Facebook account" })}
    `,
    property: `
      <div class="section-title" style="font-size:14px;">Property Information</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${inputHTML("dateOccupied", "Date Occupied", toDateInputValue(get_("dateOccupied")), { type: "date" })}
        ${inputHTML("dateAcquired", "Date Acquired", toDateInputValue(get_("dateAcquired")), { type: "date" })}
      </div>
      ${textareaHTML("propertyNotes", "Notes", get_("propertyNotes"), { rows: 5, placeholder: "Any notes about the property…" })}
    `,
    emergency: `
      <div class="section-title" style="font-size:14px;">Emergency Contact</div>
      <div style="font-size:12px;color:var(--color-grey);margin-bottom:12px;line-height:1.6;">
        <strong style="color:var(--color-black);">Important:</strong> enter as many contacts as you can, stacked one per line.
        Line 1 of each box belongs to the same person, line 2 to the next person, and so on.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        ${textareaHTML("emergencyContactName", "Name", get_("emergencyContactName"), { rows: 8, placeholder: "Full name\nFull name\nFull name" })}
        ${textareaHTML("emergencyContactRelationship", "Relationship", get_("emergencyContactRelationship"), { rows: 8, placeholder: "Relationship\nRelationship\nRelationship" })}
        ${textareaHTML("emergencyContactNumber", "Contact Number", get_("emergencyContactNumber"), { rows: 8, placeholder: "Contact number\nContact number\nContact number" })}
      </div>
    `,
    occupancy: `
      <div class="section-title" style="font-size:14px;">Occupancy Information</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:12px;color:var(--color-grey);">Home Owners only. Up to ${MAX_OCCUPANTS} occupants. <span id="occCounter"></span></div>
        <button type="button" class="btn btn-secondary btn-sm" id="addOccupantBtn">+ Add Occupant</button>
      </div>
      <div id="occupantList"></div>
    `,
    tenant: `
      <div class="section-title" style="font-size:14px;">Tenant Information</div>
      <div style="font-size:12px;color:var(--color-grey);margin-bottom:12px;">Optional. It is the responsibility of the homeowner to complete this section, especially if the property is being rented.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${inputHTML("tenantName", "Name of Tenant", get_("tenantName"))}
        ${inputHTML("tenantContact", "Contact", get_("tenantContact"))}
        ${inputHTML("leaseStart", "Start of Lease", toDateInputValue(get_("leaseStart")), { type: "date" })}
        ${inputHTML("leaseEnd", "End of Lease", toDateInputValue(get_("leaseEnd")), { type: "date" })}
        ${inputHTML("tenantNumberOfOccupants", "Number of Occupants", get_("tenantNumberOfOccupants"), { type: "number", min: 0 })}
      </div>
    `,
    documents: `
      <div class="section-title" style="font-size:14px;">Supporting Documents</div>
      ${IMAGE_FIELDS.slice(1)
        .map((f) => imageFieldHTML(f, existing?.[f.key]))
        .join("")}
    `,
    vehicle: `
      <div class="section-title" style="font-size:14px;">Vehicle Information</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${inputHTML("numberOfVehicles", "How many vehicles owned? (include motorcycle, e-bike, tricycle, etc.)", get_("numberOfVehicles"), { type: "number", min: 0 })}
        ${selectHTML("vehicleType", "Type of Vehicle", VEHICLE_TYPES, get_("vehicleType"))}
        ${inputHTML("plateNumber", "Plate Number", get_("plateNumber"))}
        ${inputHTML("vehicleMake", "Make", get_("vehicleMake"))}
        ${inputHTML("vehicleModel", "Model", get_("vehicleModel"))}
        ${inputHTML("vehicleColor", "Color", get_("vehicleColor"))}
      </div>
    `,
    pets: `
      <div class="section-title" style="font-size:14px;">Pet Information</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${selectHTML("petType", "Pet", PET_TYPES, petType)}
        ${inputHTML("numberOfPets", "Number of Pets", get_("numberOfPets"), { type: "number", min: 0 })}
      </div>
      ${inputHTML("petOtherType", "What kind of pet?", get_("petOtherType"), { hidden: petType !== "Others" })}
      <div id="vaxWrap" style="display:${showVaxFields ? "grid" : "none"};grid-template-columns:1fr 1fr;gap:16px;">
        ${selectHTML("petVaccinated", "Is your pet vaccinated (Anti-Rabies)?", YES_NO, get_("petVaccinated"))}
        ${selectHTML("petNeutered", "Is your pet neutered/castrated (Kapon)?", YES_NO, get_("petNeutered"))}
      </div>
      <div class="divider"></div>
      ${selectHTML("supportsPetWelfare", "Would you support and participate in future pet welfare and public health initiatives of the Lavanya Phase 3 Homeowners Association, Inc., including spaying/neutering (castration) and anti-rabies vaccination programs?", YES_NO, get_("supportsPetWelfare"))}
      ${selectHTML("supportsStrayProgram", "Would you be in favor of the HOA implementing a humane stray animal management program, which may include the safe capture and transfer of stray cats and dogs to accredited animal shelters or the appropriate local government or animal welfare agencies?", YES_NO, get_("supportsStrayProgram"))}
    `,
  };

  const overlay = openModal({
    title: isEdit ? "Edit Resident Account" : "New Resident Account",
    subtitle: isEdit
      ? `Editing ${getFullName(existing) || "resident"}`
      : "Creates a login and saves the profile under users.",
    size: "modal-xl",
    bodyHTML: `
      <div class="tabs" id="formTabs" style="flex-wrap:wrap;margin-bottom:16px;">
        ${TABS.map(([id, label], i) => `<button type="button" class="tab-btn ${i === 0 ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
      </div>
      ${TABS.map(([id], i) => `<div data-pane="${id}" class="${i === 0 ? "" : "hidden"}">${panes[id]}</div>`).join("")}
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="save">${isEdit ? "Save Changes" : "Create Account"}</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());

  /* ----- tabs ----- */
  let activeTab = "account";
  function showTab(name) {
    activeTab = name;
    overlay
      .querySelectorAll("#formTabs .tab-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    overlay
      .querySelectorAll("[data-pane]")
      .forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
  }
  overlay
    .querySelectorAll("#formTabs .tab-btn")
    .forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  const q = (sel) => overlay.querySelector(sel);
  const roleSelect = q("#roleInput");

  /* ----- conditional fields ----- */
  function syncConditional() {
    const isOwner = roleSelect.value === "Home Owners";
    q('[data-tab="occupancy"]').style.display = isOwner ? "" : "none";
    if (!isOwner && activeTab === "occupancy") showTab("account");

    q("#messengerNameField").style.display =
      q("#preferredCommunicationInput").value === "Messenger" ? "" : "none";

    const pet = q("#petTypeInput").value;
    q("#petOtherTypeField").style.display = pet === "Others" ? "" : "none";
    q("#vaxWrap").style.display =
      pet === "Dog" || pet === "Cat" ? "grid" : "none";
  }
  ["#roleInput", "#preferredCommunicationInput", "#petTypeInput"].forEach((s) =>
    q(s).addEventListener("change", syncConditional),
  );

  /* ----- image fields ----- */
  overlay.querySelectorAll("[data-file-key]").forEach((input) => {
    const key = input.dataset.fileKey;
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      files[key] = file;
      removed[key] = false;
      const reader = new FileReader();
      reader.onload = () => {
        q(`[data-preview="${key}"]`).src = reader.result;
        q(`[data-preview-wrap="${key}"]`).style.display = "";
      };
      reader.readAsDataURL(file);
    });
  });
  overlay.querySelectorAll("[data-remove-file]").forEach((btn) => {
    const key = btn.dataset.removeFile;
    btn.addEventListener("click", () => {
      files[key] = null;
      removed[key] = true;
      overlay.querySelector(`[data-file-key="${key}"]`).value = "";
      q(`[data-preview="${key}"]`).src = "";
      q(`[data-preview-wrap="${key}"]`).style.display = "none";
    });
  });

  /* ----- occupants ----- */
  const occList = q("#occupantList");
  const addOccBtn = q("#addOccupantBtn");
  function renderOccupants() {
    occList.innerHTML = occupants.length
      ? occupants
          .map(
            (o, i) => `
        <div class="card" style="padding:14px;margin-bottom:12px;" data-occ="${i}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong style="font-size:13px;">Occupant ${i + 1}</strong>
            <button type="button" class="btn btn-danger btn-sm" data-remove-occ="${i}">Remove</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="field" style="margin-bottom:0;"><label>Full Name</label><input class="input" data-occ-field="fullName" value="${esc(o.fullName || "")}"></div>
            <div class="field" style="margin-bottom:0;"><label>Relationship to the Owner</label>
              <select class="select" data-occ-field="relationshipToOwner">
                <option value="">Select</option>
                ${OCC_RELATIONS.map((r) => `<option value="${r}" ${o.relationshipToOwner === r ? "selected" : ""}>${r}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="margin-bottom:0;"><label>Age</label><input type="number" min="0" max="120" class="input" data-occ-field="age" value="${esc(o.age || "")}"></div>
            <div class="field" style="margin-bottom:0;"><label>Contact Information</label><input class="input" data-occ-field="contactInformation" value="${esc(o.contactInformation || "")}"></div>
          </div>
        </div>`,
          )
          .join("")
      : `<div style="padding:24px 0;text-align:center;color:var(--color-grey);font-size:13px;">No occupants added yet.</div>`;
    q("#occCounter").textContent = `(${occupants.length} / ${MAX_OCCUPANTS})`;
    addOccBtn.disabled = occupants.length >= MAX_OCCUPANTS;
  }
  const syncOcc = (e) => {
    const field = e.target.dataset.occField;
    const card = e.target.closest("[data-occ]");
    if (!field || !card) return;
    occupants[Number(card.dataset.occ)][field] = e.target.value;
  };
  occList.addEventListener("input", syncOcc);
  occList.addEventListener("change", syncOcc);
  occList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-occ]");
    if (!btn) return;
    occupants.splice(Number(btn.dataset.removeOcc), 1);
    renderOccupants();
  });
  addOccBtn.addEventListener("click", () => {
    if (occupants.length >= MAX_OCCUPANTS) return;
    occupants.push({
      fullName: "",
      relationshipToOwner: "",
      age: "",
      contactInformation: "",
    });
    renderOccupants();
  });
  renderOccupants();
  syncConditional();

  /* ----- save ----- */
  const val = (key) => (q(`#${key}Input`)?.value ?? "").trim();
  const flag = (id) => q(`#${id}`)?.classList.add("has-error");

  q('[data-act="save"]').addEventListener("click", async () => {
    overlay
      .querySelectorAll(".field.has-error")
      .forEach((f) => f.classList.remove("has-error"));

    const v = {};
    TEXT_KEYS.forEach((k) => (v[k] = val(k)));
    DATE_KEYS.forEach((k) => (v[k] = formatDateMDY(val(k))));
    const email = isEdit ? existing.email : val("email").toLowerCase();
    const password = isEdit ? "" : q("#passwordInput").value;

    let hasError = false;
    const need = (ok, id) => {
      if (!ok) {
        flag(id);
        hasError = true;
      }
    };
    need(v.firstName, "firstNameField");
    need(v.lastName, "lastNameField");
    need(/^[+\d][\d\s-]{6,}$/.test(v.phoneNumber), "phoneNumberField");
    need(ROLES.includes(v.role), "roleField");
    need(v.block, "blockField");
    need(v.lot, "lotField");
    need(v.street, "streetField");
    need(PHASES.includes(v.lavanyaPhaseType), "lavanyaPhaseTypeField");
    if (!isEdit) {
      need(/^\S+@\S+\.\S+$/.test(email), "emailField");
      need(password.length >= 6, "passwordField");
    }
    const hasProfilePic =
      !!files.imageUrl || (hasImage(existing?.imageUrl) && !removed.imageUrl);
    need(hasProfilePic, "imageUrlField");
    if (hasError) {
      showTab("account");
      toast({ type: "warning", title: "Please complete the required fields" });
      return;
    }

    const isOwner = v.role === "Home Owners";
    const cleanOccupants = occupants
      .map((o) => ({
        occupancyID: o.occupancyID || "",
        fullName: (o.fullName || "").trim(),
        relationshipToOwner: (o.relationshipToOwner || "").trim(),
        age: String(o.age ?? "").trim(),
        contactInformation: (o.contactInformation || "").trim(),
      }))
      .filter(
        (o) =>
          o.fullName || o.relationshipToOwner || o.age || o.contactInformation,
      );
    if (isOwner && cleanOccupants.some((o) => !o.fullName)) {
      showTab("occupancy");
      toast({ type: "warning", title: "Each occupant needs a full name" });
      return;
    }

    // Clear answers that no longer apply
    if (v.preferredCommunication !== "Messenger") v.messengerName = "";
    if (v.petType !== "Others") v.petOtherType = "";
    if (v.petType !== "Dog" && v.petType !== "Cat") {
      v.petVaccinated = "";
      v.petNeutered = "";
    }

    // Switching Home Owners -> Renters removes the occupancy records
    if (isEdit && !isOwner && initialOccupants.length) {
      const ok = await confirmDialog({
        title: "Change role to Renters?",
        message: `Renters have no occupancy records. This will permanently remove the ${initialOccupants.length} occupant record(s) saved for <strong>${esc(getFullName(existing))}</strong>.`,
        tone: "warning",
        confirmLabel: "Change Role",
      });
      if (!ok) return;
    }

    const saveBtn = q('[data-act="save"]');
    const idleLabel = isEdit ? "Save Changes" : "Create Account";
    saveBtn.disabled = true;

    try {
      // Upload any newly chosen images in parallel
      const toUpload = Object.keys(files).filter((k) => files[k]);
      if (toUpload.length) {
        saveBtn.textContent = `Uploading ${toUpload.length} image${toUpload.length === 1 ? "" : "s"}…`;
      }
      const uploaded = await Promise.all(
        toUpload.map((k) => uploadImage(files[k])),
      );
      toUpload.forEach((k, i) => (v[k] = uploaded[i]));
      IMAGE_KEYS.forEach((k) => {
        if (v[k]) return;
        v[k] = removed[k]
          ? "none"
          : hasImage(existing?.[k])
            ? existing[k]
            : "none";
      });

      const payload = Object.fromEntries(
        EDITABLE_KEYS.map((k) => [k, v[k] ?? ""]),
      );

      const occMap = {};
      if (isOwner) {
        cleanOccupants.forEach((o) => {
          const id =
            o.occupancyID ||
            push(
              ref(
                db,
                `${DB_PATHS.occupancyInformation}/${isEdit ? uid : "new"}`,
              ),
            ).key;
          occMap[id] = { ...o, occupancyID: id };
        });
      }

      if (isEdit) {
        saveBtn.textContent = "Saving…";
        const changes = describeChanges(existing, payload);
        const occChanged =
          JSON.stringify(normOcc(initialOccupants)) !==
          JSON.stringify(normOcc(Object.values(occMap)));
        if (!changes.length && !occChanged) {
          toast({ type: "warning", title: "No changes made" });
          saveBtn.disabled = false;
          saveBtn.textContent = idleLabel;
          return;
        }

        if (changes.length)
          await update(ref(db, `${DB_PATHS.users}/${uid}`), payload);

        const occPath = `${DB_PATHS.occupancyInformation}/${uid}`;
        if (Object.keys(occMap).length) {
          const withUser = Object.fromEntries(
            Object.entries(occMap).map(([id, o]) => [
              id,
              { ...o, userID: uid },
            ]),
          );
          await set(ref(db, occPath), withUser);
        } else if (occChanged || initialOccupants.length) {
          await remove(ref(db, occPath));
        }

        if (occChanged)
          changes.push(`Occupancy Records (${Object.keys(occMap).length})`);
        toast({
          type: "success",
          title: "Resident account updated",
          desc: `${v.firstName} ${v.lastName}'s details were saved.`,
        });
        await logActivity(adminProfile, {
          action: "Edited",
          module: "Resident Accounts",
          targetName: `${v.firstName} ${v.lastName}`,
          details: `Updated: ${changes.join(", ")}`,
        });
      } else {
        saveBtn.textContent = "Creating account…";
        const { verificationSent } = await createResidentAccount({
          email,
          password,
          payload,
          occMap,
        });
        toast(
          verificationSent
            ? {
                type: "success",
                title: "Resident account created",
                desc: `A verification email was sent to ${email}.`,
              }
            : {
                type: "warning",
                title:
                  "Account created, but the verification email was not sent",
                desc: `${v.firstName} ${v.lastName} can still sign in. Ask them to use "resend verification" in the app.`,
              },
        );
        await logActivity(adminProfile, {
          action: "Created",
          module: "Resident Accounts",
          targetName: `${v.firstName} ${v.lastName}`,
          details: `Created ${v.role} account (${email}), verification email ${verificationSent ? "sent" : "not sent"}${isOwner && Object.keys(occMap).length ? ` with ${Object.keys(occMap).length} occupant record(s)` : ""}`,
        });
      }
      overlay.close();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = idleLabel;
      toast({
        type: "danger",
        title: isEdit ? "Could not save changes" : "Could not create account",
        desc: friendlyError(err),
      });
    }
  });
}

const normOcc = (list) =>
  list
    .map((o) => [
      o.occupancyID || "",
      o.fullName || "",
      o.relationshipToOwner || "",
      String(o.age ?? ""),
      o.contactInformation || "",
    ])
    .sort((a, b) => a.join("|").localeCompare(b.join("|")));

/** Labels of changed fields, for the Activity Log. */
function describeChanges(existing, payload) {
  const out = [];
  EDITABLE_KEYS.forEach((key) => {
    const isImg = IMAGE_KEYS.includes(key);
    const before = String(existing[key] ?? (isImg ? "none" : ""));
    const after = String(payload[key] ?? "");
    if (before === after) return;
    out.push(
      key === "role"
        ? `Role (${before || "—"} → ${after})`
        : LABELS[key] || key,
    );
  });
  return out;
}

/* ============================================================
   AUTH + DATABASE CREATE
   ============================================================ */
async function createResidentAccount({ email, password, payload, occMap }) {
  const secondaryApp = initializeApp(
    getApp().options,
    `ResidentCreator-${Date.now()}`,
  );
  const secondaryAuth = getAuth(secondaryApp);
  let credential = null;
  let uid = null;
  let verificationSent = false;

  try {
    credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password,
    );
    uid = credential.user.uid;

    await set(ref(db, `${DB_PATHS.users}/${uid}`), {
      archivedAt: "none",
      archivedBy: "none",
      archivedReason: "none",
      email,
      isAccountApprovedByAdmin: "yes",
      isAccountBanned: "no",
      isAccountDisabled: "no",
      isArchived: "no",
      ...payload,
      uid,
    });

    if (Object.keys(occMap).length) {
      const withUser = Object.fromEntries(
        Object.entries(occMap).map(([id, o]) => [id, { ...o, userID: uid }]),
      );
      await set(ref(db, `${DB_PATHS.occupancyInformation}/${uid}`), withUser);
    }

    // Send the verification email only after everything is saved. A failure
    // here is not fatal: the account exists, the admin is just told to resend.
    try {
      await sendEmailVerification(credential.user);
      verificationSent = true;
    } catch (verifyErr) {
      console.error("Failed to send verification email:", verifyErr);
    }
  } catch (err) {
    // Roll back so nothing is left half-created
    if (uid) {
      try {
        await remove(ref(db, `${DB_PATHS.users}/${uid}`));
        await remove(ref(db, `${DB_PATHS.occupancyInformation}/${uid}`));
      } catch (cleanupErr) {
        console.error("Failed to clean up database records:", cleanupErr);
      }
    }
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

  return { verificationSent };
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
