import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, collection, onSnapshot, query, orderBy, setDoc, deleteDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import {
    getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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
const TOKEN_STORAGE_KEY = "bomberos_push_token"; // recuerda el token activo en este dispositivo
const EMAIL_DOMAIN = "bomberosni.internal"; // dominio interno: el número de registro se traduce a un correo ficticio para Firebase Auth

// Mismo código de colores por tipo de clave que usa Central, para reconocer
// el tipo de emergencia de un vistazo (rojo = estructural/apoyo, celeste = pastizal,
// verde = rescate, naranja = químico/gas, gris = servicios/administrativo).
const CODE_COLORS = {
    "10-0":  { light: "#D32F2F", navy: "#FF6B6B" },
    "10-1":  { light: "#D32F2F", navy: "#FF6B6B" },
    "10-2":  { light: "#0288D1", navy: "#4FC3F7" },
    "10-3-1": { light: "#F57C00", navy: "#FFB74D" },
    "10-3-2": { light: "#8E24AA", navy: "#CE93D8" },
    "10-3":  { light: "#1E8E3E", navy: "#66BB6A" },
    "10-4":  { light: "#1E8E3E", navy: "#66BB6A" },
    "10-5":  { light: "#F57C00", navy: "#FFB74D" },
    "10-6":  { light: "#F57C00", navy: "#FFB74D" },
    "10-9-1": { light: "#D32F2F", navy: "#FF6B6B" },
    "10-12": { light: "#D32F2F", navy: "#FF6B6B" },
    "10-14": { light: "#D32F2F", navy: "#FF6B6B" },
};
const DEFAULT_CODE_COLOR = { light: "#6B7280", navy: "#B0B7C0" };

function getCodeColor(code) {
    if (!code) return DEFAULT_CODE_COLOR;
    return CODE_COLORS[code.trim()] || DEFAULT_CODE_COLOR;
}

/* =======================================================
   FIREBASE
   ======================================================= */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => console.warn("No se pudo fijar la persistencia de sesión:", err));

/* =======================================================
   REFERENCIAS DOM
   ======================================================= */
const $ = (id) => document.getElementById(id);

const loadingScreen = $("loading-screen");

const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginRegistro = $("login-registro");
const loginPassword = $("login-password");
const loginSubmit = $("login-submit");
const loginError = $("login-error");

const appShell = $("app-shell");
const btnLogout = $("btn-logout");
const userPill = $("user-pill");

const feedEl = $("feed");
const statusDot = $("status-dot");
const statusText = $("status-text");
const fabNotif = $("fab-notif");

const tabbar = $("tabbar");
const tabAlertas = $("tab-alertas");
const tabDisponibilidad = $("tab-disponibilidad");
const viewAlertas = $("view-alertas");
const viewDisponibilidad = $("view-disponibilidad");

const dispNombre = $("disp-nombre");
const dispRegistro = $("disp-registro");
const dispBanner = $("disp-banner");
const dispEstadoActual = $("disp-estado-actual");
const btnDisponible = $("btn-disponible");
const btnFuera = $("btn-fuera");

const backdrop = $("backdrop");
const sheet = $("sheet");
const sheetHandleZone = $("sheet-handle-zone");
const sheetScroll = $("sheet-scroll");
const sheetClose = $("sheet-close");
const sheetCode = $("sheet-code");
const terminalTime = $("terminal-time");
const terminalBox = document.querySelector(".terminal");
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
   AUTENTICACIÓN
   ======================================================= */
let currentUser = null;
let currentProfile = null;
let authResolved = false;

function hideLoadingScreen() {
    if (!authResolved) {
        authResolved = true;
        loadingScreen.hidden = true;
    }
}

function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.add("is-visible");
}

function hideLoginError() {
    loginError.textContent = "";
    loginError.classList.remove("is-visible");
}

function setLoginLoading(isLoading) {
    loginSubmit.disabled = isLoading;
    loginSubmit.textContent = isLoading ? "Ingresando…" : "Ingresar";
}

function friendlyAuthError(code) {
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Número de registro o contraseña incorrectos.";
        case "auth/too-many-requests":
            return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
        case "auth/network-request-failed":
            return "Sin conexión a internet. Revisa tu red.";
        default:
            return "No se pudo iniciar sesión. Intenta nuevamente.";
    }
}

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideLoginError();

    const registro = loginRegistro.value.trim();
    const password = loginPassword.value;
    if (!registro || !password) return;

    setLoginLoading(true);
    try {
        const email = `${registro}@${EMAIL_DOMAIN}`;
        await signInWithEmailAndPassword(auth, email, password);
        loginPassword.value = "";
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        showLoginError(friendlyAuthError(error.code));
    } finally {
        setLoginLoading(false);
    }
});

btnLogout.addEventListener("click", () => {
    if (confirm("¿Cerrar sesión en este dispositivo?")) {
        signOut(auth).catch((err) => console.error("Error al cerrar sesión:", err));
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const profileSnap = await getDoc(doc(db, "bomberos", user.uid));
            if (!profileSnap.exists()) {
                showLoginError("Tu cuenta no tiene un perfil asignado. Contacta a Central.");
                await signOut(auth);
                hideLoadingScreen();
                return;
            }
            currentUser = user;
            currentProfile = profileSnap.data();
            enterApp();
        } catch (error) {
            console.error("Error verificando perfil de bombero:", error);
            showLoginError("No se pudo verificar tu cuenta. Intenta nuevamente.");
            await signOut(auth).catch(() => {});
        }
    } else {
        currentUser = null;
        currentProfile = null;
        exitApp();
    }
    hideLoadingScreen();
});

/* =======================================================
   ENTRAR / SALIR DE LA APP
   ======================================================= */
let feedUnsubscribe = null;
let dispoUnsubscribe = null;

function enterApp() {
    loginScreen.hidden = true;
    appShell.hidden = false;
    loginForm.reset();
    hideLoginError();

    const nombre = currentProfile.nombreCompleto || `Bombero ${currentProfile.numeroRegistro || ""}`;
    userPill.textContent = nombre;

    const esMaquinista = Boolean(currentProfile.esMaquinista);
    tabDisponibilidad.hidden = !esMaquinista;

    if (dispoUnsubscribe) { dispoUnsubscribe(); dispoUnsubscribe = null; }

    if (esMaquinista) {
        dispNombre.textContent = nombre;
        dispRegistro.textContent = `Reg. ${currentProfile.numeroRegistro || "—"}`;
        dispoUnsubscribe = onSnapshot(doc(db, "maquinistas", currentUser.uid), (snap) => {
            updateDispBanner(snap.exists() ? snap.data().estado : null);
        }, (err) => console.error("Error leyendo disponibilidad:", err));
    } else {
        switchTab("view-alertas");
    }

    startFeedListener();
}

function exitApp() {
    appShell.hidden = true;
    loginScreen.hidden = false;

    closeSheet();
    switchTab("view-alertas");

    if (feedUnsubscribe) { feedUnsubscribe(); feedUnsubscribe = null; }
    if (dispoUnsubscribe) { dispoUnsubscribe(); dispoUnsubscribe = null; }

    feedEl.innerHTML = "";
    setStatus("idle");
}

/* =======================================================
   PESTAÑAS: ALERTAS / DISPONIBILIDAD
   ======================================================= */
function switchTab(viewId) {
    [viewAlertas, viewDisponibilidad].forEach((view) => {
        const active = view.id === viewId;
        view.hidden = !active;
        view.classList.toggle("is-active", active);
    });
    [tabAlertas, tabDisponibilidad].forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.view === viewId);
    });
}

tabAlertas.addEventListener("click", () => switchTab("view-alertas"));
tabDisponibilidad.addEventListener("click", () => switchTab("view-disponibilidad"));

/* =======================================================
   DISPONIBILIDAD (MAQUINISTAS)
   ======================================================= */
function updateDispBanner(estado) {
    dispBanner.classList.remove("is-on", "is-off");
    btnDisponible.classList.remove("is-selected");
    btnFuera.classList.remove("is-selected");

    if (estado === "disponible") {
        dispBanner.classList.add("is-on");
        dispEstadoActual.textContent = "Disponible";
        btnDisponible.classList.add("is-selected");
    } else if (estado === "fuera") {
        dispBanner.classList.add("is-off");
        dispEstadoActual.textContent = "Fuera de servicio";
        btnFuera.classList.add("is-selected");
    } else {
        dispEstadoActual.textContent = "Sin reportar";
    }
}

async function reportarDisponibilidad(estado) {
    if (!currentUser || !currentProfile) return;
    try {
        await setDoc(doc(db, "maquinistas", currentUser.uid), {
            nombre: currentProfile.nombreCompleto || "",
            numeroRegistro: currentProfile.numeroRegistro || "",
            estado,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Error al reportar disponibilidad:", error);
        alert("No se pudo actualizar tu estado. Revisa tu conexión e intenta nuevamente.");
    }
}

btnDisponible.addEventListener("click", () => reportarDisponibilidad("disponible"));
btnFuera.addEventListener("click", () => reportarDisponibilidad("fuera"));

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

window.addEventListener("online", () => { if (currentUser) setStatus("live"); });
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

/* =======================================================
   FEED EN TIEMPO REAL
   ======================================================= */
const emergencyCache = new Map();
const feedQuery = query(collection(db, "emergencias_activas"), orderBy("timestamp", "desc"));

function startFeedListener() {
    if (feedUnsubscribe) feedUnsubscribe();
    renderSkeleton();

    feedUnsubscribe = onSnapshot(feedQuery, (snapshot) => {
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
            const codeColor = getCodeColor(em.code);
            item.style.setProperty("--code-color", codeColor.light);
            item.innerHTML = `
                <div class="ticket__led"></div>
                <div class="ticket__body">
                    <span class="ticket__time">${time} · ${date}</span>
                    <div class="ticket__title"><span class="code" style="color:${codeColor.light}">${escapeHtml(em.code || "")}</span>${escapeHtml(em.address || "")}</div>
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
}

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
    const codeColor = getCodeColor(em.code);

    sheetCode.innerHTML = `<span class="code" style="color:${codeColor.navy}">${escapeHtml(em.code || "")}</span>${escapeHtml(em.address || "")}`;
    terminalTime.textContent = time;
    if (terminalBox) terminalBox.style.borderLeft = `4px solid ${codeColor.navy}`;
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
            "https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=pk.eyJ1Ijoiam9yZ2VsYW5kZXIiLCJhIjoiY21yazBmNngzMDBiNDJ5b2pkMjF3dHljbCJ9.cbcHOpTihe9Y-9l6HZHjAw",
            { maxZoom: 19 }
        ).addTo(map);
    }

    map.setView([lat, lng], 16);

    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
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
const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function setFabState(state) {
    // state: "idle" (inactivo) | "loading" | "active"
    fabNotif.dataset.state = state;
    fabNotif.classList.toggle("is-active", state === "active");
    fabNotif.disabled = state === "loading";
    fabNotif.setAttribute("aria-label", state === "active" ? "Desactivar alertas push" : "Activar alertas push");

    if (state === "loading") {
        fabNotif.innerHTML = '<span class="spinner"></span>';
    } else if (state === "active") {
        fabNotif.innerHTML = ICON_CHECK;
    } else {
        fabNotif.innerHTML = ICON_BELL;
    }
}

async function activarNotificaciones() {
    if (typeof Notification === "undefined") {
        alert("Este navegador no soporta notificaciones push. En iPhone, ábrelo con Safari y agrégalo a tu pantalla de inicio antes de activarlas.");
        return;
    }

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
            fecha_registro: Date.now(),
            uid: currentUser ? currentUser.uid : null,
            numeroRegistro: currentProfile ? currentProfile.numeroRegistro || null : null
        });

        localStorage.setItem(TOKEN_STORAGE_KEY, currentToken);
        setFabState("active");
    } catch (error) {
        console.error("Error activando push:", error);
        setFabState("idle");
        alert("Error al activar las notificaciones. En iPhone: abre esta página en Safari, toca 'Compartir' → 'Añadir a inicio', y activa las alertas desde el ícono en tu pantalla principal.");
    }
}

async function desactivarNotificaciones() {
    const confirmado = confirm("¿Seguro que quieres desactivar las alertas? Ya no recibirás avisos de nuevos despachos en este dispositivo.");
    if (!confirmado) return;

    setFabState("loading");
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);

    try {
        if (storedToken) {
            await deleteDoc(doc(db, "tokens_voluntarios", storedToken)).catch((err) => {
                // Si el documento ya no existe o falla el borrado remoto, igual seguimos desactivando localmente
                console.warn("No se pudo borrar el token en Firestore:", err);
            });
        }
        await deleteToken(messaging).catch((err) => {
            console.warn("No se pudo revocar el token en Firebase Messaging:", err);
        });
    } finally {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setFabState("idle");
    }
}

fabNotif.addEventListener("click", () => {
    if (fabNotif.dataset.state === "active") {
        desactivarNotificaciones();
    } else if (fabNotif.dataset.state !== "loading") {
        activarNotificaciones();
    }
});

// Estado inicial: solo se considera "activo" si el navegador soporta notificaciones,
// hay permiso Y un token registrado en este dispositivo. Si "Notification" no existe
// (algunos navegadores embebidos/webviews no lo soportan), no debe romper el resto de la app.
const supportsNotifications = typeof Notification !== "undefined";
if (!supportsNotifications) {
    fabNotif.disabled = true;
    fabNotif.style.opacity = "0.4";
} else if (Notification.permission === "granted" && localStorage.getItem(TOKEN_STORAGE_KEY)) {
    setFabState("active");
} else {
    setFabState("idle");
}

onMessage(messaging, (payload) => {
    alert(`🚨 ${payload.notification?.title || "Alerta"}\n${payload.notification?.body || ""}`);
});
