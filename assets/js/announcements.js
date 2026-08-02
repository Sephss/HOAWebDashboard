/* ============================================================
   announcements.js — Announcements module
   Create/edit flow mirrors the Android app's AnnouncementModel
   and FirebaseAnnouncementManager.createAnnouncement() exactly:
   - date/time are admin-entered fields (distinct from dateCreated/
     timeCreated, which are auto-generated at submission time)
   - dateCreated/timeCreated use "MMMM dd, yyyy" / "hh:mm a",
     computed in Asia/Manila time regardless of the admin's browser
   - announcementId is the real Firebase push key (not a client id)
   - timestamp is a real epoch-ms number (System.currentTimeMillis()
     equivalent)
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import {
  db,
  ref,
  onValue,
  update,
  remove,
  push,
  set,
  DB_PATHS,
} from "./firebase.js";
import { DataTable } from "./tables.js";
import { toast, openModal, confirmDialog } from "./ui.js";
import { uploadImage } from "./imageUpload.js";
import {
  objectToArray,
  formatDate,
  formatDateTime,
  escapeHtml,
  getQueryParam,
  printHTML,
} from "./utils.js";

const adminProfile = await guardPage();
renderShell("announcements", adminProfile, { breadcrumb: "Announcements" });

const CATEGORIES = [
  "General",
  "Maintenance",
  "Safety & Security",
  "Events",
  "Billing",
  "Emergency",
  "Meeting",
  "Grievance",
];

/** Max characters allowed in an announcement's description — keeps posts
 * skimmable for residents while still allowing a full notice. */
const DESCRIPTION_MAX_LENGTH = 1000;

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Announcements</div>
      <div class="page-header__subtitle">Publish community-wide updates for residents.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-primary" id="newAnnouncementBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
        New Announcement
      </button>
    </div>
  </div>
  <div class="stat-grid" id="annStats"></div>
  <div class="card"><div id="annTableRoot"></div></div>
`;

document
  .getElementById("newAnnouncementBtn")
  .addEventListener("click", () => openEditorModal());

let allAnnouncements = [];

const table = new DataTable({
  root: document.getElementById("annTableRoot"),
  title: "Announcements",
  pageSize: 10,
  searchFields: ["title", "description", "category", "announcerName"],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "title",
      label: "Announcement",
      sortable: true,
      render: (r) => `
        <div>
          <div class="cell-user__name">${escapeHtml(r.title || "Untitled")}</div>
          <div class="cell-user__sub" style="margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.description || "")}</div>
        </div>`,
    },
    {
      key: "category",
      label: "Category",
      sortable: true,
      render: (r) =>
        `<span class="badge badge-neutral">${escapeHtml(r.category || "General")}</span>`,
    },
    {
      key: "announcerName",
      label: "Posted By",
      sortable: true,
      render: (r) =>
        `${escapeHtml(r.announcerName || "—")}<div class="cell-user__sub">${escapeHtml(r.announcerRole || "")}</div>`,
    },
    {
      key: "date",
      label: "Date",
      sortable: true,
      sortValue: (r) => Number(r.timestamp || 0),
      render: (r) =>
        `${escapeHtml(r.date || formatDate(r.timestamp))}${r.time ? `<div class="cell-user__sub">${escapeHtml(r.time)}</div>` : ""}`,
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      csv: false,
      render: () => `
        <div class="row-actions" data-stop-row-click>
          <button class="icon-btn btn-icon-only" data-act="preview" title="Preview">${svgEye()}</button>
          <button class="icon-btn btn-icon-only" data-act="edit" title="Edit">${svgEdit()}</button>
          <button class="icon-btn btn-icon-only" data-act="delete" title="Delete">${svgTrash()}</button>
        </div>`,
    },
  ],
  csvColumns: [
    { key: "title", label: "Title" },
    { key: "category", label: "Category" },
    { key: "announcerName", label: "Posted By" },
    {
      key: "date",
      label: "Date",
      csvValue: (r) => r.date || formatDate(r.timestamp),
    },
    { key: "time", label: "Time" },
  ],
  filters: [
    {
      key: "category",
      label: "Category",
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
      match: (r, v) => (r.category || "General") === v,
    },
  ],
  emptyTitle: "No announcements yet",
  emptyDesc: "Publish your first community announcement to get started.",
  onRowClick: (row) => openPreviewModal(row),
});

onValue(ref(db, DB_PATHS.announcements), (snap) => {
  allAnnouncements = objectToArray(snap.val(), "id").sort(
    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
  );
  table.setData(allAnnouncements);
  renderStats();
});

if (getQueryParam("action") === "new") openEditorModal();

function renderStats() {
  const total = allAnnouncements.length;
  const thisMonth = allAnnouncements.filter((a) => {
    const ts = Number(a.timestamp || 0);
    if (!ts) return false;
    const d = new Date(ts < 10 ** 12 ? ts * 1000 : ts);
    const now = new Date();
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }).length;
  document.getElementById("annStats").innerHTML = [
    ["Total Announcements", total],
    ["This Month", thisMonth],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

table.cfg.afterRender = (rows) => {
  document
    .querySelectorAll('[data-act="preview"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openPreviewModal(rows[i])),
    );
  document
    .querySelectorAll('[data-act="edit"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => openEditorModal(rows[i])),
    );
  document
    .querySelectorAll('[data-act="delete"]')
    .forEach((btn, i) =>
      btn.addEventListener("click", () => deleteAnnouncement(rows[i])),
    );
};

function openPreviewModal(r) {
  const overlay = openModal({
    title: r.title || "Untitled Announcement",
    subtitle: `${r.category || "General"} · Posted by ${r.announcerName || "Admin"}`,
    size: "modal-lg",
    bodyHTML: `
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <span class="badge badge-neutral">${escapeHtml(r.category || "General")}</span>
      </div>
      ${r.imageUrl ? `<div style="margin-bottom:16px;"><img src="${escapeHtml(r.imageUrl)}" alt="Announcement image" style="max-width:100%;border-radius:10px;display:block;"></div>` : ""}
      <p style="font-size:14px;line-height:1.7;color:var(--color-black);white-space:pre-wrap;">${escapeHtml(r.description || "")}</p>
      ${r.link ? `<div style="margin-top:16px;"><a href="${escapeHtml(r.link)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open attached link ↗</a></div>` : ""}
      <div class="divider"></div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Date & Time</div><div class="value">${escapeHtml(r.date || "—")}${r.time ? " · " + escapeHtml(r.time) : ""}</div></div>
        <div class="detail-item"><div class="label">Posted By</div><div class="value">${escapeHtml(r.announcerName || "—")} (${escapeHtml(r.announcerRole || "Admin")})</div></div>
        <div class="detail-item"><div class="label">Created</div><div class="value">${escapeHtml(r.dateCreated || "—")}${r.timeCreated ? " · " + escapeHtml(r.timeCreated) : ""}</div></div>
      </div>
    `,
    footerHTML: `<button class="btn btn-secondary" data-act="close">Close</button><button class="btn btn-primary" data-act="edit">Edit</button>`,
  });
  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay.querySelector('[data-act="edit"]').addEventListener("click", () => {
    overlay.close();
    openEditorModal(r);
  });
}

function openEditorModal(existing) {
  const isEdit = !!existing;
  const overlay = openModal({
    title: isEdit ? "Edit Announcement" : "New Announcement",
    subtitle: isEdit
      ? `Editing "${existing.title}"`
      : "Publish an update visible to all residents",
    size: "modal-lg",
    bodyHTML: `
      <div class="field" id="titleField">
        <label>Title</label>
        <input class="input" id="titleInput" placeholder="e.g. Scheduled water interruption" value="${escapeHtml(existing?.title || "")}">
        <span class="field-error">Title is required.</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field">
          <label>Category</label>
          <select class="select" id="categoryInput">
            ${CATEGORIES.map((c) => `<option value="${c}" ${existing?.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="field" id="linkField">
          <label>Attached Link (optional)</label>
          <input class="input" id="linkInput" placeholder="https://…" value="${escapeHtml(existing?.link || "")}">
          <span class="field-error">Enter a valid URL starting with http:// or https://</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field" id="dateField">
          <label>Date</label>
          <input type="date" class="input" id="dateInput" value="${toDateInputValue(existing?.date)}">
          <span class="field-error">Date is required.</span>
        </div>
        <div class="field" id="timeField">
          <label>Time</label>
          <input type="time" class="input" id="timeInput" value="${toTimeInputValue(existing?.time)}">
          <span class="field-error">Time is required.</span>
        </div>
      </div>
      <div class="field" id="descField">
        <label>Description</label>
        <textarea class="textarea" id="descInput" style="min-height:140px;" maxlength="${DESCRIPTION_MAX_LENGTH}" placeholder="Write the announcement content…">${escapeHtml(existing?.description || "")}</textarea>
        <div id="descCounter" style="font-size:12px;color:var(--color-grey);margin-top:4px;text-align:right;"></div>
        <span class="field-error">Description is required.</span>
      </div>
      <div class="field" id="imageField">
        <label>Image (optional)</label>
        <input type="file" accept="image/*" class="input" id="imageInput">
        <div id="imagePreviewWrap" style="margin-top:10px;${existing?.imageUrl ? "" : " display:none;"}">
          <img id="imagePreview" src="${escapeHtml(existing?.imageUrl || "")}" alt="Attached image" style="max-width:100%;max-height:180px;border-radius:8px;display:block;">
          <button type="button" class="btn btn-secondary btn-sm" id="removeImageBtn" style="margin-top:8px;">Remove image</button>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      ${isEdit ? `<button class="btn btn-danger" data-act="delete">Delete</button>` : ""}
      <button class="btn btn-primary" data-act="save">${isEdit ? "Save Changes" : "Publish Announcement"}</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="delete"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await deleteAnnouncement(existing);
    });

  const descInput = overlay.querySelector("#descInput");
  const descCounter = overlay.querySelector("#descCounter");
  const updateDescCounter = () => {
    descCounter.textContent = `${descInput.value.length} / ${DESCRIPTION_MAX_LENGTH}`;
  };
  descInput.addEventListener("input", updateDescCounter);
  updateDescCounter();

  let selectedImageFile = null;
  let removeExistingImage = false;
  const imageInput = overlay.querySelector("#imageInput");
  const imagePreviewWrap = overlay.querySelector("#imagePreviewWrap");
  const imagePreview = overlay.querySelector("#imagePreview");
  const removeImageBtn = overlay.querySelector("#removeImageBtn");

  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    selectedImageFile = file;
    removeExistingImage = false;
    const reader = new FileReader();
    reader.onload = () => {
      imagePreview.src = reader.result;
      imagePreviewWrap.style.display = "";
    };
    reader.readAsDataURL(file);
  });

  removeImageBtn?.addEventListener("click", () => {
    selectedImageFile = null;
    removeExistingImage = true;
    imageInput.value = "";
    imagePreview.src = "";
    imagePreviewWrap.style.display = "none";
  });

  overlay
    .querySelector('[data-act="save"]')
    .addEventListener("click", async () => {
      clearFieldErrors(overlay);

      const title = overlay.querySelector("#titleInput").value.trim();
      const description = overlay.querySelector("#descInput").value.trim();
      const category = overlay.querySelector("#categoryInput").value;
      const link = overlay.querySelector("#linkInput").value.trim();
      const dateVal = overlay.querySelector("#dateInput").value; // YYYY-MM-DD
      const timeVal = overlay.querySelector("#timeInput").value; // HH:MM (24h)

      let hasError = false;
      if (!title) {
        setFieldError(overlay, "titleField");
        hasError = true;
      }
      if (!description) {
        setFieldError(overlay, "descField");
        hasError = true;
      } else if (description.length > DESCRIPTION_MAX_LENGTH) {
        setFieldError(overlay, "descField");
        hasError = true;
      }
      if (!dateVal) {
        setFieldError(overlay, "dateField");
        hasError = true;
      }
      if (!timeVal) {
        setFieldError(overlay, "timeField");
        hasError = true;
      }
      if (link && !isValidHttpUrl(link)) {
        setFieldError(overlay, "linkField");
        hasError = true;
      }
      if (hasError) return;

      const date = formatDateMDY(new Date(`${dateVal}T00:00:00`));
      const time = formatTimeFromInput(timeVal);

      let imageUrl = removeExistingImage ? "" : existing?.imageUrl || "";
      const saveBtn = overlay.querySelector('[data-act="save"]');
      const originalSaveLabel = saveBtn.textContent;

      if (selectedImageFile) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Uploading image…";
        try {
          imageUrl = await uploadImage(selectedImageFile);
        } catch (uploadErr) {
          toast({
            type: "danger",
            title: "Image upload failed",
            desc: uploadErr.message,
          });
          saveBtn.disabled = false;
          saveBtn.textContent = originalSaveLabel;
          return;
        }
        saveBtn.disabled = false;
        saveBtn.textContent = originalSaveLabel;
      }

      const payload = {
        title,
        description,
        category,
        date,
        time,
        link,
        imageUrl,
      };

      try {
        if (isEdit) {
          // Editing never touches announcementId/announcer*/dateCreated/timeCreated/timestamp —
          // those describe the original creation and stay fixed, same as the mobile app never re-creates them.
          await update(
            ref(db, `${DB_PATHS.announcements}/${existing.id}`),
            payload,
          );
          toast({ type: "success", title: "Announcement updated" });
        } else {
          const {
            dateStr: dateCreated,
            timeStr: timeCreated,
            timestamp,
          } = nowInManila();
          const newRef = push(ref(db, DB_PATHS.announcements));
          const fullPayload = {
            ...payload,
            announcementId: newRef.key,
            announcerId: adminProfile.uid || "",
            announcerName:
              [adminProfile.firstName, adminProfile.lastName]
                .filter(Boolean)
                .join(" ") || "Admin",
            announcerRole: adminProfile.role || "Administrator",
            dateCreated,
            timeCreated,
            timestamp,
          };
          await set(newRef, fullPayload);
          toast({ type: "success", title: "Announcement published" });
        }
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Save failed", desc: err.message });
      }
    });
}

async function deleteAnnouncement(r) {
  const ok = await confirmDialog({
    title: "Delete announcement",
    message: `Delete "<strong>${escapeHtml(r.title || "this announcement")}</strong>"? This cannot be undone.`,
    tone: "danger",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await remove(ref(db, `${DB_PATHS.announcements}/${r.id}`));
    toast({ type: "success", title: "Announcement deleted" });
  } catch (err) {
    toast({ type: "danger", title: "Delete failed", desc: err.message });
  }
}

/* ============================================================
   PRINT — All announcements within a chosen date range.
   ============================================================ */

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Announcements",
    subtitle: "Generate a printable list of announcements for a date range",
    bodyHTML: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field" style="margin-bottom:0;">
          <label>From</label>
          <input type="date" class="input" id="printFromInput">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>To</label>
          <input type="date" class="input" id="printToInput">
        </div>
      </div>
      <p style="font-size:12px;color:var(--color-grey);margin-top:12px;line-height:1.6;">
        Every announcement posted inside this range will be included.
      </p>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="print">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Generate & Print
      </button>
    `,
  });

  const fromInput = overlay.querySelector("#printFromInput");
  const toInput = overlay.querySelector("#printToInput");
  fromInput.addEventListener("change", () => {
    toInput.min = fromInput.value;
    if (toInput.value && toInput.value < fromInput.value)
      toInput.value = fromInput.value;
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay.querySelector('[data-act="print"]').addEventListener("click", () => {
    const fromVal = fromInput.value;
    const toVal = toInput.value;
    if (!fromVal || !toVal) {
      toast({
        type: "warning",
        title: "Pick both dates",
        desc: "Select a From and a To date.",
      });
      return;
    }
    if (fromVal > toVal) {
      toast({
        type: "warning",
        title: "Invalid range",
        desc: "The From date must be on or before the To date.",
      });
      return;
    }
    printAnnouncementsRange(fromVal, toVal);
    overlay.close();
  });
}

function printAnnouncementsRange(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allAnnouncements
    .filter((a) => {
      const ms = toMs(a.timestamp);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No announcements fall inside that date range.",
    });
    return;
  }

  const cols = [
    { label: "Title", value: (r) => r.title },
    { label: "Category", value: (r) => r.category || "General" },
    { label: "Posted By", value: (r) => r.announcerName },
    { label: "Date", value: (r) => r.date || formatDate(r.timestamp) },
    { label: "Time", value: (r) => r.time },
  ];
  const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${cols.map((c) => `<td>${escapeHtml(c.value(r) ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("");
  const bodyHTML = `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;

  printHTML(
    `Announcements — ${formatDate(from)} to ${formatDate(to)}`,
    bodyHTML,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} announcement${rows.length === 1 ? "" : "s"} included.`,
  });
}

/** Reads timestamp (may be a numeric string or number, unix seconds or ms) into a real ms number. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/* ============================================================
   Date/time helpers — keep the web dashboard byte-for-byte
   compatible with the Android app's stored string formats.
   ============================================================ */

/** Matches Java's SimpleDateFormat("MMMM dd, yyyy", Locale.ENGLISH), e.g. "July 05, 2026". */
function formatDateMDY(dateObj) {
  const month = dateObj.toLocaleDateString("en-US", { month: "long" });
  const day = String(dateObj.getDate()).padStart(2, "0");
  const year = dateObj.getFullYear();
  return `${month} ${day}, ${year}`;
}

/** Converts a <input type="time"> value ("HH:MM", 24h) to Java's "hh:mm a" format, e.g. "02:05 PM". */
function formatTimeFromInput(timeVal) {
  const [h, m] = timeVal.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

/** Current date/time formatted exactly like the Android app's Asia/Manila dateCreated/timeCreated, plus a real epoch-ms timestamp. */
function nowInManila() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const dateStr = `${get("month")} ${get("day")}, ${get("year")}`;
  const timeStr = `${get("hour").padStart(2, "0")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;

  return { dateStr, timeStr, timestamp: now.getTime() };
}

/** "July 05, 2026" (or similar parseable string) -> "2026-07-05" for a date input's value. */
function toDateInputValue(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** "02:05 PM" -> "14:05" for a time input's value. */
function toTimeInputValue(timeStr) {
  if (!timeStr) return "";
  const match = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(timeStr.trim());
  if (!match) return "";
  let hh = Number(match[1]);
  const mm = match[2];
  const period = match[3].toUpperCase();
  if (period === "PM" && hh !== 12) hh += 12;
  if (period === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

/** Same validation as the mobile app: only accept well-formed http(s) URLs. */
function isValidHttpUrl(link) {
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setFieldError(overlay, fieldId) {
  overlay.querySelector(`#${fieldId}`)?.classList.add("has-error");
}
function clearFieldErrors(overlay) {
  overlay
    .querySelectorAll(".field.has-error")
    .forEach((f) => f.classList.remove("has-error"));
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
