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
  get,
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
let featuredRestaurantEditor = null;
let pendingListingDelete = null;
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
  trashPurgeTimer = null,
  loadedDataPaths = new Set(),
  entries = {
    restaurants: [],
    stays: [],
    resorts: [],
    hotels: [],
    touristSpots: [],
    trashListings: [],
    comments: [],
    reports: [],
    users: [],
    adminApplications: [],
  },
  listingFilter = "all",
  listingPage = 1;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let trashPurgeInFlight = false;
const LISTING_SOURCES = [
  { type: "Restaurant", key: "restaurants", path: PATHS.restaurants },
  { type: "Airbnb", key: "stays", path: PATHS.stays },
  { type: "Resort", key: "resorts", path: PATHS.resorts },
  { type: "Hotel", key: "hotels", path: PATHS.hotels },
  { type: "Tourist Spot", key: "touristSpots", path: PATHS.touristSpots },
];
function allListings() {
  return LISTING_SOURCES.flatMap(({ type, key }) =>
    entries[key].map((item) => ({ ...item, _type: type })),
  );
}
function listingSource(type) {
  return LISTING_SOURCES.find((source) => source.type === type) || LISTING_SOURCES[0];
}
function findListing(type, id) {
  const source = listingSource(type);
  return entries[source.key].find((item) => item.id === id);
}
const philippinesCenter = [12.8797, 121.774];
const defaultPhilippinesZoom = 6;
const locationMap = new maplibregl.Map({
  container: "mapCanvas",
  style: {
    version: 8,
    sources: {
      openstreetmap: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "openstreetmap",
        type: "raster",
        source: "openstreetmap",
      },
    ],
  },
  center: [philippinesCenter[1], philippinesCenter[0]],
  zoom: defaultPhilippinesZoom,
  minZoom: 5,
  maxZoom: 19,
  maxBounds: [
    [116, 4.3],
    [127.5, 21.5],
  ],
  attributionControl: true,
});
const listingMarkers = [];
const addressSearchMarkers = [];
function setMapView(point, zoom) {
  locationMap.easeTo({
    center: [point[1], point[0]],
    zoom,
    duration: 500,
  });
}
function fitMapPoints(points, maxZoom) {
  const bounds = new maplibregl.LngLatBounds();
  points.forEach(([lat, lng]) => bounds.extend([lng, lat]));
  locationMap.fitBounds(bounds, { maxZoom, padding: 48, duration: 500 });
}
function clearMapMarkers(markers) {
  markers.forEach((marker) => marker.remove());
  markers.length = 0;
}
function createMapMarker(point, popupHTML, options = {}) {
  const marker = new maplibregl.Marker(options)
    .setLngLat([point[1], point[0]])
    .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(popupHTML))
    .addTo(locationMap);
  return marker;
}
function createSelectionMarker(lat, lng) {
  const element = document.createElement("div");
  element.className = "map-selection-marker";
  return new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(locationMap);
}
let mapHasFittedListings = false;
let fitListingsTimer;
let selectionMarker = null;
let addressMatches = [];
let addressLookupTimer = null;
let addressLookupGeneration = 0;
let featuredAddressLookupTimer = null;
let featuredAddressLookupGeneration = 0;
let featuredAddressMatches = [];
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
  selectionMarker = createSelectionMarker(lat, lng);
  $("#mapResult").textContent = message;
  $("#addressStatus").textContent =
    source === "geocoded"
      ? "Pin placed from the selected address result. Check it on the map before saving."
      : "Map pin selected. Check the address and coordinates before saving.";
  return true;
}
locationMap.on("click", ({ lngLat }) => {
  setListingLocation(lngLat.lat, lngLat.lng, "Map point selected · coordinates added to form");
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
gate.innerHTML = `<div class="auth-layout">
  <section class="auth-brand-panel" aria-label="About Pasyal PH">
    <div class="auth-brand auth-brand-panel-brand">
      <div class="auth-mark"><img src="assets/pasyal-ph-logo.jpg" alt="Pasyal PH logo"></div>
      <div><b>Pasyal PH</b><small>ADMIN CONSOLE</small></div>
    </div>
    <div class="auth-system-copy">
      <span class="auth-kicker">DISCOVER THE PHILIPPINES</span>
      <h1>Every destination,<br>in one place.</h1>
      <p>Manage restaurants, stays, and local destinations from your Pasyal PH workspace.</p>
    </div>
    <div class="auth-brand-footer">LOCAL PLACES. MEANINGFUL JOURNEYS.</div>
  </section>
  <form class="auth-card" id="loginForm" autocomplete="off">
    <div class="auth-form-kicker">ADMIN PORTAL</div>
    <h2>Welcome back</h2>
    <p>Sign in to continue to your dashboard.</p>
    <label for="loginEmail">Email address</label>
    <input id="loginEmail" type="email" autocomplete="email" required placeholder="you@example.com">
    <label for="loginPassword">Password</label>
    <input id="loginPassword" type="password" autocomplete="new-password" required placeholder="Your password">
    <button class="auth-submit" type="submit">Sign in to dashboard</button>
    <div class="auth-error" id="loginError" role="alert"></div>
    <div class="auth-note">Use an existing Firebase Authentication account authorized for this dashboard.</div>
  </form>
</div>`;
document.body.append(gate);
document.body.classList.add("auth-open");
document.documentElement.classList.add("auth-open");
function stopListeners() {
  listeners.forEach((stop) => stop());
  listeners = [];
  if (trashPurgeTimer) clearInterval(trashPurgeTimer);
  trashPurgeTimer = null;
}
function asItems(raw) {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([id, value]) => ({
    ...(value && typeof value === "object" ? value : { value }),
    id,
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
    (type !== "Restaurant"
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

function renderBusinessAnalytics() {
  const owners = entries.users.filter((user) =>
    /owner/.test(String(field(user, ["role", "userType", "accountType"], "")).toLowerCase()),
  );
  const isPending = (item) =>
    ["pending", "review", "submitted"].includes(
      String(item.status || "").trim().toLowerCase(),
    );
  const isActive = (item) =>
    ["", "active", "approved", "published", "visible"].includes(
      String(item.status || "").trim().toLowerCase(),
    );
  const setCount = (id, count) => {
    const node = $(id);
    if (node) node.textContent = count.toLocaleString("en-PH");
  };
  const ownerActive = owners.filter(isActive).length;
  const ownerPending = owners.filter(isPending).length;
  const ownerInactive = owners.length - ownerActive - ownerPending;
  setCount("#analyticsOwnerTotal", owners.length);
  setCount("#analyticsOwnerActive", ownerActive);
  setCount("#analyticsOwnerPending", ownerPending);
  setCount("#analyticsOwnerInactive", ownerInactive);
  setCount("#ownerDonutTotal", owners.length);
  setCount("#ownerDonutActive", ownerActive);
  setCount("#ownerDonutPending", ownerPending);
  setCount("#ownerDonutInactive", ownerInactive);
  const ownerDonut = $("#ownerStatusDonut");
  if (ownerDonut) {
    const activeEnd = owners.length ? (ownerActive / owners.length) * 100 : 0;
    const pendingEnd = owners.length
      ? ((ownerActive + ownerPending) / owners.length) * 100
      : 0;
    ownerDonut.style.background = owners.length
      ? `conic-gradient(#38835d 0% ${activeEnd}%, #e6a63f ${activeEnd}% ${pendingEnd}%, #cbd3cc ${pendingEnd}% 100%)`
      : "conic-gradient(#e5eae6 0% 100%)";
  }

  const listings = allListings().map((item) => ({
    item,
    source: listingSource(item._type).key,
  }));
  const groupDefinitions = [
    { key: "Restaurants", label: "Restaurants", source: "restaurants" },
    { key: "Airbnb", label: "Airbnb stays", source: "stays" },
    { key: "Resorts", label: "Resorts", source: "resorts" },
    { key: "Hotels", label: "Hotels", source: "hotels" },
    { key: "Spots", label: "Tourist spots", source: "touristSpots" },
  ];
  const groups = Object.fromEntries(groupDefinitions.map((group) => [group.key, []]));
  for (const { item, source } of listings) {
    const group = groupDefinitions.find((candidate) => candidate.source === source);
    if (group) groups[group.key].push(item);
  }
  const chartRows = [];
  for (const { key, label } of groupDefinitions) {
    const items = groups[key];
    const active = items.filter(isActive).length;
    const pending = items.filter(isPending).length;
    const inactive = items.length - active - pending;
    setCount(`#analytics${key}Total`, items.length);
    setCount(`#analytics${key}Active`, active);
    setCount(`#analytics${key}Pending`, pending);
    const ratings = items
      .map((item) => Number(field(item, ["rating", "averageRating", "average_rating"], 0)))
      .filter((rating) => Number.isFinite(rating) && rating > 0 && rating <= 5);
    const ratingNode = $(`#analytics${key}Rating`);
    if (ratingNode)
      ratingNode.textContent = ratings.length
        ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1)
        : "—";
    const share = (count) => (items.length ? (count / items.length) * 100 : 0);
    chartRows.push(
      `<div class="listing-chart-row" aria-label="${label}: ${items.length} total, ${active} active, ${pending} pending, ${inactive} inactive"><span>${label}</span><div class="listing-chart-track"><span class="bar-active" style="width:${share(active)}%"></span><span class="bar-pending" style="width:${share(pending)}%"></span><span class="bar-inactive" style="width:${share(inactive)}%"></span></div><b>${items.length}</b></div>`,
    );
  }
  const chart = $("#listingStatusChart");
  if (chart) chart.innerHTML = chartRows.join("");

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const currentYear = Number(dateParts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(dateParts.find((part) => part.type === "month")?.value);
  const monthCursor = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(monthCursor);
    date.setUTCMonth(date.getUTCMonth() - (5 - index));
    return {
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("en-PH", { month: "short", timeZone: "UTC" }).format(date),
      count: 0,
    };
  });
  const monthCounts = new Map(months.map((month) => [month.key, month]));
  for (const { item } of listings) {
    const rawDate = field(item, ["createdAt", "timestamp", "submittedAt"], "");
    if (!rawDate) continue;
    const numericDate = Number(rawDate);
    const date = new Date(
      typeof rawDate === "number" || (String(rawDate).trim() && Number.isFinite(numericDate))
        ? numericDate < 1e12 ? numericDate * 1000 : numericDate
        : String(rawDate),
    );
    if (Number.isNaN(date.getTime())) continue;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(date);
    const key = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
    const month = monthCounts.get(key);
    if (month) month.count += 1;
  }
  const trendChart = $("#monthlyListingChart");
  if (trendChart) {
    const maxCount = Math.max(0, ...months.map((month) => month.count));
    trendChart.innerHTML = months
      .map((month) => {
        const height = month.count && maxCount ? Math.max(4, (month.count / maxCount) * 88) : 0;
        return `<div class="trend-month" aria-label="${month.label}: ${month.count} new listings"><b>${month.count}</b><i style="height:${height}px"></i><span>${month.label}</span></div>`;
      })
      .join("");
  }
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
    allListings()
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
  const all = allListings();
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
            `<tr><td><div class="listing-cell"><img src="${esc(itemImage(item, item._type))}" alt=""><span>${esc(itemName(item))}</span></div></td><td><span class="type-pill ${item._type === "Restaurant" ? "" : "air"}">${esc(item._type)}</span></td><td>${esc(itemAddress(item))}</td><td>${itemRating(item) === "—" ? "—" : `<span class="stars">★</span> ${esc(itemRating(item))}`}</td><td><span class="status-pill ${String(item.status || "active").toLowerCase() === "active" ? "active" : "pending"}">${esc(item.status || "Active")}</span></td><td>${dateLabel(item.createdAt || item.timestamp)}</td><td><div class="table-actions">${String(item.status || "active").toLowerCase() === "pending" ? `<button class="approve" data-approve="${esc(item._type)}:${esc(item.id)}">Approve</button>` : ""}<button data-edit="${esc(item._type)}:${esc(item.id)}">Edit</button><button class="delete" data-delete="${esc(item._type)}:${esc(item.id)}">Delete</button></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7"><div class="empty-state">No listings found in the configured database paths.</div></td></tr>';
  $("#rowCount").textContent =
    `Showing ${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} ${listingFilter === "all" ? "listings" : listingFilter}`;
  const pages = $("#listingPages");
  if (pages)
    pages.innerHTML = `<button data-list-page="${Math.max(1, listingPage - 1)}" aria-label="Previous page">‹</button>${Array.from({ length: pageCount }, (_, index) => `<button data-list-page="${index + 1}" class="${listingPage === index + 1 ? "sel" : ""}">${index + 1}</button>`).join("")}<button data-list-page="${Math.min(pageCount, listingPage + 1)}" aria-label="Next page">›</button>`;
}
function renderTrash() {
  const rows = $("#trashRows");
  if (!rows) return;
  const items = [...entries.trashListings].sort(
    (a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0),
  );
  const badge = $("#trashNavCount");
  if (badge) {
    badge.textContent = String(items.length);
    badge.hidden = items.length === 0;
  }
  rows.innerHTML = items.length
    ? items.map((item) => {
        const record = item.record || {};
        const deletedAt = Number(item.deletedAt) || 0;
        const daysLeft = deletedAt
          ? Math.max(0, Math.ceil((deletedAt + TRASH_RETENTION_MS - Date.now()) / 86400000))
          : 30;
        return `<tr><td><div class="listing-cell"><img src="${esc(itemImage(record, item.listingType || "Restaurant"))}" alt=""><span>${esc(itemName(record))}</span></div></td><td><span class="type-pill">${esc(item.listingType || "Listing")}</span></td><td>${esc(itemAddress(record))}</td><td>${dateLabel(item.deletedAt)}</td><td>${daysLeft}</td><td><div class="table-actions"><button data-restore-listing="${esc(item.id)}">Restore</button><button class="delete" data-permanent-delete="${esc(item.id)}">Delete forever</button></div></td></tr>`;
      }).join("")
    : '<tr><td colspan="6"><div class="empty-state">Trash is empty. Deleted listings will appear here for 30 days.</div></td></tr>';
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
function renderAdminApplications() {
  const rows = $("#adminApplicationRows");
  if (!rows) return;
  const items = [...entries.adminApplications].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
  );
  const pending = items.filter(
    (item) => String(item.status || "pending").toLowerCase() === "pending",
  ).length;
  const badge = $("#adminApplicationNavCount");
  if (badge) {
    badge.textContent = String(pending);
    badge.hidden = pending === 0;
  }
  rows.innerHTML = items.length
    ? items
        .map((item) => {
          const status = String(item.status || "pending").toLowerCase();
          return `<tr><td>${esc(field(item, ["name", "fullName"], "Applicant"))}</td><td>${esc(field(item, ["email"], "—"))}</td><td class="application-reason">${esc(field(item, ["reason", "message"], "—"))}</td><td>${dateLabel(item.createdAt)}</td><td><span class="status-pill ${status === "pending" ? "pending" : "active"}">${esc(status)}</span></td><td><button class="mini-btn" data-create-from-application="${esc(item.id)}" ${status !== "pending" ? "disabled" : ""}>Create admin</button></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6"><div class="empty-state">No admin applications have been submitted.</div></td></tr>';
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
  clearMapMarkers(listingMarkers);
  const all = allListings();
  const positioned = [];
  all.forEach((item) => {
    const coordinates = itemCoordinates(item);
    if (!coordinates) return;
    const { lat, lng } = coordinates;
    const isStay = item._type !== "Restaurant";
    const iconSvg = isStay
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 11 9-8 9 8v9H3zM8 20v-6h8v6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 11h-7c0-4 2-8 5-8v18"/></svg>';
    const element = document.createElement("div");
    element.className = "listing-map-marker-container";
    element.innerHTML = `<span class="listing-map-marker ${isStay ? "air" : ""}">${iconSvg}</span>`;
    const marker = createMapMarker(
      [lat, lng],
      `<strong>${esc(itemName(item))}</strong><br>${esc(item._type)}<br>${esc(itemAddress(item))}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      { element, anchor: "bottom" },
    );
    element.addEventListener("click", () => {
      updateCoordinateReadout(lat, lng);
      $("#mapResult").textContent = `${itemName(item)} · ${item._type}`;
    });
    listingMarkers.push(marker);
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
      fitMapPoints(positioned, 14);
      mapHasFittedListings = true;
    }, 400);
  }
}
function renderAll() {
  renderStats();
  renderBusinessAnalytics();
  renderListings();
  renderTrash();
  renderFeatures();
  renderComments();
  renderReports();
  renderUsers();
  renderAdminApplications();
  renderPins();
  purgeExpiredTrash();
}
function purgeExpiredTrash() {
  if (!auth.currentUser || trashPurgeInFlight) return;
  const now = Date.now();
  const expired = entries.trashListings.filter((item) => {
    const deletedAt = Number(item.deletedAt);
    return Number.isFinite(deletedAt) && deletedAt > 0 && now >= deletedAt + TRASH_RETENTION_MS;
  });
  if (!expired.length) return;
  const changes = Object.fromEntries(
    expired.map((item) => [`${PATHS.trashListings}/${item.id}`, null]),
  );
  trashPurgeInFlight = true;
  update(ref(db), changes)
    .catch((error) => console.error("Could not permanently delete expired trash listings", error))
    .finally(() => {
      trashPurgeInFlight = false;
    });
}
function friendlyError(error, path = "") {
  const code = error?.code || "";
  if (code.includes("storage/unauthorized") || code.includes("storage/unauthenticated"))
    return "Firebase Storage rejected the image upload. Check Storage rules for signed-in admins and the listing-images/ path.";
  if (code.includes("storage/canceled")) return "Image upload was canceled.";
  if (code.includes("permission-denied")) {
    return path
      ? `You are signed in, but Firebase Realtime Database rules block access to /${path}. Add this account's Firebase UID (${auth.currentUser?.uid || "unknown"}) to the authorized admin list in Firebase Console. A Vercel account does not grant Firebase access.`
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
      loadedDataPaths.add(key);
      entries[key] = asItems(snapshot.val());
      renderAll();
    },
    (error) => {
      toast(friendlyError(error, path));
      console.error(`Realtime Database listener failed at /${path}`, error);
    },
  );
  listeners.push(stop);
}
function attachData() {
  stopListeners();
  trashPurgeTimer = setInterval(purgeExpiredTrash, 60 * 60 * 1000);
  watch(PATHS.restaurants, "restaurants");
  watch(PATHS.stays, "stays");
  watch(PATHS.resorts, "resorts");
  watch(PATHS.hotels, "hotels");
  watch(PATHS.touristSpots, "touristSpots");
  watch(PATHS.trashListings, "trashListings");
  watch(PATHS.comments, "comments");
  watch(PATHS.reports, "reports");
  watch(PATHS.users, "users");
  watch(PATHS.adminApplications, "adminApplications");
}

const fallbackAdminPhoto =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&h=96&fit=crop&crop=faces";
let profilePreviewObjectUrl = null;
let profileSaveSlowTimer = null;

function applyAdminProfile(user) {
  const name = user.displayName || user.email?.split("@")[0] || "Admin";
  const info = $(".admin-label");
  if (info) {
    $("b", info).textContent = name;
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
  document.documentElement.classList.add("profile-open");
  document.body.classList.add("profile-open");
  $("#profileName").focus();
}

function closeProfileEditor() {
  $("#profileModal").hidden = true;
  document.documentElement.classList.remove("profile-open");
  document.body.classList.remove("profile-open");
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
  if (event.key === "Escape" && !$("#featuredRestaurantModal").hidden) {
    closeFeaturedRestaurantEditor();
  }
  if (event.key === "Escape" && !$("#logoutConfirmModal").hidden) {
    closeLogoutConfirmation();
  }
  if (event.key === "Escape" && !$("#listingDeleteModal").hidden) {
    closeListingDeleteConfirmation();
  }
  if (event.key === "Escape" && !$("#listingViewModal").hidden) {
    closeListingView();
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
  if (!file && name === (user.displayName || "") && photoUrl === (user.photoURL || "")) {
    closeProfileEditor();
    toast("No profile changes to save");
    return;
  }
  button.disabled = true;
  button.textContent = "Saving profile...";
  $("#profileError").textContent = "";
  clearTimeout(profileSaveSlowTimer);
  profileSaveSlowTimer = setTimeout(() => {
    if (!$("#profileModal").hidden) {
      button.textContent = "Still saving...";
      $("#profileError").textContent =
        "Firebase is taking longer than usual. Keep this window open while it finishes.";
    }
  }, 10000);
  try {
    await updateProfile(user, {
      displayName: name,
      ...(photoUrl ? { photoURL: photoUrl } : {}),
    });
    applyAdminProfile(user);

    if (file) {
      try {
        button.textContent = "Uploading photo...";
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
    clearTimeout(profileSaveSlowTimer);
    profileSaveSlowTimer = null;
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
  const email = $("#loginEmail").value.trim();
  try {
    await signInWithEmailAndPassword(
      auth,
      email,
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
    updateAdminCreateAccess(user);
    attachData();
  } else {
    $("#adminCreateSection").hidden = true;
    resetLoginForm();
    closeLogoutConfirmation();
    if (!$("#featuredRestaurantModal").hidden) closeFeaturedRestaurantEditor();
    if (!$("#listingViewModal").hidden) closeListingView();
    document.body.classList.add("auth-open");
    document.documentElement.classList.add("auth-open");
    if (!$("#profileModal").hidden) closeProfileEditor();
    stopListeners();
    entries = {
      restaurants: [],
      stays: [],
      resorts: [],
      hotels: [],
      touristSpots: [],
      trashListings: [],
      comments: [],
      reports: [],
      users: [],
      adminApplications: [],
    };
    loadedDataPaths.clear();
    renderAll();
    gate.hidden = false;
    gate.style.display = "grid";
  }
});

async function updateAdminCreateAccess(user) {
  const section = $("#adminCreateSection");
  if (!section) return;
  section.hidden = true;
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/admins", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const result = await response.json();
    section.hidden = result.canCreateAdmin !== true;
  } catch (error) {
    console.error("Could not check head-admin access:", error);
  }
}

$("#adminCreateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#createAdminButton");
  const errorNode = $("#adminCreateError");
  const user = auth.currentUser;
  errorNode.textContent = "";
  if (!user) {
    errorNode.textContent = "Sign in again before creating an account.";
    return;
  }

  button.disabled = true;
  button.textContent = "Creating account…";
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/admins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName: $("#newAdminName").value.trim(),
        email: $("#newAdminEmail").value.trim(),
        password: $("#newAdminPassword").value,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not create the account.");

    const applicationId = $("#newAdminApplicationId").value;
    if (applicationId) {
      try {
        await update(ref(db, `${PATHS.adminApplications}/${applicationId}`), {
          status: "approved",
          accountUid: result.uid,
          reviewedAt: Date.now(),
        });
      } catch (error) {
        toast("Account created, but its application status could not be updated.");
        console.error("Could not mark the admin application approved:", error);
      }
    }

    form.reset();
    toast(`Admin account created for ${result.email}. Share the temporary password securely.`);
  } catch (error) {
    errorNode.textContent = error.message || "Could not create the account.";
  } finally {
    button.disabled = false;
    button.textContent = "Create admin account";
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
    "Admin Applications": "#adminApplicationsPanel",
    Trash: "#trashPanel",
    Settings: "#settingsPanel",
    Analytics: "#businessAnalytics",
  }[page];
  if (target) {
    const targetNode = $(target);
    if (targetNode.hidden) targetNode.hidden = false;
    targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-create-from-application]");
  if (!button) return;
  const application = entries.adminApplications.find(
    (item) => item.id === button.dataset.createFromApplication,
  );
  if (!application) return;
  if ($("#adminCreateSection").hidden) {
    toast("Admin account creation is available only to the configured head admin.");
    return;
  }
  $("#newAdminName").value = field(application, ["name", "fullName"], "");
  $("#newAdminEmail").value = field(application, ["email"], "");
  $("#newAdminApplicationId").value = application.id;
  $("#adminCreateError").textContent = "";
  $("#nav [data-page='Settings']").click();
  $("#newAdminPassword").focus({ preventScroll: true });
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
function openLogoutConfirmation() {
  $("#logoutConfirmError").textContent = "";
  $("#logoutConfirmModal").hidden = false;
  document.documentElement.classList.add("profile-open");
  document.body.classList.add("profile-open");
  $("#cancelLogout").focus();
}
function closeLogoutConfirmation() {
  $("#logoutConfirmModal").hidden = true;
  if (
    $("#profileModal").hidden &&
    $("#featuredRestaurantModal").hidden &&
    $("#listingViewModal").hidden &&
    $("#listingDeleteModal").hidden
  ) {
    document.documentElement.classList.remove("profile-open");
    document.body.classList.remove("profile-open");
  }
}
function closeListingDeleteConfirmation() {
  $("#listingDeleteModal").hidden = true;
  pendingListingDelete = null;
  if (
    $("#profileModal").hidden &&
    $("#featuredRestaurantModal").hidden &&
    $("#listingViewModal").hidden &&
    $("#logoutConfirmModal").hidden
  ) {
    document.documentElement.classList.remove("profile-open");
    document.body.classList.remove("profile-open");
  }
}
$("#cancelListingDelete").addEventListener("click", closeListingDeleteConfirmation);
$("#listingDeleteModal").addEventListener("click", (event) => {
  if (event.target === $("#listingDeleteModal")) closeListingDeleteConfirmation();
});
$("#confirmListingDelete").addEventListener("click", async (event) => {
  const pending = pendingListingDelete;
  if (!pending) return;
  const button = event.currentTarget;
  button.disabled = true;
  $("#cancelListingDelete").disabled = true;
  $("#listingDeleteError").textContent = "";
  button.textContent = "Deleting...";
  try {
    if (pending.mode === "permanent") {
      await remove(ref(db, `${PATHS.trashListings}/${pending.id}`));
      closeListingDeleteConfirmation();
      toast(`${itemName(pending.item.record || {})} permanently deleted`);
    } else {
      const storedRecord = { ...pending.item };
      delete storedRecord.id;
      const trashRef = push(ref(db, PATHS.trashListings));
      const trashEntry = {
        originalId: pending.id,
        originalPath: pending.path,
        listingType: pending.kind,
        record: storedRecord,
        deletedAt: Date.now(),
        deletedBy: auth.currentUser.uid,
      };
      await update(ref(db), {
        [`${pending.path}/${pending.id}`]: null,
        [`${PATHS.trashListings}/${trashRef.key}`]: trashEntry,
      });
      closeListingDeleteConfirmation();
      toast(`${itemName(pending.item)} moved to Trash for 30 days`);
    }
  } catch (error) {
    $("#listingDeleteError").textContent = friendlyError(error, pending.mode === "permanent" ? PATHS.trashListings : pending.path);
  } finally {
    button.disabled = false;
    $("#cancelListingDelete").disabled = false;
    button.textContent = pending.mode === "permanent" ? "Delete permanently" : "Move to Trash";
  }
});
async function restoreListingFromTrash(trashId) {
  const trashed = entries.trashListings.find((item) => item.id === trashId);
  if (!trashed) return;
  const source = LISTING_SOURCES.find((item) => item.type === trashed.listingType);
  const originalId = String(trashed.originalId || "");
  const originalRecord = trashed.record;
  if (!source || !originalId || !originalRecord || typeof originalRecord !== "object") {
    toast("This trash entry is missing its original listing data and cannot be restored.");
    return;
  }
  try {
    const destination = ref(db, `${source.path}/${originalId}`);
    if ((await get(destination)).exists()) {
      toast("A listing with this ID already exists. Delete or edit it before restoring.");
      return;
    }
    await update(ref(db), {
      [`${source.path}/${originalId}`]: originalRecord,
      [`${PATHS.trashListings}/${trashId}`]: null,
    });
    toast(`${itemName(originalRecord)} restored`);
  } catch (error) {
    toast(friendlyError(error, PATHS.trashListings));
    console.error("Could not restore trashed listing", error);
  }
}
function normalizeListingImageUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  if (!/^https?:\/\//i.test(input))
    throw new Error("Enter a complete public HTTP or HTTPS image URL.");
  const url = safeUrl(input);
  if (!url) throw new Error("Enter a valid HTTP or HTTPS image URL.");
  return url;
}
function previewListingImage(inputSelector, imageSelector) {
  const input = $(inputSelector);
  const image = $(imageSelector);
  image.onerror = () => {
    image.hidden = true;
  };
  image.onload = () => {
    image.hidden = false;
  };
  try {
    const url = normalizeListingImageUrl(input.value);
    image.hidden = !url;
    if (url) image.src = url;
    else image.removeAttribute("src");
  } catch {
    image.hidden = true;
    image.removeAttribute("src");
  }
}
function validateListingImageFile(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 5 MB.");
  }
}
function previewListingImageFile(file, imageSelector) {
  const image = $(imageSelector);
  if (!file) return;
  const previewUrl = URL.createObjectURL(file);
  image.onload = () => {
    image.hidden = false;
    URL.revokeObjectURL(previewUrl);
  };
  image.onerror = () => {
    image.hidden = true;
    URL.revokeObjectURL(previewUrl);
  };
  image.src = previewUrl;
}
async function uploadListingImage(file) {
  validateListingImageFile(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const imageRef = storageRef(
    storage,
    `listing-images/${auth.currentUser.uid}/${Date.now()}-${safeName}`,
  );
  await uploadBytes(imageRef, file, { contentType: file.type });
  return getDownloadURL(imageRef);
}
function openListingView(item, kind) {
  $("#listingViewTitle").textContent = itemName(item);
  $("#listingViewType").textContent = kind;
  $("#listingViewImage").src = itemImage(item, kind);
  $("#listingViewImage").alt = `Cover image for ${itemName(item)}`;
  $("#listingViewStatus").textContent = field(item, ["status"], "Active");
  $("#listingViewAddress").textContent = itemAddress(item);
  $("#listingViewContact").textContent = field(
    item,
    ["contactNumber", "phone", "contact", "telephone"],
    "—",
  );
  $("#listingViewRating").textContent = itemRating(item);
  $("#listingViewDate").textContent = dateLabel(item.createdAt || item.timestamp);
  $("#listingViewDescription").textContent = field(
    item,
    ["description", "details"],
    "No description provided.",
  );
  $("#listingViewModal").hidden = false;
  document.documentElement.classList.add("profile-open");
  document.body.classList.add("profile-open");
  $("#closeListingView").focus();
}
function closeListingView() {
  $("#listingViewModal").hidden = true;
  if (
    $("#profileModal").hidden &&
    $("#featuredRestaurantModal").hidden &&
    $("#logoutConfirmModal").hidden
  ) {
    document.documentElement.classList.remove("profile-open");
    document.body.classList.remove("profile-open");
  }
}
$("#closeListingView").addEventListener("click", closeListingView);
$("#listingViewModal").addEventListener("click", (event) => {
  if (event.target === $("#listingViewModal")) closeListingView();
});
$("#logout").addEventListener("click", (event) => {
  event.preventDefault();
  openLogoutConfirmation();
});
$("#cancelLogout").addEventListener("click", closeLogoutConfirmation);
$("#logoutConfirmModal").addEventListener("click", (event) => {
  if (event.target === $("#logoutConfirmModal")) closeLogoutConfirmation();
});
let aiChatHistory = [];
function sanitizeAiContext(value, depth = 0) {
  if (depth > 8) return "[nested data omitted]";
  if (typeof value === "string") return value.length > 2500 ? value.slice(0, 2500) + "…" : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAiContext(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(?:password|secret|token|api.?key|credential|private.?key)/i.test(key))
        .map(([key, item]) => [key, sanitizeAiContext(item, depth + 1)]),
    );
  }
  return String(value ?? "");
}
function buildAiDashboardContext() {
  const source = {
    restaurants: entries.restaurants,
    airbnbListings: entries.stays,
    resorts: entries.resorts,
    hotels: entries.hotels,
    touristSpots: entries.touristSpots,
    trashListings: entries.trashListings,
    comments: entries.comments,
    reports: entries.reports,
    users: entries.users,
    adminApplications: entries.adminApplications,
  };
  return JSON.stringify({
    snapshotAt: new Date().toISOString(),
    loadedPaths: [...loadedDataPaths],
    notLoadedYet: Object.keys(source).filter((path) =>
      !loadedDataPaths.has(path === "airbnbListings" ? "stays" : path),
    ),
    records: sanitizeAiContext(source),
  });
}
function appendAiMessage(role, text, error = false) {
  const message = document.createElement("div");
  message.className = `ai-message ${role === "assistant" ? "ai-message-bot" : "ai-message-user"}${error ? " ai-message-error" : ""}`;
  message.textContent = text;
  $("#aiChatMessages").append(message);
  $("#aiChatMessages").scrollTop = $("#aiChatMessages").scrollHeight;
  return message;
}
$("#openAiChat").addEventListener("click", () => {
  const isOpening = $("#aiChatPanel").hidden;
  $("#aiChatPanel").hidden = !isOpening;
  $("#openAiChat").setAttribute("aria-expanded", String(isOpening));
  if (isOpening) $("#aiChatInput").focus();
});
$("#aiChatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#aiChatInput");
  const question = input.value.trim();
  if (!question) return;
  if (question.length > 1000) {
    appendAiMessage("assistant", "Please keep your question under 1,000 characters.", true);
    return;
  }
  if (!auth.currentUser) {
    appendAiMessage("assistant", "Sign in to use the Pasyal AI assistant.", true);
    return;
  }

  const sendButton = $("#sendAiMessage");
  const userMessage = { role: "user", content: question };
  appendAiMessage("user", question);
  input.value = "";
  input.disabled = true;
  sendButton.disabled = true;
  const typing = appendAiMessage("assistant", "Pasyal AI is thinking…");
  typing.classList.add("ai-typing");
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/help-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question,
        history: aiChatHistory.slice(-8),
        dashboardContext: buildAiDashboardContext(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The assistant could not reply. Please try again.");
    typing.remove();
    appendAiMessage("assistant", result.answer);
    aiChatHistory.push(userMessage, { role: "assistant", content: result.answer });
    aiChatHistory = aiChatHistory.slice(-8);
  } catch (error) {
    typing.remove();
    appendAiMessage("assistant", error.message || "Could not reach the AI assistant. Please try again.", true);
  } finally {
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
});
$("#confirmLogout").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Signing out…";
  $("#cancelLogout").disabled = true;
  $("#logoutConfirmError").textContent = "";
  try {
    await signOut(auth);
    closeLogoutConfirmation();
  } catch (error) {
    $("#logoutConfirmError").textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
    $("#cancelLogout").disabled = false;
  }
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
  const featuredEdit = event.target.closest("[data-feature-edit]");
  if (featuredEdit) {
    const card = featuredEdit.closest(".feature");
    const currentName = card?.querySelector(".feature-name")?.textContent.trim() || "";
    const normalizedName = currentName.toLocaleLowerCase();
    const item = entries.restaurants.find(
      (record) => String(itemName(record)).trim().toLocaleLowerCase() === normalizedName,
    );
    featuredRestaurantEditor = { card, item, path: PATHS.restaurants };
    $("#featuredRestaurantTitle").textContent = "Edit featured restaurant";
    $("#featuredRestaurantImageFile").value = "";
    $("#featuredRestaurantImageUrl").value = item
      ? safeUrl(field(item, ["imageUrl", "image", "photoUrl", "coverImage", "thumbnail"], ""))
      : safeUrl(card?.querySelector("img")?.src || "");
    $("#featuredRestaurantImagePreview").src = item
      ? itemImage(item, "Restaurant")
      : card?.querySelector("img")?.src || itemImage({}, "Restaurant");
    $("#featuredRestaurantName").value = currentName;
    const displayedAddress = card?.querySelector(".feature-loc")?.textContent.trim() || "";
    $("#featuredRestaurantAddress").value = item ? itemAddress(item) : displayedAddress.replace(/^[^ ]+\s/, "");
    $("#featuredRestaurantContact").value = item
      ? field(item, ["contactNumber", "phone", "contact", "telephone"], "")
      : "";
    const coordinates = item ? itemCoordinates(item) : null;
    $("#featuredRestaurantLatitude").value = coordinates?.lat ?? "";
    $("#featuredRestaurantLongitude").value = coordinates?.lng ?? "";
    $("#featuredRestaurantDescription").value = item ? field(item, ["description", "details"], "") : "";
    previewListingImage("#featuredRestaurantImageUrl", "#featuredRestaurantImagePreview");
    $("#featuredRestaurantError").textContent = "";
    $("#featuredRestaurantModal").hidden = false;
    document.documentElement.classList.add("profile-open");
    document.body.classList.add("profile-open");
    $("#featuredRestaurantName").focus();
    return;
  }
  const approve = event.target.closest("[data-approve]");
  if (approve) {
    const [kind, id] = approve.dataset.approve.split(":", 2);
    const path = listingSource(kind).path;
    const item = findListing(kind, id);
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
    const [kind, id] = edit.dataset.edit.split(":", 2);
    const path = listingSource(kind).path;
    const item = findListing(kind, id);
    if (!item) return;
    featuredRestaurantEditor = { card: null, item, path };
    $("#featuredRestaurantTitle").textContent = `Edit ${kind} listing`;
    $("#featuredRestaurantImageFile").value = "";
    $("#featuredRestaurantImageUrl").value = safeUrl(
      field(item, ["imageUrl", "image", "photoUrl", "coverImage", "thumbnail"], ""),
    );
    $("#featuredRestaurantImagePreview").src = itemImage(item, kind);
    $("#featuredRestaurantImagePreview").hidden = false;
    $("#featuredRestaurantName").value = itemName(item);
    $("#featuredRestaurantAddress").value = itemAddress(item);
    $("#featuredRestaurantContact").value = field(
      item,
      ["contactNumber", "phone", "contact", "telephone"],
      "",
    );
    const coordinates = itemCoordinates(item);
    $("#featuredRestaurantLatitude").value = coordinates?.lat ?? "";
    $("#featuredRestaurantLongitude").value = coordinates?.lng ?? "";
    $("#featuredRestaurantDescription").value = field(item, ["description", "details"], "");
    $("#featuredRestaurantError").textContent = "";
    $("#featuredRestaurantModal").hidden = false;
    document.documentElement.classList.add("profile-open");
    document.body.classList.add("profile-open");
    $("#featuredRestaurantName").focus();
    return;
  }
  const restore = event.target.closest("[data-restore-listing]");
  if (restore) {
    await restoreListingFromTrash(restore.dataset.restoreListing);
    return;
  }
  const permanentDelete = event.target.closest("[data-permanent-delete]");
  if (permanentDelete) {
    const item = entries.trashListings.find(
      (entry) => entry.id === permanentDelete.dataset.permanentDelete,
    );
    if (!item) return;
    pendingListingDelete = {
      mode: "permanent",
      id: item.id,
      item,
      path: PATHS.trashListings,
    };
    $("#listingDeleteTitle").textContent = "Delete this listing permanently?";
    $("#listingDeleteMessage").textContent =
      `“${itemName(item.record || {})}” will be permanently deleted and cannot be restored.`;
    $("#listingDeleteError").textContent = "";
    $("#confirmListingDelete").disabled = false;
    $("#cancelListingDelete").disabled = false;
    $("#confirmListingDelete").textContent = "Delete permanently";
    $("#listingDeleteModal").hidden = false;
    document.documentElement.classList.add("profile-open");
    document.body.classList.add("profile-open");
    $("#cancelListingDelete").focus();
    return;
  }
  const del = event.target.closest("[data-delete]");
  if (del) {
    const [kind, id] = del.dataset.delete.split(":", 2);
    const path = listingSource(kind).path;
    const item = findListing(kind, id);
    if (!item) return;
    pendingListingDelete = { mode: "trash", kind, id, path, item };
    $("#listingDeleteTitle").textContent = "Move this listing to Trash?";
    $("#listingDeleteMessage").textContent =
      `“${itemName(item)}” will move to Trash. You can restore it within 30 days; after that it will be permanently deleted.`;
    $("#listingDeleteError").textContent = "";
    $("#confirmListingDelete").disabled = false;
    $("#cancelListingDelete").disabled = false;
    $("#confirmListingDelete").textContent = "Move to Trash";
    $("#listingDeleteModal").hidden = false;
    document.documentElement.classList.add("profile-open");
    document.body.classList.add("profile-open");
    $("#cancelListingDelete").focus();
    return;
  }
  const view = event.target.closest("[data-view]");
  if (view) {
    const [kind, id] = view.dataset.view.split(":", 2);
    const item = findListing(kind, id);
    if (item) openListingView(item, kind);
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

function closeFeaturedRestaurantEditor() {
  $("#featuredRestaurantModal").hidden = true;
  $("#featuredRestaurantImageUrl").value = "";
  $("#featuredRestaurantImageFile").value = "";
  document.documentElement.classList.remove("profile-open");
  document.body.classList.remove("profile-open");
  featuredRestaurantEditor = null;
}
$("#closeFeaturedRestaurant").addEventListener("click", closeFeaturedRestaurantEditor);
$("#cancelFeaturedRestaurant").addEventListener("click", closeFeaturedRestaurantEditor);
$("#featuredRestaurantModal").addEventListener("click", (event) => {
  if (event.target === $("#featuredRestaurantModal")) closeFeaturedRestaurantEditor();
});
$("#featuredRestaurantImageUrl").addEventListener("input", () => {
  if ($("#featuredRestaurantImageUrl").value.trim()) $("#featuredRestaurantImageFile").value = "";
  previewListingImage("#featuredRestaurantImageUrl", "#featuredRestaurantImagePreview");
  $("#featuredRestaurantError").textContent = "";
});
$("#featuredRestaurantImageFile").addEventListener("change", (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    validateListingImageFile(file);
    $("#featuredRestaurantImageUrl").value = "";
    previewListingImageFile(file, "#featuredRestaurantImagePreview");
    $("#featuredRestaurantError").textContent = "";
  } catch (error) {
    event.currentTarget.value = "";
    $("#featuredRestaurantError").textContent = error.message;
  }
});
$("#featuredRestaurantForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editor = featuredRestaurantEditor;
  if (!editor) return;
  if (!auth.currentUser) {
    $("#featuredRestaurantError").textContent = "Sign in before saving restaurant changes.";
    return;
  }
  const name = $("#featuredRestaurantName").value.trim();
  const address = $("#featuredRestaurantAddress").value.trim();
  const contactNumber = $("#featuredRestaurantContact").value.trim();
  const latitudeText = $("#featuredRestaurantLatitude").value.trim();
  const longitudeText = $("#featuredRestaurantLongitude").value.trim();
  const latitude = latitudeText ? Number(latitudeText) : null;
  const longitude = longitudeText ? Number(longitudeText) : null;
  const description = $("#featuredRestaurantDescription").value.trim();
  const imageFile = $("#featuredRestaurantImageFile").files[0];
  let imageUrl;
  try {
    validateListingImageFile(imageFile);
    imageUrl = imageFile ? "" : normalizeListingImageUrl($("#featuredRestaurantImageUrl").value);
  } catch (error) {
    $("#featuredRestaurantError").textContent = error.message;
    return;
  }
  if (!name || !address) {
    $("#featuredRestaurantError").textContent = "Enter a listing name and address.";
    return;
  }
  if (Boolean(latitudeText) !== Boolean(longitudeText)) {
    $("#featuredRestaurantError").textContent = "Enter both coordinates, or leave both blank.";
    return;
  }
  if (
    latitudeText &&
    (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isInPhilippines(latitude, longitude))
  ) {
    $("#featuredRestaurantError").textContent = "Enter valid coordinates inside the Philippines.";
    return;
  }
  const button = $("#saveFeaturedRestaurant");
  button.disabled = true;
  button.textContent = "Saving changes...";
  $("#featuredRestaurantError").textContent = "";
  try {
    if (imageFile) {
      button.textContent = "Uploading image...";
      imageUrl = await uploadListingImage(imageFile);
    }
    const path = editor.path || PATHS.restaurants;
    const recordRef = editor.item
      ? ref(db, `${path}/${editor.item.id}`)
      : push(ref(db, path));
    if (editor.item) {
      const item = editor.item;
      const nameKey = ["name", "title", "businessName", "listingName"].find((key) => key in item) || "name";
      const addressKey = ["address", "location"].find((key) => key in item) || "address";
      const descriptionKey = ["description", "details"].find((key) => key in item) || "description";
      const contactKey = ["contactNumber", "phone", "contact", "telephone"].find((key) => key in item) || "contactNumber";
      const imageUpdates = Object.fromEntries(
        [...new Set(["imageUrl", ...["image", "photoUrl", "coverImage", "thumbnail"].filter((key) => key in item)])]
          .map((key) => [key, imageUrl || null]),
      );
      await update(recordRef, {
        [nameKey]: name,
        [addressKey]: address,
        [descriptionKey]: description,
        [contactKey]: contactNumber,
        ...imageUpdates,
        ...(latitudeText ? { latitude, longitude } : {}),
      });
    } else {
      await set(recordRef, {
        name,
        address,
        contactNumber,
        ...(imageUrl ? { imageUrl } : {}),
        description,
        type: "Restaurant",
        status: "active",
        createdAt: Date.now(),
        createdBy: auth.currentUser.uid,
        ...(latitudeText ? { latitude, longitude } : {}),
      });
    }
    if (editor.card) {
      editor.card.querySelector(".feature-name").textContent = name;
      editor.card.querySelector(".feature-loc").textContent = `📍 ${address}`;
      editor.card.querySelector("img").src =
        imageUrl || itemImage({}, "Restaurant");
    }
    closeFeaturedRestaurantEditor();
    toast(`${name} saved to Firebase`);
  } catch (error) {
    $("#featuredRestaurantError").textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = "Save changes";
  }
});

$("#zoomIn").addEventListener("click", () =>
  locationMap.zoomTo(locationMap.getZoom() + 1),
);
$("#zoomOut").addEventListener("click", () =>
  locationMap.zoomTo(locationMap.getZoom() - 1),
);
$("#resetMap").addEventListener("click", () => {
  clearMapMarkers(addressSearchMarkers);
  setMapView(philippinesCenter, defaultPhilippinesZoom);
  $("#mapSearch").value = "";
  $("#mapResult").textContent =
    `${allListings().length} listings loaded`;
});
$("#searchBtn").addEventListener("click", async () => {
  const query = $("#mapSearch").value.trim();
  if (!query) {
    toast("Search for a saved listing name or address");
    return;
  }
  clearMapMarkers(addressSearchMarkers);
  const matches = allListings().filter((item) =>
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
      const points = results.map((result) => [
        Number(result.lat),
        Number(result.lon),
      ]);
      results.forEach((result) => {
        addressSearchMarkers.push(
          createMapMarker(
            [Number(result.lat), Number(result.lon)],
            esc(result.display_name),
          ),
        );
      });
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
      selectionMarker = createSelectionMarker(lat, lng);
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

async function locateListingAddress(automatic = false, generation = ++addressLookupGeneration) {
  const address = $("#address").value.trim();
  const button = $("#locateAddress");
  const results = $("#addressResults");
  addressMatches = [];

  if (!address) {
    if (!automatic) {
      toast("Enter the listing address first.");
      $("#address").focus();
    }
    return false;
  }
  if (automatic && address.length < 4) return false;
  button.disabled = true;
  button.textContent = "Searching…";
  results.replaceChildren();
  $("#addressStatus").textContent = automatic
    ? "Finding matching Philippine addresses…"
    : "Searching Philippine addresses…";
  try {
    const matches = await nominatimSearch(address, 5);
    if (generation !== addressLookupGeneration || address !== $("#address").value.trim()) return false;
    addressMatches = matches;
    if (!matches.length) {
      $("#addressStatus").textContent =
        "No Philippine match found. Add the city or province, or place the pin manually on the map.";
      if (!automatic) toast("No matching location found in the Philippines.");
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
        ? "Choose the matching address to fill the accurate address and map pin."
        : `${addressMatches.length} suggestions · choose the correct address to fill the map pin.`;
    return true;
  } catch (error) {
    if (generation === addressLookupGeneration) {
      $("#addressStatus").textContent = automatic
        ? "Address suggestions are unavailable. You can still enter the address manually."
        : error.message;
      if (!automatic) toast(error.message);
    }
    return false;
  } finally {
    if (generation === addressLookupGeneration) {
      button.disabled = false;
      button.textContent = "Locate address";
    }
  }
}

$("#locateAddress").addEventListener("click", () => locateListingAddress());
$("#address").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    locateListingAddress();
  }
});
$("#address").addEventListener("input", () => {
  clearTimeout(addressLookupTimer);
  const generation = ++addressLookupGeneration;
  $("#locateAddress").disabled = false;
  $("#locateAddress").textContent = "Locate address";
  $("#addressResults").replaceChildren();
  if (coordinateSource === "geocoded" && $("#address").value.trim() !== resolvedAddress) {
    $("#lat").value = "";
    $("#lng").value = "";
    coordinateSource = "";
    resolvedAddress = "";
    if (selectionMarker) selectionMarker.remove();
    selectionMarker = null;
    $("#addressStatus").textContent = "Address changed. Choose an address suggestion to refresh its pin.";
  }
  const address = $("#address").value.trim();
  if (address.length >= 4) {
    $("#addressStatus").textContent = "Finding matching Philippine addresses…";
    addressLookupTimer = setTimeout(() => locateListingAddress(true, generation), 900);
  } else if (!address) {
    $("#addressStatus").textContent = "Map coordinates are optional; listings can be saved without a pin.";
  }
});
$("#addressResults").addEventListener("click", (event) => {
  const result = event.target.closest("[data-address-match]");
  if (!result) return;
  const feature = addressMatches[Number(result.dataset.addressMatch)];
  if (!feature) return;
  const lat = Number(feature.lat);
  const lng = Number(feature.lon);
  $("#address").value = feature.display_name || $("#address").value.trim();
  addressLookupGeneration++;
  clearTimeout(addressLookupTimer);
  if (setListingLocation(lat, lng, "Address match selected · pin and coordinates updated", "geocoded")) {
    $("#addressResults").replaceChildren();
    toast("Accurate address and map pin added. Verify before saving.");
  }
});
$("#featuredRestaurantAddress").addEventListener("input", () => {
  clearTimeout(featuredAddressLookupTimer);
  const generation = ++featuredAddressLookupGeneration;
  const address = $("#featuredRestaurantAddress").value.trim();
  const results = $("#featuredRestaurantAddressResults");
  featuredAddressMatches = [];
  results.replaceChildren();
  $("#featuredRestaurantLatitude").value = "";
  $("#featuredRestaurantLongitude").value = "";
  $("#featuredRestaurantAddressStatus").textContent = address
    ? "Finding matching Philippine addresses…"
    : "Type the address to get matching Philippine locations and coordinates.";
  if (address.length < 4) return;

  featuredAddressLookupTimer = setTimeout(async () => {
    try {
      const matches = await nominatimSearch(address, 5);
      if (
        generation !== featuredAddressLookupGeneration ||
        address !== $("#featuredRestaurantAddress").value.trim()
      ) return;
      featuredAddressMatches = matches;
      if (!matches.length) {
        $("#featuredRestaurantAddressStatus").textContent =
          "No match found. Add a city or province for a more accurate result.";
        return;
      }
      matches.forEach((feature, index) => {
        const result = document.createElement("button");
        result.type = "button";
        result.className = "address-result";
        result.dataset.featuredAddressMatch = String(index);
        result.textContent = feature.display_name || address;
        results.append(result);
      });
      $("#featuredRestaurantAddressStatus").textContent =
        "Choose the correct address to update its coordinates.";
    } catch {
      if (generation === featuredAddressLookupGeneration) {
        $("#featuredRestaurantAddressStatus").textContent =
          "Address suggestions are unavailable. You can still enter the address manually.";
      }
    }
  }, 900);
});
$("#featuredRestaurantAddressResults").addEventListener("click", (event) => {
  const result = event.target.closest("[data-featured-address-match]");
  if (!result) return;
  const feature = featuredAddressMatches[Number(result.dataset.featuredAddressMatch)];
  if (!feature) return;
  clearTimeout(featuredAddressLookupTimer);
  featuredAddressLookupGeneration++;
  $("#featuredRestaurantAddress").value = feature.display_name || $("#featuredRestaurantAddress").value.trim();
  $("#featuredRestaurantLatitude").value = Number(feature.lat).toFixed(6);
  $("#featuredRestaurantLongitude").value = Number(feature.lon).toFixed(6);
  featuredAddressMatches = [];
  $("#featuredRestaurantAddressResults").replaceChildren();
  $("#featuredRestaurantAddressStatus").textContent = "Address and coordinates filled from the selected map result.";
});

$("#imageUrl").addEventListener("input", () => {
  if ($("#imageUrl").value.trim()) $("#listingImageFile").value = "";
  previewListingImage("#imageUrl", "#coverPreview");
});
$("#listingImageFile").addEventListener("change", (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return;
  try {
    validateListingImageFile(file);
    $("#imageUrl").value = "";
    previewListingImageFile(file, "#coverPreview");
  } catch (error) {
    event.currentTarget.value = "";
    toast(error.message);
  }
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
    address = $("#address").value.trim();
  const source = LISTING_SOURCES.find((listing) => listing.type === type);
  if (!source) {
    toast("Choose a valid listing type.");
    return;
  }
  const path = source.path;
  if (!name || !address) {
    toast("Enter a listing name and address.");
    return;
  }
  const imageFile = $("#listingImageFile").files[0];
  let imageUrl;
  try {
    validateListingImageFile(imageFile);
    imageUrl = imageFile ? "" : normalizeListingImageUrl($("#imageUrl").value);
  } catch (error) {
    toast(error.message);
    return;
  }
  const latitudeText = $("#lat").value.trim();
  const longitudeText = $("#lng").value.trim();
  const hasCoordinates = Boolean(latitudeText && longitudeText);
  if (Boolean(latitudeText) !== Boolean(longitudeText)) {
    toast("Enter both latitude and longitude, or leave both blank.");
    return;
  }
  const latitude = latitudeText ? Number(latitudeText) : null;
  const longitude = longitudeText ? Number(longitudeText) : null;
  if (
    hasCoordinates &&
    (!Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !isInPhilippines(latitude, longitude))
  ) {
    toast(
      "Choose a listing point within the Philippines or enter valid coordinates.",
    );
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    if (imageFile) {
      button.textContent = "Uploading image...";
      imageUrl = await uploadListingImage(imageFile);
    }
    const newRef = push(ref(db, path));
    const record = {
      name,
      description: $("#description").value.trim(),
      address,
      contactNumber: $("#phone").value.trim(),
      ...(imageUrl ? { imageUrl } : {}),
      ...(hasCoordinates ? { latitude, longitude } : {}),
      type,
      status: "pending",
      createdAt: Date.now(),
      createdBy: auth.currentUser.uid,
    };
    await set(newRef, record);

    form.reset();
    toast(`${name} saved to Firebase`);
  } catch (error) {
    toast(friendlyError(error, path));
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
      "Map coordinates are optional; listings can be saved without a pin.";
    previewListingImage("#imageUrl", "#coverPreview");
    if (selectionMarker) selectionMarker.remove();
    selectionMarker = null;
    $("#mapResult").textContent = "Select a listing location on the map";
  }, 0);
});
$("#notificationBtn").addEventListener("click", () =>
  toast(`${entries.reports.length} reports need review`),
);
