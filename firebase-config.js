// ─────────────────────────────────────────────────────────────
//  1. Firebase Console → ⚙️ Paramètres du projet → Vos applications
//     → ajoute une application Web (</>) → copie les valeurs ici.
//  Ces valeurs ne sont pas secrètes : ce sont les règles Firestore
//  (fichier firestore.rules) qui protègent tes données.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyDz2YEru-u76xwLzn6LWvi8vKWhiGplRik",
  authDomain: "noel-whishlist.firebaseapp.com",
  projectId: "noel-whishlist",
  storageBucket: "noel-whishlist.firebasestorage.app",
  messagingSenderId: "709351505120",
  appId: "1:709351505120:web:7fdb7f3fd78a7c1c002485",
};

// ─────────────────────────────────────────────────────────────
//  2. (Facultatif) Notifications push quand l'appli est fermée.
//  Firebase Console → Paramètres du projet → Cloud Messaging
//  → « Certificats Web Push » → Générer une paire de clés
//  → colle la clé publique ici. Laisse tel quel pour désactiver.
// ─────────────────────────────────────────────────────────────
export const VAPID_KEY = "VOTRE_CLE_VAPID";
