import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  push,
  set,
  update,
  remove,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js";
import { firebaseConfig, PATHS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const safeUrl = (value) => {
  if (!value) return "";
  try {
    const u = new URL(value, location.href);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
const today = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Manila",
}).format(new Date());
$("#currentDate").textContent = today;
const themeToggle = $("#themeToggle");
function applyDashboardTheme(theme, persist = true) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute(
    "aria-label",
    `Switch to ${isDark ? "light" : "dark"} mode`,
  );
  themeToggle.title = `Switch to ${isDark ? "light" : "dark"} mode`;
  themeToggle.innerHTML = isDark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5a8.5 8.5 0 1 0 11.7 11.7Z"/></svg>';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? "#111914" : "#f5f7f4";
  if (persist) {
    try {
      localStorage.setItem("pasyal-dashboard-theme", isDark ? "dark" : "light");
    } catch {
      toast("Theme changed for this session, but browser storage is unavailable.");
    }
  }
}
applyDashboardTheme(document.documentElement.dataset.theme || "light", false);
themeToggle.addEventListener("click", () =>
  applyDashboardTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  ),
);
const brandLogoImage = $("#brandLogoImage");
const brandLogoFallback = $("#brandLogoFallback");
if (brandLogoImage && brandLogoFallback) {
  const showBrandLogo = () => {
    brandLogoImage.hidden = false;
    brandLogoFallback.hidden = true;
  };
  brandLogoImage.addEventListener("load", showBrandLogo, { once: true });
  brandLogoImage.addEventListener(
    "error",
    () => {
      brandLogoImage.hidden = true;
      brandLogoFallback.hidden = false;
    },
    { once: true },
  );
  if (brandLogoImage.complete && brandLogoImage.naturalWidth) showBrandLogo();
}
let toastTimer,
  listeners = [],
  entries = {
    restaurants: [],
    stays: [],
    comments: [],
    reports: [],
    users: [],
  },
  listingFilter = "all",
  listingPage = 1;
const philippinesBounds = L.latLngBounds([4.3, 116], [21.5, 127.5]);
const philippinesCenter = [12.8797, 121.774];
const defaultPhilippinesZoom = 6;
const locationMap = L.map("mapCanvas", {
  zoomControl: false, maxBounds: philippinesBounds, maxBoundsViscosity: 1, minZoom: 5,
}).setView(philippinesCenter, defaultPhilippinesZoom);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(locationMap);
const listingMarkers = L.layerGroup().addTo(locationMap);
const addressSearchMarkers = L.layerGroup().addTo(locationMap);
function setMapView(point, zoom) { locationMap.setView(point, zoom); }
function fitMapPoints(points, maxZoom) {
  locationMap.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom });
}
let mapHasFittedListings = false;
let fitListingsTimer;
let selectionMarker = null;
let addressMatches = [];
let coordinateSource = "";
let resolvedAddress = "";
function setListingLocation(lat, lng, message, source = "map") {
  if (!isInPhilippines(lat, lng)) {
    toast("That location is outside the Philippines map area.");
    return false;
  }
  $("#lat").value = Number(lat).toFixed(6);
  $("#lng").value = Number(lng).toFixed(6);
  coordinateSource = source;
  resolvedAddress = source === "geocoded" ? $("#address").value.trim() : "";
  updateCoordinateReadout(lat, lng);
  setMapView([lat, lng], 16);
  if (selectionMarker) selectionMarker.remove();
  selectionMarker = L.circleMarker([lat, lng], {
    radius: 8, color: "#ffffff", weight: 3, fillColor: "#4f7edc", fillOpacity: 1,
  }).addTo(locationMap);
  $("#mapResult").textContent = message;
  $("#addressStatus").textContent =
    source === "geocoded"
      ? "Pin placed from the selected address result. Check it on the map before saving."
      : "Map pin selected. Check the address and coordinates before saving.";
  return true;
}
locationMap.on("click", ({ latlng }) => {
  setListingLocation(latlng.lat, latlng.lng, "Map point selected · coordinates added to form");
  $("#mapResult").textContent =
    "Selected map point · coordinates added to form";
});
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

const gate = document.createElement("section");
gate.className = "auth-gate";
gate.innerHTML = `<form class="auth-card" id="loginForm" autocomplete="off"><div class="auth-brand"><div class="auth-mark"><img src="assets/pasyal-ph-logo.jpg" alt="Pasyal PH logo"></div><div><b>Pasyal ph</b><small>ADMIN CONSOLE</small></div></div><h2>Welcome back</h2><p>Sign in with your Firebase admin account to manage live listings.</p><label for="loginEmail">Email address</label><input id="loginEmail" type="email" autocomplete="off" required placeholder="you@example.com"><label for="loginPassword">Password</label><input id="loginPassword" type="password" autocomplete="new-password" required placeholder="Your password"><button class="auth-submit" type="submit">Sign in to dashboard</button><div class="auth-error" id="loginError" role="alert"></div><div class="auth-note">Use an existing Firebase Authentication account. This page does not create accounts or store your password.</div></form>`;
document.body.append(gate);
document.body.classList.add("auth-open");
document.documentElement.classList.add("auth-open");
const status = document.createElement("div");
status.className = "fb-status";
status.dataset.state = "connecting";
status.innerHTML = '<i class="fb-dot"></i><span>Connecting to Firebase…</span>';
$(".top-actions").prepend(status);
function setStatus(text, state = "connecting") {
  status.dataset.state = state;
  $("span:last-child", status).textContent = text;
}
function stopListeners() {
  listeners.forEach((stop) => stop());
  listeners = [];
}
function asItems(raw) {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([id, value]) => ({
    id,
    ...(value && typeof value === "object" ? value : { value }),
  }));
}
function field(item, names, fallback = "") {
  for (const name of names)
    if (item[name] !== undefined && item[name] !== null && item[name] !== "")
      return item[name];
  return fallback;
}
function itemName(item) {
  return field(
    item,
    ["name", "title", "businessName", "listingName"],
    "Untitled listing",
  );
}
function itemAddress(item) {
  return field(item, ["address", "location", "city", "province"], "—");
}
function itemImage(item, type) {
  return (
    safeUrl(
      field(
        item,
        ["imageUrl", "image", "photoUrl", "coverImage", "thumbnail"],
        "",
      ),
    ) ||
    (type === "Airbnb"
      ? "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=220&h=160&fit=crop"
      : "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=220&h=160&fit=crop")
  );
}
function itemRating(item) {
  const rating = Number(
    field(item, ["rating", "averageRating", "average_rating"], 0),
  );
  return Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : "—";
}
function dateLabel(value) {
  if (!value) return "—";
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? esc(value)
    : new Intl.DateTimeFormat("en-PH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Manila",
      }).format(date);
}

function renderStats() {
  $("#restaurantCount").textContent =
    entries.restaurants.length.toLocaleString("en-PH");
  $("#airbnbCount").textContent = entries.stays.length.toLocaleString("en-PH");
  const isActive = (item) => {
    const status = String(item.status || "active").trim().toLowerCase();
    return ["active", "approved", "published", "visible"].includes(status);
  };
  const locations = new Set(
    [...entries.restaurants, ...entries.stays]
      .filter(isActive)
      .map((item) => String(field(item, ["city", "province", "location", "address"], "")))
      .map((location) => location.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean),
  );
  $("#activeLocationCount").textContent = locations.size.toLocaleString("en-PH");
  const openReports = entries.reports.filter(
    (item) =>
      !["resolved", "closed", "complete", "dismissed", "rejected"].includes(
        String(item.status || "").trim().toLowerCase(),
      ),
  ).length;
  $("#pendingReportCount").textContent = openReports.toLocaleString("en-PH");
}
function renderListings() {
  const all = [
    ...entries.restaurants.map((item) => ({ ...item, _type: "Restaurant" })),
    ...entries.stays.map((item) => ({ ...item, _type: "Airbnb" })),
  ];
  all.sort(
    (a, b) =>
      Number(b.createdAt || b.timestamp || 0) -
      Number(a.createdAt || a.timestamp || 0),
  );
  const filtered =
    listingFilter === "all"
      ? all
      : all.filter((item) => item._type === listingFilter);
  const pageSize = 10,
    pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  listingPage = Math.min(listingPage, pageCount);
  const start = (listingPage - 1) * pageSize,
    recent = filtered.slice(start, start + pageSize);
  $("#listingRows").innerHTML = recent.length
    ? recent
        .map(
          (item) =>
            `<tr><td><div class="listing-cell"><img src="${esc(itemImage(item, item._type))}" alt=""><span>${esc(itemName(item))}</span></div></td><td><span class="type-pill ${item._type === "Airbnb" ? "air" : ""}">${item._type}</span></td><td>${esc(itemAddress(item))}</td><td>${itemRating(item) === "—" ? "—" : `<span class="stars">★</span> ${esc(itemRating(item))}`}</td><td><span class="status-pill ${String(item.status || "active").toLowerCase() === "active" ? "active" : "pending"}">${esc(item.status || "Active")}</span></td><td>${dateLabel(item.createdAt || item.timestamp)}</td><td><div class="table-actions">${String(item.status || "active").toLowerCase() === "pending" ? `<button class="approve" data-approve="${esc(item._type)}:${esc(item.id)}">Approve</button>` : ""}<button data-edit="${esc(item._type)}:${esc(item.id)}">Edit</button><button class="delete" data-delete="${esc(item._type)}:${esc(item.id)}">Delete</button></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7"><div class="empty-state">No listings found in the configured database paths.</div></td></tr>';
  $("#rowCount").textContent =
    `Showing ${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} ${listingFilter === "all" ? "listings" : listingFilter === "Airbnb" ? "Airbnb listings" : "restaurants"}`;
  const pages = $("#listingPages");
  if (pages)
    pages.innerHTML = `<button data-list-page="${Math.max(1, listingPage - 1)}" aria-label="Previous page">‹</button>${Array.from({ length: pageCount }, (_, index) => `<button data-list-page="${index + 1}" class="${listingPage === index + 1 ? "sel" : ""}">${index + 1}</button>`).join("")}<button data-list-page="${Math.min(pageCount, listingPage + 1)}" aria-label="Next page">›</button>`;
}
function renderFeatures() {
  const panels = $$(".right-stack .feature-panel");
  const sets = [entries.restaurants, entries.stays];
  panels.forEach((panel, idx) => {
    const items = sets[idx].slice(0, 2),
      type = idx ? "Airbnb" : "Restaurant";
    const allButton = $(".panel-head .small-link", panel);
    if (allButton) allButton.dataset.featureAll = type;
    const body = items.length
      ? items
          .map(
            (item) =>
              `<article class="feature"><img src="${esc(itemImage(item, type))}" alt="${esc(itemName(item))}"><div class="feature-info"><div class="feature-name">${esc(itemName(item))}</div><div class="feature-loc">📍 ${esc(itemAddress(item))}</div><div class="feature-rating"><span class="stars">★★★★★</span> ${esc(itemRating(item))}</div>${idx ? `<div class="feature-price">${field(item, ["price", "nightlyPrice", "pricePerNight"], "") ? `<b>₱${esc(field(item, ["price", "nightlyPrice", "pricePerNight"]))}</b> / night` : "Nightly price not set"}</div>` : ""}<div class="feature-actions"><button class="mini-btn" data-edit="${type}:${esc(item.id)}">Edit</button><button class="mini-btn outline" data-view="${esc(type)}:${esc(item.id)}">View</button></div></div></article>`,
          )
          .join("")
      : '<div class="empty-state">No featured listings in the database yet.</div>';
    const existing = $$(".feature", panel);
    existing.forEach((node) => node.remove());
    const empty = $(".empty-state", panel);
    if (empty) empty.remove();
    panel.insertAdjacentHTML("beforeend", body);
  });
}
function renderComments() {
  const panel = $("#comments");
  $$(".comment", panel).forEach((node) => node.remove());
  $$(".empty-state", panel).forEach((node) => node.remove());
  const items = entries.comments.slice(-3).reverse();
  const html = items.length
    ? items
        .map((item) => {
          const hidden = String(item.status || "").toLowerCase() === "hidden";
          return `<article class="comment"><img src="${esc(safeUrl(field(item, ["photoURL", "photoUrl", "avatar"], "")) || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=faces")}" alt=""><div class="comment-body"><div class="comment-name">${esc(field(item, ["userName", "username", "name", "author"], "Guest"))}<span class="comment-place">on ${esc(field(item, ["listingName", "businessName", "placeName"], "a listing"))}</span></div><div class="comment-stars">${"★".repeat(Math.max(0, Math.min(5, Math.round(Number(item.rating) || 0))))}<span style="color:#829087"> ${esc(item.rating ?? "")}</span></div><div class="comment-review">“${esc(field(item, ["comment", "review", "text", "message"], "No review text"))}”</div></div><button class="mini-btn" data-toggle-comment="${esc(item.id)}" data-next-status="${hidden ? "visible" : "hidden"}">${hidden ? "Restore" : "Hide"}</button></article>`;
        })
        .join("")
    : '<div class="empty-state">No comments found in the configured database path.</div>';
  panel.insertAdjacentHTML("beforeend", html);
}
function renderUsers() {
  const rows = $("#userRows");
  if (!rows) return;
  rows.innerHTML = entries.users.length
    ? entries.users
        .map(
          (user) =>
            `<tr><td>${esc(field(user, ["displayName", "name", "username"], "App user"))}</td><td>${esc(field(user, ["email", "emailAddress"], "—"))}</td><td>${esc(field(user, ["role", "userType"], "Member"))}</td><td>${esc(field(user, ["status", "accountStatus"], "Active"))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4"><div class="empty-state">No user profiles found at /users.</div></td></tr>';
}
function renderReports() {
  const panel = $("#reports");
  $$(".report", panel).forEach((node) => node.remove());
  $$(".empty-state", panel).forEach((node) => node.remove());
  const unresolved = entries.reports.filter(
    (item) =>
      !["resolved", "closed", "complete"].includes(
        String(item.status || "").toLowerCase(),
      ),
  ).length;
  const navBadge = $("#reportNavCount");
  navBadge.textContent = String(unresolved);
  navBadge.hidden = unresolved === 0;
  const badge = $(".panel-title span", panel);
  if (badge) badge.textContent = `${unresolved} open`;
  const items = entries.reports.slice(-3).reverse();
  const html = items.length
    ? items
        .map((item) => {
          const kind = field(item, ["type", "category", "reason"], "Report"),
            lower = String(kind).toLowerCase(),
            cls = lower.includes("closed")
              ? "red"
              : lower.includes("location")
                ? "amber"
                : "",
            resolved = ["resolved", "closed", "complete"].includes(
              String(item.status || "").toLowerCase(),
            );
          return `<article class="report"><span class="report-badge ${cls}">${esc(kind)}</span><div class="report-body"><div class="report-name">${esc(field(item, ["title", "reason", "type"], "Listing report"))}</div><div class="report-meta">${esc(field(item, ["listingName", "businessName", "placeName"], "Listing"))} · ${esc(field(item, ["location", "city", "address"], "Location not specified"))} · ${dateLabel(item.createdAt || item.timestamp)}</div></div><button class="mini-btn" data-resolve-report="${esc(item.id)}" ${resolved ? "disabled" : ""}>${resolved ? "Resolved" : "Resolve"}</button></article>`;
        })
        .join("")
    : '<div class="empty-state">No reports found in the configured database path.</div>';
  panel.insertAdjacentHTML("beforeend", html);
}
function itemCoordinates(item) {
  const read = (paths) => {
    for (const path of paths) {
      const value = path.split(".").reduce((part, key) => part?.[key], item);
      if (value === undefined || value === null || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return NaN;
  };
  const lat = read([
      "latitude",
      "lat",
      "coordinates.latitude",
      "coordinates.lat",
      "location.latitude",
      "location.lat",
      "geo.latitude",
      "position.latitude",
    ]),
    lng = read([
      "longitude",
      "lng",
      "lon",
      "long",
      "coordinates.longitude",
      "coordinates.lng",
      "location.longitude",
      "location.lng",
      "location.long",
      "geo.longitude",
      "position.longitude",
    ]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isInPhilippines(lat, lng)) return null;
  return { lat, lng };
}
function isInPhilippines(lat, lng) {
  return lat >= 4.3 && lat <= 21.5 && lng >= 116 && lng <= 127.5;
}
function formatCoordinate(value, axis) {
  const direction =
    axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(6)}° ${direction}`;
}
function updateCoordinateReadout(lat, lng) {
  $("#readLat").textContent = formatCoordinate(lat, "lat");
  $("#readLng").textContent = formatCoordinate(lng, "lng");
}
function renderPins() {
  listingMarkers.clearLayers();
  const all = [
    ...entries.restaurants.map((item) => ({ ...item, _type: "Restaurant" })),
    ...entries.stays.map((item) => ({ ...item, _type: "Airbnb" })),
  ];
  const positioned = [];
  all.forEach((item) => {
    const coordinates = itemCoordinates(item);
    if (!coordinates) return;
    const { lat, lng } = coordinates;
    const isAirbnb = item._type === "Airbnb";
    const iconSvg = isAirbnb
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 11 9-8 9 8v9H3zM8 20v-6h8v6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 11h-7c0-4 2-8 5-8v18"/></svg>';
    const icon = L.divIcon({
      className: "listing-map-marker-icon",
      html: `<span class="listing-map-marker ${isAirbnb ? "air" : ""}">${iconSvg}</span>`,
      iconSize: [27, 27], iconAnchor: [13, 27],
    });
    const marker = L.marker([lat, lng], { icon }).bindPopup(
      `<strong>${esc(itemName(item))}</strong><br>${esc(item._type)}<br>${esc(itemAddress(item))}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    );
    marker.on("click", () => {
      updateCoordinateReadout(lat, lng);
      $("#mapResult").textContent = `${itemName(item)} · ${item._type}`;
    });
    marker.addTo(listingMarkers);
    positioned.push([lat, lng]);
  });
  const withoutCoordinates = all.length - positioned.length;
  $("#mapResult").textContent = positioned.length
    ? `${positioned.length} mapped listing${positioned.length === 1 ? "" : "s"}${withoutCoordinates ? ` · ${withoutCoordinates} need coordinates` : ""}`
    : all.length
      ? `${all.length} listing${all.length === 1 ? "" : "s"} need valid Philippines coordinates`
      : "No listings in the database yet";

  if (positioned.length && !mapHasFittedListings) {
    clearTimeout(fitListingsTimer);
    fitListingsTimer = setTimeout(() => {
      if (!positioned.length || mapHasFittedListings) return;
      const bounds = L.latLngBounds(positioned);
      locationMap.fitBounds(bounds.pad(0.18), { maxZoom: 14 });
      mapHasFittedListings = true;
    }, 400);
  }
}
function renderAll() {
  renderStats();
  renderListings();
  renderFeatures();
  renderComments();
  renderReports();
  renderUsers();
  renderPins();
}
function friendlyError(error, path = "") {
  const code = error?.code || "";
  if (code.includes("permission-denied")) {
    return path
      ? "Database rules deny access to /" +
          path +
          ". Add this signed-in admin to your Realtime Database rules."
      : "Firebase rules denied this request. Check the relevant Realtime Database or Storage rules.";
  }
  if (code.includes("network"))
    return "Network error connecting to Firebase services. Check your connection.";
  return error?.message || "Firebase request failed.";
}
function watch(path, key) {
  const stop = onValue(
    ref(db, path),
    (snapshot) => {
      entries[key] = asItems(snapshot.val());
      renderAll();
      setStatus("Connected · live data", "connected");
    },
    (error) => {
      setStatus(`Access denied: /${path}`, "error");
      toast(friendlyError(error, path));
      console.error(`Realtime Database listener failed at /${path}`, error);
    },
  );
  listeners.push(stop);
}
function attachData() {
  stopListeners();
  setStatus("Loading live data…");
  watch(PATHS.restaurants, "restaurants");
  watch(PATHS.stays, "stays");
  watch(PATHS.comments, "comments");
  watch(PATHS.reports, "reports");
  watch(PATHS.users, "users");
}

const fallbackAdminPhoto =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&h=96&fit=crop&crop=faces";
let profilePreviewObjectUrl = null;

function applyAdminProfile(user) {
  const name = user.displayName || user.email?.split("@")[0] || "Admin";
  const info = $(".admin-label");
  if (info) {
    $("b", info).textContent = name;
    const role = $("span", info);
    if (role) role.textContent = "Firebase admin";
  }
  $("#welcomeAdminName").textContent = name;
  $(".avatar").src = safeUrl(user.photoURL) || fallbackAdminPhoto;
  $(".avatar").alt = name + " profile photo";
}

function openProfileEditor() {
  if (!auth.currentUser) {
    toast("Sign in before editing your profile");
    return;
  }
  const user = auth.currentUser;
  $("#profileName").value = user.displayName || user.email?.split("@")[0] || "";
  $("#profileEmail").value = user.email || "";
  $("#profilePhotoUrl").value = user.photoURL || "";
  $("#profilePhotoFile").value = "";
  $("#profilePreview").src = safeUrl(user.photoURL) || fallbackAdminPhoto;
  $("#profileError").textContent = "";
  $("#profileModal").hidden = false;
  $("#profileName").focus();
}

function closeProfileEditor() {
  $("#profileModal").hidden = true;
  if (profilePreviewObjectUrl) {
    URL.revokeObjectURL(profilePreviewObjectUrl);
    profilePreviewObjectUrl = null;
  }
}

$("#editProfile").addEventListener("click", openProfileEditor);
$("#closeProfile").addEventListener("click", closeProfileEditor);
$("#cancelProfile").addEventListener("click", closeProfileEditor);
$("#profileModal").addEventListener("click", (event) => {
  if (event.target === $("#profileModal")) closeProfileEditor();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#profileModal").hidden) {
    closeProfileEditor();
  }
});
$("#profilePhotoFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (profilePreviewObjectUrl) URL.revokeObjectURL(profilePreviewObjectUrl);
  profilePreviewObjectUrl = URL.createObjectURL(file);
  $("#profilePreview").src = profilePreviewObjectUrl;
});
$("#profilePhotoUrl").addEventListener("input", (event) => {
  const url = safeUrl(event.target.value.trim());
  if (url) $("#profilePreview").src = url;
});
$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = auth.currentUser;
  if (!user) {
    $("#profileError").textContent = "Sign in again to update your profile.";
    return;
  }
  const name = $("#profileName").value.trim();
  const photoUrl = $("#profilePhotoUrl").value.trim();
  const file = $("#profilePhotoFile").files[0];
  const button = $("#saveProfile");
  if (!name) {
    $("#profileError").textContent = "Enter a display name.";
    return;
  }
  if (photoUrl && !safeUrl(photoUrl)) {
    $("#profileError").textContent =
      "Photo URL must use a valid https:// or http:// address.";
    return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    $("#profileError").textContent = "Choose an image smaller than 5 MB.";
    return;
  }
  if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    $("#profileError").textContent = "Use a JPG, PNG, or WebP image.";
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  $("#profileError").textContent = "";
  try {
    await updateProfile(user, {
      displayName: name,
      ...(photoUrl ? { photoURL: photoUrl } : {}),
    });
    applyAdminProfile(user);

    if (file) {
      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const imageRef = storageRef(
          storage,
          "admin-profiles/" + user.uid + "/" + Date.now() + "-" + safeName,
        );
        await uploadBytes(imageRef, file, { contentType: file.type });
        const uploadedUrl = await getDownloadURL(imageRef);
        await updateProfile(user, { displayName: name, photoURL: uploadedUrl });
        applyAdminProfile(user);
      } catch (error) {
        applyAdminProfile(user);
        $("#profileError").textContent =
          "Name saved, but photo upload failed: " +
          friendlyError(error) +
          " Check Firebase Storage rules.";
        return;
      }
    }

    closeProfileEditor();
    toast("Profile updated");
  } catch (error) {
    $("#profileError").textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = "Save profile";
  }
});
let loginSubmitArmed = false;
const loginForm = $("#loginForm");
loginForm.addEventListener("click", (event) => {
  if (event.target.closest(".auth-submit")) loginSubmitArmed = true;
});
loginForm.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginSubmitArmed = true;
});
function resetLoginForm() {
  loginSubmitArmed = false;
  loginForm.reset();
  $("#loginError").textContent = "";
  const button = $(".auth-submit", loginForm);
  button.disabled = false;
  button.textContent = "Sign in to dashboard";
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginSubmitArmed) {
    resetLoginForm();
    return;
  }
  loginSubmitArmed = false;
  const button = $(".auth-submit", loginForm);
  button.disabled = true;
  button.textContent = "Signing in…";
  $("#loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(
      auth,
      $("#loginEmail").value.trim(),
      $("#loginPassword").value,
    );
  } catch (error) {
    $("#loginError").textContent =
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password"
        ? "Email or password is incorrect."
        : error.code === "auth/operation-not-allowed"
          ? "Email/password sign-in is not enabled in Firebase Authentication yet."
          : error.message;
    button.disabled = false;
    button.textContent = "Sign in to dashboard";
  }
});
onAuthStateChanged(auth, (user) => {
  if (user) {
    resetLoginForm();
    document.body.classList.remove("auth-open");
    document.documentElement.classList.remove("auth-open");
    gate.hidden = true;
    gate.style.display = "none";
    applyAdminProfile(user);
    let out = $(".auth-signout");
    if (!out) {
      out = document.createElement("button");
      out.className = "auth-signout";
      out.textContent = "Sign out";
      out.addEventListener("click", async () => {
        await signOut(auth);
        toast("Signed out");
      });
      $(".top-actions").append(out);
    }
    attachData();
  } else {
    resetLoginForm();
    document.body.classList.add("auth-open");
    document.documentElement.classList.add("auth-open");
    if (!$("#profileModal").hidden) closeProfileEditor();
    stopListeners();
    entries = {
      restaurants: [],
      stays: [],
      comments: [],
      reports: [],
      users: [],
    };
    renderAll();
    gate.hidden = false;
    gate.style.display = "grid";
    setStatus("Sign in required", "connecting");
  }
});

$("#nav").addEventListener("click", (event) => {
  const link = event.target.closest("[data-page]");
  if (!link) return;
  event.preventDefault();
  $$("#nav a").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
  $("#crumbPage").textContent = link.dataset.page;
  const page = link.dataset.page;
  if (page === "Dashboard") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (page === "Restaurants" || page === "Airbnb Listings") {
    listingFilter = page === "Restaurants" ? "Restaurant" : "Airbnb";
    listingPage = 1;
    renderListings();
    $(".table-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const target = {
    "Map Manager": "#mapPanel",
    Comments: "#comments",
    Reports: "#reports",
    Users: "#usersPanel",
    Settings: "#settingsPanel",
    Analytics: ".stats",
  }[page];
  if (target) $(target).scrollIntoView({ behavior: "smooth", block: "center" });
});
$$("[data-nav]").forEach((button) =>
  button.addEventListener("click", () => {
    const section = button.dataset.nav === "Reports" ? "#reports" : "#comments";
    $(section).scrollIntoView({ behavior: "smooth", block: "center" });
  }),
);
$("#mobileMenu").addEventListener("click", () =>
  $("#sidebar").classList.toggle("open"),
);
$("#logout").addEventListener("click", async (event) => {
  event.preventDefault();
  await signOut(auth);
});
document.addEventListener("click", async (event) => {
  if (!event.target.closest("#sidebar") && !event.target.closest("#mobileMenu"))
    $("#sidebar").classList.remove("open");
  const allListings = event.target.closest("[data-all-listings]");
  if (allListings) {
    listingFilter = "all";
    listingPage = 1;
    renderListings();
    $(".table-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const featureAll = event.target.closest("[data-feature-all]");
  if (featureAll) {
    listingFilter = featureAll.dataset.featureAll;
    listingPage = 1;
    renderListings();
    $(".table-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const pageButton = event.target.closest("[data-list-page]");
  if (pageButton) {
    listingPage = Number(pageButton.dataset.listPage) || 1;
    renderListings();
    return;
  }
  const approve = event.target.closest("[data-approve]");
  if (approve) {
    const [kind, id] = approve.dataset.approve.split(":", 2);
    const path = kind === "Airbnb" ? PATHS.stays : PATHS.restaurants;
    const item = (kind === "Airbnb" ? entries.stays : entries.restaurants).find(
      (record) => record.id === id,
    );
    if (!item || String(item.status || "").toLowerCase() !== "pending") return;
    approve.disabled = true;
    approve.textContent = "Approving…";
    try {
      await update(ref(db, `${path}/${id}`), {
        status: "active",
        approvedAt: Date.now(),
        approvedBy: auth.currentUser.uid,
      });
      toast(`${itemName(item)} approved and now active`);
    } catch (error) {
      toast(friendlyError(error));
      renderListings();
    }
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    const [kind, id] = edit.dataset.edit.split(":", 2),
      air = kind === "Airbnb",
      path = air ? PATHS.stays : PATHS.restaurants,
      item = (air ? entries.stays : entries.restaurants).find(
        (record) => record.id === id,
      );
    if (!item) return;
    const name = prompt("Listing name", itemName(item));
    if (name === null) return;
    const address = prompt("Address", itemAddress(item));
    if (address === null) return;
    const description = prompt(
      "Description",
      field(item, ["description", "details"], ""),
    );
    if (description === null) return;
    const nameKey =
        ["name", "title", "businessName", "listingName"].find(
          (key) => key in item,
        ) || "name",
      addressKey =
        ["address", "location"].find((key) => key in item) || "address",
      descriptionKey =
        ["description", "details"].find((key) => key in item) || "description";
    try {
      await update(ref(db, `${path}/${id}`), {
        [nameKey]: name,
        [addressKey]: address,
        [descriptionKey]: description,
      });
      toast(`${name} updated in Firebase`);
    } catch (error) {
      toast(friendlyError(error));
    }
    return;
  }
  const del = event.target.closest("[data-delete]");
  if (del) {
    const [kind, id] = del.dataset.delete.split(":", 2);
    const path = kind === "Airbnb" ? PATHS.stays : PATHS.restaurants;
    const item = (kind === "Airbnb" ? entries.stays : entries.restaurants).find(
      (record) => record.id === id,
    );
    if (
      !item ||
      !confirm(
        `Delete “${itemName(item)}” from Firebase? This cannot be undone.`,
      )
    )
      return;
    try {
      await remove(ref(db, `${path}/${id}`));
      toast(`${itemName(item)} deleted`);
    } catch (error) {
      toast(friendlyError(error));
    }
    return;
  }
  const view = event.target.closest("[data-view]");
  if (view) {
    const [kind, id] = view.dataset.view.split(":", 2);
    const item = (kind === "Airbnb" ? entries.stays : entries.restaurants).find(
      (record) => record.id === id,
    );
    if (item) toast(`${itemName(item)} · ${itemAddress(item)}`);
  }
  const resolve = event.target.closest("[data-resolve-report]");
  if (resolve) {
    try {
      await update(
        ref(db, `${PATHS.reports}/${resolve.dataset.resolveReport}`),
        {
          status: "resolved",
          resolvedAt: Date.now(),
          resolvedBy: auth.currentUser.uid,
        },
      );
      toast("Report marked as resolved");
    } catch (error) {
      toast(friendlyError(error));
    }
    return;
  }
  const toggleComment = event.target.closest("[data-toggle-comment]");
  if (toggleComment) {
    try {
      await update(
        ref(db, `${PATHS.comments}/${toggleComment.dataset.toggleComment}`),
        { status: toggleComment.dataset.nextStatus },
      );
      toast(
        `Comment ${toggleComment.dataset.nextStatus === "hidden" ? "hidden" : "restored"}`,
      );
    } catch (error) {
      toast(friendlyError(error));
    }
    return;
  }
});

$("#zoomIn").addEventListener("click", () => locationMap.zoomIn());
$("#zoomOut").addEventListener("click", () => locationMap.zoomOut());
$("#resetMap").addEventListener("click", () => {
  addressSearchMarkers.clearLayers();
  setMapView(philippinesCenter, defaultPhilippinesZoom);
  $("#mapSearch").value = "";
  $("#mapResult").textContent =
    `${entries.restaurants.length + entries.stays.length} listings loaded`;
});
$("#searchBtn").addEventListener("click", async () => {
  const query = $("#mapSearch").value.trim();
  if (!query) {
    toast("Search for a saved listing name or address");
    return;
  }
  addressSearchMarkers.clearLayers();
  const matches = [...entries.restaurants, ...entries.stays].filter((item) =>
    `${itemName(item)} ${itemAddress(item)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const located = matches
    .map((item) => ({ item, coordinates: itemCoordinates(item) }))
    .filter((match) => match.coordinates);
  if (!located.length && matches.length) {
    $("#mapResult").textContent =
      `${matches.length} matching listing${matches.length === 1 ? "" : "s"} need coordinates`;
    toast("This listing needs valid coordinates inside the Philippines.");
    return;
  }
  if (!located.length) {
    try {
      const results = await nominatimSearch(query, 5);
      if (!results.length) throw new Error("No matching Philippine address found.");
      addressMatches = results;
      const points = results.map((result) => [Number(result.lat), Number(result.lon)]);
      results.forEach((result) => L.marker([Number(result.lat), Number(result.lon)])
        .bindPopup(esc(result.display_name)).addTo(addressSearchMarkers));
      if (points.length === 1) setMapView(points[0], 15);
      else fitMapPoints(points, 15);
      updateCoordinateReadout(points[0][0], points[0][1]);
      $("#mapResult").textContent = `Showing ${results.length} OpenStreetMap address result${results.length === 1 ? "" : "s"} for “${query}”`;
    } catch (error) {
      $("#mapResult").textContent = `No saved listing or address match for “${query}”`;
      toast(error.message);
    }
    return;
  }
  const points = located.map(({ coordinates }) => [
    coordinates.lat,
    coordinates.lng,
  ]);
  if (points.length === 1) setMapView(points[0], 16);
  else fitMapPoints(points, 16);
  const first = located[0];
  updateCoordinateReadout(first.coordinates.lat, first.coordinates.lng);
  $("#mapResult").textContent =
    `${located.length} matching listing${located.length === 1 ? "" : "s"} centered on map`;
});
$("#mapSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#searchBtn").click();
  }
});
$("#useLocation").addEventListener("click", () => {
  if (!navigator.geolocation) {
    toast("Location is unavailable in this browser");
    return;
  }
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (!isInPhilippines(lat, lng)) {
        toast("This dashboard map is limited to the Philippines.");
        return;
      }
      $("#lat").value = lat.toFixed(6);
      $("#lng").value = lng.toFixed(6);
      updateCoordinateReadout(lat, lng);
      setMapView([lat, lng], 16);
      if (selectionMarker) selectionMarker.remove();
      selectionMarker = L.circleMarker([lat, lng], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#4f7edc", fillOpacity: 1,
      }).addTo(locationMap);
      $("#mapResult").textContent =
        "Current location · coordinates added to form";
      toast("Current coordinates added to the listing form");
    },
    () =>
      toast(
        "Location permission unavailable. Click the map or enter coordinates manually.",
      ),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
});
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
function nominatimSearch(address, limit = 5) {
  const request = nominatimQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const params = new URLSearchParams({
      q: address,
      format: "jsonv2",
      addressdetails: "1",
      countrycodes: "ph",
      limit: String(limit),
    });
    lastNominatimRequestAt = Date.now();
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!response.ok) throw new Error(`OpenStreetMap address search failed (${response.status}). Try again later.`);
    return (await response.json()).filter((result) =>
      isInPhilippines(Number(result.lat), Number(result.lon)),
    );
  });
  nominatimQueue = request.catch(() => {});
  return request;
}

async function locateListingAddress() {
  const address = $("#address").value.trim();
  const button = $("#locateAddress");
  const results = $("#addressResults");
  addressMatches = [];

  if (!address) {
    toast("Enter the listing address first.");
    $("#address").focus();
    return false;
  }
  button.disabled = true;
  button.textContent = "Locating…";
  results.replaceChildren();
  $("#addressStatus").textContent = "Searching Philippine addresses…";
  try {
    addressMatches = await nominatimSearch(address, 5);
    if (!addressMatches.length) {
      $("#addressStatus").textContent =
        "No Philippine match found. Add the city or province, or place the pin manually on the map.";
      toast("No matching location found in the Philippines.");
      return false;
    }
    addressMatches.forEach((feature, index) => {
      const result = document.createElement("button");
      result.type = "button";
      result.className = "address-result";
      result.dataset.addressMatch = String(index);
      result.textContent = feature.display_name || address;
      results.append(result);
    });
    $("#addressStatus").textContent =
      addressMatches.length === 1
        ? "Choose the matching result to set the pin and coordinates."
        : `${addressMatches.length} matching results · choose the correct location to set the pin.`;
    return true;
  } catch (error) {
    $("#addressStatus").textContent = error.message;
    toast(error.message);
    return false;
  } finally {
    button.disabled = false;
    button.textContent = "Locate address";
  }
}

$("#locateAddress").addEventListener("click", locateListingAddress);
$("#address").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    locateListingAddress();
  }
});
$("#address").addEventListener("input", () => {
  $("#addressResults").replaceChildren();
  if (coordinateSource === "geocoded" && $("#address").value.trim() !== resolvedAddress) {
    $("#lat").value = "";
    $("#lng").value = "";
    coordinateSource = "";
    resolvedAddress = "";
    if (selectionMarker) selectionMarker.remove();
    selectionMarker = null;
    $("#addressStatus").textContent = "Address changed. Locate it again to refresh the pin.";
  }
});
$("#addressResults").addEventListener("click", (event) => {
  const result = event.target.closest("[data-address-match]");
  if (!result) return;
  const feature = addressMatches[Number(result.dataset.addressMatch)];
  if (!feature) return;
  const lat = Number(feature.lat);
  const lng = Number(feature.lon);
  if (setListingLocation(lat, lng, "Address match selected · pin and coordinates updated", "geocoded")) {
    $("#addressResults").replaceChildren();
    toast("Address located. Verify the pin and coordinates before saving.");
  }
});

$("#cover").addEventListener("change", (event) => {
  $("#fileName").textContent =
    event.target.files[0]?.name || "JPG or PNG · Max 5 MB";
});
$("#listingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth.currentUser) {
    toast("Sign in before saving listings");
    return;
  }
  const form = event.currentTarget,
    button = $(".btn-primary", form),
    name = $("#name").value.trim(),
    type = $("#type").value,
    address = $("#address").value.trim(),
    latitude = Number($("#lat").value),
    longitude = Number($("#lng").value),
    isStay = type === "Airbnb",
    path = isStay ? PATHS.stays : PATHS.restaurants;
  if (!name || !address) return;
  if (!$("#lat").value.trim() && !$("#lng").value.trim()) {
    const located = await locateListingAddress();
    if (located && addressMatches.length)
      toast("Choose the correct address match, then save the listing again.");
    return;
  }
  if (
    !$("#lat").value.trim() ||
    !$("#lng").value.trim() ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !isInPhilippines(latitude, longitude)
  ) {
    toast(
      "Choose a listing point within the Philippines or enter valid coordinates.",
    );
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const newRef = push(ref(db, path));
    const record = {
      name,
      description: $("#description").value.trim(),
      address,
      contactNumber: $("#phone").value.trim(),
      latitude,
      longitude,
      type,
      status: "pending",
      createdAt: Date.now(),
      createdBy: auth.currentUser.uid,
    };
    const file = $("#cover").files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Image is larger than 5 MB. Choose a smaller image.");
      const objectRef = storageRef(
        storage,
        `listing-images/${newRef.key}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      );
      await uploadBytes(objectRef, file);
      record.imageUrl = await getDownloadURL(objectRef);
    }
    await set(newRef, record);
    form.reset();
    $("#fileName").textContent = "JPG or PNG · Max 5 MB";
    toast(`${name} saved to Firebase`);
  } catch (error) {
    toast(friendlyError(error));
    console.error("Listing save failed", error);
  } finally {
    button.disabled = false;
    button.innerHTML = "Save listing <span>→</span>";
  }
});
$("#listingForm").addEventListener("reset", () => {
  setTimeout(() => {
    addressMatches = [];
    coordinateSource = "";
    resolvedAddress = "";
    $("#addressResults").replaceChildren();
    $("#addressStatus").textContent =
      "Enter a Philippine address to place its map pin.";
    $("#fileName").textContent = "JPG or PNG · Max 5 MB";
    if (selectionMarker) selectionMarker.remove();
    selectionMarker = null;
    $("#mapResult").textContent = "Select a listing location on the map";
  }, 0);
});
$("#notificationBtn").addEventListener("click", () =>
  toast(`${entries.reports.length} reports need review`),
);
setStatus("Sign in required");
