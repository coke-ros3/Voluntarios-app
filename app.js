import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, collection, onSnapshot, query, orderBy, setDoc, doc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

/* =======================================================
   CONFIGURACIÓN
   ======================================================= */
const firebaseConfig = {
    apiKey: "AIzaSyA-NIM0pbgU2w85mWFhqUEkbA3L0_NrimI",
    authDomain: "despachador-58fb8.firebaseapp.com",
    projectId: "despachador-58fb8",
    storageBucket: "despachador-58fb8.firebasestorage.app",
    messagingSenderId: "1024295745401",
    appId: "1:1024295745401:web:8d49683a86a8b1ff7aa1a8"
};
const VAPID_KEY = "BJAd0EQok-Gy4tA4ZkpvXinuLauwqk6cT70j-64zaFEj5tIgp2wLc81MFiN6tc_aspi2-TAiBoYkKJzozIAxcaw";
const DEFAULT_LATLNG = { lat: -38.7446590, lng: -72.9521597 }; // Nueva Imperial
const RECENT_MINUTES = 15; // ventana para marcar un despacho como "reciente" en la lista

/* =======================================================
   FIREBASE
   ======================================================= */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);

/* =======================================================
   REFERENCIAS DOM
   ======================================================= */
const $ = (id) => document.getElementById(id);

const feedEl = $("feed");
const statusDot = $("status-dot");
const statusText = $("status-text");
const fabNotif = $("fab-notif");

const backdrop = $("backdrop");
const sheet = $("sheet");
const sheetHandleZone = $("sheet-handle-zone");
const sheetScroll = $("sheet-scroll");
const sheetClose = $("sheet-close");
const sheetCode = $("sheet-code");
const terminalTime = $("terminal-time");
const terminalDate = $("terminal-date");
const detAtentado = $("det-atentado");
const detObs = $("det-obs");
const detUnits = $("det-units");
const detFooterTime = $("det-footer-time");
const btnRecenter = $("btn-recenter");

/* =======================================================
   UTILIDADES
   ======================================================= */
function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function formatTimestamp(ts) {
    if (!ts || typeof ts.toDate !== "function") {
        return { time: "--:--:--", date: "--/--/----", full: "", ms: 0 };
    }
    const d = ts.toDate();
    const time = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const date = d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
    return { time, date, full: `${date} ${time}`, ms: d.getTime() };
}

function isRecent(ts) {
    if (!ts || typeof ts.toDate !== "function") return false;
    return (Date.now() - ts.toDate().getTime()) < RECENT_MINUTES * 60 * 1000;
}

/* =======================================================
   ESTADO DE CONEXIÓN
   ======================================================= */
function setStatus(state) {
    statusDot.classList.remove("is-live", "is-offline");
    if (state === "live") {
        statusDot.classList.add("is-live");
        statusText.textContent = "En línea";
    } else if (state === "offline") {
        statusDot.classList.add("is-offline");
        statusText.textContent = "Sin conexión";
    } else {
        statusText.textContent = "Conectando…";
    }
}

window.addEventListener("online", () => setStatus("live"));
window.addEventListener("offline", () => setStatus("offline"));

/* =======================================================
   SKELETON
   ======================================================= */
function renderSkeleton(count = 4) {
    feedEl.innerHTML = Array.from({ length: count }).map(() => `
        <div class="ticket skeleton">
            <div class="ticket__led"></div>
            <div class="ticket__body">
                <div class="bone bone--time"></div>
                <div class="bone bone--title"></div>
                <div class="bone bone--title2" style="margin-top:6px;"></div>
            </div>
        </div>
    `).join("");
}

renderSkeleton();

/* =======================================================
   FEED EN TIEMPO REAL
   ======================================================= */
const emergencyCache = new Map();

const feedQuery = query(collection(db, "emergencias_activas"), orderBy("timestamp", "desc"));

onSnapshot(feedQuery, (snapshot) => {
    setStatus(snapshot.metadata.fromCache ? "offline" : "live");

    if (snapshot.empty) {
        feedEl.innerHTML = `
            <div class="feed__empty">
                <strong>Sin despachos activos</strong>
                En cuanto se genere una nueva alerta, aparecerá aquí al instante.
            </div>`;
        return;
    }

    emergencyCache.clear();
    feedEl.innerHTML = "";

    snapshot.forEach((docSnap) => {
        const em = docSnap.data();
        emergencyCache.set(docSnap.id, em);

        const { time, date } = formatTimestamp(em.timestamp);
        const units = em.units || [];
        const recent = isRecent(em.timestamp);

        const item = document.createElement("div");
        item.className = `ticket${recent ? " ticket--recent" : ""}`;
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.innerHTML = `
            <div class="ticket__led"></div>
            <div class="ticket__body">
                <span class="ticket__time">${time} · ${date}</span>
                <div class="ticket__title"><span class="code">${escapeHtml(em.code || "")}</span>${escapeHtml(em.address || "")}</div>
                ${units.length ? `<div class="ticket__units">${units.map(u => `<span class="chip">${escapeHtml(u)}</span>`).join("")}</div>` : ""}
            </div>
            <svg class="ticket__chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
        `;
        const openThis = () => openSheet(em);
        item.addEventListener("click", openThis);
        item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openThis(); } });

        feedEl.appendChild(item);
    });
}, (error) => {
    console.error("Error escuchando emergencias:", error);
    setStatus("offline");
});

/* =======================================================
   SHEET DE DETALLE
   ======================================================= */
let map = null;
let marker = null;
let currentLatLng = DEFAULT_LATLNG;
let mapInitTimer = null;

function openSheet(em) {
    const { time, date, full } = formatTimestamp(em.timestamp);
    const units = em.units || [];

    sheetCode.innerHTML = `<span class="code">${escapeHtml(em.code || "")}</span>${escapeHtml(em.address || "")}`;
    terminalTime.textContent = time;
    terminalDate.textContent = date;
    detObs.textContent = em.obs || "Sin observaciones al despacho.";
    detAtentado.classList.toggle("is-visible", Boolean(em.isAtentado));
    detFooterTime.textContent = full ? `Despacho registrado · ${full}` : "—";

    detUnits.innerHTML = units.map(u => `<span class="chip">${escapeHtml(u)}</span>`).join("");

    currentLatLng = em.markerLatLng ? em.markerLatLng : DEFAULT_LATLNG;
    const { lat, lng } = currentLatLng;

    $("btn-waze").onclick = () => { window.location.href = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`; };
    $("btn-gmaps").onclick = () => { window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; };
    $("btn-amaps").onclick = () => { window.location.href = `http://maps.apple.com/?daddr=${lat},${lng}`; };

    backdrop.classList.add("is-open");
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    clearTimeout(mapInitTimer);
    mapInitTimer = setTimeout(() => initOrUpdateMap(lat, lng), 380);
}

function closeSheet() {
    backdrop.classList.remove("is-open");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
}

sheetClose.addEventListener("click", closeSheet);
backdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

btnRecenter.addEventListener("click", () => {
    if (map) map.setView([currentLatLng.lat, currentLatLng.lng], 16, { animate: true });
});

/* =======================================================
   MAPA (Leaflet, inicializado de forma perezosa)
   ======================================================= */
function initOrUpdateMap(lat, lng) {
    if (!map) {
        map = L.map("map-voluntarios", { zoomControl: false, attributionControl: false });
        L.tileLayer(
            "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=pk.eyJ1Ijoiam9yZ2VsYW5kZXIiLCJhIjoiY21yazBmNngzMDBiNDJ5b2pkMjF3dHljbCJ9.cbcHOpTihe9Y-9l6HZHjAw",
            { maxZoom: 19 }
        ).addTo(map);
    }

    map.setView([lat, lng], 16);

    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41]
        })
    }).addTo(map);

    map.invalidateSize();
}

/* =======================================================
   GESTO: ARRASTRAR PARA CERRAR EL SHEET
   ======================================================= */
(function enableDragToDismiss() {
    let startY = 0;
    let currentY = 0;
    let dragging = false;

    function onPointerDown(e) {
        dragging = true;
        startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        sheet.classList.add("is-dragging");
        sheetHandleZone.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
        if (!dragging) return;
        currentY = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - startY;
        if (currentY < 0) currentY = 0;
        sheet.style.transform = `translateY(${currentY}px)`;
    }

    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove("is-dragging");
        sheet.style.transform = "";
        if (currentY > 120) {
            closeSheet();
        }
        currentY = 0;
    }

    sheetHandleZone.addEventListener("pointerdown", onPointerDown);
    sheetHandleZone.addEventListener("pointermove", onPointerMove);
    sheetHandleZone.addEventListener("pointerup", onPointerUp);
    sheetHandleZone.addEventListener("pointercancel", onPointerUp);

    // También permite iniciar el arrastre desde el header si el contenido está en el tope del scroll
    sheetScroll.addEventListener("touchstart", (e) => {
        if (sheetScroll.scrollTop <= 0) {
            startY = e.touches[0].clientY;
        }
    }, { passive: true });
})();

/* =======================================================
   NOTIFICACIONES PUSH
   ======================================================= */
function setFabState(state) {
    fabNotif.classList.toggle("is-active", state === "active");
    fabNotif.disabled = state === "loading";
    fabNotif.innerHTML = state === "loading"
        ? '<span class="spinner"></span>'
        : state === "active"
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
}

async function activarNotificaciones() {
    if (Notification.permission === "granted") return; // ya activo
    setFabState("loading");

    try {
        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
            setFabState("idle");
            alert("Permiso denegado. No recibirás alarmas en este dispositivo.");
            return;
        }

        const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });

        if (!currentToken) {
            setFabState("idle");
            alert("No se pudo generar la llave del dispositivo. Intenta nuevamente.");
            return;
        }

        await setDoc(doc(db, "tokens_voluntarios", currentToken), {
            token: currentToken,
            plataforma: navigator.userAgent,
            fecha_registro: Date.now()
        });

        setFabState("active");
    } catch (error) {
        console.error("Error activando push:", error);
        setFabState("idle");
        alert("Error al activar las notificaciones. En iPhone: abre esta página en Safari, toca 'Compartir' → 'Añadir a inicio', y activa las alertas desde el ícono en tu pantalla principal.");
    }
}

fabNotif.addEventListener("click", activarNotificaciones);

if (Notification.permission === "granted") setFabState("active");

onMessage(messaging, (payload) => {
    alert(`🚨 ${payload.notification?.title || "Alerta"}\n${payload.notification?.body || ""}`);
});
