// ─────────────────────────────────────────────────────────────
//  1. Firebase Console → ⚙️ Paramètres du projet → Vos applications
//     → ajoute une application Web (</>) → copie les valeurs ici.
//  Ces valeurs ne sont pas secrètes : ce sont les règles Firestore
//  (fichier firestore.rules) qui protègent tes données.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "VOTRE_PROJET.firebaseapp.com",
  projectId: "VOTRE_PROJET",
  storageBucket: "VOTRE_PROJET.firebasestorage.app",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId: "VOTRE_APP_ID",
};

// ─────────────────────────────────────────────────────────────
//  2. (Facultatif) Notifications push quand l'appli est fermée.
//  Firebase Console → Paramètres du projet → Cloud Messaging
//  → « Certificats Web Push » → Générer une paire de clés
//  → colle la clé publique ici. Laisse tel quel pour désactiver.
// ─────────────────────────────────────────────────────────────
export const VAPID_KEY = "VOTRE_CLE_VAPID";
