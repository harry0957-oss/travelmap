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
const animationControls = {
  enableCheckbox: null,
  previewButton: null,
  downloadButton: null,
  speedSelect: null,
};

const baseAnimationSpeed = 65;
let animationSpeedMultiplier = 1;

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
    startRouteAnimation({ record: true });
  });

  updateAnimationButtons();
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

function startRouteAnimation({ record = false } = {}) {
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
    const recording = createAnimationRecorder();
    if (!recording) {
      vehicleMarker.setMap(null);
      vehicleMarker = null;
      setStatus("Animation recording isn't supported in this browser.", "error");
      updateAnimationButtons();
      return;
    }
    state.recording = recording;
    isRecordingInProgress = true;
    try {
      recording.recorder.start();
    } catch (error) {
      console.error("Unable to start recording", error);
      isRecordingInProgress = false;
      state.recording = null;
      vehicleMarker.setMap(null);
      vehicleMarker = null;
      setStatus("Recording could not be started.", "error");
      updateAnimationButtons();
      return;
    }
  }

  animationState = state;
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
  if (currentCenter && areLatLngEqual(currentCenter, position)) {
    return;
  }
  if (typeof map.panTo === "function") {
    map.panTo(position);
  } else if (typeof map.setCenter === "function") {
    map.setCenter(position);
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

function createAnimationRecorder() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const mapElement = document.getElementById("map");
  if (!mapElement) return null;
  const canvas = mapElement.querySelector("canvas");
  const sourceElement = canvas ?? mapElement;
  const captureStream =
    sourceElement.captureStream ?? sourceElement.mozCaptureStream ?? null;
  if (typeof captureStream !== "function") {
    return null;
  }

  let stream;
  try {
    stream = captureStream.call(sourceElement, 60);
  } catch (error) {
    console.error("Unable to capture map stream", error);
    return null;
  }
  if (!stream) {
    return null;
  }
  const preferredTypes = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  let mimeType = null;
  for (const type of preferredTypes) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      mimeType = type;
      break;
    }
  }
  if (!mimeType) {
    return null;
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  return { recorder, chunks, mimeType };
}

function finalizeAnimation({
  statusMessage,
  statusType = "info",
  keepMarker = false,
  shouldSaveRecording = true,
} = {}) {
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
    const { recorder } = recording;
    const finishRecording = () => {
      if (shouldSaveRecording) {
        saveRecording(recording);
      } else if (statusMessage) {
        setStatus(statusMessage, statusType);
      }
      isRecordingInProgress = false;
      updateAnimationButtons();
    };
    if (recorder.state !== "inactive") {
      recorder.addEventListener("stop", finishRecording, { once: true });
      recorder.stop();
    } else {
      finishRecording();
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
  const extension = recording.mimeType.includes("mp4") ? "mp4" : "webm";
  link.download = `travelmap-animation-${Date.now()}.${extension}`;
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

document.addEventListener("DOMContentLoaded", () => {
  initialiseForm();
  initialiseVehicleIconUploads();
  initialiseAnimationControls();
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
