let map;
let ownshipMarker;
let accuracyCircle;
let lastPosition = null;
let followPosition = true;

let routeData = null;
let routeLine = null;
let waypointMarkers = [];
let activeWpIndex = 1; 
// activeWpIndex means: the next waypoint we are navigating to.
// So if activeWpIndex = 1, current leg is waypoint 0 -> waypoint 1.

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

        drawRoute();
        updateRoutePanel();

        document.getElementById("status").textContent = "Route loaded";
    } catch (error) {
        console.error(error);
        document.getElementById("status").textContent = "Route loading error";
    }
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
        document.getElementById("routeName").textContent = "---";
        document.getElementById("currentLeg").textContent = "---";
        document.getElementById("nextPoint").textContent = "---";
        document.getElementById("distNext").textContent = "---";
        document.getElementById("etoNext").textContent = "---";
        document.getElementById("wpNote").textContent = "---";
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

    document.getElementById("routeName").textContent = routeData.route_name || "---";
    document.getElementById("currentLeg").textContent = `${previousWp.name} → ${nextWp.name}`;
    document.getElementById("nextPoint").textContent = nextWp.name;
    document.getElementById("wpNote").textContent = nextWp.note || "---";

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

    updateRoutePanel();
});

initMap();
loadRoute();
startGNSS();