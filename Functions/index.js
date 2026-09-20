// Envoie une notification push quand quelqu'un ajoute un cadeau à sa liste.
// Respecte les choix de chacun : tout le monde / certaines personnes / personne.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

// ⚠️ À adapter : l'adresse de ton site GitHub Pages (avec le / final)
const APP_URL = "https://VOTRE-PSEUDO.github.io/liste-noel/";
// ⚠️ À adapter : la région la plus proche de ta base Firestore (ex. europe-west1)
const REGION = "europe-west1";

exports.notifyNewGift = onDocumentCreated(
  { document: "lists/{listId}/gifts/{giftId}", region: REGION },
  async (event) => {
    const gift = event.data && event.data.data();
    if (!gift) return;
    const { listId } = event.params;
    const db = admin.firestore();

    const [listSnap, membersSnap] = await Promise.all([
      db.doc(`lists/${listId}`).get(),
      db.collection(`lists/${listId}/members`).get(),
    ]);
    const listName = listSnap.get("name") || "ta liste";

    // Qui veut être prévenu ?
    const uids = [];
    membersSnap.forEach((m) => {
      if (m.id === gift.ownerId) return;
      const notify = m.get("notify") || { mode: "all", from: [] };
      const wanted =
        notify.mode === "all" ||
        (notify.mode === "some" && (notify.from || []).includes(gift.ownerId));
      if (wanted) uids.push(m.id);
    });
    if (!uids.length) return;

    // Leurs appareils
    const userSnaps = await Promise.all(uids.map((uid) => db.doc(`users/${uid}`).get()));
    const owners = {}; // token -> uid (pour nettoyer les jetons périmés)
    userSnaps.forEach((u) => (u.get("fcmTokens") || []).forEach((t) => (owners[t] = u.id)));
    const tokens = Object.keys(owners);
    if (!tokens.length) return;

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `🎁 ${gift.ownerName} a ajouté un cadeau`,
        body: `« ${gift.name} » dans ${listName}`,
      },
      webpush: {
        fcmOptions: { link: `${APP_URL}#/liste/${listId}` },
        notification: { icon: `${APP_URL}icon-192.png` },
      },
    });

    // Supprime les appareils qui ne répondent plus
    const cleanups = [];
    response.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        cleanups.push(
          db.doc(`users/${owners[tokens[i]]}`).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(tokens[i]),
          })
        );
      }
    });
    await Promise.all(cleanups);
  }
);
