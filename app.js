let map;
let ownshipMarker;
let accuracyCircle;
let lastPosition = null;
let followPosition = true;

let routeData = null;
let routeLine = null;
let waypointMarkers = [];
let activeWpIndex = 1;

// One status object per waypoint.
// Example:
// waypointStatus[2] = {
//     checked: true,
//     ato: Date object,
//     method: "auto" or "manual"
// };
let waypointStatus = [];

// Automatic ATO confirmation state
let autoAtoCandidateIndex = null;
let autoAtoCandidateStartTime = null;

// Initial map position: Madrid-ish fallback
const INITIAL_LAT = 40.4168;
const INITIAL_LON = -3.7038;

function initMap() {
    map = L.map("map").setView([INITIAL_LAT, INITIAL_LON], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    ownshipMarker = L.marker([INITIAL_LAT, INITIAL_LON]).addTo(map);
    ownshipMarker.bindPopup("Current position");

    accuracyCircle = L.circle([INITIAL_LAT, INITIAL_LON], {
        radius: 0
    }).addTo(map);

    map.on("dragstart", () => {
        followPosition = false;
        document.getElementById("status").textContent = "Map moved manually";
    });
}

function startGNSS() {
    if (!window.isSecureContext) {
        document.getElementById("status").textContent =
            "GNSS blocked: use HTTPS or localhost";
        return;
    }

    if (!navigator.geolocation) {
        document.getElementById("status").textContent = "Geolocation not supported";
        return;
    }

    document.getElementById("status").textContent = "Requesting GNSS permission...";

    navigator.geolocation.watchPosition(
        handlePosition,
        handlePositionError,
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
}

function handlePosition(position) {
    const coords = position.coords;

    const lat = coords.latitude;
    const lon = coords.longitude;
    const accuracy = coords.accuracy;
    const speed = coords.speed;
    const heading = coords.heading;

    lastPosition = {
        lat,
        lon,
        accuracy,
        speed,
        heading,
        timestamp: position.timestamp
    };

    updateMap(lat, lon, accuracy);
    updateGNSSPanel(lat, lon, accuracy, speed, heading);

    checkAutomaticATO();
    updateRoutePanel();

    document.getElementById("status").textContent = "GNSS active";
}

function updateMap(lat, lon, accuracy) {
    const latlon = [lat, lon];

    ownshipMarker.setLatLng(latlon);

    accuracyCircle.setLatLng(latlon);
    accuracyCircle.setRadius(accuracy);

    if (followPosition) {
        map.setView(latlon, map.getZoom());
    }
}

function updateGNSSPanel(lat, lon, accuracy, speed, heading) {
    document.getElementById("lat").textContent = lat.toFixed(6);
    document.getElementById("lon").textContent = lon.toFixed(6);
    document.getElementById("accuracy").textContent = `${accuracy.toFixed(0)} m`;

    if (speed !== null) {
        const speedKmh = speed * 3.6;
        document.getElementById("speed").textContent = `${speedKmh.toFixed(1)} km/h`;
    } else {
        document.getElementById("speed").textContent = "---";
    }

    if (heading !== null) {
        document.getElementById("heading").textContent = `${heading.toFixed(0)}°`;
    } else {
        document.getElementById("heading").textContent = "---";
    }
}

function handlePositionError(error) {
    let message = "GNSS error";

    switch (error.code) {
        case error.PERMISSION_DENIED:
            message = "Location permission denied";
            break;
        case error.POSITION_UNAVAILABLE:
            message = "Position unavailable";
            break;
        case error.TIMEOUT:
            message = "GNSS timeout";
            break;
    }

    document.getElementById("status").textContent = message;
    console.error(error);
}

async function loadRoute() {
    try {
        const response = await fetch("routes/test_route.json");

        if (!response.ok) {
            throw new Error("Could not load route file");
        }

        routeData = await response.json();

        initialiseWaypointStatus();
        drawRoute();
        updateRoutePanel();

        document.getElementById("status").textContent = "Route loaded";
    } catch (error) {
        console.error(error);
        document.getElementById("status").textContent = "Route loading error";
    }
}

function initialiseWaypointStatus() {
    waypointStatus = routeData.waypoints.map(() => {
        return {
            checked: false,
            ato: null,
            method: null
        };
    });

    // We normally start navigating TO waypoint 1.
    // Waypoint 0 is the route origin.
    activeWpIndex = 1;

    // Optional: mark START as already checked at load time.
    // For now we leave it unchecked, because later we may want a START ROUTE button.
}

function drawRoute() {
    if (!routeData || !routeData.waypoints) {
        return;
    }

    const latlngs = routeData.waypoints.map(wp => [wp.lat, wp.lon]);

    if (routeLine) {
        map.removeLayer(routeLine);
    }

    waypointMarkers.forEach(marker => map.removeLayer(marker));
    waypointMarkers = [];

    routeLine = L.polyline(latlngs, {
        weight: 4
    }).addTo(map);

    routeData.waypoints.forEach((wp, index) => {
        const marker = L.marker([wp.lat, wp.lon]).addTo(map);

        marker.bindPopup(
            `<strong>${wp.name}</strong><br>${wp.note || ""}`
        );

        waypointMarkers.push(marker);
    });

    map.fitBounds(routeLine.getBounds(), {
        padding: [40, 40]
    });
}

function updateRoutePanel() {
    if (!routeData || !routeData.waypoints || routeData.waypoints.length < 2) {
        setRoutePanelEmpty();
        return;
    }

    const waypoints = routeData.waypoints;

    if (activeWpIndex < 1) {
        activeWpIndex = 1;
    }

    if (activeWpIndex >= waypoints.length) {
        activeWpIndex = waypoints.length - 1;
    }

    const previousWp = waypoints[activeWpIndex - 1];
    const nextWp = waypoints[activeWpIndex];
    const nextStatus = waypointStatus[activeWpIndex];

    document.getElementById("routeName").textContent = routeData.route_name || "---";
    document.getElementById("currentLeg").textContent = `${previousWp.name} → ${nextWp.name}`;
    document.getElementById("nextPoint").textContent = nextWp.name;
    document.getElementById("wpNote").textContent = nextWp.note || "---";

    if (nextStatus && nextStatus.checked && nextStatus.ato) {
        document.getElementById("atoNext").textContent = formatTime(nextStatus.ato);
        document.getElementById("atoMethod").textContent = nextStatus.method.toUpperCase();
    } else {
        document.getElementById("atoNext").textContent = "---";
        document.getElementById("atoMethod").textContent = "---";
    }

    updateAutoAtoStatusText();

    if (lastPosition) {
        const distKm = distanceKm(
            lastPosition.lat,
            lastPosition.lon,
            nextWp.lat,
            nextWp.lon
        );

        document.getElementById("distNext").textContent = `${distKm.toFixed(1)} km`;

        const speedKmh = getNavigationSpeedKmh();

        if (speedKmh > 1) {
            const etoDate = calculateETO(distKm, speedKmh);
            document.getElementById("etoNext").textContent = formatTime(etoDate);
        } else {
            document.getElementById("etoNext").textContent = "---";
        }
    } else {
        document.getElementById("distNext").textContent = "---";
        document.getElementById("etoNext").textContent = "---";
    }
}

function setRoutePanelEmpty() {
    document.getElementById("routeName").textContent = "---";
    document.getElementById("currentLeg").textContent = "---";
    document.getElementById("nextPoint").textContent = "---";
    document.getElementById("distNext").textContent = "---";
    document.getElementById("etoNext").textContent = "---";
    document.getElementById("atoNext").textContent = "---";
    document.getElementById("atoMethod").textContent = "---";
    document.getElementById("autoAtoStatus").textContent = "---";
    document.getElementById("wpNote").textContent = "---";
}

function getNavigationSpeedKmh() {
    if (lastPosition && lastPosition.speed !== null && lastPosition.speed > 1) {
        return lastPosition.speed * 3.6;
    }

    if (routeData && routeData.planned_speed_kmh) {
        return routeData.planned_speed_kmh;
    }

    return 0;
}

function calculateETO(distanceKm, speedKmh) {
    const hours = distanceKm / speedKmh;
    const milliseconds = hours * 60 * 60 * 1000;

    return new Date(Date.now() + milliseconds);
}

function checkAutomaticATO() {
    if (!routeData || !lastPosition) {
        resetAutoAtoCandidate();
        return;
    }

    if (routeData.auto_ato_enabled === false) {
        resetAutoAtoCandidate();
        return;
    }

    const waypoints = routeData.waypoints;

    if (activeWpIndex < 1 || activeWpIndex >= waypoints.length) {
        resetAutoAtoCandidate();
        return;
    }

    const nextStatus = waypointStatus[activeWpIndex];

    if (nextStatus && nextStatus.checked) {
        resetAutoAtoCandidate();
        return;
    }

    const nextWp = waypoints[activeWpIndex];

    const distanceM = distanceKm(
        lastPosition.lat,
        lastPosition.lon,
        nextWp.lat,
        nextWp.lon
    ) * 1000;

    const radiusM = nextWp.auto_radius_m ||
        routeData.default_auto_radius_m ||
        150;

    const accuracyLimitM =
        routeData.default_accuracy_limit_m ||
        75;

    const confirmationSeconds =
        routeData.auto_confirmation_seconds ||
        3;

    const gnssGood = lastPosition.accuracy <= accuracyLimitM;
    const insideZone = distanceM <= radiusM;

    if (!gnssGood || !insideZone) {
        resetAutoAtoCandidate();
        return;
    }

    const now = Date.now();

    if (autoAtoCandidateIndex !== activeWpIndex) {
        autoAtoCandidateIndex = activeWpIndex;
        autoAtoCandidateStartTime = now;
        return;
    }

    const elapsedSeconds = (now - autoAtoCandidateStartTime) / 1000;

    if (elapsedSeconds >= confirmationSeconds) {
        recordATO("auto");
        resetAutoAtoCandidate();
    }
}

function updateAutoAtoStatusText() {
    const el = document.getElementById("autoAtoStatus");

    if (!routeData || !lastPosition) {
        el.textContent = "---";
        return;
    }

    if (routeData.auto_ato_enabled === false) {
        el.textContent = "OFF";
        return;
    }

    if (autoAtoCandidateIndex === activeWpIndex && autoAtoCandidateStartTime !== null) {
        const confirmationSeconds =
            routeData.auto_confirmation_seconds ||
            3;

        const elapsedSeconds = (Date.now() - autoAtoCandidateStartTime) / 1000;
        const remainingSeconds = Math.max(0, confirmationSeconds - elapsedSeconds);

        el.textContent = `CONFIRMING ${remainingSeconds.toFixed(1)}s`;
        return;
    }

    el.textContent = "ARMED";
}

function resetAutoAtoCandidate() {
    autoAtoCandidateIndex = null;
    autoAtoCandidateStartTime = null;
}

function recordATO(method) {
    if (!routeData || !routeData.waypoints) {
        return;
    }

    if (activeWpIndex < 1 || activeWpIndex >= routeData.waypoints.length) {
        return;
    }

    const status = waypointStatus[activeWpIndex];

    if (status.checked) {
        return;
    }

    status.checked = true;
    status.ato = new Date();
    status.method = method;

    const wpName = routeData.waypoints[activeWpIndex].name;
    document.getElementById("status").textContent =
        `${wpName} ATO recorded (${method.toUpperCase()})`;

    advanceToNextWaypoint();
    updateRoutePanel();
}

function advanceToNextWaypoint() {
    if (!routeData || !routeData.waypoints) {
        return;
    }

    if (activeWpIndex < routeData.waypoints.length - 1) {
        activeWpIndex++;
    }
}

function formatTime(date) {
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km

    const dLat = degreesToRadians(lat2 - lat1);
    const dLon = degreesToRadians(lon2 - lon1);

    const rLat1 = degreesToRadians(lat1);
    const rLat2 = degreesToRadians(lat2);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(rLat1) * Math.cos(rLat2) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
}

document.getElementById("centerBtn").addEventListener("click", () => {
    if (lastPosition) {
        followPosition = true;
        map.setView([lastPosition.lat, lastPosition.lon], 16);
        document.getElementById("status").textContent = "Following GNSS position";
    }
});

document.getElementById("prevWpBtn").addEventListener("click", () => {
    if (!routeData) {
        return;
    }

    activeWpIndex--;

    if (activeWpIndex < 1) {
        activeWpIndex = 1;
    }

    resetAutoAtoCandidate();
    updateRoutePanel();
});

document.getElementById("nextWpBtn").addEventListener("click", () => {
    if (!routeData) {
        return;
    }

    activeWpIndex++;

    if (activeWpIndex >= routeData.waypoints.length) {
        activeWpIndex = routeData.waypoints.length - 1;
    }

    resetAutoAtoCandidate();
    updateRoutePanel();
});

document.getElementById("markAtoBtn").addEventListener("click", () => {
    recordATO("manual");
});

initMap();
loadRoute();
startGNSS();