// Service worker : affiche les notifications quand l'appli est fermée ou en arrière-plan.
// La config Firebase lui est passée dans l'URL par app.js (rien à modifier ici).
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const p = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: p.get("apiKey"),
  authDomain: p.get("authDomain"),
  projectId: p.get("projectId"),
  storageBucket: p.get("storageBucket"),
  messagingSenderId: p.get("messagingSenderId"),
  appId: p.get("appId"),
});

// Les messages contiennent un bloc « notification » : Firebase les affiche tout seul.
firebase.messaging();
