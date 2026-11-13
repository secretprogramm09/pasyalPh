import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const ADMIN_APP_NAME = "pasyalph-admin";
const MOBILE_APP_NAME = "pasyalph-mobile-auth";
const ADMIN_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://pasyalphadmin-default-rtdb.asia-southeast1.firebasedatabase.app";
const MAX_BODY_BYTES = 64 * 1024;

function setCors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.ADMIN_ALLOWED_ORIGIN || "*",
  );
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, status, body) {
  setCors(res);
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseServiceAccount(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not configured.`);
  const account = JSON.parse(raw);
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error(`${name} is missing required service-account fields.`);
  }
  return account;
}

function getNamedApp(name, envName, options = {}) {
  return (
    getApps().find((app) => app.name === name) ||
    initializeApp(
      { credential: cert(parseServiceAccount(envName)), ...options },
      name,
    )
  );
}

function getMobileAuth() {
  return getAuth(getNamedApp(MOBILE_APP_NAME, "MOBILE_FIREBASE_SERVICE_ACCOUNT"));
}

function getAdminDatabase() {
  return getDatabase(
    getNamedApp(ADMIN_APP_NAME, "FIREBASE_SERVICE_ACCOUNT", {
      databaseURL: ADMIN_DATABASE_URL,
    }),
  );
}

function bearerToken(req) {
  return req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function cleanString(value, field, max, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  const result = String(value).trim();
  if (!result || result.length > max) {
    throw new Error(`${field} must be 1-${max} characters.`);
  }
  return result;
}

function cleanTimestamp(value, field) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${field} is required.`);
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }
  return value;
}

function validateApplication(body, uid) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Send a JSON object.");
  }

  const allowedFields = new Set([
    "ownerId",
    "legalName",
    "businessName",
    "category",
    "address",
    "phone",
    "permitReference",
    "description",
    "status",
    "submittedAt",
    "updatedAt",
  ]);
  const unknownField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unknownField) throw new Error(`Unsupported field: ${unknownField}.`);

  const ownerId = cleanString(body.ownerId, "ownerId", 128, true);
  if (ownerId !== uid) {
    throw new Error("ownerId must match the signed-in mobile user.");
  }
  if (body.status !== undefined && body.status !== "Pending review") {
    throw new Error("New applications must use status 'Pending review'.");
  }

  return {
    ownerId,
    legalName: cleanString(body.legalName, "legalName", 200, true),
    businessName: cleanString(body.businessName, "businessName", 200, true),
    category: cleanString(body.category, "category", 100, true),
    address: cleanString(body.address, "address", 500, true),
    phone: cleanString(body.phone, "phone", 40, true),
    permitReference: cleanString(body.permitReference, "permitReference", 200, true),
    description: cleanString(body.description, "description", 3000, true),
    status: "Pending review",
    submittedAt: cleanTimestamp(body.submittedAt, "submittedAt"),
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const token = bearerToken(req);
  if (!token) {
    return sendJson(res, 401, { error: "A Firebase ID token is required." });
  }

  let caller;
  try {
    caller = await getMobileAuth().verifyIdToken(token);
  } catch (error) {
    console.error("Business application token verification failed:", error);
    return sendJson(res, 401, {
      error: "Your mobile Firebase session could not be verified.",
    });
  }

  let applicationRef;
  let serviceInitialized = false;
  try {
    applicationRef = getAdminDatabase().ref(
      `businessApplications/${caller.uid}`,
    );
    serviceInitialized = true;

    if (req.method === "GET") {
      const snapshot = await applicationRef.once("value");
      const application = snapshot.exists() ? snapshot.val() : null;
      return sendJson(res, 200, {
        status: application?.status || null,
        application,
      });
    }

    const rawLength = Number(req.headers["content-length"] || 0);
    if (rawLength > MAX_BODY_BYTES) {
      return sendJson(res, 413, { error: "Application payload is too large." });
    }

    const application = validateApplication(req.body, caller.uid);
    const current = await applicationRef.once("value");
    const previous = current.val() || {};
    const saved = {
      ...application,
      submittedAt:
        application.submittedAt ||
        (typeof previous.submittedAt === "string" ? previous.submittedAt : new Date().toISOString()),
      status: "Pending review",
      updatedAt: new Date().toISOString(),
    };
    await applicationRef.set(saved);
    return sendJson(res, 200, { status: saved.status, application: saved });
  } catch (error) {
    console.error("Business application request failed:", error);
    if (!serviceInitialized) {
      return sendJson(res, 503, {
        error: "Business application service is not configured.",
      });
    }
    const clientError =
      error instanceof SyntaxError ||
      /required|must be|Unsupported field|ownerId|Pending review|JSON object/i.test(
        error.message || "",
      );
    return sendJson(res, clientError ? 400 : 500, {
      error: clientError
        ? error.message
        : "Could not process the business application.",
    });
  }
}
