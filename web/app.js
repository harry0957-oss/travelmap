const DEFAULT_ICON_COLOUR = "#53a9ff";
const CONTINENT_SHAPES = {
  north_america: [
    [83.0, -95.0],
    [70.0, -168.0],
    [50.0, -170.0],
    [23.0, -100.0],
    [7.0, -83.0],
    [18.0, -64.0],
    [32.0, -81.0],
    [50.0, -60.0],
    [60.0, -64.0],
    [70.0, -70.0],
    [83.0, -95.0],
  ],
  south_america: [
    [12.0, -81.0],
    [5.0, -75.0],
    [-15.0, -75.0],
    [-33.0, -69.0],
    [-55.0, -67.0],
    [-55.0, -47.0],
    [-30.0, -40.0],
    [-12.0, -38.0],
    [4.0, -50.0],
    [12.0, -60.0],
    [12.0, -81.0],
  ],
  europe_asia: [
    [72.0, -10.0],
    [70.0, 40.0],
    [55.0, 85.0],
    [50.0, 120.0],
    [58.0, 160.0],
    [50.0, 180.0],
    [10.0, 140.0],
    [5.0, 100.0],
    [25.0, 50.0],
    [35.0, 30.0],
    [45.0, 10.0],
    [60.0, -10.0],
    [72.0, -10.0],
  ],
  africa: [
    [35.0, -17.0],
    [31.0, 30.0],
    [12.0, 43.0],
    [0.0, 46.0],
    [-25.0, 32.0],
    [-35.0, 20.0],
    [-35.0, 15.0],
    [-22.0, 11.0],
    [-5.0, 10.0],
    [16.0, -5.0],
    [20.0, -17.0],
    [35.0, -17.0],
  ],
  australia: [
    [-11.0, 113.0],
    [-12.0, 129.0],
    [-23.0, 153.0],
    [-36.0, 149.0],
    [-43.0, 146.0],
    [-39.0, 135.0],
    [-34.0, 115.0],
    [-17.0, 113.0],
    [-11.0, 113.0],
  ],
  antarctica: [
    [-60.0, -180.0],
    [-60.0, -90.0],
    [-60.0, 0.0],
    [-60.0, 90.0],
    [-60.0, 180.0],
    [-80.0, 180.0],
    [-80.0, -180.0],
    [-60.0, -180.0],
  ],
};

const state = {
  waypoints: [],
  iconImage: null,
  iconScale: 1,
  timeline: null,
  animation: null,
  projectedWaypoints: [],
  bounds: null,
  heading: 0,
};

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const iconCanvas = document.getElementById("iconPreview");
const iconCtx = iconCanvas.getContext("2d");
const waypointTableBody = document.querySelector("#waypointTable tbody");
const waypointRowTemplate = document.getElementById("waypointRowTemplate");
const statusEl = document.getElementById("status");
const downloadPreview = document.getElementById("downloadPreview");

const titleInput = document.getElementById("titleInput");
const speedInput = document.getElementById("speedInput");
const frameRateInput = document.getElementById("frameRateInput");
const startPauseInput = document.getElementById("startPauseInput");
const endPauseInput = document.getElementById("endPauseInput");

const previewButton = document.getElementById("previewButton");
const downloadButton = document.getElementById("downloadButton");

function setStatus(text, type = "info") {
  statusEl.textContent = text;
  statusEl.dataset.type = type;
}

function renderIconPreview() {
  iconCtx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
  iconCtx.save();
  iconCtx.translate(iconCanvas.width / 2, iconCanvas.height / 2);
  if (state.iconImage) {
    const scale = state.iconScale;
    const size = Math.min(iconCanvas.width, iconCanvas.height) * 0.8 * scale;
    iconCtx.drawImage(state.iconImage, -size / 2, -size / 2, size, size);
  } else {
    const radius = Math.min(iconCanvas.width, iconCanvas.height) * 0.35;
    const gradient = iconCtx.createRadialGradient(0, 0, radius * 0.35, 0, 0, radius);
    gradient.addColorStop(0, "#8fd3ff");
    gradient.addColorStop(1, DEFAULT_ICON_COLOUR);
    iconCtx.fillStyle = gradient;
    iconCtx.beginPath();
    iconCtx.arc(0, 0, radius, 0, Math.PI * 2);
    iconCtx.fill();
    iconCtx.fillStyle = "rgba(0, 0, 0, 0.65)";
    iconCtx.font = "bold 32px 'Inter', system-ui";
    iconCtx.textAlign = "center";
    iconCtx.textBaseline = "middle";
    iconCtx.fillText("GO", 0, 0);
  }
  iconCtx.restore();
}

function renderWaypointTable() {
  waypointTableBody.innerHTML = "";
  state.waypoints.forEach((wp, index) => {
    const row = waypointRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".index").textContent = String(index + 1);
    row.querySelector(".name").textContent = wp.name || "(untitled)";
    row.querySelector(".lat").textContent = Number(wp.lat).toFixed(4);
    row.querySelector(".lon").textContent = Number(wp.lon).toFixed(4);
    row.querySelector(".pause").textContent = Number(wp.pause || 0).toFixed(1);
    row.querySelector(".remove").addEventListener("click", () => {
      state.waypoints.splice(index, 1);
      renderWaypointTable();
      drawStaticMap();
    });
    waypointTableBody.appendChild(row);
  });
}

function handleWaypointSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("waypointName").value.trim();
  const lat = parseFloat(document.getElementById("waypointLat").value);
  const lon = parseFloat(document.getElementById("waypointLon").value);
  const pause = parseFloat(document.getElementById("waypointPause").value || "0");
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    setStatus("Latitude and longitude must be valid numbers.", "error");
    return;
  }
  state.waypoints.push({ name, lat, lon, pause });
  event.target.reset();
  document.getElementById("waypointPause").value = "1";
  renderWaypointTable();
  drawStaticMap();
  setStatus("Waypoints updated.");
}

document.getElementById("waypointForm").addEventListener("submit", handleWaypointSubmit);

document.getElementById("configUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    applyConfiguration(config);
    setStatus(`Loaded configuration from ${file.name}.`);
  } catch (error) {
    console.error(error);
    setStatus("Unable to read configuration file.", "error");
  }
});

document.getElementById("iconUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    state.iconImage = null;
    renderIconPreview();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.iconImage = img;
      state.iconScale = 1;
      renderIconPreview();
      drawStaticMap();
      setStatus(`Loaded icon (${file.name}).`);
    };
    img.src = reader.result;
  };
  reader.onerror = () => {
    setStatus("Unable to read icon file.", "error");
  };
  reader.readAsDataURL(file);
});

function applyConfiguration(config) {
  titleInput.value = config.title || "";
  speedInput.value = config.speed_kmh || 80;
  frameRateInput.value = config.frame_rate || 30;
  startPauseInput.value = config.pause_at_start ?? 1;
  endPauseInput.value = config.pause_at_end ?? 1;

  state.iconScale = config.vehicle?.icon_scale || 1;
  if (config.vehicle?.icon) {
    tryLoadIcon(config.vehicle.icon);
  }

  state.waypoints = Array.isArray(config.waypoints)
    ? config.waypoints.map((wp) => ({
        name: wp.name || "",
        lat: parseFloat(wp.lat),
        lon: parseFloat(wp.lon),
        pause: parseFloat(wp.pause || 0),
      }))
    : [];
  renderWaypointTable();
  drawStaticMap();
}

async function tryLoadIcon(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Request failed");
    const blob = await response.blob();
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        state.iconImage = img;
        renderIconPreview();
        drawStaticMap();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(blob);
  } catch (error) {
    console.warn("Unable to load icon from configuration", error);
    setStatus("Icon path could not be loaded in the browser.", "warning");
    state.iconImage = null;
    renderIconPreview();
  }
}

function computeBounds(marginDegrees = 6) {
  if (!state.waypoints.length) {
    return {
      minLat: -60,
      maxLat: 80,
      minLon: -140,
      maxLon: 160,
    };
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  state.waypoints.forEach((wp) => {
    if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) {
      return;
    }
    minLat = Math.min(minLat, wp.lat);
    maxLat = Math.max(maxLat, wp.lat);
    minLon = Math.min(minLon, wp.lon);
    maxLon = Math.max(maxLon, wp.lon);
  });
  return {
    minLat: minLat - marginDegrees,
    maxLat: maxLat + marginDegrees,
    minLon: minLon - marginDegrees,
    maxLon: maxLon + marginDegrees,
  };
}

function project(lat, lon, bounds) {
  const { minLat, maxLat, minLon, maxLon } = bounds;
  const lonRange = Math.max(maxLon - minLon, 0.0001);
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const x = ((lon - minLon) / lonRange) * canvas.width;
  const y = ((maxLat - lat) / latRange) * canvas.height;
  return { x, y };
}

function drawStaticMap() {
  const bounds = computeBounds();
  state.bounds = bounds;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#021224");
  gradient.addColorStop(1, "#031a2f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#142d47";
  Object.values(CONTINENT_SHAPES).forEach((shape) => {
    ctx.beginPath();
    shape.forEach(([lat, lon], index) => {
      const { x, y } = project(lat, lon, bounds);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  if (!state.waypoints.length) return;

  state.projectedWaypoints = state.waypoints.map((wp) => ({
    ...wp,
    ...project(wp.lat, wp.lon, bounds),
  }));

  ctx.strokeStyle = "rgba(143, 211, 255, 0.25)";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  state.projectedWaypoints.forEach((pt, index) => {
    if (index === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();

  ctx.fillStyle = "#8fd3ff";
  ctx.strokeStyle = "rgba(12, 42, 70, 0.7)";
  ctx.lineWidth = 2;
  state.projectedWaypoints.forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = "600 20px 'Inter', system-ui";
  ctx.textAlign = "left";
  ctx.fillText(titleInput.value || "", 24, 36);
}

function haversineDistance(a, b) {
  const R = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const c =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) *
      sinLon * sinLon;
  const d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
  return R * d;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function buildTimeline() {
  if (state.waypoints.length < 2) {
    setStatus("Add at least two waypoints to animate.", "warning");
    return null;
  }
  const speed = Math.max(parseFloat(speedInput.value) || 1, 0.1);
  const startPause = Math.max(parseFloat(startPauseInput.value) || 0, 0);
  const endPause = Math.max(parseFloat(endPauseInput.value) || 0, 0);

  const segments = [];
  let currentTime = 0;

  if (startPause > 0) {
    segments.push({
      type: "pause",
      at: state.waypoints[0],
      duration: startPause,
      start: currentTime,
    });
    currentTime += startPause;
  }

  for (let i = 0; i < state.waypoints.length - 1; i++) {
    const from = state.waypoints[i];
    const to = state.waypoints[i + 1];
    const distance = haversineDistance(from, to);
    const duration = (distance / speed) * 3600;
    segments.push({
      type: "move",
      from,
      to,
      duration,
      start: currentTime,
    });
    currentTime += duration;
    const pause = Math.max(parseFloat(to.pause) || 0, 0);
    if (pause > 0 && (i + 1) !== state.waypoints.length - 1) {
      segments.push({
        type: "pause",
        at: to,
        duration: pause,
        start: currentTime,
      });
      currentTime += pause;
    }
  }

  if (endPause > 0) {
    segments.push({
      type: "pause",
      at: state.waypoints[state.waypoints.length - 1],
      duration: endPause,
      start: currentTime,
    });
    currentTime += endPause;
  }

  const totalDuration = currentTime;
  return { segments, totalDuration };
}

function interpolatePosition(segment, elapsed) {
  const t = Math.min(Math.max(elapsed / segment.duration, 0), 1);
  const lat = segment.from.lat + (segment.to.lat - segment.from.lat) * t;
  const lon = segment.from.lon + (segment.to.lon - segment.from.lon) * t;
  return { lat, lon, t };
}

function headingBetween(from, to) {
  const p1 = project(from.lat, from.lon, state.bounds);
  const p2 = project(to.lat, to.lon, state.bounds);
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function runAnimation(record = false) {
  const timeline = buildTimeline();
  if (!timeline) return;
  state.timeline = timeline;
  state.bounds = computeBounds();
  state.projectedWaypoints = state.waypoints.map((wp) => ({
    ...wp,
    ...project(wp.lat, wp.lon, state.bounds),
  }));
  const frameRate = Math.min(Math.max(parseFloat(frameRateInput.value) || 30, 1), 60);
  const frameInterval = 1000 / frameRate;

  let recorder = null;
  let recordedChunks = [];
  if (record) {
    downloadPreview.hidden = true;
  }
  if (record) {
    if (typeof MediaRecorder === "undefined") {
      setStatus("MediaRecorder API is not supported in this browser.", "error");
      return;
    }
    const stream = canvas.captureStream(frameRate);
    const mimeTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    let mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setStatus("This browser cannot export WebM recordings.", "error");
      return;
    }
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const fileName = `travelmap-${Date.now()}.webm`;
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      downloadPreview.src = url;
      downloadPreview.hidden = false;
      downloadPreview.focus();
      setStatus(`Download ready (${fileName}).`);
    };
    recorder.start();
    recordedChunks = [];
  }

  let lastFrameTime = 0;
  const startTime = performance.now();
  const animation = {
    timeline,
    startTime,
    frameInterval,
    recorder,
    record,
    finished: false,
  };
  state.animation = animation;
  disableControls(true);
  setStatus(record ? "Recording animation..." : "Playing preview...");

  function step(timestamp) {
    if (!state.animation || animation.finished) return;
    if (timestamp - lastFrameTime < frameInterval && !record) {
      requestAnimationFrame(step);
      return;
    }
    lastFrameTime = timestamp;
    const elapsed = (timestamp - startTime) / 1000;
    const { segments, totalDuration } = timeline;
    if (elapsed >= totalDuration) {
      drawFrame(segments, totalDuration);
      finish();
      return;
    }
    drawFrame(segments, elapsed);
    requestAnimationFrame(step);
  }

  function finish() {
    animation.finished = true;
    disableControls(false);
    setStatus(record ? "Finishing recording..." : "Preview finished.");
    if (record && recorder) {
      recorder.stop();
    }
    state.animation = null;
    if (!record) {
      drawStaticMap();
    }
  }

  requestAnimationFrame(step);
}

function drawFrame(segments, elapsed) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#021224");
  gradient.addColorStop(1, "#031a2f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#142d47";
  Object.values(CONTINENT_SHAPES).forEach((shape) => {
    ctx.beginPath();
    shape.forEach(([lat, lon], index) => {
      const { x, y } = project(lat, lon, state.bounds);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  ctx.strokeStyle = "rgba(143, 211, 255, 0.2)";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  state.projectedWaypoints.forEach((pt, index) => {
    if (index === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();

  const travelPath = buildTravelPath(segments, elapsed);
  if (travelPath.length > 1) {
    ctx.strokeStyle = "rgba(244, 94, 94, 0.85)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    travelPath.forEach((pt, index) => {
      if (index === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  }

  ctx.fillStyle = "#8fd3ff";
  ctx.strokeStyle = "rgba(12, 42, 70, 0.7)";
  ctx.lineWidth = 2;
  state.projectedWaypoints.forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  const active = currentSegmentAt(segments, elapsed);
  const vehicle = determineVehiclePosition(active, elapsed);
  state.heading = vehicle.heading;

  drawVehicle(vehicle.position, vehicle.heading);
  drawUpcomingLine(vehicle.position, active);

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = "600 24px 'Inter', system-ui";
  ctx.textAlign = "left";
  ctx.fillText(titleInput.value || "", 24, 36);
}

function drawVehicle(position, heading) {
  const point = project(position.lat, position.lon, state.bounds);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(heading);
  if (state.iconImage) {
    const scale = state.iconScale;
    const size = 48 * scale;
    ctx.drawImage(state.iconImage, -size / 2, -size / 2, size, size);
  } else {
    const radius = 18;
    const gradient = ctx.createRadialGradient(0, 0, radius * 0.3, 0, 0, radius);
    gradient.addColorStop(0, "#f9fffe");
    gradient.addColorStop(1, DEFAULT_ICON_COLOUR);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.font = "bold 16px 'Inter', system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GO", 0, 0);
  }
  ctx.restore();
}

function drawUpcomingLine(position, active) {
  let segment = active;
  if (!segment) return;
  if (segment.type !== "move") {
    segment = findNextMove(segment);
    if (!segment) return;
  }
  const { lat, lon } = position;
  const future = project(segment.to.lat, segment.to.lon, state.bounds);
  const current = project(lat, lon, state.bounds);
  ctx.strokeStyle = "rgba(83, 255, 178, 0.75)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(current.x, current.y);
  ctx.lineTo(future.x, future.y);
  ctx.stroke();
}

function buildTravelPath(segments, elapsed) {
  const path = [];
  if (!segments.length) return path;
  let lastPoint = null;
  segments.forEach((segment) => {
    if (segment.type !== "move") {
      return;
    }
    if (segment.start + segment.duration <= elapsed) {
      const from = project(segment.from.lat, segment.from.lon, state.bounds);
      const to = project(segment.to.lat, segment.to.lon, state.bounds);
      if (!lastPoint || lastPoint.x !== from.x || lastPoint.y !== from.y) {
        path.push(from);
      }
      path.push(to);
      lastPoint = to;
    } else if (segment.start <= elapsed) {
      const partial = interpolatePosition(segment, elapsed - segment.start);
      const from = project(segment.from.lat, segment.from.lon, state.bounds);
      if (!lastPoint || lastPoint.x !== from.x || lastPoint.y !== from.y) {
        path.push(from);
      }
      path.push(project(partial.lat, partial.lon, state.bounds));
      lastPoint = path[path.length - 1];
    }
  });
  return path;
}

function currentSegmentAt(segments, elapsed) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (elapsed >= segment.start) {
      return segment;
    }
  }
  return segments[0];
}

function determineVehiclePosition(segment, elapsed) {
  if (!segment) {
    const first = state.waypoints[0];
    return { position: first, heading: 0 };
  }
  if (segment.type === "pause") {
    const previousMove = findPreviousMove(segment);
    if (previousMove) {
      const heading = headingBetween(previousMove.from, previousMove.to);
      return { position: segment.at, heading };
    }
    const nextMove = findNextMove(segment);
    if (nextMove) {
      const heading = headingBetween(nextMove.from, nextMove.to);
      return { position: segment.at, heading };
    }
    return { position: segment.at, heading: 0 };
  }
  const progress = interpolatePosition(segment, elapsed - segment.start);
  const heading = headingBetween(segment.from, segment.to);
  return { position: { lat: progress.lat, lon: progress.lon }, heading };
}

function findPreviousMove(segment) {
  const segments = state.timeline?.segments || [];
  const index = segments.indexOf(segment);
  for (let i = index - 1; i >= 0; i--) {
    if (segments[i].type === "move") return segments[i];
  }
  return null;
}

function findNextMove(segment) {
  const segments = state.timeline?.segments || [];
  const index = segments.indexOf(segment);
  for (let i = index + 1; i < segments.length; i++) {
    if (segments[i].type === "move") return segments[i];
  }
  return null;
}

function disableControls(disabled) {
  [previewButton, downloadButton].forEach((button) => {
    button.disabled = disabled;
    button.classList.toggle("disabled", disabled);
  });
}

previewButton.addEventListener("click", () => {
  if (state.animation) return;
  runAnimation(false);
});

downloadButton.addEventListener("click", () => {
  if (state.animation) return;
  runAnimation(true);
});

renderIconPreview();
drawStaticMap();
setStatus("Load a configuration or start adding waypoints.");
