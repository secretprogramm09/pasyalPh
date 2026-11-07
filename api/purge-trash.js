import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getDatabaseAdmin() {
  const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");

  const serviceAccount = JSON.parse(rawAccount);
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
      databaseURL:
        "https://pasyalphadmin-default-rtdb.asia-southeast1.firebasedatabase.app",
    });
  return getDatabase(app);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return sendJson(res, 503, { error: "Trash cleanup is not configured." });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return sendJson(res, 401, { error: "Unauthorized." });
  }

  try {
    const db = getDatabaseAdmin();
    const snapshot = await db.ref("trashListings").once("value");
    const expiration = Date.now() - RETENTION_MS;
    const updates = {};

    snapshot.forEach((child) => {
      const deletedAt = Number(child.child("deletedAt").val());
      if (Number.isFinite(deletedAt) && deletedAt > 0 && deletedAt <= expiration) {
        updates[`trashListings/${child.key}`] = null;
      }
    });

    const deleted = Object.keys(updates).length;
    if (deleted) await db.ref().update(updates);
    return sendJson(res, 200, { deleted });
  } catch (error) {
    console.error("Scheduled trash cleanup failed:", error);
    return sendJson(res, 500, { error: "Could not clean expired trash." });
  }
}
