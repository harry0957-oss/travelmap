let map;
let directionsService;
let directionsRenderer;
let mapReady = false;

const waypointClass = "waypoint-input";

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

document.addEventListener("DOMContentLoaded", () => {
  initialiseForm();
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
  setStatus("Map loaded. Enter your route to begin.", "info");
};
