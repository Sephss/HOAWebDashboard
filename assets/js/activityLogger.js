/* ============================================================
   activityLogger.js — Reusable activity logger.
   Call logActivity(adminProfile, {...}) from any admin module
   after a tracked action succeeds (approve, reject, update status,
   post, delete, etc). Writes to DB_PATHS.activityLogs.

   Usage (future wiring, e.g. in users.js after approving a resident):
     import { logActivity } from "./activityLogger.js";

     await logActivity(adminProfile, {
       action: "Approved",
       module: "Residents & Users",
       targetName: `${user.firstName} ${user.lastName}`,
       details: "Approved new resident registration",
     });
   ============================================================ */
import { db, ref, push, set, DB_PATHS } from "./firebase.js";

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

/**
 * Writes one Activity Log entry.
 * @param {object} adminProfile  the logged-in admin's profile from guardPage()
 * @param {object} entry
 * @param {string} entry.action      e.g. "Approved", "Rejected", "Updated Status", "Posted", "Deleted", "Edited"
 * @param {string} entry.module      e.g. "Residents & Users", "Grievance Reports", "Error Tickets"
 * @param {string} [entry.targetName] human-readable label of what was acted on (a name, a ticket title, etc.)
 * @param {string} [entry.details]    optional longer description shown under the target name
 */
export async function logActivity(adminProfile, entry) {
  try {
    const now = new Date();
    const logRef = push(ref(db, DB_PATHS.activityLogs));

    await set(logRef, {
      logId: logRef.key,
      adminId: adminProfile?.uid || "",
      adminName:
        adminProfile?.fullName ||
        [adminProfile?.firstName, adminProfile?.lastName]
          .filter(Boolean)
          .join(" ") ||
        "Unknown Admin",
      adminRole: adminProfile?.role || adminProfile?.position || "Admin",
      action: entry.action || "Performed an action",
      module: entry.module || "—",
      targetName: entry.targetName || "",
      details: entry.details || "",
      dateCreated: formatManilaDate(now),
      timeCreated: formatManilaTime(now),
      timestamp: now.getTime(),
    });
  } catch (err) {
    // Logging failures should never block the admin's actual action.
    console.error("Failed to write activity log:", err);
  }
}
