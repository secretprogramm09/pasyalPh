import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getFirebaseAuth() {
  const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");

  const serviceAccount = JSON.parse(rawAccount);
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  return getAuth(app);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const headAdminUid = process.env.HEAD_ADMIN_UID;
  if (!headAdminUid) {
    return sendJson(res, 503, {
      error: "Admin account creation is not configured on the server.",
    });
  }

  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return sendJson(res, 401, { error: "Sign in to continue." });

  let firebaseAuth;
  let caller;
  try {
    firebaseAuth = getFirebaseAuth();
    caller = await firebaseAuth.verifyIdToken(token);
  } catch (error) {
    console.error("Admin endpoint could not verify Firebase credentials:", error);
    return sendJson(res, 401, { error: "Your Firebase session could not be verified." });
  }

  if (caller.uid !== headAdminUid) {
    return sendJson(res, 403, { error: "Only the head admin can create admin accounts." });
  }

  if (req.method === "GET") return sendJson(res, 200, { canCreateAdmin: true });

  const displayName = String(req.body?.displayName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!displayName || displayName.length > 80) {
    return sendJson(res, 400, { error: "Enter an admin name (up to 80 characters)." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return sendJson(res, 400, { error: "Enter a valid email address." });
  }
  if (password.length < 12 || password.length > 128) {
    return sendJson(res, 400, { error: "Use a temporary password between 12 and 128 characters." });
  }

  let createdUser;
  try {
    createdUser = await firebaseAuth.createUser({ email, password, displayName });
    try {
      await firebaseAuth.setCustomUserClaims(createdUser.uid, { admin: true });
    } catch (error) {
      await firebaseAuth.deleteUser(createdUser.uid).catch(() => {});
      throw error;
    }
    return sendJson(res, 201, {
      uid: createdUser.uid,
      email: createdUser.email,
      displayName: createdUser.displayName,
    });
  } catch (error) {
    console.error("Admin account creation failed:", error);
    if (error.code === "auth/email-already-exists") {
      return sendJson(res, 409, { error: "An account already exists for that email." });
    }
    if (error.code === "auth/invalid-password") {
      return sendJson(res, 400, { error: "Firebase rejected the temporary password." });
    }
    return sendJson(res, 500, { error: "Could not create the admin account. Check the server configuration." });
  }
}
