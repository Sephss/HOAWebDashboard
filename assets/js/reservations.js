/* ============================================================
   reservations.js — Facilities Reservation & Booking Controller
   Synchronizes with Firebase Realtime Database:
   - `Bookings`: Master booking records
   - `BookingSlots`: Slot availability grid [Sport > Date > Slot]

   Status flow: mobile app now creates bookings as "pending".
   Admin resolves them here via Approve / Deny / Cancel / Refund.
   Approving stamps bookingORNumber + bookingAmount +
   whoUpdatedTheBookingStatus (mirrored onto BookingSlots too).
   Deny/Cancel/Refund free the slot and stamp the same "who" field
   on the Bookings record via the shared reason modal.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import {
  db,
  ref,
  onValue,
  remove,
  update,
  push,
  set,
  DB_PATHS,
} from "./firebase.js";
import {
  objectToArray,
  formatDate,
  formatDateTime,
  escapeHtml,
  printHTML,
  statusToken,
} from "./utils.js";
import { toast, openModal } from "./ui.js";

const adminProfile = await guardPage();
renderShell("reservations", adminProfile, {
  breadcrumb: "Facilities Reservation",
});

const SPORTS_CATEGORIES = [
  "Basketball",
  "Volleyball",
  "Chess",
  "Zumba",
  "Puregold Bazaar",
  "Community Event",
  "Emergency / Repair",
  "Holy Mass",
  "General Assembly",
];

const ALL_SLOTS = [
  "8:00 AM - 11:00 AM",
  "11:00 AM - 2:00 PM",
  "2:00 PM - 5:00 PM",
  "5:00 PM - 8:00 PM",
];

/** Non-approve status actions available from the booking detail dropdown.
 * Each maps to the bookingStatus token written to Firebase, plus the
 * copy used by the shared reason modal and resident notification. */
const STATUS_ACTIONS = {
  deny: {
    status: "denied",
    title: "Deny Facility Reservation",
    banner:
      "This action will remove the slot from <code>BookingSlots</code> to allow other residents to book, and mark the booking record as <strong>denied</strong>.",
    confirmLabel: "Confirm Denial",
    defaultReason: "Denied by HOA Admin",
    notifMessage: (b) =>
      `Your facility reservation for ${b.bookerSport || "the facility"} on ${b.requestBookingDate || ""} has been denied.`,
  },
  cancel: {
    status: "cancelled",
    title: "Cancel Facility Reservation",
    banner:
      "This action will remove the slot from <code>BookingSlots</code> to allow other residents to book, and mark the booking record as <strong>cancelled</strong>.",
    confirmLabel: "Confirm Cancellation",
    defaultReason: "Cancelled by HOA Admin",
    notifMessage: (b) =>
      `Your facility reservation for ${b.bookerSport || "the facility"} on ${b.requestBookingDate || ""} has been cancelled.`,
  },
  refund: {
    status: "refunded",
    title: "Refund Facility Reservation",
    banner:
      "This action will remove the slot from <code>BookingSlots</code> to allow other residents to book, and mark the booking record as <strong>refunded</strong>.",
    confirmLabel: "Confirm Refund",
    defaultReason: "Refunded by HOA Admin",
    notifMessage: (b) =>
      `Your facility reservation for ${b.bookerSport || "the facility"} on ${b.requestBookingDate || ""} has been refunded.`,
  },
};

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

/** Admin display name used for whoUpdatedTheBookingStatus — matches the
 * firstName+lastName pattern used elsewhere in this dashboard. */
function getAdminDisplayName() {
  return (
    [adminProfile.firstName, adminProfile.lastName].filter(Boolean).join(" ") ||
    adminProfile.role ||
    "Admin"
  );
}

/** "none" is the mobile app's placeholder for an unset value — display it as a dash. */
function displayOrDash(val) {
  if (!val || String(val).toLowerCase() === "none") return "—";
  return val;
}

/**
 * Writes a NotificationModel-shaped record to DB_PATHS.notifications,
 * mirroring FirebaseNotificationManager.createNotification() on Android —
 * same pattern used in documents.js's notifyRequester().
 */
async function notifyBooker(booking, remarks, notifMessage, actionToken) {
  const now = new Date();

  const notifRef = push(ref(db, DB_PATHS.notifications));
  const data = {
    notificationID: notifRef.key,
    receiverID: booking.bookerID || "",
    title: "",
    message: remarks,
    notificationType: booking.bookerSport || "",
    action: actionToken,
    date: formatManilaDate(now),
    time: formatManilaTime(now),
    referenceID: booking.bookingID || "",
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
      <div class="page-header__title">Facilities & Reservations</div>
      <div class="page-header__subtitle">View, track, manage, and print facility reservations across your community.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-secondary" id="printReportBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Print Report
      </button>
      <button class="btn btn-secondary" id="refreshBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
      </button>
    </div>
  </div>

  <!-- Stat Grid matching Grievances Card style -->
  <div class="stat-grid" id="reservationStats"></div>

  <div class="card" style="margin-bottom: 24px;">
    <div class="card-body" style="padding: 16px 20px;">
      <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between;">
        
        <!-- Filter Controls: Date Stepper & Picker -->
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="btn btn-secondary btn-sm" id="prevDayBtn" title="Previous Day">‹</button>
            <input type="date" id="datePickerInput" class="form-input" style="padding:4px 10px; font-size:13px; width:auto;">
            <button class="btn btn-secondary btn-sm" id="nextDayBtn" title="Next Day">›</button>
          </div>
          <button class="btn btn-secondary btn-sm active" id="todayBtn">Today</button>
          <button class="btn btn-secondary btn-sm" id="allDatesBtn">All Bookings</button>
        </div>

        <!-- Facility Dropdown & View Mode Switcher -->
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div style="min-width:180px;">
            <select id="facilitySelect" class="form-select" style="padding:6px 12px; font-size:13px;">
              <option value="all">All Facilities / Sports</option>
              ${SPORTS_CATEGORIES.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
          </div>

          <div style="display:flex; gap:6px; align-items:center;">
            <button class="btn btn-secondary btn-sm active" id="viewModeGridBtn" title="Slot Matrix View">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
              Slot View
            </button>
            <button class="btn btn-secondary btn-sm" id="viewModeTableBtn" title="Master Data Table View">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Table View
            </button>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div id="reservationsContent"></div>
`;

// Helper: Format Date object to "MMMM dd, yyyy" matching Java SimpleDateFormat("MMMM dd, yyyy")
function formatBookingDateStr(date) {
  const d = new Date(date);
  const month = d.toLocaleString("en-US", { month: "long" });
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  return `${month} ${day}, ${year}`;
}

function formatDateForInput(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Human label + badge class for any bookingStatus token, including the
 * new pending/denied/refunded states alongside the existing ones. */
function statusMeta(status) {
  const token = (status || "confirmed").toLowerCase();
  const map = {
    pending: { label: "Pending", badge: "badge-pending" },
    confirmed: { label: "Confirmed", badge: "badge-success" },
    cancelled: { label: "Cancelled", badge: "badge-danger" },
    denied: { label: "Denied", badge: "badge-danger" },
    refunded: { label: "Refunded", badge: "badge-neutral" },
  };
  return (
    map[token] || {
      label: status ? status[0].toUpperCase() + status.slice(1) : "Unknown",
      badge: "badge-neutral",
    }
  );
}

// Application State
let dataBookings = [];
let dataSlotsTree = {};
let selectedDateObj = new Date();
let selectedDateStr = formatBookingDateStr(selectedDateObj); // Default to Today
let filterByDate = true; // true = filter by selectedDateStr, false = show All Bookings
let selectedFacility = "all";
let viewMode = "grid"; // 'grid' or 'table'

// Initialize Date Picker input to Today
const dateInput = document.getElementById("datePickerInput");
dateInput.value = formatDateForInput(selectedDateObj);

// Wire Date Controls
dateInput.addEventListener("change", (e) => {
  if (e.target.value) {
    const parts = e.target.value.split("-");
    selectedDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    selectedDateStr = formatBookingDateStr(selectedDateObj);
    filterByDate = true;
    updateDateButtonsUI();
    render();
  }
});

document.getElementById("prevDayBtn").addEventListener("click", () => {
  selectedDateObj.setDate(selectedDateObj.getDate() - 1);
  selectedDateStr = formatBookingDateStr(selectedDateObj);
  dateInput.value = formatDateForInput(selectedDateObj);
  filterByDate = true;
  updateDateButtonsUI();
  render();
});

document.getElementById("nextDayBtn").addEventListener("click", () => {
  selectedDateObj.setDate(selectedDateObj.getDate() + 1);
  selectedDateStr = formatBookingDateStr(selectedDateObj);
  dateInput.value = formatDateForInput(selectedDateObj);
  filterByDate = true;
  updateDateButtonsUI();
  render();
});

document.getElementById("todayBtn").addEventListener("click", () => {
  selectedDateObj = new Date();
  selectedDateStr = formatBookingDateStr(selectedDateObj);
  dateInput.value = formatDateForInput(selectedDateObj);
  filterByDate = true;
  updateDateButtonsUI();
  render();
});

document.getElementById("allDatesBtn").addEventListener("click", () => {
  filterByDate = false;
  updateDateButtonsUI();
  render();
});

function updateDateButtonsUI() {
  document
    .getElementById("todayBtn")
    .classList.toggle(
      "active",
      filterByDate && selectedDateStr === formatBookingDateStr(new Date()),
    );
  document
    .getElementById("allDatesBtn")
    .classList.toggle("active", !filterByDate);
}

// Wire View Mode Switcher
const viewGridBtn = document.getElementById("viewModeGridBtn");
const viewTableBtn = document.getElementById("viewModeTableBtn");

viewGridBtn.addEventListener("click", () => {
  viewMode = "grid";
  viewGridBtn.classList.add("active");
  viewTableBtn.classList.remove("active");
  render();
});

viewTableBtn.addEventListener("click", () => {
  viewMode = "table";
  viewTableBtn.classList.add("active");
  viewGridBtn.classList.remove("active");
  render();
});

// Wire Facility Filter
document.getElementById("facilitySelect").addEventListener("change", (e) => {
  selectedFacility = e.target.value;
  render();
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  toast({ type: "success", title: "Reservations refreshed", duration: 1800 });
});

document.getElementById("printReportBtn").addEventListener("click", () => {
  openPrintRangeModal();
});

// Bind Firebase RTDB Listeners
function bindFirebase() {
  onValue(ref(db, DB_PATHS.bookings), (snap) => {
    dataBookings = objectToArray(snap.val(), "bookingID");
    render();
  });

  onValue(ref(db, DB_PATHS.bookingSlots), (snap) => {
    dataSlotsTree = snap.val() || {};
    render();
  });
}
bindFirebase();

// Render Main Interface
function render() {
  renderStatGrid();

  const container = document.getElementById("reservationsContent");
  const filteredList = getFilteredBookings();

  if (viewMode === "grid") {
    renderSlotGrid(container, filteredList);
  } else {
    renderTableView(container, filteredList);
  }
}

// Filtered Bookings logic
function getFilteredBookings() {
  return dataBookings.filter((b) => {
    const facility = b.bookerSport || "";
    const reqDateStr = b.requestBookingDate || "";

    // Date Filter
    if (filterByDate) {
      if (reqDateStr !== selectedDateStr) return false;
    }

    // Facility Filter
    if (selectedFacility !== "all" && facility !== selectedFacility) {
      return false;
    }

    return true;
  });
}

// Render Summary Metrics matching Grievances Card design exactly
function renderStatGrid() {
  const grid = document.getElementById("reservationStats");
  const todayStr = formatBookingDateStr(new Date());

  const todayBookings = dataBookings.filter(
    (b) => b.requestBookingDate === todayStr,
  );
  const pending = dataBookings.filter(
    (b) => (b.bookingStatus || "").toLowerCase() === "pending",
  );
  const confirmed = dataBookings.filter(
    (b) => (b.bookingStatus || "confirmed").toLowerCase() === "confirmed",
  );
  const cancelled = dataBookings.filter((b) =>
    ["cancelled", "denied", "refunded"].includes(
      (b.bookingStatus || "").toLowerCase(),
    ),
  );

  const stats = [
    ["Total Reservations", dataBookings.length],
    ["Today's Bookings", todayBookings.length],
    ["Pending Review", pending.length],
    ["Confirmed Total", confirmed.length],
    ["Cancelled/Denied/Refunded", cancelled.length],
  ];

  grid.innerHTML = stats
    .map(
      ([label, value]) =>
        `<div class="stat-card">
          <div class="stat-card__accent-bar"></div>
          <div class="stat-card__value">${value}</div>
          <div class="stat-card__label">${escapeHtml(label)}</div>
        </div>`,
    )
    .join("");
}

// Render Slot Matrix (Grid View)
function renderSlotGrid(container, bookingsList) {
  const displayFacilities =
    selectedFacility === "all" ? SPORTS_CATEGORIES : [selectedFacility];
  const dateHeader = filterByDate ? selectedDateStr : "All Dates";

  let html = `<div style="display:flex; flex-direction:column; gap:20px;">`;

  displayFacilities.forEach((facility) => {
    const facilitySlots = dataSlotsTree[facility]?.[selectedDateStr] || {};

    html += `
      <div class="card">
        <div class="card-header" style="background:var(--color-surface-alt); padding:14px 20px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:10px; height:10px; border-radius:50%; background:var(--color-primary);"></div>
            <h3 style="margin:0; font-size:16px;">${escapeHtml(facility)}</h3>
          </div>
          <span class="badge badge-neutral">${escapeHtml(dateHeader)}</span>
        </div>
        <div class="card-body" style="padding:16px 20px;">
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">
    `;

    ALL_SLOTS.forEach((slotTime) => {
      const slotRecord = facilitySlots[slotTime];

      const matchingBooking = dataBookings.find((b) => {
        const slotStr =
          b.requestBookingTimeIn && b.requestBookingsTimeOut
            ? `${b.requestBookingTimeIn} - ${b.requestBookingsTimeOut}`
            : b.slot || "";

        return (
          b.bookerSport === facility &&
          (filterByDate ? b.requestBookingDate === selectedDateStr : true) &&
          slotStr === slotTime
        );
      });

      const isTaken = !!slotRecord;

      if (isTaken) {
        const bookerName =
          slotRecord?.bookerName || matchingBooking?.bookerName || "Reserved";
        const bookingID =
          slotRecord?.bookingID || matchingBooking?.bookingID || "";
        const purpose = matchingBooking?.bookerPurpose || "Resident Booking";
        const meta = statusMeta(matchingBooking?.bookingStatus);

        html += `
          <div style="border:1.5px solid var(--color-primary-100); background:var(--color-primary-50); border-radius:var(--radius-md); padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <span class="badge ${meta.badge}" style="font-size:11px;">${escapeHtml(meta.label)}</span>
              <small style="color:var(--color-grey); font-family:var(--font-mono); font-size:11px;">${escapeHtml(slotTime)}</small>
            </div>
            <div style="font-weight:600; color:var(--color-black); font-size:14px; margin-bottom:4px;">
              ${escapeHtml(bookerName)}
            </div>
            <div style="font-size:12px; color:var(--color-grey); margin-bottom:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
              ${escapeHtml(purpose)}
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" style="flex:1; padding:4px 8px; font-size:11px;" data-act="details" data-id="${escapeHtml(bookingID)}">Details</button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div style="border:1px dashed var(--color-border-strong); background:var(--color-surface); border-radius:var(--radius-md); padding:14px; opacity:0.75;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <span class="badge badge-neutral" style="font-size:11px;">Available</span>
              <small style="color:var(--color-grey-light); font-family:var(--font-mono); font-size:11px;">${escapeHtml(slotTime)}</small>
            </div>
            <div style="font-weight:500; color:var(--color-grey-light); font-size:13px;">
              No booking for this slot
            </div>
          </div>
        `;
      }
    });

    html += `
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  container.innerHTML = html;
  wireActionButtons(container);
}

// Render Table View
function renderTableView(container, bookingsList) {
  if (!bookingsList.length) {
    container.innerHTML = `
      <div class="card" style="padding:40px; text-align:center;">
        <div style="font-weight:600; font-size:16px; color:var(--color-black); margin-bottom:6px;">No reservations found</div>
        <div style="font-size:13px; color:var(--color-grey);">There are no bookings matching your selected filters.</div>
      </div>
    `;
    return;
  }

  const sorted = [...bookingsList].sort((a, b) => {
    return Number(b.timestamp || 0) - Number(a.timestamp || 0);
  });

  let html = `
    <div class="card">
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Booker Name</th>
              <th>Facility / Sport</th>
              <th>Booking Date</th>
              <th>Time Slot</th>
              <th>Purpose</th>
              <th>Status</th>
              <th>Date Booked</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
  `;

  sorted.forEach((b) => {
    const meta = statusMeta(b.bookingStatus);
    const slotStr =
      b.requestBookingTimeIn && b.requestBookingsTimeOut
        ? `${b.requestBookingTimeIn} - ${b.requestBookingsTimeOut}`
        : b.slot || "—";

    html += `
      <tr>
        <td>
          <div style="font-weight:600; color:var(--color-black);">${escapeHtml(b.bookerName || "Unknown")}</div>
        </td>
        <td>
          <span class="badge badge-neutral">${escapeHtml(b.bookerSport || "—")}</span>
        </td>
        <td>
          <div style="font-weight:500;">${escapeHtml(b.requestBookingDate || "—")}</div>
        </td>
        <td>
          <span style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(slotStr)}</span>
        </td>
        <td>
          <div style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(b.bookerPurpose || "")}">
            ${escapeHtml(b.bookerPurpose || "—")}
          </div>
        </td>
        <td>
          <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
        </td>
        <td>
          <small style="color:var(--color-grey);">${escapeHtml(b.dateBooked || "—")} ${escapeHtml(b.timeBooked || "")}</small>
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:6px;">
            <button class="btn btn-secondary btn-sm" data-act="details" data-id="${escapeHtml(b.bookingID)}">Details</button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
  wireActionButtons(container);
}

// Attach Event Listeners to rendered Action Buttons
function wireActionButtons(container) {
  container.querySelectorAll('[data-act="details"]').forEach((btn) => {
    btn.addEventListener("click", () => openBookingDetailModal(btn.dataset.id));
  });
}

// Open Booking Details Modal
function openBookingDetailModal(bookingID) {
  const booking = dataBookings.find((b) => b.bookingID === bookingID);
  if (!booking) {
    toast({ type: "danger", title: "Booking record not found" });
    return;
  }

  const slotStr =
    booking.requestBookingTimeIn && booking.requestBookingsTimeOut
      ? `${booking.requestBookingTimeIn} - ${booking.requestBookingsTimeOut}`
      : booking.slot || "—";

  const meta = statusMeta(booking.bookingStatus);

  const overlay = openModal({
    title: `Reservation Details #${booking.bookingID || ""}`,
    subtitle: booking.bookerSport || "Facility Booking",
    size: "modal-lg",
    bodyHTML: `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; background:var(--color-surface-alt); padding:14px; border-radius:var(--radius-md);">
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Booker Name</small>
            <div style="font-weight:600; color:var(--color-black); font-size:15px; margin-top:2px;">${escapeHtml(booking.bookerName || "—")}</div>
          </div>
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Facility / Sport</small>
            <div style="font-weight:600; color:var(--color-primary); font-size:15px; margin-top:2px;">${escapeHtml(booking.bookerSport || "—")}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Reserved Date</small>
            <div style="font-weight:500; margin-top:2px;">${escapeHtml(booking.requestBookingDate || "—")}</div>
          </div>
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Time Slot</small>
            <div style="font-weight:500; font-family:var(--font-mono); margin-top:2px;">${escapeHtml(slotStr)}</div>
          </div>
        </div>

        <div>
          <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Purpose</small>
          <div style="background:var(--color-bg); padding:10px; border-radius:var(--radius-sm); font-size:13px; margin-top:4px; border:1px solid var(--color-border);">
            ${escapeHtml(booking.bookerPurpose || "None specified")}
          </div>
        </div>

        <div>
          <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Remarks</small>
          <div style="background:var(--color-bg); padding:10px; border-radius:var(--radius-sm); font-size:13px; margin-top:4px; border:1px solid var(--color-border);">
            ${escapeHtml(booking.bookerRemarks || "No remarks provided")}
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Status</small>
            <div style="margin-top:4px;"><span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span></div>
          </div>
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Submitted On</small>
            <div style="font-size:13px; color:var(--color-grey); margin-top:4px;">${escapeHtml(booking.dateBooked || "—")} at ${escapeHtml(booking.timeBooked || "")}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">OR Number</small>
            <div style="font-size:13px; margin-top:4px;">${escapeHtml(displayOrDash(booking.bookingORNumber))}</div>
          </div>
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Amount</small>
            <div style="font-size:13px; margin-top:4px;">${escapeHtml(displayOrDash(booking.bookingAmount))}</div>
          </div>
          <div>
            <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Updated By</small>
            <div style="font-size:13px; margin-top:4px;">${escapeHtml(displayOrDash(booking.whoUpdatedTheBookingStatus))}</div>
          </div>
        </div>

        ${
          booking.adminRemarks
            ? `
          <div>
            <small style="color:var(--color-danger); font-size:11px; text-transform:uppercase; font-weight:600;">Admin Remarks</small>
            <div style="background:var(--color-danger-bg); color:var(--color-danger); padding:10px; border-radius:var(--radius-sm); font-size:13px; margin-top:4px;">
              ${escapeHtml(booking.adminRemarks)}
            </div>
          </div>
        `
            : ""
        }

        <div class="divider"></div>

        <div>
          <small style="color:var(--color-grey); font-size:11px; text-transform:uppercase; font-weight:600;">Update Status</small>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <select id="statusUpdateSelect" class="form-select" style="flex:1;">
              <option value="">Select action…</option>
              <option value="approve">Approve</option>
              <option value="deny">Deny</option>
              <option value="cancel">Cancel</option>
              <option value="refund">Refund</option>
            </select>
          </div>
          <div id="approveFieldsWrap" style="display:none; margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label class="form-label" for="orNumberInput" style="font-weight:600; font-size:13px;">OR Number</label>
              <input type="text" id="orNumberInput" class="form-input" placeholder="e.g. OR-00123">
            </div>
            <div>
              <label class="form-label" for="amountInput" style="font-weight:600; font-size:13px;">Amount</label>
              <input type="number" id="amountInput" class="form-input" placeholder="e.g. 500" min="0" step="0.01">
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="applyStatusUpdateBtn" style="margin-top:10px;">Apply Update</button>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      <button class="btn btn-secondary" data-act="print">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Print
      </button>
    `,
  });

  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());

  overlay.querySelector('[data-act="print"]').addEventListener("click", () => {
    printSingleBooking(booking, slotStr);
  });

  // --- inline status update controls ---
  const statusSelect = overlay.querySelector("#statusUpdateSelect");
  const approveFieldsWrap = overlay.querySelector("#approveFieldsWrap");
  const orNumberInput = overlay.querySelector("#orNumberInput");
  const amountInput = overlay.querySelector("#amountInput");
  const applyBtn = overlay.querySelector("#applyStatusUpdateBtn");

  statusSelect.addEventListener("change", () => {
    approveFieldsWrap.style.display =
      statusSelect.value === "approve" ? "grid" : "none";
  });

  applyBtn.addEventListener("click", async () => {
    const action = statusSelect.value;
    if (!action) {
      toast({ type: "warning", title: "Select an action first" });
      return;
    }

    if (action === "approve") {
      const orNumber = orNumberInput.value.trim();
      const amount = amountInput.value.trim();
      if (!orNumber || !amount) {
        toast({
          type: "warning",
          title: "OR Number and Amount are required",
        });
        return;
      }

      try {
        const who = getAdminDisplayName();
        const updates = {
          bookingStatus: "confirmed",
          bookingORNumber: orNumber,
          bookingAmount: amount,
          whoUpdatedTheBookingStatus: who,
        };
        await update(
          ref(db, `${DB_PATHS.bookings}/${booking.bookingID}`),
          updates,
        );

        // Mirror OR Number/Amount/Updated-By onto the BookingSlots entry too.
        if (booking.bookerSport && booking.requestBookingDate && slotStr) {
          const slotPath = `${DB_PATHS.bookingSlots}/${booking.bookerSport}/${booking.requestBookingDate}/${slotStr}`;
          await update(ref(db, slotPath), {
            bookingORNumber: orNumber,
            bookingAmount: amount,
            whoUpdatedTheBookingStatus: who,
          });
        }

        // Notify the booker, same pattern as deny/cancel/refund.
        try {
          const notifMessage = `Your facility reservation for ${booking.bookerSport || "the facility"} on ${booking.requestBookingDate || ""} has been approved.`;
          await notifyBooker(booking, "", notifMessage, "confirmed");
        } catch (notifErr) {
          console.error("Failed to create notification:", notifErr);
        }

        toast({
          type: "success",
          title: "Reservation approved",
          desc: `OR #${orNumber} recorded.`,
        });
        overlay.close();
      } catch (err) {
        toast({
          type: "danger",
          title: "Failed to approve reservation",
          desc: err.message,
        });
      }
      return;
    }

    // deny / cancel / refund — hand off to the shared reason modal.
    overlay.close();
    openStatusReasonModal(
      booking.bookingID,
      booking.bookerSport,
      booking.requestBookingDate,
      slotStr,
      action,
    );
  });
}

/** Prints a single reservation's full detail sheet, including OR Number,
 * Amount, and who last updated the status. */
function printSingleBooking(booking, slotStr) {
  const bodyHTML = `
    <table>
      <tbody>
        <tr><th style="text-align:left;">Booker Name</th><td>${escapeHtml(booking.bookerName || "—")}</td></tr>
        <tr><th style="text-align:left;">Facility / Sport</th><td>${escapeHtml(booking.bookerSport || "—")}</td></tr>
        <tr><th style="text-align:left;">Reserved Date</th><td>${escapeHtml(booking.requestBookingDate || "—")}</td></tr>
        <tr><th style="text-align:left;">Time Slot</th><td>${escapeHtml(slotStr || "—")}</td></tr>
        <tr><th style="text-align:left;">Purpose</th><td>${escapeHtml(booking.bookerPurpose || "—")}</td></tr>
        <tr><th style="text-align:left;">Status</th><td>${escapeHtml(statusMeta(booking.bookingStatus).label)}</td></tr>
        <tr><th style="text-align:left;">OR Number</th><td>${escapeHtml(displayOrDash(booking.bookingORNumber))}</td></tr>
        <tr><th style="text-align:left;">Amount</th><td>${escapeHtml(displayOrDash(booking.bookingAmount))}</td></tr>
        <tr><th style="text-align:left;">Updated By</th><td>${escapeHtml(displayOrDash(booking.whoUpdatedTheBookingStatus))}</td></tr>
       
        <tr><th style="text-align:left;">Date Booked</th><td>${escapeHtml(booking.dateBooked || "—")} ${escapeHtml(booking.timeBooked || "")}</td></tr>
      </tbody>
    </table>
  `;
  printHTML(`Reservation #${booking.bookingID || ""}`, bodyHTML);
}

// Open Status Reason Modal — shared by Deny / Cancel / Refund.
function openStatusReasonModal(bookingID, facility, dateStr, slotStr, action) {
  const cfg = STATUS_ACTIONS[action];
  if (!cfg) return;

  const overlay = openModal({
    title: cfg.title,
    subtitle: `${facility || ""} · ${dateStr || ""}`,
    bodyHTML: `
      <p style="margin-bottom:12px; font-size:14px; color:var(--color-black);">
        Are you sure you want to ${cfg.title.split(" ")[0].toLowerCase()} the reservation for <strong>${escapeHtml(facility || "Facility")}</strong> on <strong>${escapeHtml(dateStr || "")} (${escapeHtml(slotStr || "")})</strong>?
      </p>
      <div style="background:var(--color-warning-bg); border-left:4px solid var(--color-warning); padding:10px 14px; border-radius:var(--radius-sm); margin-bottom:16px; font-size:13px;">
        ${cfg.banner}
      </div>
      <div>
        <label class="form-label" for="statusReasonInput" style="font-weight:600; font-size:13px;">Reason (Admin Remarks):</label>
        <textarea id="statusReasonInput" class="form-textarea" rows="3" placeholder="Enter a reason…" style="width:100%; box-sizing:border-box; margin-top:4px;"></textarea>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="keep">Go Back</button>
      <button class="btn btn-danger" data-act="confirm">${cfg.confirmLabel}</button>
    `,
  });

  overlay
    .querySelector('[data-act="keep"]')
    .addEventListener("click", () => overlay.close());

  overlay
    .querySelector('[data-act="confirm"]')
    .addEventListener("click", async () => {
      const reasonInput = overlay.querySelector("#statusReasonInput");
      const reason = reasonInput
        ? reasonInput.value.trim() || cfg.defaultReason
        : cfg.defaultReason;

      try {
        // 1. Free the slot: BookingSlots > [facility] > [dateStr] > [slotStr]
        if (facility && dateStr && slotStr) {
          const slotPath = `${DB_PATHS.bookingSlots}/${facility}/${dateStr}/${slotStr}`;
          await remove(ref(db, slotPath));
        }

        // 2. Update Bookings node: Bookings > [bookingID]
        if (bookingID) {
          const nowFormatted = formatDateTime(new Date());
          const bookingPath = `${DB_PATHS.bookings}/${bookingID}`;
          const who = getAdminDisplayName();
          await update(ref(db, bookingPath), {
            bookingStatus: cfg.status,
            cancelledDate: nowFormatted,
            adminRemarks: reason,
            whoUpdatedTheBookingStatus: who,
          });

          // 3. Notify the booker, same as the Android app — only when we can
          // find the booking record to notify about.
          const booking = dataBookings.find((b) => b.bookingID === bookingID);
          if (booking) {
            try {
              await notifyBooker(
                booking,
                reason,
                cfg.notifMessage(booking),
                cfg.status,
              );
            } catch (notifErr) {
              console.error("Failed to create notification:", notifErr);
            }
          }
        }

        overlay.close();
        toast({
          type: "success",
          title: `Reservation ${cfg.status} and slot released!`,
        });
      } catch (err) {
        console.error(`${action} error:`, err);
        toast({
          type: "danger",
          title: `Failed to ${action} reservation: ` + err.message,
        });
      }
    });
}

// Open Print Range Modal
function openPrintRangeModal() {
  const defaultStart = formatDateForInput(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  );
  const defaultEnd = formatDateForInput(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );

  const overlay = openModal({
    title: "Print Facility Reservations Report",
    subtitle: "Select date range and parameters",
    bodyHTML: `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label class="form-label" for="printStartDate" style="font-weight:600; font-size:13px;">Start Date</label>
            <input type="date" id="printStartDate" class="form-input" value="${defaultStart}" style="border-radius:8px; padding:8px 12px; box-sizing:border-box; width:100%;">
          </div>
          <div>
            <label class="form-label" for="printEndDate" style="font-weight:600; font-size:13px;">End Date</label>
            <input type="date" id="printEndDate" class="form-input" value="${defaultEnd}" style="border-radius:8px; padding:8px 12px; box-sizing:border-box; width:100%;">
          </div>
        </div>

        <div>
          <label class="form-label" for="printFacility" style="font-weight:600; font-size:13px;">Facility / Sport</label>
          <select id="printFacility" class="form-select" style="border-radius:8px; padding:8px 12px; box-sizing:border-box; width:100%;">
            <option value="all">All Facilities</option>
            ${SPORTS_CATEGORIES.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="print">Generate & Print Report</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());

  overlay.querySelector('[data-act="print"]').addEventListener("click", () => {
    const startVal = overlay.querySelector("#printStartDate").value;
    const endVal = overlay.querySelector("#printEndDate").value;
    const facVal = overlay.querySelector("#printFacility").value;

    const startDate = startVal ? new Date(startVal + "T00:00:00") : null;
    const endDate = endVal ? new Date(endVal + "T23:59:59") : null;

    const filtered = dataBookings.filter((b) => {
      const reqObj = b.requestBookingDate
        ? new Date(b.requestBookingDate)
        : null;
      if (startDate && reqObj && reqObj < startDate) return false;
      if (endDate && reqObj && reqObj > endDate) return false;
      if (facVal !== "all" && b.bookerSport !== facVal) return false;
      return true;
    });

    const reportTitle = `HOA Facilities Reservation Report (${startVal || "All"} to ${endVal || "All"})`;

    let bodyHTML = `
      <div style="margin-bottom:16px; font-size:12px; color:#5C5F61;">
        <strong>Total Records:</strong> ${filtered.length}<br>
        <strong>Facility Filter:</strong> ${escapeHtml(facVal === "all" ? "All Facilities" : facVal)}
      </div>
      <table>
        <thead>
          <tr>
            <th>Booker Name</th>
            <th>Facility / Sport</th>
            <th>Reserved Date</th>
            <th>Time Slot</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>OR Number</th>
            <th>Amount</th>
            <th>Updated By</th>
            <th>Date Booked</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (!filtered.length) {
      bodyHTML += `<tr><td colspan="10" style="text-align:center; padding:20px;">No bookings found matching selected parameters.</td></tr>`;
    } else {
      filtered.forEach((b) => {
        const slotStr =
          b.requestBookingTimeIn && b.requestBookingsTimeOut
            ? `${b.requestBookingTimeIn} - ${b.requestBookingsTimeOut}`
            : b.slot || "—";

        bodyHTML += `
          <tr>
            <td><strong>${escapeHtml(b.bookerName || "—")}</strong></td>
            <td>${escapeHtml(b.bookerSport || "—")}</td>
            <td>${escapeHtml(b.requestBookingDate || "—")}</td>
            <td>${escapeHtml(slotStr)}</td>
            <td>${escapeHtml(b.bookerPurpose || "—")}</td>
            <td>${escapeHtml(statusMeta(b.bookingStatus).label)}</td>
            <td>${escapeHtml(displayOrDash(b.bookingORNumber))}</td>
            <td>${escapeHtml(displayOrDash(b.bookingAmount))}</td>
            <td>${escapeHtml(displayOrDash(b.whoUpdatedTheBookingStatus))}</td>
            <td>${escapeHtml(b.dateBooked || "—")} ${escapeHtml(b.timeBooked || "")}</td>
          </tr>
        `;
      });
    }

    bodyHTML += `</tbody></table>`;

    overlay.close();
    printHTML(reportTitle, bodyHTML);
  });
}
