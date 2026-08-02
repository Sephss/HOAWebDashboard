/* ============================================================
   about.js — About Us page
   Static informational page. To update names, just edit the
   PROJECT_OWNER constant and the `name` fields in OFFICIALS below
   — nothing else in this file needs to change.
   ============================================================ */
import { guardPage } from "./auth.js";
import { renderShell } from "./sidebar.js";
import { initials, escapeHtml } from "./utils.js";

const adminProfile = await guardPage();
renderShell("about", adminProfile, { breadcrumb: "About Us" });

const PROJECT_OWNER = "JC Rausa";

// Fill in each official's name below. Leave a name blank to show "To be announced".
const OFFICIALS = [
  { role: "President", name: "" },
  { role: "Vice President", name: "" },
  { role: "Secretary", name: "" },
  { role: "Treasurer", name: "" },
  { role: "Auditor", name: "" },
];

const content = document.getElementById("page-content");
content.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-header__title">About Us</div>
      <div class="page-header__subtitle">Project credits and your HOA's main officials.</div>
    </div>
  </div>

  <div class="card" style="max-width:640px;margin-bottom:16px;">
    <div class="card-header"><h3>Project</h3></div>
    <div class="card-body">
      <div class="detail-item">
        <div class="label">Project by:</div>
        <div class="value" style="font-size:16px;">${escapeHtml(PROJECT_OWNER)}</div>
      </div>
    </div>
  </div>

  <div class="card" style="max-width:640px;">
    <div class="card-header"><h3>HOA Main Officials</h3></div>
    <div class="card-body" style="padding-top:8px;padding-bottom:8px;">
      ${OFFICIALS.map(officialRowHTML).join("")}
    </div>
  </div>
`;

function officialRowHTML(o, i) {
  const name = (o.name || "").trim();
  const isLast = i === OFFICIALS.length - 1;
  return `
    <div style="display:flex;align-items:center;gap:14px;padding:12px 0;${isLast ? "" : "border-bottom:1px solid var(--color-border);"}">
      <div class="avatar" style="width:42px;height:42px;font-size:14px;">${initials(name || o.role)}</div>
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--color-black);">${name ? escapeHtml(name) : "To be announced"}</div>
        <div style="font-size:12px;color:var(--color-grey);">${escapeHtml(o.role)}</div>
      </div>
    </div>
  `;
}
