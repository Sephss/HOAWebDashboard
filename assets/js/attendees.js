/* ============================================================
   attendees.js — Attendees module
   Reads the existing `announcements` node (read-only — nothing
   here writes to or modifies announcements or attendee data,
   both are owned by the mobile app / announcements.js flow).
   For every announcement with category === "Meeting", the nested
   `attendees/{uid}` children (AttendeeModel from the Android app)
   are already included in a normal read of the announcement, so
   no extra Firebase listeners are needed.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { db, ref, onValue, DB_PATHS } from "./firebase.js";
import {
  objectToArray,
  formatDate,
  formatDateTime,
  escapeHtml,
  printHTML,
  debounce,
} from "./utils.js";
import { openModal, emptyState, toast } from "./ui.js";

const adminProfile = await guardPage();
renderShell("attendees", adminProfile, { breadcrumb: "Attendees" });

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Attendees</div>
      <div class="page-header__subtitle">RSVP tracking for meeting-category announcements.</div>
    </div>
  </div>

  <div class="table-search" style="max-width:320px;margin-bottom:20px;">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>
    <input type="text" id="meetingSearchInput" placeholder="Search meetings…">
  </div>

  <div id="meetingsGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;"></div>
`;

let meetings = [];
let searchTerm = "";

onValue(ref(db, DB_PATHS.announcements), (snap) => {
  const all = objectToArray(snap.val(), "id");
  meetings = all
    .filter((a) => String(a.category || "").trim() === "Meeting")
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  render();
});

document.getElementById("meetingSearchInput").addEventListener(
  "input",
  debounce((e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
  }, 200),
);

function render() {
  const grid = document.getElementById("meetingsGrid");
  const filtered = meetings.filter(
    (m) => !searchTerm || (m.title || "").toLowerCase().includes(searchTerm),
  );

  if (!filtered.length) {
    grid.style.gridTemplateColumns = "1fr";
    grid.innerHTML = emptyState({
      title: meetings.length
        ? "No meetings match your search"
        : "No meeting announcements yet",
      desc: meetings.length
        ? "Try a different search term."
        : "Announcements posted with the “Meeting” category will show up here once residents start RSVPing.",
    });
    return;
  }
  grid.style.gridTemplateColumns = "repeat(auto-fill,minmax(320px,1fr))";
  grid.innerHTML = filtered.map(meetingCardHTML).join("");

  grid.querySelectorAll("[data-view-attendees]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = meetings.find((x) => x.id === btn.dataset.viewAttendees);
      if (m) openAttendeesModal(m);
    });
  });
  grid.querySelectorAll("[data-print-attendees]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = meetings.find((x) => x.id === btn.dataset.printAttendees);
      if (m) printAttendance(m);
    });
  });
}

/** Pulls the nested attendees/{uid} map (already present on the announcement object) into an array. */
function getAttendeesArray(m) {
  return objectToArray(m.attendees, "uid");
}

function getCounts(m) {
  const list = getAttendeesArray(m);
  return {
    attending: list.filter((a) => a.status === "attending").length,
    notAttending: list.filter((a) => a.status === "not_attending").length,
  };
}

function meetingCardHTML(m) {
  const { attending, notAttending } = getCounts(m);
  return `
    <div class="card card-hover">
      <div class="card-body">
        <span class="badge badge-accent" style="margin-bottom:10px;">Meeting</span>
        <div class="cell-user__name" style="font-size:15px;margin:4px 0;">${escapeHtml(m.title || "Untitled Meeting")}</div>
        <div class="cell-user__sub" style="margin-bottom:16px;">${escapeHtml(m.date || formatDate(m.timestamp))}${m.time ? " · " + escapeHtml(m.time) : ""}</div>
        <div style="display:flex;gap:24px;margin-bottom:18px;">
          <div>
            <div style="font-size:20px;font-weight:800;color:var(--color-success);">${attending}</div>
            <div style="font-size:11px;color:var(--color-grey);">Attending</div>
          </div>
          <div>
            <div style="font-size:20px;font-weight:800;color:var(--color-danger);">${notAttending}</div>
            <div style="font-size:11px;color:var(--color-grey);">Not Attending</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" data-view-attendees="${m.id}">View Attendees</button>
          <button class="btn btn-primary btn-sm" style="flex:1;" data-print-attendees="${m.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
            Print
          </button>
        </div>
      </div>
    </div>
  `;
}

function openAttendeesModal(m) {
  const list = getAttendeesArray(m);
  const attending = sortByName(list.filter((a) => a.status === "attending"));
  const notAttending = sortByName(
    list.filter((a) => a.status === "not_attending"),
  );

  const overlay = openModal({
    title: m.title || "Untitled Meeting",
    subtitle: `${m.date || formatDate(m.timestamp)}${m.time ? " · " + m.time : ""}`,
    size: "modal-xl",
    bodyHTML: `
      <div class="tabs" id="attendeeTabs">
        <button class="tab-btn active" data-tab="attending">Attending (${attending.length})</button>
        <button class="tab-btn" data-tab="notAttending">Not Attending (${notAttending.length})</button>
      </div>
      <div id="attendingPane">${attendeeTableHTML(attending, false)}</div>
      <div id="notAttendingPane" class="hidden">${attendeeTableHTML(notAttending, true)}</div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      <button class="btn btn-primary" data-act="print">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Print Attendance List
      </button>
    `,
  });

  overlay.querySelectorAll("#attendeeTabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      overlay
        .querySelectorAll("#attendeeTabs .tab-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      overlay
        .querySelector("#attendingPane")
        .classList.toggle("hidden", tab !== "attending");
      overlay
        .querySelector("#notAttendingPane")
        .classList.toggle("hidden", tab !== "notAttending");
    });
  });

  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="print"]')
    .addEventListener("click", () => printAttendance(m));
}

function sortByName(list) {
  return [...list].sort((a, b) =>
    (a.homeownerName || "").localeCompare(b.homeownerName || ""),
  );
}

function attendeeTableHTML(list, showReason) {
  if (!list.length) {
    return `<div style="padding:30px 0;text-align:center;color:var(--color-grey);font-size:13px;">No responses yet.</div>`;
  }
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>Name</th>
          <th>Block / Lot / Street</th>
          <th>Role</th>
          <th>Phase</th>
          ${showReason ? "<th>Reason</th>" : ""}
          <th>Signature</th>
          <th>Responded</th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (a) => `
            <tr>
              <td>${escapeHtml(a.homeownerName || "—")}</td>
              <td>${escapeHtml(a.block || "—")} / ${escapeHtml(a.lot || "—")} / ${escapeHtml(a.street || "—")}</td>
              <td><span class="badge badge-neutral">${escapeHtml(a.role || "—")}</span></td>
              <td>${escapeHtml(a.lavanyaPhaseType || "—")}</td>
              ${showReason ? `<td>${escapeHtml(a.reason || "—")}</td>` : ""}
              <td>${signatureCellHTML(a.signatureUrl)}</td>
              <td class="muted">${formatDateTime(a.timestamp)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/** Renders a small clickable signature thumbnail, or a placeholder if none was captured. */
function signatureCellHTML(signatureUrl) {
  if (!signatureUrl) {
    return `<span class="muted" style="font-size:12px;">—</span>`;
  }
  return `
    <img
      src="${escapeHtml(signatureUrl)}"
      alt="Signature"
      data-signature-preview="${escapeHtml(signatureUrl)}"
      style="height:82px;max-width:140px;object-fit:contain;background:#fff;border:1px solid var(--color-border,#e5e7eb);border-radius:4px;padding:2px;cursor:pointer;"
    />
  `;
}

/** Prints Attending + Not Attending for one meeting in a single print job. */
function printAttendance(m) {
  const list = getAttendeesArray(m);
  const attending = sortByName(list.filter((a) => a.status === "attending"));
  const notAttending = sortByName(
    list.filter((a) => a.status === "not_attending"),
  );

  const section = (title, rows, showReason) => {
    if (!rows.length) {
      return `<h2 style="font-size:14px;color:#013717;margin:24px 0 8px;">${escapeHtml(title)} (0)</h2><div style="font-size:12px;color:#5C5F61;">No responses.</div>`;
    }
    const cols = [
      "Name",
      "Block / Lot / Street",
      "Role",
      "Phase",
      ...(showReason ? ["Reason"] : []),
      "Signature",
      "Responded",
    ];
    const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
    const tbody = rows
      .map(
        (a) => `
      <tr style="page-break-inside:avoid;">
        <td>${escapeHtml(a.homeownerName || "—")}</td>
        <td>${escapeHtml(a.block || "—")} / ${escapeHtml(a.lot || "—")} / ${escapeHtml(a.street || "—")}</td>
        <td>${escapeHtml(a.role || "—")}</td>
        <td>${escapeHtml(a.lavanyaPhaseType || "—")}</td>
        ${showReason ? `<td>${escapeHtml(a.reason || "—")}</td>` : ""}
        <td>${printSignatureCellHTML(a.signatureUrl)}</td>
        <td>${formatDateTime(a.timestamp)}</td>
      </tr>`,
      )
      .join("");
    return `<h2 style="font-size:14px;color:#013717;margin:24px 0 8px;">${escapeHtml(title)} (${rows.length})</h2><table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  };

  const bodyHTML = `
    <div style="font-size:13px;color:#5C5F61;margin-bottom:8px;">${escapeHtml(m.date || formatDate(m.timestamp))}${m.time ? " · " + escapeHtml(m.time) : ""}</div>
    ${section("Attending", attending, false)}
    ${section("Not Attending", notAttending, true)}
  `;

  printHTML(`Attendance — ${m.title || "Meeting"}`, bodyHTML);
  toast({
    type: "success",
    title: "Print ready",
    desc: `${attending.length} attending, ${notAttending.length} not attending.`,
  });
}

/** Print-friendly signature cell: fixed small size, no broken-image fallback, avoids page-break slicing. */
function printSignatureCellHTML(signatureUrl) {
  if (!signatureUrl) {
    return `<span style="color:#5C5F61;">—</span>`;
  }
  return `<img src="${escapeHtml(signatureUrl)}" alt="Signature" style="height:80px;width:auto;max-width:120px;display:block;background:#fff;border:1px solid #e5e7eb;" />`;
}
