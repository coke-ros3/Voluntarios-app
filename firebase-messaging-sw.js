// Importamos las versiones "compat" de Firebase 10.8.1 que son necesarias para que el Service Worker funcione sin problemas en PWA.
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// La misma configuración de tu base de datos
firebase.initializeApp({
    apiKey: "AIzaSyA-NIM0pbgU2w85mWFhqUEkbA3L0_NrimI",
    authDomain: "despachador-58fb8.firebaseapp.com",
    projectId: "despachador-58fb8",
    storageBucket: "despachador-58fb8.firebasestorage.app",
    messagingSenderId: "1024295745401",
    appId: "1:1024295745401:web:8d49683a86a8b1ff7aa1a8"
});

// Inicializamos el servicio de mensajería en segundo plano
const messaging = firebase.messaging();

// Esta función "despierta" y lanza la alerta al celular cuando la app está cerrada o en segundo plano
messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Alerta recibida en segundo plano: ', payload);

    const notificationTitle = payload.notification.title || 'Central de Alarmas';
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/784/784115.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/784/784115.png',
        vibrate: [200, 100, 200, 100, 200, 100, 200] // Patrón de vibración de emergencia
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
