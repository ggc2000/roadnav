let map;
let ownshipMarker;
let accuracyCircle;
let lastPosition = null;
let followPosition = true;

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
    updatePanel(lat, lon, accuracy, speed, heading);

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

function updatePanel(lat, lon, accuracy, speed, heading) {
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

document.getElementById("centerBtn").addEventListener("click", () => {
    if (lastPosition) {
        followPosition = true;
        map.setView([lastPosition.lat, lastPosition.lon], 16);
        document.getElementById("status").textContent = "Following GNSS position";
    }
});

initMap();
startGNSS();