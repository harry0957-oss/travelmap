let map;
let directionsService;
let directionsRenderer;
let mapReady = false;

const mapTileWaiters = new Set();
let mapTilesExpectingRefresh = false;
let lastTilesLoadedTime = 0;

const waypointClass = "waypoint-input";
const desiredIconSize = { width: 128, height: 64 };
const directionOrder = ["north", "east", "south", "west"];
const defaultVehicleIcons = createDefaultVehicleIcons();
const customVehicleIcons = {
  north: null,
  east: null,
  south: null,
  west: null,
};
const vehicleIconStorageKey = "travelmap.customVehicleIcons.v1";
const previousTripsStorageKey = "travelmap.previousTrips.v1";
const fuelSettingsStorageKey = "travelmap.fuelSettings.v1";

const defaultCurrencySymbol = "$";
const LITRES_PER_GALLON = 3.785411784;
const routeSummaryPlaceholderText =
  "Plot a route to see the distance, duration and estimated fuel usage for your journey.";

let previousTrips = [];
const maxStoredTrips = 10;

let currentRouteResult = null;
let currentRouteSegments = [];
let vehicleMarker = null;
let animationState = null;
let isRecordingInProgress = false;
let mapTypePreference = "roadmap";
let recordingOverlayElement = null;
let routeSummaryElement = null;
const animationControls = {
  enableCheckbox: null,
  previewButton: null,
  downloadButton: null,
  speedSelect: null,
};

const fuelSettings = {
  efficiencyMpg: null,
  pricePerLitre: null,
  currencySymbol: defaultCurrencySymbol,
};

const fuelInputs = {
  efficiency: null,
  price: null,
  currency: null,
};

const baseAnimationSpeed = 65;
let animationSpeedMultiplier = 1;

function isEditableElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;

  const editableSelector = "input, textarea, select, [contenteditable='true']";
  if (typeof element.closest === "function" && element.closest(editableSelector)) {
    return true;
  }

  const tagName = element.tagName;
  if (!tagName) return false;

  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName);
}

function setStatus(message, type = "info") {
  const statusEl = document.getElementById("routeStatus");
  if (!statusEl) return;
  statusEl.textContent = message ?? "";
  if (message) {
    statusEl.dataset.type = type;
  } else {
    delete statusEl.dataset.type;
  }
}

function markMapTilesForRefresh() {
  mapTilesExpectingRefresh = true;
}

function resolveMapTileWaiters() {
  const waiters = Array.from(mapTileWaiters);
  mapTileWaiters.clear();
  waiters.forEach((waiter) => {
    try {
      waiter();
    } catch (error) {
      console.error("Map tile waiter failed", error);
    }
  });
}

function handleMapTilesLoaded() {
  lastTilesLoadedTime = Date.now();
  mapTilesExpectingRefresh = false;
  resolveMapTileWaiters();
}

function waitForMapTiles({ timeoutMs = 4000, minDelayMs = 0 } = {}) {
  if (!mapReady || !map) {
    return Promise.resolve();
  }

  const start = Date.now();
  if (!mapTilesExpectingRefresh) {
    if (lastTilesLoadedTime === 0) {
      return Promise.resolve();
    }
    if (minDelayMs > 0) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, minDelayMs);
      });
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const waiter = () => {
      mapTileWaiters.delete(waiter);
      const elapsed = Date.now() - start;
      if (minDelayMs > 0 && elapsed < minDelayMs) {
        window.setTimeout(resolve, minDelayMs - elapsed);
      } else {
        resolve();
      }
    };

    mapTileWaiters.add(waiter);

    if (timeoutMs > 0) {
      window.setTimeout(() => {
        if (mapTileWaiters.has(waiter)) {
          waiter();
        }
      }, timeoutMs);
    }
  });
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return number;
}

function sanitiseCurrencySymbol(value) {
  if (typeof value !== "string") {
    return defaultCurrencySymbol;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultCurrencySymbol;
  }
  return trimmed.slice(0, 3);
}

function loadStoredFuelSettings() {
  if (!window?.localStorage) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(fuelSettingsStorageKey);
    if (!raw) {
      return;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return;
    }
    fuelSettings.efficiencyMpg = parsePositiveNumber(data.efficiencyMpg);
    const storedPricePerLitre = parsePositiveNumber(data.pricePerLitre);
    const storedPricePerGallon = parsePositiveNumber(data.pricePerGallon);
    let pricePerLitre = storedPricePerLitre;
    if (pricePerLitre === null && storedPricePerGallon !== null) {
      pricePerLitre = storedPricePerGallon / LITRES_PER_GALLON;
    }
    fuelSettings.pricePerLitre = pricePerLitre;
    const symbol = sanitiseCurrencySymbol(data.currencySymbol);
    fuelSettings.currencySymbol = symbol || defaultCurrencySymbol;
  } catch (error) {
    console.warn("Unable to load stored fuel settings", error);
  }
}

function persistFuelSettings() {
  if (!window?.localStorage) {
    return;
  }
  try {
    const payload = {
      efficiencyMpg: fuelSettings.efficiencyMpg,
      pricePerLitre: fuelSettings.pricePerLitre,
      currencySymbol: fuelSettings.currencySymbol,
    };
    window.localStorage.setItem(fuelSettingsStorageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Unable to store fuel settings", error);
  }
}

function applyFuelSettingsToInputs() {
  if (fuelInputs.efficiency) {
    fuelInputs.efficiency.value =
      fuelSettings.efficiencyMpg !== null && fuelSettings.efficiencyMpg !== undefined
        ? String(fuelSettings.efficiencyMpg)
        : "";
  }
  if (fuelInputs.price) {
    fuelInputs.price.value =
      fuelSettings.pricePerLitre !== null && fuelSettings.pricePerLitre !== undefined
        ? String(fuelSettings.pricePerLitre)
        : "";
  }
  if (fuelInputs.currency) {
    fuelInputs.currency.value = fuelSettings.currencySymbol ?? defaultCurrencySymbol;
  }
}

function formatDistanceValue(meters) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return null;
  }
  const miles = meters * 0.000621371;
  const kilometres = meters / 1000;
  const milesText = miles >= 100 ? miles.toFixed(0) : miles >= 10 ? miles.toFixed(1) : miles.toFixed(2);
  const kmText = kilometres >= 100 ? kilometres.toFixed(0) : kilometres >= 10 ? kilometres.toFixed(1) : kilometres.toFixed(2);
  return {
    meters,
    miles,
    kilometres,
    text: `${milesText} mi (${kmText} km)`,
  };
}

function formatDurationValue(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} hr${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min${minutes === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    parts.push(`${secs} sec${secs === 1 ? "" : "s"}`);
  } else if (hours === 0 && minutes < 5 && secs > 0) {
    parts.push(`${secs} sec${secs === 1 ? "" : "s"}`);
  }
  return {
    seconds: totalSeconds,
    text: parts.join(" "),
  };
}

function formatLitresValue(litres) {
  if (!Number.isFinite(litres) || litres <= 0) {
    return null;
  }
  const text = litres >= 100 ? litres.toFixed(0) : litres >= 10 ? litres.toFixed(1) : litres.toFixed(2);
  return `${text} L`;
}

function formatCurrencyValue(amount, symbol) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const trimmed = typeof symbol === "string" && symbol.trim() ? symbol.trim() : defaultCurrencySymbol;
  const separator = trimmed.length > 1 ? " " : "";
  return `${trimmed}${separator}${amount.toFixed(2)}`;
}

function computeRouteSummary(route) {
  if (!route) {
    return null;
  }
  const legs = route.legs ?? [];
  let totalMeters = 0;
  let totalSeconds = 0;
  legs.forEach((leg) => {
    totalMeters += leg?.distance?.value ?? 0;
    totalSeconds += leg?.duration?.value ?? 0;
  });

  const distance = formatDistanceValue(totalMeters);
  const duration = formatDurationValue(totalSeconds);

  const hasEfficiency = Number.isFinite(fuelSettings.efficiencyMpg) && fuelSettings.efficiencyMpg > 0;
  const hasPrice = Number.isFinite(fuelSettings.pricePerLitre) && fuelSettings.pricePerLitre > 0;

  let litres = null;
  if (hasEfficiency) {
    const miles = distance?.miles ?? totalMeters * 0.000621371;
    const gallons = miles / fuelSettings.efficiencyMpg;
    litres = gallons * LITRES_PER_GALLON;
  }
  if (litres !== null && (!Number.isFinite(litres) || litres <= 0)) {
    litres = null;
  }

  let cost = null;
  if (hasPrice && litres !== null) {
    cost = litres * fuelSettings.pricePerLitre;
  }
  if (cost !== null && (!Number.isFinite(cost) || cost <= 0)) {
    cost = null;
  }

  let note = null;
  if (!hasEfficiency) {
    note = "Add your vehicle's fuel efficiency to estimate fuel usage.";
  } else if (!hasPrice) {
    note = "Add a fuel price per litre to estimate trip cost.";
  }

  return {
    distance,
    duration,
    litres,
    cost,
    note,
  };
}

function renderRouteSummary(summary) {
  if (!routeSummaryElement) {
    routeSummaryElement = document.getElementById("routeSummary");
  }
  const container = routeSummaryElement;
  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!summary) {
    const placeholder = document.createElement("p");
    placeholder.className = "placeholder";
    placeholder.textContent = routeSummaryPlaceholderText;
    container.append(placeholder);
    return;
  }

  const list = document.createElement("dl");
  if (summary.distance?.text) {
    const dt = document.createElement("dt");
    dt.textContent = "Total distance";
    const dd = document.createElement("dd");
    dd.textContent = summary.distance.text;
    list.append(dt, dd);
  }
  if (summary.duration?.text) {
    const dt = document.createElement("dt");
    dt.textContent = "Estimated drive time";
    const dd = document.createElement("dd");
    dd.textContent = summary.duration.text;
    list.append(dt, dd);
  }

  const litresText = formatLitresValue(summary.litres);
  if (litresText) {
    const dt = document.createElement("dt");
    dt.textContent = "Fuel needed";
    const dd = document.createElement("dd");
    dd.textContent = litresText;
    list.append(dt, dd);
  }

  const costText = formatCurrencyValue(summary.cost, fuelSettings.currencySymbol);
  if (costText) {
    const dt = document.createElement("dt");
    dt.textContent = "Estimated fuel cost";
    const dd = document.createElement("dd");
    dd.textContent = costText;
    list.append(dt, dd);
  }

  if (list.children.length > 0) {
    container.append(list);
  }

  if (summary.note) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = summary.note;
    container.append(note);
  }

  if (container.children.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "placeholder";
    placeholder.textContent = routeSummaryPlaceholderText;
    container.append(placeholder);
  }
}

function refreshRouteSummary() {
  if (!routeSummaryElement) {
    routeSummaryElement = document.getElementById("routeSummary");
  }
  if (!routeSummaryElement) {
    return;
  }

  const route = currentRouteResult?.routes?.[0] ?? null;
  const summary = computeRouteSummary(route);
  renderRouteSummary(summary);
}

function handleFuelSettingsInputChange() {
  fuelSettings.efficiencyMpg = parsePositiveNumber(fuelInputs.efficiency?.value);
  fuelSettings.pricePerLitre = parsePositiveNumber(fuelInputs.price?.value);
  const symbol = sanitiseCurrencySymbol(fuelInputs.currency?.value ?? defaultCurrencySymbol);
  fuelSettings.currencySymbol = symbol || defaultCurrencySymbol;
  persistFuelSettings();
  refreshRouteSummary();
}

function initialiseFuelSettings() {
  fuelInputs.efficiency = document.getElementById("fuelEfficiencyInput");
  fuelInputs.price = document.getElementById("fuelPriceInput");
  fuelInputs.currency = document.getElementById("currencySymbolInput");
  routeSummaryElement = document.getElementById("routeSummary");

  loadStoredFuelSettings();
  applyFuelSettingsToInputs();
  refreshRouteSummary();

  [fuelInputs.efficiency, fuelInputs.price, fuelInputs.currency].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", handleFuelSettingsInputChange);
    input.addEventListener("change", handleFuelSettingsInputChange);
  });
}

function getBrowserBrandNames() {
  const brands = navigator?.userAgentData?.brands;
  if (Array.isArray(brands)) {
    return brands.map((entry) => entry?.brand?.toLowerCase?.() ?? "").filter(Boolean);
  }
  return [];
}

function isLikelyBackgroundThrottledBrowser() {
  const brandMatches = getBrowserBrandNames().some((brand) =>
    /(chrome|chromium|edge|opera|brave|vivaldi)/i.test(brand)
  );
  if (brandMatches) {
    return true;
  }
  const userAgent = navigator?.userAgent ?? "";
  if (!userAgent) {
    return false;
  }
  if (/Chrom(e|ium)|Edg|OPR|Brave|Vivaldi/i.test(userAgent) && !/Mobile Safari/i.test(userAgent)) {
    return true;
  }
  return false;
}

function ensureRecordingOverlay() {
  if (recordingOverlayElement?.isConnected) {
    return recordingOverlayElement;
  }
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    return null;
  }
  const computedStyle = window.getComputedStyle(mapElement);
  if (computedStyle.position === "static") {
    mapElement.dataset.recordingOverlayPosition = "relative";
    mapElement.style.position = "relative";
  }
  const overlay = document.createElement("div");
  overlay.id = "mapRecordingIndicator";
  overlay.setAttribute("role", "status");
  overlay.style.position = "absolute";
  overlay.style.top = "1rem";
  overlay.style.right = "1rem";
  overlay.style.zIndex = "2000";
  overlay.style.padding = "0.75rem 1rem";
  overlay.style.borderRadius = "0.5rem";
  overlay.style.background = "rgba(6, 20, 34, 0.85)";
  overlay.style.color = "#fff";
  overlay.style.fontWeight = "600";
  overlay.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.25)";
  overlay.style.maxWidth = "18rem";
  overlay.style.pointerEvents = "none";
  overlay.style.display = "none";
  overlay.style.textAlign = "left";
  overlay.style.lineHeight = "1.4";
  mapElement.appendChild(overlay);
  recordingOverlayElement = overlay;
  return overlay;
}

function showRecordingIndicator(message, tone = "info") {
  const overlay = ensureRecordingOverlay();
  if (!overlay) {
    return;
  }
  overlay.textContent = message;
  overlay.style.display = "block";
  overlay.dataset.tone = tone;
  overlay.style.background =
    tone === "warning" ? "rgba(239, 71, 111, 0.92)" : "rgba(6, 20, 34, 0.85)";
}

function hideRecordingIndicator() {
  if (!recordingOverlayElement) {
    return;
  }
  recordingOverlayElement.style.display = "none";
  recordingOverlayElement.textContent = "";
}

function getRecordingStatusDetails() {
  if (isLikelyBackgroundThrottledBrowser()) {
    return {
      message:
        "Recording in progress. Keep this tab visible while the video is captured to avoid an empty download.",
      type: "warning",
    };
  }
  return {
    message: "Recording animation…",
    type: "info",
  };
}

function createWaypointRow(value = "") {
  const row = document.createElement("div");
  row.className = "waypoint-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "e.g. Monterey, CA";
  input.value = value;
  input.classList.add(waypointClass);
  row.append(input);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-waypoint";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    row.remove();
    if (!document.querySelector(`.${waypointClass}`)) {
      addWaypointField();
    }
  });
  row.append(removeButton);

  return row;
}

function addWaypointField(value = "") {
  const container = document.getElementById("waypointsContainer");
  if (!container) return;
  const row = createWaypointRow(value);
  container.append(row);
  row.querySelector("input").focus();
}

function gatherWaypointValues() {
  return Array.from(document.querySelectorAll(`.${waypointClass}`))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function setWaypointValues(values = []) {
  const container = document.getElementById("waypointsContainer");
  if (!container) return;

  container.innerHTML = "";
  const entries = Array.isArray(values) && values.length ? values : [""];

  entries.forEach((value) => {
    const row = createWaypointRow(value);
    container.append(row);
  });
}

function formatTripLabel(trip) {
  const stops = Array.isArray(trip.waypoints) ? trip.waypoints.length : 0;
  const stopsPart = stops
    ? `${stops} stop${stops === 1 ? "" : "s"}`
    : "Direct";
  const tollsPart = trip.avoidTolls ? " • Avoid tolls" : "";
  return `${trip.start} → ${trip.end} (${stopsPart})${tollsPart}`;
}

function createTripKey(trip) {
  const waypoints = Array.isArray(trip.waypoints) ? trip.waypoints.join("|") : "";
  return [trip.start, trip.end, waypoints, trip.avoidTolls ? "1" : "0"].join("::");
}

function loadStoredPreviousTrips() {
  if (!window?.localStorage) {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(previousTripsStorageKey);
    if (!storedValue) {
      return [];
    }

    const parsed = JSON.parse(storedValue);
    const trips = parsed?.trips;
    if (!Array.isArray(trips)) {
      return [];
    }

    return trips
      .map((trip) => {
        const start = typeof trip.start === "string" ? trip.start.trim() : "";
        const end = typeof trip.end === "string" ? trip.end.trim() : "";
        if (!start || !end) {
          return null;
        }
        return {
          id:
            typeof trip.id === "string"
              ? trip.id
              : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          start,
          end,
          waypoints: Array.isArray(trip.waypoints)
            ? trip.waypoints.map((wp) => (typeof wp === "string" ? wp.trim() : "")).filter(Boolean)
            : [],
          avoidTolls: Boolean(trip.avoidTolls),
          savedAt: typeof trip.savedAt === "string" ? trip.savedAt : new Date().toISOString(),
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn("Unable to load previous trips", error);
    return [];
  }
}

function persistPreviousTrips() {
  if (!window?.localStorage) {
    return;
  }

  try {
    const serialisableTrips = previousTrips.map((trip) => ({
      id: trip.id,
      start: trip.start,
      end: trip.end,
      waypoints: trip.waypoints,
      avoidTolls: trip.avoidTolls,
      savedAt: trip.savedAt,
    }));
    window.localStorage.setItem(
      previousTripsStorageKey,
      JSON.stringify({ version: 1, trips: serialisableTrips })
    );
  } catch (error) {
    console.warn("Unable to persist previous trips", error);
  }
}

function populatePreviousTripsSelect() {
  const select = document.getElementById("previousTripsSelect");
  if (!select) {
    return;
  }

  const previousValue = select.value;
  select.innerHTML = "";

  if (!previousTrips.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No saved trips yet";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
  } else {
    previousTrips.forEach((trip) => {
      const option = document.createElement("option");
      option.value = trip.id;
      option.textContent = formatTripLabel(trip);
      select.append(option);
    });
    const hasPrevious = previousTrips.some((trip) => trip.id === previousValue);
    select.value = hasPrevious ? previousValue : previousTrips[0].id;
  }

  updatePreviousTripControls();
}

function getSelectedPreviousTripId() {
  const select = document.getElementById("previousTripsSelect");
  if (!select || select.disabled) {
    return null;
  }
  const value = select.value;
  return previousTrips.some((trip) => trip.id === value) ? value : null;
}

function getSelectedPreviousTrip() {
  const id = getSelectedPreviousTripId();
  if (!id) {
    return null;
  }
  return previousTrips.find((trip) => trip.id === id) ?? null;
}

function updatePreviousTripControls() {
  const select = document.getElementById("previousTripsSelect");
  const loadButton = document.getElementById("loadTripButton");
  const hasTrips = previousTrips.length > 0;

  if (select) {
    select.disabled = !hasTrips;
    if (!hasTrips) {
      select.value = "";
    }
  }

  if (loadButton) {
    loadButton.disabled = !getSelectedPreviousTrip();
  }
}

function recordPreviousTrip({ start, end, waypoints = [], avoidTolls = false }) {
  const trimmedStart = typeof start === "string" ? start.trim() : "";
  const trimmedEnd = typeof end === "string" ? end.trim() : "";
  if (!trimmedStart || !trimmedEnd) {
    return;
  }

  const cleanedWaypoints = Array.isArray(waypoints)
    ? waypoints.map((wp) => (typeof wp === "string" ? wp.trim() : "")).filter(Boolean)
    : [];

  const newTrip = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    start: trimmedStart,
    end: trimmedEnd,
    waypoints: cleanedWaypoints,
    avoidTolls: Boolean(avoidTolls),
    savedAt: new Date().toISOString(),
  };

  const newKey = createTripKey(newTrip);
  previousTrips = previousTrips.filter((trip) => createTripKey(trip) !== newKey);
  previousTrips.unshift(newTrip);

  if (previousTrips.length > maxStoredTrips) {
    previousTrips = previousTrips.slice(0, maxStoredTrips);
  }

  persistPreviousTrips();
  populatePreviousTripsSelect();
}

function applyTripToForm(trip) {
  const startInput = document.getElementById("startInput");
  const endInput = document.getElementById("endInput");
  const avoidTollsToggle = document.getElementById("avoidTollsToggle");

  if (startInput) {
    startInput.value = trip.start;
  }
  if (endInput) {
    endInput.value = trip.end;
  }
  if (avoidTollsToggle) {
    avoidTollsToggle.checked = Boolean(trip.avoidTolls);
  }

  setWaypointValues(trip.waypoints);
}

function loadSelectedPreviousTrip() {
  const trip = getSelectedPreviousTrip();
  if (!trip) {
    return false;
  }

  applyTripToForm(trip);
  plotRoute(trip.start, trip.end, trip.waypoints, { avoidTolls: trip.avoidTolls });
  return true;
}

function initialisePreviousTrips() {
  previousTrips = loadStoredPreviousTrips();
  populatePreviousTripsSelect();

  const select = document.getElementById("previousTripsSelect");
  const loadButton = document.getElementById("loadTripButton");

  select?.addEventListener("change", updatePreviousTripControls);
  select?.addEventListener("input", updatePreviousTripControls);

  loadButton?.addEventListener("click", () => {
    if (!loadSelectedPreviousTrip()) {
      setStatus("Select a saved trip to load.", "error");
    }
  });

  select?.addEventListener("dblclick", () => {
    void loadSelectedPreviousTrip();
  });
}

async function openRecorderPopup(routePayload) {
  const w = 1920;
  const h = 1080;
  const features = `popup=yes,resizable=no,scrollbars=no,width=${w},height=${h},left=50,top=50`;
  const win = window.open("", "map-recorder", features);
  if (!win) {
    setStatus("Pop-up blocked. Allow pop-ups to record.", "error");
    return null;
  }

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Map Recorder</title>
<style>
  html,body { margin:0; height:100%; background:#0b1020; color:#eaf1ff; font-family:system-ui,-apple-system,Segoe UI,Roboto; }
  #wrap { height:100%; display:grid; place-items:center; }
  #stage { width:1920px; height:1080px; background:#000; position:relative; }
  #map { position:absolute; inset:0; }
  #ui { position:absolute; inset:auto 16px 16px auto; z-index:10; }
  button { padding:10px 16px; border-radius:8px; border:none; cursor:pointer; }
</style>
</head>
<body>
  <div id="wrap">
    <div id="stage">
      <div id="map"></div>
      <div id="ui"><button id="startBtn">Start recording</button></div>
    </div>
  </div>
  <script>
    (function(){
      let payload = null;

      function determineDirection(heading) {
        if (typeof heading !== 'number' || Number.isNaN(heading)) return 'north';
        const normalized = ((heading % 360) + 360) % 360;
        if (normalized >= 45 && normalized < 135) return 'east';
        if (normalized >= 135 && normalized < 225) return 'south';
        if (normalized >= 225 && normalized < 315) return 'west';
        return 'north';
      }

      function getVehicleIcon(direction) {
        if (!payload) return null;
        const icons = payload.vehicleIcons || {};
        const size = payload.iconSize || { width: 128, height: 64 };
        const url = icons[direction] || icons.north;
        if (!url || !window.google || !google.maps) return null;
        const width = Number(size.width) || 128;
        const height = Number(size.height) || 64;
        return {
          url,
          size: new google.maps.Size(width, height),
          scaledSize: new google.maps.Size(width, height),
          anchor: new google.maps.Point(width / 2, height - 8)
        };
      }

      function applyMarkerIcon(marker, heading) {
        if (!marker) return;
        const direction = determineDirection(heading);
        const icon = getVehicleIcon(direction);
        if (icon) {
          marker.setIcon(icon);
        }
      }

      function applyFallbackIcon(marker) {
        if (!marker) return;
        const icon = getVehicleIcon('north');
        if (icon) {
          marker.setIcon(icon);
        }
      }

      function buildRouteSegments(path) {
        if (!Array.isArray(path)) return [];
        const segments = [];
        for (let index = 0; index < path.length - 1; index += 1) {
          const start = path[index];
          const end = path[index + 1];
          const length =
            google.maps.geometry?.spherical?.computeDistanceBetween
              ? google.maps.geometry.spherical.computeDistanceBetween(start, end)
              : 0;
          if (!length) continue;
          const heading =
            google.maps.geometry?.spherical?.computeHeading
              ? google.maps.geometry.spherical.computeHeading(start, end)
              : 0;
          segments.push({ start, end, length, heading });
        }
        return segments;
      }

      function interpolatePosition(start, end, fraction) {
        if (google.maps.geometry?.spherical?.interpolate) {
          return google.maps.geometry.spherical.interpolate(start, end, fraction);
        }
        const lat = start.lat() + (end.lat() - start.lat()) * fraction;
        const lng = start.lng() + (end.lng() - start.lng()) * fraction;
        return new google.maps.LatLng(lat, lng);
      }

      function centerMapOnPosition(map, position) {
        if (!map || !position) return;
        const currentCenter = typeof map.getCenter === 'function' ? map.getCenter() : null;
        let shouldCenter = true;
        if (currentCenter && google.maps.geometry?.spherical?.computeDistanceBetween) {
          const distance = google.maps.geometry.spherical.computeDistanceBetween(
            currentCenter,
            position
          );
          shouldCenter = distance > 1;
        }
        if (!shouldCenter) return;
        if (typeof map.setCenter === 'function') {
          map.setCenter(position);
        } else if (typeof map.panTo === 'function') {
          map.panTo(position);
        }
      }

      window.addEventListener('message', (ev) => {
        if (!ev || !ev.data || ev.data.type !== 'INIT') return;
        payload = ev.data.payload;
        // Enable the button when we have data
        document.getElementById('startBtn').disabled = false;
      });

      async function loadMaps(apiKey) {
        if (window.google && window.google.maps) return;
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&libraries=geometry';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      async function record() {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 60, displaySurface: "window" }, // user selects this popup
          audio: false
        });
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm');

        const chunks = [];
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(500);
        return { rec, chunks, stream, mimeType: mime };
      }

      async function run() {
        const btn = document.getElementById('startBtn');
        btn.disabled = true;

        // 1) Load Google Maps in popup
        try {
          await loadMaps(payload.apiKey);
        } catch {
          alert('Failed to load Google Maps in popup. Check API key.');
          btn.disabled = false;
          return;
        }

        // 2) Build map + route
        const map = new google.maps.Map(document.getElementById('map'), {
          center: { lat: 20, lng: 0 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        if (payload?.mapType) {
          try {
            map.setMapTypeId(payload.mapType);
          } catch (error) {
            console.warn('Unable to set map type for recorder popup', error);
          }
        }
        const svc = new google.maps.DirectionsService();
        const rdr = new google.maps.DirectionsRenderer({
          map, suppressMarkers: false,
          polylineOptions: { strokeColor: "#53a9ff", strokeWeight: 5 }
        });

        try {
          const res = await svc.route({
            origin: payload.start,
            destination: payload.end,
            waypoints: (payload.waypoints || []).map(v => ({ location: v, stopover: true })),
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING
          });
          rdr.setDirections(res);

          // Extract dense path
          const pts = [];
          (res.routes[0].legs||[]).forEach(leg =>
            (leg.steps||[]).forEach(step =>
              (step.path||[]).forEach(p => pts.push(p))
            )
          );
          if (!pts.length) throw new Error('No points to animate');
          const segments = buildRouteSegments(pts);
          if (!segments.length) throw new Error('No segments to animate');

          const marker = new google.maps.Marker({
            map,
            position: segments[0].start,
            optimized: false,
          });
          centerMapOnPosition(map, segments[0].start);

          if (segments.length > 0) {
            applyMarkerIcon(marker, segments[0].heading);
          } else {
            applyFallbackIcon(marker);
          }

          // 3) Start recording (user gesture came from the click in this popup)
          const { rec, chunks, stream, mimeType } = await record();

          const baseSpeed = Number(payload?.baseSpeed);
          const multiplier = Number(payload?.speedMultiplier);
          const animationSpeed =
            (Number.isFinite(baseSpeed) ? baseSpeed : 65) *
            (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);

          const animation = {
            frameId: null,
            lastTimestamp: null,
            segmentIndex: 0,
            distanceIntoSegment: 0,
            speed: animationSpeed,
            active: true,
          };

          function finishAnimation() {
            if (!animation.active) return;
            animation.active = false;
            if (animation.frameId) {
              cancelAnimationFrame(animation.frameId);
              animation.frameId = null;
            }
            try {
              rec.requestData?.();
            } catch (error) {
              console.warn('Unable to request final recorder data', error);
            }
            try {
              rec.stop();
            } catch (error) {
              console.warn('Unable to stop recorder cleanly', error);
            }
          }

          function step(timestamp) {
            if (!animation.active) return;
            if (animation.lastTimestamp === null) {
              animation.lastTimestamp = timestamp;
              animation.frameId = requestAnimationFrame(step);
              return;
            }

            const deltaSeconds = (timestamp - animation.lastTimestamp) / 1000;
            animation.lastTimestamp = timestamp;
            let distanceToTravel = deltaSeconds * animation.speed;

            while (distanceToTravel > 0 && animation.segmentIndex < segments.length) {
              const segment = segments[animation.segmentIndex];
              const remaining = segment.length - animation.distanceIntoSegment;
              if (distanceToTravel >= remaining) {
                distanceToTravel -= remaining;
                animation.segmentIndex += 1;
                animation.distanceIntoSegment = 0;
                if (animation.segmentIndex >= segments.length) {
                  marker.setPosition(segment.end);
                  centerMapOnPosition(map, segment.end);
                  finishAnimation();
                  return;
                }
                const nextSegment = segments[animation.segmentIndex];
                applyMarkerIcon(marker, nextSegment.heading);
              } else {
                animation.distanceIntoSegment += distanceToTravel;
                distanceToTravel = 0;
              }
            }

            if (animation.segmentIndex < segments.length) {
              const segment = segments[animation.segmentIndex];
              const fraction =
                segment.length === 0 ? 0 : animation.distanceIntoSegment / segment.length;
              const position = interpolatePosition(segment.start, segment.end, fraction);
              marker.setPosition(position);
              centerMapOnPosition(map, position);
              animation.frameId = requestAnimationFrame(step);
            }
          }

          animation.frameId = requestAnimationFrame(step);

          rec.onstop = () => {
            animation.active = false;
            if (animation.frameId) {
              cancelAnimationFrame(animation.frameId);
              animation.frameId = null;
            }
            stream.getTracks().forEach(t => t.stop());
            if (chunks.length) {
              const blob = new Blob(chunks, { type: mimeType });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'travelmap-animation-' + Date.now() + '.webm';
              document.body.appendChild(a); a.click();
              requestAnimationFrame(() => { URL.revokeObjectURL(url); a.remove(); });
            } else {
              alert('No animation data was recorded.');
            }
          };

        } catch (e) {
          console.error(e);
          alert('Failed to initialize route or recording.');
          btn.disabled = false;
        }
      }

      document.getElementById('startBtn').addEventListener('click', run);
      // Disable until we receive INIT payload
      document.getElementById('startBtn').disabled = true;
    })();
  </script>
</body>
</html>`);
  win.document.close();

  const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
  let apiKey = window.GMAPS_API_KEY || "YOUR_API_KEY";
  if (existingScript?.src) {
    try {
      const url = new URL(existingScript.src);
      apiKey = url.searchParams.get("key") || apiKey;
    } catch (error) {
      console.warn("Unable to parse Google Maps script URL", error);
    }
  }

  const vehicleIconsPayload = {};
  directionOrder.forEach((direction) => {
    const icon = customVehicleIcons[direction] ?? defaultVehicleIcons[direction];
    if (icon) {
      vehicleIconsPayload[direction] = icon;
    }
  });
  const iconSizePayload = {
    width: desiredIconSize.width,
    height: desiredIconSize.height,
  };

  win.postMessage(
    {
      type: "INIT",
      payload: {
        ...routePayload,
        apiKey,
        vehicleIcons: vehicleIconsPayload,
        iconSize: iconSizePayload,
        mapType: mapTypePreference,
        speedMultiplier: animationSpeedMultiplier,
        baseSpeed: baseAnimationSpeed,
      },
    },
    "*"
  );

  win.focus();
  return win;
}

function plotRoute(start, end, waypointValues, options = {}) {
  if (!mapReady) {
    setStatus("The map is still loading. Please try again shortly.", "info");
    return;
  }

  if (!start || !end) {
    setStatus("Start and end locations are required.", "error");
    return;
  }

  if (animationState) {
    finalizeAnimation({
      statusMessage: "Animation stopped while plotting a new route.",
      statusType: "info",
      shouldSaveRecording: false,
    });
  }

  const avoidTolls = options?.avoidTolls ?? false;

  const request = {
    origin: start,
    destination: end,
    travelMode: google.maps.TravelMode.DRIVING,
    waypoints: waypointValues.map((value) => ({ location: value, stopover: true })),
    optimizeWaypoints: false,
    provideRouteAlternatives: false,
    avoidTolls,
  };

  setStatus("Calculating route…", "info");

  directionsService
    .route(request)
    .then((result) => {
      markMapTilesForRefresh();
      directionsRenderer.setDirections(result);
      updateRouteSegments(result);
      recordPreviousTrip({ start, end, waypoints: waypointValues, avoidTolls });
      setStatus("Route updated successfully.", "success");
    })
    .catch((error) => {
      console.error("Directions request failed", error);
      let message = "Unable to calculate the route. Please check your inputs.";
      if (error?.message) {
        message += ` (${error.message})`;
      }
      setStatus(message, "error");
    });
}

function updateRouteSegments(result) {
  currentRouteResult = result;
  const route = result?.routes?.[0];
  if (!route) {
    currentRouteSegments = [];
    updateAnimationButtons();
    refreshRouteSummary();
    return;
  }

  const path = extractRoutePath(route);
  currentRouteSegments = buildRouteSegments(path);
  updateAnimationButtons();
  refreshRouteSummary();
}

function extractRoutePath(route) {
  const detailedPath = [];
  const legs = route?.legs ?? [];

  legs.forEach((leg) => {
    const steps = leg?.steps ?? [];
    steps.forEach((step) => {
      const stepPath = step?.path ?? [];
      stepPath.forEach((point) => {
        if (!point) return;
        const lastPoint = detailedPath[detailedPath.length - 1];
        if (!lastPoint || !areLatLngEqual(lastPoint, point)) {
          detailedPath.push(point);
        }
      });
    });
  });

  if (detailedPath.length > 1) {
    return detailedPath;
  }

  return route?.overview_path ?? [];
}

function initialiseForm() {
  const form = document.getElementById("routeForm");
  const addWaypointButton = document.getElementById("addWaypointButton");
  const waypointsContainer = document.getElementById("waypointsContainer");
  const avoidTollsToggle = document.getElementById("avoidTollsToggle");

  if (!form || !addWaypointButton || !waypointsContainer) return;

  if (!waypointsContainer.querySelector(`.${waypointClass}`)) {
    addWaypointField();
  }

  addWaypointButton.addEventListener("click", () => {
    addWaypointField();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = document.getElementById("startInput")?.value.trim() ?? "";
    const end = document.getElementById("endInput")?.value.trim() ?? "";
    const waypointValues = gatherWaypointValues();
    const avoidTolls = avoidTollsToggle?.checked ?? false;

    plotRoute(start, end, waypointValues, { avoidTolls });
  });
}

function initialiseVehicleIconUploads() {
  restoreStoredVehicleIcons();
  directionOrder.forEach((direction) => {
    updateVehicleIconPreview(direction);
  });

  const inputs = document.querySelectorAll('.icon-upload input[type="file"]');
  inputs.forEach((input) => {
    const direction = input.dataset.direction;
    if (!directionOrder.includes(direction)) return;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      handleVehicleIconUpload(direction, file);
      input.value = "";
    });
  });
}

function handleVehicleIconUpload(direction, file) {
  readImageFile(file)
    .then((image) => resizeVehicleImage(image))
    .then((dataUrl) => {
      customVehicleIcons[direction] = dataUrl;
      persistCustomVehicleIcons();
      updateVehicleIconPreview(direction);
      if (animationState?.currentDirection === direction && vehicleMarker) {
        updateVehicleMarkerIcon(direction, animationState.motionOffsets);
      }
      setStatus(`Updated ${direction} vehicle icon.`, "success");
    })
    .catch((error) => {
      console.error("Unable to process icon", error);
      setStatus("The selected icon could not be processed.", "error");
    });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (event) => reject(event);
      image.src = reader.result;
    };
    reader.onerror = (event) => reject(event);
    reader.readAsDataURL(file);
  });
}

function resizeVehicleImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = desiredIconSize.width;
  canvas.height = desiredIconSize.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable");
  }

  context.clearRect(0, 0, desiredIconSize.width, desiredIconSize.height);
  const scale = Math.min(
    1,
    desiredIconSize.width / image.width,
    desiredIconSize.height / image.height
  );
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (desiredIconSize.width - drawWidth) / 2;
  const offsetY = (desiredIconSize.height - drawHeight) / 2;
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  return canvas.toDataURL("image/png");
}

function updateVehicleIconPreview(direction) {
  const preview = document.querySelector(`img[data-preview="${direction}"]`);
  if (!preview) return;
  const icon = customVehicleIcons[direction] ?? defaultVehicleIcons[direction];
  preview.src = icon;
}

function persistCustomVehicleIcons() {
  if (!window?.localStorage) {
    return;
  }

  try {
    const iconsToStore = directionOrder.reduce((accumulator, direction) => {
      const icon = customVehicleIcons[direction];
      if (typeof icon === "string" && icon.startsWith("data:image")) {
        accumulator[direction] = icon;
      }
      return accumulator;
    }, {});

    if (Object.keys(iconsToStore).length) {
      window.localStorage.setItem(
        vehicleIconStorageKey,
        JSON.stringify({ version: 1, icons: iconsToStore })
      );
    } else {
      window.localStorage.removeItem(vehicleIconStorageKey);
    }
  } catch (error) {
    console.warn("Unable to persist custom vehicle icons", error);
  }
}

function restoreStoredVehicleIcons() {
  if (!window?.localStorage) {
    return;
  }

  try {
    const storedValue = window.localStorage.getItem(vehicleIconStorageKey);
    if (!storedValue) {
      return;
    }

    const parsed = JSON.parse(storedValue);
    const storedIcons = parsed?.icons ?? {};
    if (!storedIcons || typeof storedIcons !== "object") {
      return;
    }

    directionOrder.forEach((direction) => {
      const icon = storedIcons[direction];
      if (typeof icon === "string" && icon.startsWith("data:image")) {
        customVehicleIcons[direction] = icon;
      }
    });
  } catch (error) {
    console.warn("Unable to restore stored vehicle icons", error);
  }
}

function initialiseAnimationControls() {
  animationControls.enableCheckbox = document.getElementById("enableAnimation");
  animationControls.previewButton = document.getElementById("previewAnimationButton");
  animationControls.downloadButton = document.getElementById("downloadAnimationButton");
  animationControls.speedSelect = document.getElementById("animationSpeed");

  if (animationControls.speedSelect) {
    const selectedValue = Number(animationControls.speedSelect.value);
    animationSpeedMultiplier = Number.isFinite(selectedValue) && selectedValue > 0 ? selectedValue : 1;
    animationControls.speedSelect.addEventListener("change", () => {
      const newValue = Number(animationControls.speedSelect.value);
      animationSpeedMultiplier = Number.isFinite(newValue) && newValue > 0 ? newValue : 1;
      if (animationState) {
        animationState.speed = baseAnimationSpeed * animationSpeedMultiplier;
      }
    });
  }

  animationControls.enableCheckbox?.addEventListener("change", () => {
    if (!animationControls.enableCheckbox.checked) {
      if (animationState) {
        finalizeAnimation({
          statusMessage: "Animation disabled.",
          statusType: "info",
          shouldSaveRecording: false,
        });
      }
    }
    updateAnimationButtons();
  });

  animationControls.previewButton?.addEventListener("click", () => {
    if (!currentRouteSegments.length) {
      setStatus("Plot a route before previewing the animation.", "error");
      return;
    }
    if (animationState && !animationState.recording) {
      finalizeAnimation({
        statusMessage: "Preview stopped.",
        statusType: "info",
        shouldSaveRecording: false,
      });
      return;
    }
    startRouteAnimation({ record: false });
  });

  animationControls.downloadButton?.addEventListener("click", async () => {
    if (!currentRouteSegments.length) {
      setStatus("Plot a route before downloading the animation.", "error");
      return;
    }
    const payload = {
      start: document.getElementById("startInput")?.value.trim() ?? "",
      end: document.getElementById("endInput")?.value.trim() ?? "",
      waypoints: gatherWaypointValues(),
    };
    if (!payload.start || !payload.end) {
      setStatus("Start and end locations are required.", "error");
      return;
    }
    const win = await openRecorderPopup(payload);
    if (win) setStatus("Popup opened. Click 'Start recording' in the popup window.", "info");
  });

  updateAnimationButtons();
}

function initialiseKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const isSpacebar = event.code === "Space" || event.key === " ";
    if (!isSpacebar) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (isEditableElement(event.target)) return;
    if (!animationControls.enableCheckbox?.checked) return;
    if (!currentRouteSegments.length) return;
    if (animationState) return;

    event.preventDefault();
    startRouteAnimation({ record: false });
  });
}

function initialiseMapTypeControl() {
  const mapTypeSelect = document.getElementById("mapTypeSelect");
  if (!mapTypeSelect) return;
  mapTypeSelect.value = mapTypePreference;
  mapTypeSelect.addEventListener("change", () => {
    mapTypePreference = mapTypeSelect.value;
    if (mapReady && map) {
      markMapTilesForRefresh();
      map.setMapTypeId(mapTypePreference);
    }
  });
}

function updateAnimationButtons() {
  const enabled = animationControls.enableCheckbox?.checked ?? false;
  const hasRoute = currentRouteSegments.length > 0;
  const running = Boolean(animationState);
  const recording = isRecordingInProgress;

  if (animationControls.previewButton) {
    const runningPreview = running && !animationState?.recording;
    animationControls.previewButton.disabled = !enabled || !hasRoute || recording;
    animationControls.previewButton.textContent = runningPreview
      ? "Stop preview"
      : "Preview animation";
    animationControls.previewButton.setAttribute(
      "aria-pressed",
      runningPreview ? "true" : "false"
    );
  }

  if (animationControls.downloadButton) {
    animationControls.downloadButton.disabled =
      !enabled || !hasRoute || running || recording;
  }
}

async function startRouteAnimation({ record = false } = {}) {
  if (!mapReady) {
    setStatus("The map is not ready yet.", "error");
    return;
  }

  if (!animationControls.enableCheckbox?.checked) {
    setStatus("Enable animation to preview the route.", "info");
    return;
  }

  if (!currentRouteSegments.length) {
    setStatus("Plot a route before starting the animation.", "error");
    return;
  }

  let firstSegment = currentRouteSegments[0];
  if (!firstSegment) {
    setStatus("The calculated route is too short to animate.", "error");
    return;
  }

  if (animationState) {
    finalizeAnimation({ shouldSaveRecording: false });
  }

  setStatus(record ? "Preparing map for recording…" : "Preparing map for animation…", "info");
  await waitForMapTiles({ timeoutMs: 5000, minDelayMs: 300 });

  if (!animationControls.enableCheckbox?.checked) {
    setStatus("Animation is disabled.", "info");
    return;
  }

  if (!currentRouteSegments.length) {
    setStatus("Plot a route before starting the animation.", "error");
    return;
  }

  firstSegment = currentRouteSegments[0];
  if (!firstSegment) {
    setStatus("The calculated route is too short to animate.", "error");
    return;
  }

  const initialDirection = determineDirection(firstSegment.heading);
  vehicleMarker = new google.maps.Marker({
    map,
    position: firstSegment.start,
    icon: getVehicleIcon(initialDirection),
    optimized: false,
    zIndex: 1000,
  });
  centerMapOnPosition(firstSegment.start);

  const state = {
    segments: currentRouteSegments,
    segmentIndex: 0,
    distanceIntoSegment: 0,
    speed: baseAnimationSpeed * animationSpeedMultiplier,
    lastTimestamp: null,
    frameId: null,
    currentDirection: initialDirection,
    recording: null,
    motionElapsed: 0,
    motionOffsets: { bounce: 0, sway: 0 },
  };

  if (record) {
    const recording = await createAnimationRecorder();
    if (!recording) {
      if (vehicleMarker) {
        vehicleMarker.setMap(null);
        vehicleMarker = null;
      }
      setStatus(
        "Recording isn’t available (canvas capture failed and display capture was denied).",
        "error"
      );
      updateAnimationButtons();
      return;
    }
    state.recording = recording;
    isRecordingInProgress = true;
    try {
      const { message, type } = getRecordingStatusDetails();
      showRecordingIndicator(message, type);
    } catch (error) {
      console.error("Unable to start recording", error);
      isRecordingInProgress = false;
      state.recording = null;
      vehicleMarker.setMap(null);
      vehicleMarker = null;
      hideRecordingIndicator();
      recording.stream?.getTracks?.().forEach((track) => track.stop());
      setStatus("Recording could not be started.", "error");
      updateAnimationButtons();
      return;
    }
  }

  animationState = state;
  if (!record) {
    hideRecordingIndicator();
  }
  setStatus(record ? "Recording animation…" : "Animation started.", "info");
  updateAnimationButtons();

  const step = (timestamp) => {
    if (!animationState) return;

    if (animationState.lastTimestamp === null) {
      animationState.lastTimestamp = timestamp;
      animationState.frameId = requestAnimationFrame(step);
      return;
    }

    const deltaSeconds = (timestamp - animationState.lastTimestamp) / 1000;
    animationState.lastTimestamp = timestamp;
    animationState.motionElapsed += deltaSeconds;
    const bounce = Math.sin(animationState.motionElapsed * 1.5) * 2.5;
    const sway = Math.sin(animationState.motionElapsed * 1.1 + Math.PI / 6) * 1.8;
    animationState.motionOffsets = { bounce, sway };
    updateVehicleMarkerIcon(
      animationState.currentDirection,
      animationState.motionOffsets
    );
    let distanceToTravel = deltaSeconds * animationState.speed;

    while (distanceToTravel > 0 && animationState.segmentIndex < animationState.segments.length) {
      const segment = animationState.segments[animationState.segmentIndex];
      const remainingDistance = segment.length - animationState.distanceIntoSegment;
      if (distanceToTravel >= remainingDistance) {
        distanceToTravel -= remainingDistance;
        animationState.segmentIndex += 1;
        animationState.distanceIntoSegment = 0;
        if (animationState.segmentIndex >= animationState.segments.length) {
          vehicleMarker.setPosition(segment.end);
          centerMapOnPosition(segment.end);
          finalizeAnimation({ statusMessage: "Animation complete.", statusType: "success" });
          return;
        }
        const nextSegment = animationState.segments[animationState.segmentIndex];
        const nextDirection = determineDirection(nextSegment.heading);
        animationState.currentDirection = nextDirection;
        updateVehicleMarkerIcon(nextDirection, animationState.motionOffsets);
      } else {
        animationState.distanceIntoSegment += distanceToTravel;
        distanceToTravel = 0;
      }
    }

    if (animationState.segmentIndex < animationState.segments.length) {
      const segment = animationState.segments[animationState.segmentIndex];
      const fraction = segment.length === 0 ? 0 : animationState.distanceIntoSegment / segment.length;
      const position = interpolatePosition(segment.start, segment.end, fraction);
      vehicleMarker.setPosition(position);
      centerMapOnPosition(position);
      animationState.frameId = requestAnimationFrame(step);
    }
  };

  animationState.frameId = requestAnimationFrame(step);
}

function centerMapOnPosition(position) {
  if (!map || !position) return;
  const currentCenter = typeof map.getCenter === "function" ? map.getCenter() : null;
  let shouldCenter = true;
  if (currentCenter) {
    if (google.maps.geometry?.spherical?.computeDistanceBetween) {
      const distance = google.maps.geometry.spherical.computeDistanceBetween(
        currentCenter,
        position
      );
      shouldCenter = distance > 1; // ≈1 metre threshold to avoid redundant updates
    } else {
      shouldCenter = !areLatLngEqual(currentCenter, position);
    }
  }
  if (!shouldCenter) {
    return;
  }
  if (typeof map.setCenter === "function") {
    map.setCenter(position);
  } else if (typeof map.panTo === "function") {
    map.panTo(position);
  }
}

function buildRouteSegments(path) {
  if (!Array.isArray(path)) return [];
  const segments = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const length = google.maps.geometry?.spherical?.computeDistanceBetween
      ? google.maps.geometry.spherical.computeDistanceBetween(start, end)
      : 0;
    const heading = google.maps.geometry?.spherical?.computeHeading
      ? google.maps.geometry.spherical.computeHeading(start, end)
      : 0;
    if (length <= 0) continue;
    segments.push({ start, end, length, heading });
  }
  return segments;
}

function determineDirection(heading) {
  if (typeof heading !== "number" || Number.isNaN(heading)) return "north";
  const normalized = ((heading % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return "east";
  if (normalized >= 135 && normalized < 225) return "south";
  if (normalized >= 225 && normalized < 315) return "west";
  return "north";
}

function interpolatePosition(start, end, fraction) {
  if (google.maps.geometry?.spherical?.interpolate) {
    return google.maps.geometry.spherical.interpolate(start, end, fraction);
  }
  const lat = start.lat() + (end.lat() - start.lat()) * fraction;
  const lng = start.lng() + (end.lng() - start.lng()) * fraction;
  return new google.maps.LatLng(lat, lng);
}

function areLatLngEqual(a, b) {
  if (!a || !b) return false;
  if (typeof a.equals === "function") {
    return a.equals(b);
  }
  const latA = typeof a.lat === "function" ? a.lat() : a.lat;
  const lngA = typeof a.lng === "function" ? a.lng() : a.lng;
  const latB = typeof b.lat === "function" ? b.lat() : b.lat;
  const lngB = typeof b.lng === "function" ? b.lng() : b.lng;
  return Math.abs(latA - latB) < 1e-10 && Math.abs(lngA - lngB) < 1e-10;
}

function getVehicleIcon(direction, { bounce = 0, sway = 0 } = {}) {
  const iconUrl = customVehicleIcons[direction] ?? defaultVehicleIcons[direction];
  const anchorX = desiredIconSize.width / 2 + sway;
  const anchorY = desiredIconSize.height - 8 + bounce;
  return {
    url: iconUrl,
    size: new google.maps.Size(desiredIconSize.width, desiredIconSize.height),
    scaledSize: new google.maps.Size(desiredIconSize.width, desiredIconSize.height),
    anchor: new google.maps.Point(anchorX, anchorY),
  };
}

function updateVehicleMarkerIcon(direction, offsets = { bounce: 0, sway: 0 }) {
  if (!vehicleMarker) return;
  vehicleMarker.setIcon(getVehicleIcon(direction, offsets));
}

async function createAnimationRecorder() {
  if (typeof MediaRecorder === "undefined") return null;

  const mapElement = document.getElementById("map");
  if (!mapElement) return null;

  const canvas = Array.from(mapElement.querySelectorAll("canvas")).find((c) => {
    if (!c) return false;
    const r = c.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(c);
    return !(s.display === "none" || s.visibility === "hidden" || s.opacity === "0");
  });

  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  let mimeType = null;
  for (const t of mimeCandidates) {
    if (MediaRecorder.isTypeSupported?.(t)) {
      mimeType = t;
      break;
    }
  }
  if (!mimeType) return null;

  const makeRecorder = (stream) => {
    const chunks = [];
    let resolveStopped,
      resolveDataFinished;
    const stopped = new Promise((r) => (resolveStopped = r));
    const dataFinished = new Promise((r) => (resolveDataFinished = r));
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });

    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
      if (recorder.state === "inactive") resolveDataFinished?.();
    });
    recorder.addEventListener(
      "stop",
      () => {
        resolveStopped?.();
        requestAnimationFrame(() => resolveDataFinished?.());
      },
      { once: true }
    );

    return {
      recorder,
      chunks,
      mimeType,
      stopped,
      finished: Promise.all([stopped, dataFinished]),
      stream,
    };
  };

  let stream = null;
  if (canvas && typeof canvas.captureStream === "function") {
    try {
      stream = canvas.captureStream(60);
    } catch (error) {
      console.warn("Canvas capture failed", error);
    }
  }
  if (stream && (stream.getVideoTracks?.().length ?? 0) === 0) {
    stream.getTracks?.().forEach((t) => t.stop());
    stream = null;
  }

  const getDisplayStream = async () => {
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, displaySurface: "browser" },
        audio: false,
      });
    } catch (error) {
      console.warn("Display capture denied", error);
      return null;
    }
  };

  if (!stream) {
    const ds = await getDisplayStream();
    if (!ds) return null;
    const rec = makeRecorder(ds);
    try {
      rec.recorder.start(500);
    } catch (error) {
      console.error("Unable to start display recorder", error);
      ds.getTracks?.().forEach((t) => t.stop());
      return null;
    }
    return rec;
  }

  const rec = makeRecorder(stream);
  let gotData = false;
  const onFirstData = () => {
    gotData = true;
  };
  rec.recorder.addEventListener("dataavailable", onFirstData, { once: true });
  try {
    rec.recorder.start(500);
  } catch (error) {
    console.error("Unable to start canvas recorder", error);
    stream.getTracks?.().forEach((t) => t.stop());
    return null;
  }

  await new Promise((r) => setTimeout(r, 2000));
  if (gotData) {
    return rec;
  }

  try {
    rec.recorder.stop();
  } catch (error) {
    console.warn("Stopping canvas recorder failed", error);
  }
  rec.stream.getTracks?.().forEach((t) => t.stop());
  const ds = await getDisplayStream();
  if (!ds) return null;
  const rec2 = makeRecorder(ds);
  try {
    rec2.recorder.start(500);
  } catch (error) {
    console.error("Unable to start display recorder", error);
    ds.getTracks?.().forEach((t) => t.stop());
    return null;
  }
  return rec2;
}

function finalizeAnimation({
  statusMessage,
  statusType = "info",
  keepMarker = false,
  shouldSaveRecording = true,
} = {}) {
  hideRecordingIndicator();
  const recording = animationState?.recording ?? null;
  const frameId = animationState?.frameId ?? null;

  if (frameId) {
    cancelAnimationFrame(frameId);
  }

  animationState = null;

  if (!keepMarker && vehicleMarker) {
    vehicleMarker.setMap(null);
    vehicleMarker = null;
  }

  if (recording) {
    const { recorder, stopped = Promise.resolve(), finished = stopped, stream } = recording;
    let hasFinalized = false;
    const finalizeRecording = () => {
      if (hasFinalized) return;
      hasFinalized = true;
      if (shouldSaveRecording) {
        if (recording.chunks.length) {
          saveRecording(recording);
        } else {
          console.error("MediaRecorder finished without delivering any data chunks.");
          setStatus(
            "No animation data reached the recorder. Keep this tab visible and consider using your browser's screen recording (MediaDevices.getDisplayMedia) as a fallback.",
            "error"
          );
        }
      } else if (statusMessage) {
        setStatus(statusMessage, statusType);
      }
      stream?.getTracks?.().forEach((track) => track.stop());
      isRecordingInProgress = false;
      updateAnimationButtons();
    };

    finished
      .catch((error) => {
        console.error("Recording did not stop cleanly", error);
      })
      .then(() => {
        finalizeRecording();
      });

    if (recorder.state !== "inactive") {
      if (typeof recorder.requestData === "function") {
        try {
          recorder.requestData();
        } catch (error) {
          console.warn("Unable to request final recording data", error);
        }
      }
      try {
        recorder.stop();
      } catch (error) {
        console.error("Unable to stop recorder", error);
        Promise.resolve().then(() => {
          finalizeRecording();
        });
      }
    }
  } else {
    if (statusMessage) {
      setStatus(statusMessage, statusType);
    }
    updateAnimationButtons();
  }
}

function saveRecording(recording) {
  if (!recording?.chunks?.length) {
    setStatus("No animation data was recorded.", "error");
    return;
  }
  const blob = new Blob(recording.chunks, { type: recording.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `travelmap-animation-${Date.now()}.webm`;
  document.body.appendChild(link);
  link.click();
  requestAnimationFrame(() => {
    URL.revokeObjectURL(url);
    link.remove();
  });
  setStatus("Animation downloaded successfully.", "success");
}

function createDefaultVehicleIcons() {
  const colors = {
    north: "#53a9ff",
    east: "#ffd166",
    south: "#ef476f",
    west: "#06d6a0",
  };
  const rotations = {
    north: 0,
    east: 90,
    south: 180,
    west: 270,
  };
  const icons = {};
  directionOrder.forEach((direction) => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${desiredIconSize.width}" height="${desiredIconSize.height}" viewBox="0 0 ${desiredIconSize.width} ${desiredIconSize.height}">
  <g transform="rotate(${rotations[direction]} ${desiredIconSize.width / 2} ${desiredIconSize.height / 2})">
    <path d="M${desiredIconSize.width / 2} 12 L${desiredIconSize.width - 18} ${desiredIconSize.height - 16} L${desiredIconSize.width / 2} ${desiredIconSize.height - 32} L18 ${desiredIconSize.height - 16} Z" fill="${colors[direction]}" stroke="#061422" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="${desiredIconSize.width / 2}" cy="${desiredIconSize.height - 24}" r="10" fill="#061422" opacity="0.45"/>
  </g>
</svg>`;
    icons[direction] = `data:image/svg+xml;base64,${btoa(svg)}`;
  });
  return icons;
}

let envApiKeyPromise = null;

function extractEnvValue(content, variable) {
  if (typeof content !== "string" || !variable) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    if (key !== variable) continue;
    let value = line.slice(equalsIndex + 1).trim();
    if (!value) return "";
    if (!value.startsWith("\"") && !value.startsWith("'")) {
      const commentIndex = value.indexOf("#");
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function loadApiKeyFromEnvFile() {
  if (envApiKeyPromise) {
    return envApiKeyPromise;
  }
  envApiKeyPromise = fetch("./.env", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        return null;
      }
      return response.text();
    })
    .then((text) => {
      if (!text) {
        return null;
      }
      const key = extractEnvValue(text, "GOOGLE_MAPS_API_KEY");
      if (key) {
        window.GMAPS_API_KEY = key;
      }
      return key || null;
    })
    .catch((error) => {
      console.warn("Unable to load Google Maps API key from .env file", error);
      return null;
    });
  return envApiKeyPromise;
}

async function resolveGoogleMapsApiKey() {
  try {
    const url = new URL(window.location.href);
    const urlKey = url.searchParams.get("key");
    if (urlKey) {
      window.GMAPS_API_KEY = urlKey;
      return urlKey;
    }
  } catch (error) {
    console.warn("Unable to parse window location for API key override", error);
  }

  if (window.GMAPS_API_KEY && window.GMAPS_API_KEY !== "YOUR_API_KEY") {
    return window.GMAPS_API_KEY;
  }

  const envKey = await loadApiKeyFromEnvFile();
  if (envKey) {
    return envKey;
  }

  return null;
}

async function bootstrapGoogleMaps() {
  if (!mapReady) {
    setStatus("Loading map…", "info");
  }

  try {
    const apiKey = await resolveGoogleMapsApiKey();
    if (!apiKey) {
      setStatus(
        "Google Maps API key is not configured. Update web/.env with a valid key.",
        "error"
      );
      return;
    }

    if (window.google?.maps) {
      return;
    }

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-maps-loader="true"]');
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Google Maps script failed to load.")),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&callback=initMap&libraries=geometry`;
      script.dataset.googleMapsLoader = "true";
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      });
      script.addEventListener("error", () => {
        reject(new Error("Google Maps script failed to load."));
      });
      document.head.appendChild(script);
    });
  } catch (error) {
    console.error("Failed to bootstrap Google Maps", error);
    setStatus(
      "Unable to load Google Maps at this time. Check the API key configuration.",
      "error"
    );
  }
}

function startApplication() {
  const versionElement = document.getElementById("appVersion");
  const version = window.APP_VERSION ?? "dev-build";
  if (versionElement) {
    versionElement.textContent = version;
  }
  console.info(`Travel Map Planner version: ${version}`);

  initialiseForm();
  initialisePreviousTrips();
  initialiseVehicleIconUploads();
  initialiseFuelSettings();
  initialiseAnimationControls();
  initialiseKeyboardShortcuts();
  initialiseMapTypeControl();

  void bootstrapGoogleMaps();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApplication, { once: true });
} else {
  startApplication();
}

window.initMap = function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.error("Map element not found");
    return;
  }

  map = new google.maps.Map(mapElement, {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  map.addListener("tilesloaded", handleMapTilesLoaded);
  markMapTilesForRefresh();

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: "#53a9ff",
      strokeWeight: 5,
    },
  });

  mapReady = true;
  map.setMapTypeId(mapTypePreference);
  updateAnimationButtons();
  setStatus("Map loaded. Enter your route to begin.", "info");
};
