/* ============================================================
   solicitations.js — Community Solicitation module
   DB structure: CommunitySolicitations > solicitID > {
     title, description, imageUrl, bankName, accountNumber,
     accountName, status ("active" | "closed"),
     postedById, postedByName, postedByRole,
     dateCreated, timeCreated, timestamp,
     contributions: { uid: { contributorName, controlNumber,
                              signatureUrl, date, time, timestamp } }
   }
   Mobile users view active solicitations, then submit a control
   number + signature after sending money — mirrors the
   attendees/{uid} nested-write pattern in attendees.js.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import {
  db,
  ref,
  onValue,
  push,
  set,
  update,
  remove,
  DB_PATHS,
} from "./firebase.js";
import {
  objectToArray,
  formatDate,
  formatDateTime,
  escapeHtml,
  printHTML,
  debounce,
} from "./utils.js";
import { openModal, emptyState, toast } from "./ui.js";

// TODO: point this at whatever helper emergency.js / rules.js already use
// to upload admin-attached images (Cloudinary, Firebase Storage, etc).
// Expected contract: uploadImage(file) -> Promise<string imageUrl>
import { uploadImage } from "./imageUpload.js";

import { logActivity } from "./activityLogger.js";

const adminProfile = await guardPage();
renderShell("solicitations", adminProfile, {
  breadcrumb: "Community Solicitation",
});

/** Matches Android's SimpleDateFormat("MMMM dd, yyyy") in Asia/Manila. */
function formatManilaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Matches Android's SimpleDateFormat("hh:mm a") in Asia/Manila. */
function formatManilaTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function adminDisplayName() {
  return (
    adminProfile.fullName ||
    [adminProfile.firstName, adminProfile.lastName].filter(Boolean).join(" ") ||
    "Admin"
  );
}
function adminDisplayRole() {
  return adminProfile.role || adminProfile.position || "Admin";
}

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">Community Solicitation</div>
      <div class="page-header__subtitle">Post fundraising drives and track who has sent their contribution.</div>
    </div>
    <button class="btn btn-primary" id="newSolicitBtn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
      New Solicitation
    </button>
  </div>

  <div class="stat-grid" id="solicitStats"></div>

  <div class="table-search" style="max-width:320px;margin-bottom:20px;">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>
    <input type="text" id="solicitSearchInput" placeholder="Search solicitations…">
  </div>

  <div id="solicitGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;"></div>
`;

let solicitations = [];
let searchTerm = "";

onValue(ref(db, DB_PATHS.communitySolicitations), (snap) => {
  const all = objectToArray(snap.val(), "solicitId");
  solicitations = all.sort(
    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
  );
  render();
});

document
  .getElementById("newSolicitBtn")
  .addEventListener("click", () => openEditorModal(null));
document.getElementById("solicitSearchInput").addEventListener(
  "input",
  debounce((e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
  }, 200),
);

function getContributions(s) {
  return objectToArray(s.contributions, "uid");
}

function render() {
  renderStats();

  const grid = document.getElementById("solicitGrid");
  const filtered = solicitations.filter(
    (s) => !searchTerm || (s.title || "").toLowerCase().includes(searchTerm),
  );

  if (!filtered.length) {
    grid.style.gridTemplateColumns = "1fr";
    grid.innerHTML = emptyState({
      title: solicitations.length
        ? "No solicitations match your search"
        : "No solicitations posted yet",
      desc: solicitations.length
        ? "Try a different search term."
        : "Post a fundraising drive and residents will be able to view it and submit their proof of payment.",
    });
    return;
  }

  grid.style.gridTemplateColumns = "repeat(auto-fill,minmax(320px,1fr))";
  grid.innerHTML = filtered.map(solicitCardHTML).join("");

  grid.querySelectorAll("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = solicitations.find((x) => x.solicitId === btn.dataset.view);
      if (s) openContributorsModal(s);
    }),
  );
  grid.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = solicitations.find((x) => x.solicitId === btn.dataset.edit);
      if (s) openEditorModal(s);
    }),
  );
  grid
    .querySelectorAll("[data-toggle-status]")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        toggleStatus(btn.dataset.toggleStatus),
      ),
    );
  grid
    .querySelectorAll("[data-delete]")
    .forEach((btn) =>
      btn.addEventListener("click", () => deleteSolicit(btn.dataset.delete)),
    );
}

function renderStats() {
  const active = solicitations.filter(
    (s) => (s.status || "active") === "active",
  ).length;
  const totalContributions = solicitations.reduce(
    (sum, s) => sum + getContributions(s).length,
    0,
  );
  document.getElementById("solicitStats").innerHTML = [
    ["Total Solicitations", solicitations.length],
    ["Active", active],
    ["Closed", solicitations.length - active],
    ["Total Contributions", totalContributions],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-card__accent-bar"></div><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`,
    )
    .join("");
}

function solicitCardHTML(s) {
  const count = getContributions(s).length;
  const status = s.status || "active";
  return `
    <div class="card card-hover">
      ${
        s.imageUrl
          ? `<img src="${escapeHtml(s.imageUrl)}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:var(--radius-md,10px) var(--radius-md,10px) 0 0;">`
          : ""
      }
      <div class="card-body">
        <span class="badge ${status === "active" ? "badge-success" : "badge-neutral"}" style="margin-bottom:10px;">
          ${status === "active" ? "Active" : "Closed"}
        </span>
        <div class="cell-user__name" style="font-size:15px;margin:4px 0;">${escapeHtml(s.title || "Untitled")}</div>
        <div class="cell-user__sub" style="margin-bottom:10px;">${escapeHtml(s.dateCreated || formatDate(s.timestamp))}</div>
        <div style="font-size:13px;color:var(--color-grey);margin-bottom:16px;line-height:1.5;
                    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
          ${escapeHtml(s.description || "")}
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:20px;font-weight:800;color:var(--color-success);">${count}</div>
          <div style="font-size:11px;color:var(--color-grey);">Contribution${count === 1 ? "" : "s"} received</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" data-view="${s.solicitId}">View Contributors</button>
          <button class="btn btn-secondary btn-sm" data-edit="${s.solicitId}">Edit</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" data-toggle-status="${s.solicitId}">
            ${status === "active" ? "Mark as Closed" : "Reopen"}
          </button>
          <button class="btn btn-danger btn-sm" data-delete="${s.solicitId}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   CREATE / EDIT
   ============================================================ */

function openEditorModal(existing) {
  const isEdit = !!existing;
  let selectedFile = null;
  let currentImageUrl = existing?.imageUrl || "";

  const overlay = openModal({
    title: isEdit ? "Edit Solicitation" : "New Solicitation",
    subtitle: "Visible to all residents on the mobile app once posted.",
    size: "modal-lg",
    bodyHTML: `
      <div class="field">
        <label>Title</label>
        <input type="text" class="input" id="solicitTitleInput" value="${escapeHtml(existing?.title || "")}" placeholder="e.g. Christmas Party Fund">
      </div>
      <div class="field">
        <label>Description</label>
        <textarea class="textarea" id="solicitDescInput" placeholder="Explain the purpose of this solicitation…">${escapeHtml(existing?.description || "")}</textarea>
      </div>
      <div class="divider"></div>
      <div class="section-title" style="font-size:13px;">Bank Details (optional)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="field">
          <label>Bank Name</label>
          <input type="text" class="input" id="solicitBankNameInput" value="${escapeHtml(existing?.bankName || "")}" placeholder="e.g. BDO">
        </div>
        <div class="field">
          <label>Account Name</label>
          <input type="text" class="input" id="solicitAccountNameInput" value="${escapeHtml(existing?.accountName || "")}" placeholder="e.g. Lavanya HOA Inc.">
        </div>
      </div>
      <div class="field">
        <label>Account Number</label>
        <input type="text" class="input" id="solicitAccountNumberInput" value="${escapeHtml(existing?.accountNumber || "")}" placeholder="e.g. 1234-5678-90">
      </div>
      <div class="divider"></div>
      <div class="field">
        <label>Image (optional)</label>
        <input type="file" accept="image/*" id="solicitImageInput">
        <img id="solicitImagePreview" src="${escapeHtml(currentImageUrl)}"
             style="margin-top:10px;max-height:160px;border-radius:8px;${currentImageUrl ? "" : "display:none;"}">
      </div>
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="save">${isEdit ? "Save Changes" : "Post Solicitation"}</button>
    `,
  });

  overlay
    .querySelector("#solicitImageInput")
    .addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      selectedFile = file;
      const preview = overlay.querySelector("#solicitImagePreview");
      preview.src = URL.createObjectURL(file);
      preview.style.display = "block";
    });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="save"]')
    .addEventListener("click", async () => {
      const title = overlay.querySelector("#solicitTitleInput").value.trim();
      const description = overlay
        .querySelector("#solicitDescInput")
        .value.trim();
      const bankName = overlay
        .querySelector("#solicitBankNameInput")
        .value.trim();
      const accountName = overlay
        .querySelector("#solicitAccountNameInput")
        .value.trim();
      const accountNumber = overlay
        .querySelector("#solicitAccountNumberInput")
        .value.trim();

      if (!title) {
        toast({
          type: "warning",
          title: "Title required",
          desc: "Give this solicitation a title.",
        });
        return;
      }
      if (!description) {
        toast({
          type: "warning",
          title: "Description required",
          desc: "Explain what this solicitation is for.",
        });
        return;
      }

      const saveBtn = overlay.querySelector('[data-act="save"]');
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      try {
        let imageUrl = currentImageUrl;
        if (selectedFile) {
          imageUrl = await uploadImage(selectedFile);
        }

        if (isEdit) {
          await update(
            ref(db, `${DB_PATHS.communitySolicitations}/${existing.solicitId}`),
            {
              title,
              description,
              bankName,
              accountName,
              accountNumber,
              imageUrl,
            },
          );
          toast({
            type: "success",
            title: "Updated",
            desc: "Solicitation updated.",
          });
          await logActivity(adminProfile, {
            action: "Edited",
            module: "Community Solicitation",
            targetName: title,
            details: "Updated solicitation details",
          });
        } else {
          const newRef = push(ref(db, DB_PATHS.communitySolicitations));
          const now = new Date();
          await set(newRef, {
            solicitId: newRef.key,
            title,
            description,
            bankName,
            accountName,
            accountNumber,
            imageUrl,
            status: "active",
            postedById: adminProfile.uid || "",
            postedByName: adminDisplayName(),
            postedByRole: adminDisplayRole(),
            dateCreated: formatManilaDate(now),
            timeCreated: formatManilaTime(now),
            timestamp: now.getTime(),
          });
          toast({
            type: "success",
            title: "Posted",
            desc: "Solicitation is now live for residents.",
          });
          await logActivity(adminProfile, {
            action: "Posted",
            module: "Community Solicitation",
            targetName: title,
            details: "Published a new solicitation",
          });
        }
        overlay.close();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? "Save Changes" : "Post Solicitation";
        toast({ type: "danger", title: "Save failed", desc: err.message });
      }
    });
}

async function toggleStatus(solicitId) {
  const s = solicitations.find((x) => x.solicitId === solicitId);
  if (!s) return;
  const nextStatus = (s.status || "active") === "active" ? "closed" : "active";
  try {
    await update(ref(db, `${DB_PATHS.communitySolicitations}/${solicitId}`), {
      status: nextStatus,
    });
    toast({
      type: "success",
      title:
        nextStatus === "closed"
          ? "Solicitation closed"
          : "Solicitation reopened",
      desc:
        nextStatus === "closed"
          ? "Residents will no longer see this as active."
          : "This solicitation is active again.",
    });
    await logActivity(adminProfile, {
      action: nextStatus === "closed" ? "Closed" : "Reopened",
      module: "Community Solicitation",
      targetName: s.title || "Untitled Solicitation",
    });
  } catch (err) {
    toast({ type: "danger", title: "Update failed", desc: err.message });
  }
}

function deleteSolicit(solicitId) {
  const s = solicitations.find((x) => x.solicitId === solicitId);
  if (!s) return;

  const overlay = openModal({
    title: "Delete Solicitation?",
    subtitle: s.title,
    bodyHTML: `<p style="font-size:13px;color:var(--color-grey);line-height:1.6;">
      This permanently removes "${escapeHtml(s.title)}" and all ${getContributions(s).length}
      submitted contribution record${getContributions(s).length === 1 ? "" : "s"}. This cannot be undone.
    </p>`,
    footerHTML: `
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-danger" data-act="confirm">Delete Permanently</button>
    `,
  });

  overlay
    .querySelector('[data-act="cancel"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="confirm"]')
    .addEventListener("click", async () => {
      try {
        await remove(
          ref(db, `${DB_PATHS.communitySolicitations}/${solicitId}`),
        );
        toast({
          type: "success",
          title: "Deleted",
          desc: "Solicitation removed.",
        });
        await logActivity(adminProfile, {
          action: "Deleted",
          module: "Community Solicitation",
          targetName: s.title || "Untitled Solicitation",
          details: `Removed along with ${getContributions(s).length} contribution record(s)`,
        });
        overlay.close();
      } catch (err) {
        toast({ type: "danger", title: "Delete failed", desc: err.message });
      }
    });
}

/* ============================================================
   CONTRIBUTORS
   ============================================================ */

function openContributorsModal(s) {
  const list = sortByDate(getContributions(s));

  const overlay = openModal({
    title: s.title || "Untitled Solicitation",
    subtitle: `${s.dateCreated || formatDate(s.timestamp)} · Posted by ${escapeHtml(s.postedByName || "Admin")}`,
    size: "modal-xl",
    bodyHTML: `
      <div style="margin-bottom:16px;font-size:13px;color:var(--color-grey);line-height:1.6;">
        ${escapeHtml(s.description || "")}
      </div>
      ${contributorsTableHTML(list)}
    `,
    footerHTML: `
      <button class="btn btn-secondary" data-act="close">Close</button>
      <button class="btn btn-primary" data-act="print">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" stroke-linejoin="round"/></svg>
        Print Contributor List
      </button>
    `,
  });

  overlay
    .querySelector('[data-act="close"]')
    .addEventListener("click", () => overlay.close());
  overlay
    .querySelector('[data-act="print"]')
    .addEventListener("click", () => printContributors(s));
}

function sortByDate(list) {
  return [...list].sort(
    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
  );
}

function contributorsTableHTML(list) {
  if (!list.length) {
    return `<div style="padding:30px 0;text-align:center;color:var(--color-grey);font-size:13px;">No contributions submitted yet.</div>`;
  }
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>Contributor</th>
          <th>Control Number</th>
          <th>Amount Sent</th>
          <th>Signature</th>
          <th>Submitted</th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.contributorName || "—")}</td>
              <td><span class="mono">${escapeHtml(c.controlNumber || "—")}</span></td>
              <td>${escapeHtml(formatAmount(c.amountSent))}</td>
              <td>${signatureCellHTML(c.signatureUrl)}</td>
              <td class="muted">${
                c.date
                  ? escapeHtml(`${c.date}${c.time ? " • " + c.time : ""}`)
                  : formatDateTime(c.timestamp)
              }</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

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

function printContributors(s) {
  const list = sortByDate(getContributions(s));
  if (!list.length) {
    toast({
      type: "warning",
      title: "Nothing to print",
      desc: "No contributions have been submitted yet.",
    });
    return;
  }

  const thead = `<tr><th>Contributor</th><th>Control Number</th><th>Amount Sent</th><th>Signature</th><th>Submitted</th></tr>`;
  const tbody = list
    .map(
      (c) => `
    <tr style="page-break-inside:avoid;">
      <td>${escapeHtml(c.contributorName || "—")}</td>
      <td>${escapeHtml(c.controlNumber || "—")}</td>
      <td>${escapeHtml(formatAmount(c.amountSent))}</td>
      <td>${printSignatureCellHTML(c.signatureUrl)}</td>
      <td>${c.date ? escapeHtml(`${c.date}${c.time ? " • " + c.time : ""}`) : formatDateTime(c.timestamp)}</td>
    </tr>`,
    )
    .join("");

  const bodyHTML = `
    <div style="font-size:13px;color:#5C5F61;margin-bottom:16px;">
      ${escapeHtml(s.dateCreated || formatDate(s.timestamp))} · Posted by ${escapeHtml(s.postedByName || "Admin")}
    </div>
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  `;

  printHTML(`Contributors — ${s.title || "Solicitation"}`, bodyHTML);
  toast({
    type: "success",
    title: "Print ready",
    desc: `${list.length} contributor${list.length === 1 ? "" : "s"} included.`,
  });
}

/** Formats the raw amountSent string as currency, e.g. "500" -> "₱500.00". Falls back gracefully if it's not numeric. */
function formatAmount(raw) {
  if (raw === undefined || raw === null || raw === "") return "—";
  const num = Number(raw);
  if (isNaN(num)) return raw; // just show whatever was stored
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function printSignatureCellHTML(signatureUrl) {
  if (!signatureUrl) return `<span style="color:#5C5F61;">—</span>`;
  return `<img src="${escapeHtml(signatureUrl)}" alt="Signature" style="height:80px;width:auto;max-width:120px;display:block;background:#fff;border:1px solid #e5e7eb;" />`;
}
