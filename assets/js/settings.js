/* ============================================================
   settings.js — System Settings module
   Currently manages: /appSettings/operatingHours
   { openHour: <0-23>, closeHour: <0-23> }
   Read by the Android app to gate resident/renter access outside
   the configured window. This dashboard only reads/writes the
   values — enforcement itself happens on the mobile app side.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, update, DB_PATHS } from "./firebase.js";
import { toast } from "./ui.js";

const adminProfile = await guardPage();
renderShell("settings", adminProfile, { breadcrumb: "Settings" });

const SETTINGS_PATH = `${DB_PATHS.appSettings}/operatingHours`;
const DEFAULT_OPEN_HOUR = 6;
const DEFAULT_CLOSE_HOUR = 20;

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Settings</div>
      <div class="page-header__subtitle">System-wide preferences used by the resident mobile app.</div>
    </div>
  </div>

  <div class="card" style="max-width:640px;">
    <div class="card-header">
      <h3>Operating Hours</h3>
      <span class="badge badge-neutral" id="liveStatusBadge">—</span>
    </div>
    <div class="card-body">
      <p style="font-size:13px;color:var(--color-grey);line-height:1.6;margin-bottom:20px;">
        Residents and renters can only use the mobile app between these hours. Outside this window,
        the app will show a closed notice and prevent further use. Changes apply the next time the
        app checks in — no app update required.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field">
          <label>Opening Hour</label>
          <select class="select" id="openHourSelect"></select>
        </div>
        <div class="field">
          <label>Closing Hour</label>
          <select class="select" id="closeHourSelect"></select>
        </div>
      </div>

      <div class="field-error" id="rangeError" style="display:none;margin-top:-8px;margin-bottom:16px;">
        Closing hour must be later than opening hour.
      </div>

      <div style="display:flex;align-items:center;gap:10px;">
        <button class="btn btn-primary" id="saveHoursBtn">Save Changes</button>
        <span id="savedHint" style="font-size:12px;color:var(--color-grey);display:none;">Saved ✓</span>
      </div>
    </div>
  </div>
`;

const openSelect = document.getElementById("openHourSelect");
const closeSelect = document.getElementById("closeHourSelect");
const rangeError = document.getElementById("rangeError");
const saveBtn = document.getElementById("saveHoursBtn");
const savedHint = document.getElementById("savedHint");
const liveStatusBadge = document.getElementById("liveStatusBadge");

// Populate both dropdowns with all 24 hours, shown in friendly 12-hour format.
for (let h = 0; h < 24; h++) {
  const label = formatHourLabel(h);
  openSelect.insertAdjacentHTML(
    "beforeend",
    `<option value="${h}">${label}</option>`,
  );
  closeSelect.insertAdjacentHTML(
    "beforeend",
    `<option value="${h}">${label}</option>`,
  );
}

let currentSettings = {
  openHour: DEFAULT_OPEN_HOUR,
  closeHour: DEFAULT_CLOSE_HOUR,
};

onValue(ref(db, SETTINGS_PATH), (snap) => {
  const val = snap.val();
  currentSettings = {
    openHour: Number.isInteger(val?.openHour)
      ? val.openHour
      : DEFAULT_OPEN_HOUR,
    closeHour: Number.isInteger(val?.closeHour)
      ? val.closeHour
      : DEFAULT_CLOSE_HOUR,
  };
  openSelect.value = String(currentSettings.openHour);
  closeSelect.value = String(currentSettings.closeHour);
  updateLiveStatusBadge();
});

[openSelect, closeSelect].forEach((el) =>
  el.addEventListener("change", () => {
    savedHint.style.display = "none";
    validateRange();
  }),
);

function validateRange() {
  const open = Number(openSelect.value);
  const close = Number(closeSelect.value);
  const invalid = close <= open;
  rangeError.style.display = invalid ? "block" : "none";
  return !invalid;
}

saveBtn.addEventListener("click", async () => {
  if (!validateRange()) {
    toast({
      type: "warning",
      title: "Invalid hours",
      desc: "Closing hour must be later than opening hour.",
    });
    return;
  }
  const openHour = Number(openSelect.value);
  const closeHour = Number(closeSelect.value);

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner"></span> Saving…`;
  try {
    await update(ref(db, SETTINGS_PATH), { openHour, closeHour });
    toast({
      type: "success",
      title: "Operating hours updated",
      desc: `${formatHourLabel(openHour)} – ${formatHourLabel(closeHour)}`,
    });
    savedHint.style.display = "inline";
    updateLiveStatusBadge();
  } catch (err) {
    toast({ type: "danger", title: "Save failed", desc: err.message });
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Changes";
  }
});

/** Purely informational for the admin — shows whether "now" falls inside the configured window. */
function updateLiveStatusBadge() {
  const hourNow = new Date().getHours();
  const isOpen =
    hourNow >= currentSettings.openHour && hourNow < currentSettings.closeHour;
  liveStatusBadge.textContent = isOpen ? "Currently Open" : "Currently Closed";
  liveStatusBadge.className = `badge ${isOpen ? "badge-success" : "badge-neutral"}`;
}
setInterval(updateLiveStatusBadge, 60000);

function formatHourLabel(h) {
  const period = h >= 12 ? "PM" : "AM";
  let displayHour = h % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:00 ${period}`;
}
