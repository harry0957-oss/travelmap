let map;
let directionsService;
let directionsRenderer;
let mapReady = false;

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

let currentRouteResult = null;
let currentRouteSegments = [];
let vehicleMarker = null;
let animationState = null;
let isRecordingInProgress = false;
let mapTypePreference = "roadmap";
let recordingOverlayElement = null;
const animationControls = {
  enableCheckbox: null,
  previewButton: null,
  downloadButton: null,
  speedSelect: null,
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

function plotRoute(start, end, waypointValues) {
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

  const request = {
    origin: start,
    destination: end,
    travelMode: google.maps.TravelMode.DRIVING,
    waypoints: waypointValues.map((value) => ({ location: value, stopover: true })),
    optimizeWaypoints: false,
    provideRouteAlternatives: false,
  };

  setStatus("Calculating route…", "info");

  directionsService
    .route(request)
    .then((result) => {
      directionsRenderer.setDirections(result);
      updateRouteSegments(result);
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
    return;
  }

  const path = extractRoutePath(route);
  currentRouteSegments = buildRouteSegments(path);
  updateAnimationButtons();
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

    plotRoute(start, end, waypointValues);
  });
}

function initialiseVehicleIconUploads() {
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
    startRouteAnimation({ record: false });
  });

  animationControls.downloadButton?.addEventListener("click", () => {
    if (!currentRouteSegments.length) {
      setStatus("Plot a route before downloading the animation.", "error");
      return;
    }
    startPopupRecordingFlow();
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
    animationControls.previewButton.disabled = !enabled || !hasRoute || running;
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

  const firstSegment = currentRouteSegments[0];
  if (!firstSegment) {
    setStatus("The calculated route is too short to animate.", "error");
    return;
  }

  if (animationState) {
    finalizeAnimation({ shouldSaveRecording: false });
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

function getGoogleMapsScriptSrc() {
  const existing = document.querySelector(
    'script[src*="maps.googleapis.com/maps/api/js"]'
  );
  if (existing?.src) {
    return existing.src;
  }
  return "https://maps.googleapis.com/maps/api/js?key=AIzaSyBEQXlNW6hW-F_VqL9OVtt3YABfl545MkU&libraries=geometry";
}

async function startRecordingInPopup() {
  const width = 1920;
  const height = 1080;
  const features = `popup=yes,noopener=yes,resizable=no,scrollbars=no,width=${width},height=${height},left=50,top=50`;
  const popup = window.open("", "map-recorder", features);
  if (!popup) {
    setStatus("Pop-up blocked. Allow pop-ups to record.", "error");
    return null;
  }

  popup.document.write(`<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Map Recorder</title>
<style>
  html,body,#map { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#000; }
</style>
</head>
<body>
  <div id="map"></div>
  <script>
    window.isRecorderWindow = true;
  </script>
</body></html>`);
  popup.document.close();
  try {
    popup.focus();
  } catch (error) {
    console.warn("Unable to focus popup window", error);
  }

  return popup;
}

async function initRecorderMapInWindow(win, payload) {
  if (!win || win.closed) {
    throw new Error("Recorder window is not available.");
  }

  if (!win.google?.maps) {
    const scriptSrc = getGoogleMapsScriptSrc();
    await new Promise((resolve, reject) => {
      const script = win.document.createElement("script");
      script.src = scriptSrc;
      script.onload = resolve;
      script.onerror = reject;
      win.document.head.appendChild(script);
    });
  }

  const mapElement = win.document.getElementById("map");
  if (!mapElement) {
    throw new Error("Recorder map element missing.");
  }

  const popupMap = new win.google.maps.Map(mapElement, {
    center: { lat: 20, lng: 0 },
    zoom: 4,
    mapTypeId: mapTypePreference,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  const popupDirectionsService = new win.google.maps.DirectionsService();
  const popupDirectionsRenderer = new win.google.maps.DirectionsRenderer({
    map: popupMap,
    suppressMarkers: false,
    polylineOptions: { strokeColor: "#53a9ff", strokeWeight: 5 },
  });

  const req = {
    origin: payload.start,
    destination: payload.end,
    waypoints: (payload.waypoints ?? []).map((value) => ({
      location: value,
      stopover: true,
    })),
    optimizeWaypoints: false,
    travelMode: win.google.maps.TravelMode.DRIVING,
  };

  const result = await popupDirectionsService.route(req);
  popupDirectionsRenderer.setDirections(result);

  return { popupMap, result };
}

function getPopupVehicleIcon(win, direction, { bounce = 0, sway = 0 } = {}) {
  const iconUrl = customVehicleIcons[direction] ?? defaultVehicleIcons[direction];
  const anchorX = desiredIconSize.width / 2 + sway;
  const anchorY = desiredIconSize.height - 8 + bounce;
  return {
    url: iconUrl,
    size: new win.google.maps.Size(desiredIconSize.width, desiredIconSize.height),
    scaledSize: new win.google.maps.Size(desiredIconSize.width, desiredIconSize.height),
    anchor: new win.google.maps.Point(anchorX, anchorY),
  };
}

async function recordPopupWindow(win) {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("Display capture is not supported in this browser.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60, displaySurface: "window" },
    audio: false,
  });

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";

  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) {
      chunks.push(event.data);
    }
  };

  recorder.start(500);

  return { rec: recorder, chunks, stream, mimeType };
}

async function startPopupRecordingFlow() {
  if (isRecordingInProgress) {
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

  isRecordingInProgress = true;
  updateAnimationButtons();
  setStatus("Preparing recording window…", "info");

  const popupWindow = await startRecordingInPopup();
  if (!popupWindow) {
    isRecordingInProgress = false;
    updateAnimationButtons();
    return;
  }

  try {
    const { popupMap, result } = await initRecorderMapInWindow(popupWindow, payload);
    const route = result?.routes?.[0];
    if (!route) {
      throw new Error("No route available in recorder window.");
    }

    const points = [];
    (route.legs ?? []).forEach((leg) => {
      (leg.steps ?? []).forEach((step) => {
        (step.path ?? []).forEach((point) => {
          if (point) {
            points.push(point);
          }
        });
      });
    });

    if (!points.length) {
      throw new Error("Route path could not be extracted for recording.");
    }

    const startPoint = points[0];
    const secondPoint = points[1] ?? points[0];
    const initialHeading = popupWindow.google.maps.geometry?.spherical?.computeHeading
      ? popupWindow.google.maps.geometry.spherical.computeHeading(startPoint, secondPoint)
      : 0;
    let currentDirection = determineDirection(initialHeading);

    const marker = new popupWindow.google.maps.Marker({
      map: popupMap,
      position: startPoint,
      icon: getPopupVehicleIcon(popupWindow, currentDirection),
      optimized: false,
    });

    if (typeof popupMap.setCenter === "function") {
      popupMap.setCenter(startPoint);
    }

    setStatus("Select the map recorder window in the capture picker.", "info");
    const recording = await recordPopupWindow(popupWindow);
    setStatus("Recording animation…", "info");

    let animationFinished = false;
    const stopRecording = () => {
      if (animationFinished) return;
      animationFinished = true;
      const timerHost = popupWindow?.setTimeout ? popupWindow : window;
      timerHost.setTimeout(() => {
        try {
          recording.rec.requestData?.();
        } catch (error) {
          console.warn("Unable to request final recording data", error);
        }
        try {
          recording.rec.stop();
        } catch (error) {
          console.warn("Unable to stop recorder", error);
        }
      }, 250);
    };

    recording.rec.onstop = () => {
      recording.stream.getTracks?.().forEach((track) => track.stop());
      if (recording.chunks.length) {
        const blob = new Blob(recording.chunks, { type: recording.mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = `travelmap-animation-${Date.now()}.webm`;
        document.body.appendChild(anchor);
        anchor.click();
        requestAnimationFrame(() => {
          URL.revokeObjectURL(downloadUrl);
          anchor.remove();
        });
        setStatus("Animation downloaded successfully.", "success");
      } else {
        setStatus("No animation data was recorded.", "error");
      }
      try {
        popupWindow.close();
      } catch (error) {
        console.warn("Unable to close recorder window", error);
      }
      isRecordingInProgress = false;
      updateAnimationButtons();
    };

    let pointIndex = 1;
    const advanceAnimation = () => {
      if (animationFinished) {
        return;
      }

      if (popupWindow.closed) {
        stopRecording();
        return;
      }

      if (pointIndex >= points.length) {
        stopRecording();
        return;
      }

      const point = points[pointIndex];
      marker.setPosition(point);
      if (typeof popupMap.panTo === "function") {
        popupMap.panTo(point);
      }

      const nextPoint = points[pointIndex + 1] ?? point;
      const heading = popupWindow.google.maps.geometry?.spherical?.computeHeading
        ? popupWindow.google.maps.geometry.spherical.computeHeading(point, nextPoint)
        : 0;
      const nextDirection = determineDirection(heading);
      if (nextDirection !== currentDirection) {
        currentDirection = nextDirection;
        marker.setIcon(getPopupVehicleIcon(popupWindow, currentDirection));
      }

      pointIndex += 1;
      popupWindow.requestAnimationFrame(advanceAnimation);
    };

    popupWindow.requestAnimationFrame(advanceAnimation);

    const videoTracks = recording.stream.getVideoTracks?.() ?? [];
    videoTracks.forEach((track) => {
      track.addEventListener("ended", () => {
        stopRecording();
      });
    });
  } catch (error) {
    console.error("Recording failed to initialize", error);
    const cancelled = error?.name === "NotAllowedError" || error?.name === "AbortError";
    setStatus(
      cancelled ? "Screen capture was cancelled." : "Recording failed to initialize.",
      "error"
    );
    try {
      popupWindow.close();
    } catch (closeError) {
      console.warn("Unable to close recorder window after failure", closeError);
    }
    isRecordingInProgress = false;
    updateAnimationButtons();
  }
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

document.addEventListener("DOMContentLoaded", () => {
  const versionElement = document.getElementById("appVersion");
  const version = window.APP_VERSION ?? "dev-build";
  if (versionElement) {
    versionElement.textContent = version;
  }
  console.info(`Travel Map Planner version: ${version}`);

  initialiseForm();
  initialiseVehicleIconUploads();
  initialiseAnimationControls();
  initialiseKeyboardShortcuts();
  initialiseMapTypeControl();
});

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
