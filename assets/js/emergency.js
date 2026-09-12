/* ============================================================
   emergency.js — Emergency Directory module
   Mirrors rules.js's create/edit/delete/upload pattern exactly.
   Stored at EmergencyDirectories > {entryId} > { title, category,
   description, link, imageUrl, postedByName, postedByRole,
   dateCreated, timeCreated, timestamp }.
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
  escapeHtml,
  getQueryParam,
  printHTML,
} from "./utils.js";

const adminProfile = await guardPage();
renderShell("emergency", adminProfile, { breadcrumb: "Emergency Directory" });

// TODO: confirm this list with the client — placeholder categories for now.
const CATEGORIES = [
  "Hospital",
  "Police Station",
  "Fire Station",
  "Barangay",
  "Ambulance",
  "Utility (Power/Water)",
  "Disaster Response",
  "Other",
];

/** Max characters allowed in an entry's description. */
const DESCRIPTION_MAX_LENGTH = 2000;

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Emergency Directory</div>
      <div class="page-header__subtitle">Publish emergency contacts and nearest facilities for residents.</div>
    </div>
    <div class="page-header__actions">
      <button class="btn btn-primary" id="newEntryBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
        New Entry
      </button>
    </div>
  </div>
  <div class="stat-grid" id="emergencyStats"></div>
  <div class="card"><div id="emergencyTableRoot"></div></div>
`;

document
  .getElementById("newEntryBtn")
  .addEventListener("click", () => openEditorModal());

let allEntries = [];

const table = new DataTable({
  root: document.getElementById("emergencyTableRoot"),
  title: "Emergency Directory",
  pageSize: 10,
  searchFields: ["title", "description", "category"],
  defaultSort: "timestamp",
  showExportCsv: false,
  onPrintClick: () => openPrintRangeModal(),
  columns: [
    {
      key: "title",
      label: "Entry",
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
        `<span class="badge badge-neutral">${escapeHtml(r.category || "Other")}</span>`,
    },
    {
      key: "postedByName",
      label: "Posted By",
      sortable: true,
      render: (r) =>
        `${escapeHtml(r.postedByName || "—")}<div class="cell-user__sub">${escapeHtml(r.postedByRole || "")}</div>`,
    },
    {
      key: "dateCreated",
      label: "Date Posted",
      sortable: true,
      sortValue: (r) => Number(r.timestamp || 0),
      render: (r) =>
        `${escapeHtml(r.dateCreated || formatDate(r.timestamp))}${r.timeCreated ? `<div class="cell-user__sub">${escapeHtml(r.timeCreated)}</div>` : ""}`,
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
    { key: "postedByName", label: "Posted By" },
    { key: "dateCreated", label: "Date Posted" },
    { key: "timeCreated", label: "Time Posted" },
  ],
  filters: [
    {
      key: "category",
      label: "Category",
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
      match: (r, v) => (r.category || "Other") === v,
    },
  ],
  emptyTitle: "No emergency entries yet",
  emptyDesc: "Publish your first emergency contact or facility to get started.",
  onRowClick: (row) => openPreviewModal(row),
});

onValue(ref(db, DB_PATHS.emergencyDirectories), (snap) => {
  allEntries = objectToArray(snap.val(), "id").sort(
    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
  );
  table.setData(allEntries);
  renderStats();
});

if (getQueryParam("action") === "new") openEditorModal();

function renderStats() {
  const total = allEntries.length;
  const thisMonth = allEntries.filter((r) => {
    const ts = Number(r.timestamp || 0);
    if (!ts) return false;
    const d = new Date(ts < 10 ** 12 ? ts * 1000 : ts);
    const now = new Date();
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }).length;
  document.getElementById("emergencyStats").innerHTML = [
    ["Total Entries", total],
    ["Posted This Month", thisMonth],
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
      btn.addEventListener("click", () => deleteEntry(rows[i])),
    );
};

function openPreviewModal(r) {
  const overlay = openModal({
    title: r.title || "Untitled Entry",
    subtitle: `${r.category || "Other"} · Posted by ${r.postedByName || "Admin"}`,
    size: "modal-lg",
    bodyHTML: `
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <span class="badge badge-neutral">${escapeHtml(r.category || "Other")}</span>
      </div>
      ${r.imageUrl ? `<div style="margin-bottom:16px;"><img src="${escapeHtml(r.imageUrl)}" alt="Entry image" style="max-width:100%;border-radius:10px;display:block;"></div>` : ""}
      <p style="font-size:14px;line-height:1.7;color:var(--color-black);white-space:pre-wrap;">${escapeHtml(r.description || "")}</p>
      ${r.link ? `<div style="margin-top:16px;"><a href="${escapeHtml(r.link)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open attached link ↗</a></div>` : ""}
      <div class="divider"></div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">Posted By</div><div class="value">${escapeHtml(r.postedByName || "—")} (${escapeHtml(r.postedByRole || "Admin")})</div></div>
        <div class="detail-item"><div class="label">Date Posted</div><div class="value">${escapeHtml(r.dateCreated || "—")}${r.timeCreated ? " · " + escapeHtml(r.timeCreated) : ""}</div></div>
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
    title: isEdit ? "Edit Entry" : "New Entry",
    subtitle: isEdit
      ? `Editing "${existing.title}"`
      : "Publish an emergency contact or facility visible to all residents",
    size: "modal-lg",
    bodyHTML: `
      <div class="field" id="titleField">
        <label>Title</label>
        <input class="input" id="titleInput" placeholder="e.g. Lavanya General Hospital" value="${escapeHtml(existing?.title || "")}">
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
      <div class="field" id="descField">
        <label>Description</label>
        <textarea class="textarea" id="descInput" style="min-height:180px;" maxlength="${DESCRIPTION_MAX_LENGTH}" placeholder="Address, contact number, hours, and other details…">${escapeHtml(existing?.description || "")}</textarea>
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
      <button class="btn btn-primary" data-act="save">${isEdit ? "Save Changes" : "Publish Entry"}</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="delete"]')
    ?.addEventListener("click", async () => {
      overlay.close();
      await deleteEntry(existing);
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
      if (link && !isValidHttpUrl(link)) {
        setFieldError(overlay, "linkField");
        hasError = true;
      }
      if (hasError) return;

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
        link,
        imageUrl,
      };

      try {
        if (isEdit) {
          // Editing never touches entryId/postedBy*/dateCreated/timeCreated/timestamp —
          // those describe the original posting and stay fixed.
          await update(
            ref(db, `${DB_PATHS.emergencyDirectories}/${existing.id}`),
            payload,
          );
          toast({ type: "success", title: "Entry updated" });
        } else {
          const {
            dateStr: dateCreated,
            timeStr: timeCreated,
            timestamp,
          } = nowInManila();
          const newRef = push(ref(db, DB_PATHS.emergencyDirectories));
          const fullPayload = {
            ...payload,
            entryId: newRef.key,
            postedById: adminProfile.uid || "",
            postedByName:
              [adminProfile.firstName, adminProfile.lastName]
                .filter(Boolean)
                .join(" ") || "Admin",
            postedByRole: adminProfile.role || "Administrator",
            dateCreated,
            timeCreated,
            timestamp,
          };
          await set(newRef, fullPayload);
          toast({ type: "success", title: "Entry published" });
        }
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Save failed", desc: err.message });
      }
    });
}

async function deleteEntry(r) {
  const ok = await confirmDialog({
    title: "Delete entry",
    message: `Delete "<strong>${escapeHtml(r.title || "this entry")}</strong>"? This cannot be undone.`,
    tone: "danger",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await remove(ref(db, `${DB_PATHS.emergencyDirectories}/${r.id}`));
    toast({ type: "success", title: "Entry deleted" });
  } catch (err) {
    toast({ type: "danger", title: "Delete failed", desc: err.message });
  }
}

/* ============================================================
   PRINT — All entries within a chosen date range.
   ============================================================ */

function openPrintRangeModal() {
  const overlay = openModal({
    title: "Print Emergency Directory",
    subtitle: "Generate a printable list of entries for a date range",
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
        Every entry posted inside this range will be included.
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
    printEntriesRange(fromVal, toVal);
    overlay.close();
  });
}

function printEntriesRange(fromVal, toVal) {
  const from = new Date(`${fromVal}T00:00:00`).getTime();
  const to = new Date(`${toVal}T23:59:59.999`).getTime();

  const rows = allEntries
    .filter((r) => {
      const ms = toMs(r.timestamp);
      return ms >= from && ms <= to;
    })
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  if (!rows.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No entries fall inside that date range.",
    });
    return;
  }

  const cols = [
    { label: "Title", value: (r) => r.title },
    { label: "Category", value: (r) => r.category || "Other" },
    { label: "Posted By", value: (r) => r.postedByName },
    {
      label: "Date Posted",
      value: (r) => r.dateCreated || formatDate(r.timestamp),
    },
    { label: "Time Posted", value: (r) => r.timeCreated },
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
    `Emergency Directory — ${formatDate(from)} to ${formatDate(to)}`,
    bodyHTML,
  );
  toast({
    type: "success",
    title: "Print ready",
    desc: `${rows.length} entr${rows.length === 1 ? "y" : "ies"} included.`,
  });
}

/** Reads timestamp (may be numeric string/number, unix seconds or ms) into a real ms number. */
function toMs(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return 0;
  return t < 10 ** 12 ? t * 1000 : t;
}

/** Current date/time in "MMMM dd, yyyy" / "hh:mm a" Asia/Manila format, plus a real epoch-ms timestamp. */
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

/** Same validation as elsewhere: only accept well-formed http(s) URLs. */
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
