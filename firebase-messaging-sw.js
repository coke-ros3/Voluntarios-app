// Versiones "compat" de Firebase 10.8.1, necesarias para que el Service Worker funcione en PWA.
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyA-NIM0pbgU2w85mWFhqUEkbA3L0_NrimI",
    authDomain: "despachador-58fb8.firebaseapp.com",
    projectId: "despachador-58fb8",
    storageBucket: "despachador-58fb8.firebasestorage.app",
    messagingSenderId: "1024295745401",
    appId: "1:1024295745401:web:8d49683a86a8b1ff7aa1a8"
});

const messaging = firebase.messaging();
const ICON_URL = 'https://cdn-icons-png.flaticon.com/512/784/784115.png';

// Lanza la alerta al celular cuando la app está cerrada o en segundo plano
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Alerta recibida en segundo plano:', payload);

    const title = payload.notification?.title || payload.data?.title || 'Central de Alarmas';
    const options = {
        body: payload.notification?.body || payload.data?.body || 'Nuevo despacho activo.',
        icon: ICON_URL,
        badge: ICON_URL,
        tag: 'despacho-bomberos', // agrupa alertas para no acumular notificaciones viejas sin leer
        renotify: true,
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        data: { url: self.registration.scope }
    };

    self.registration.showNotification(title, options);
});

// Al tocar la notificación, enfoca la app si ya está abierta o la abre en una pestaña nueva
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || self.registration.scope;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
