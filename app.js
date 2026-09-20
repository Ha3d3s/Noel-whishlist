// ─────────────────────────────────────────────────────────────
//  Listes de Noël — application 100 % statique (GitHub Pages) + Firebase
//  Auth (email / mot de passe) · Firestore. Aucun serveur, forfait gratuit.
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot,
  query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ── Éléments de base ─────────────────────────────────────────
const $app = document.getElementById("app");
const $toasts = document.getElementById("toasts");
const $modal = document.getElementById("modal-root");

const configured = !String(firebaseConfig.apiKey).startsWith("VOTRE");
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const state = {
  user: null,
  view: "auth",            // auth | home | list | loading
  authMode: "login",       // login | signup
  lists: [],               // mes listes (accueil), avec leur « dernière visite »
  unsubLists: null,
  badgeSubs: new Map(),    // listId -> { since, unsub } : nouveaux cadeaux depuis ma dernière visite
  newCounts: new Map(),    // listId -> nombre de nouveaux cadeaux

  // liste ouverte
  listId: null,
  list: null,
  members: [],
  gifts: [],
  since: null,             // « dernière visite » au moment de l'ouverture
  selectedUid: null,
  unsubs: [],
  memberSubs: new Map(),   // uid -> [écoute des achats, écoute des idées secrètes]
  purchaseDocs: new Map(), // uid -> documents d'achat
  secretDocs: new Map(),   // uid -> documents d'idées / commentaires
  purchases: new Map(),    // giftId -> achat principal (jamais visible pour le destinataire)
  joins: new Map(),        // giftId -> participants à un cadeau à plusieurs
  ideas: new Map(),        // uid -> idées secrètes pour cette personne
  comments: new Map(),     // giftId / ideaId -> commentaires secrets
  thread: null,            // fil de commentaires ouvert
  signup: null,            // inscription en cours (on attend que le prénom soit enregistré)
  nameSynced: false,       // ma fiche de la liste ouverte a été remise à jour
};

// ── Petits outils ────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const myUid = () => state.user.uid;
const myName = () => state.user.displayName || (state.user.email || "Moi").split("@")[0];
const firstName = () => myName().split(" ")[0];
const startedAt = Date.now();
const ms = (t, fallback = Date.now()) => (t && typeof t.toMillis === "function" ? t.toMillis() : typeof t === "number" ? t : fallback);

function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes(".") ? parsed.href : "";
  } catch { return ""; }
}
const safeImage = (u) => (String(u || "").startsWith("data:image/") ? u : normalizeUrl(u));
const MAX_IMAGES = 5;
// Un cadeau peut avoir plusieurs photos (images). Les anciens cadeaux n'ont qu'une image (imageUrl).
const imagesOf = (item) => {
  const raw = Array.isArray(item?.images) && item.images.length ? item.images : item?.imageUrl ? [item.imageUrl] : [];
  return raw.map(safeImage).filter(Boolean).slice(0, MAX_IMAGES);
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const priceFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
function parsePrice(raw) {
  const n = parseFloat(String(raw || "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const AVATAR_COLORS = ["#ffd76a", "#f7a8b8", "#bfe3d2", "#bfd9f2", "#f9c9a5", "#d9c7f0"];
function avatar(uid, name, kind) {
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const inner = kind === "child" ? "🧸" : esc((String(name || "?").trim()[0] || "?").toUpperCase());
  return `<span class="avatar" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${inner}</span>`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1
function randomCode(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function toast(msg, ms = 4500) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  t.addEventListener("click", () => t.remove());
  $toasts.append(t);
  setTimeout(() => t.remove(), ms);
}

function friendlyError(e) {
  const code = e && e.code ? String(e.code) : "";
  const map = {
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/wrong-password": "Email ou mot de passe incorrect.",
    "auth/user-not-found": "Email ou mot de passe incorrect.",
    "auth/invalid-email": "Cette adresse email n'a pas l'air valide.",
    "auth/email-already-in-use": "Un compte existe déjà avec cet email. Connecte-toi plutôt.",
    "auth/weak-password": "Choisis un mot de passe d'au moins 6 caractères.",
    "auth/too-many-requests": "Trop d'essais. Patiente quelques minutes avant de réessayer.",
    "auth/network-request-failed": "Pas de connexion internet. Réessaie dans un instant.",
    "permission-denied": "Action non autorisée.",
  };
  return map[code] || (e && e.message) || "Oups, quelque chose s'est mal passé.";
}

// ── Guirlande lumineuse ──────────────────────────────────────
function buildLights() {
  const el = document.querySelector(".lights");
  const W = Math.max(320, document.documentElement.clientWidth);
  const n = Math.ceil(W / (W < 500 ? 120 : 170));
  const segW = W / n, sag = 26;
  const colors = ["#d7263d", "#ffd76a", "#2c9a72", "#f7a8b8", "#7cc4f0"];
  let wires = "", bulbs = "", c = 0;
  for (let i = 0; i < n; i++) {
    const x0 = i * segW, x1 = x0 + segW, xm = x0 + segW / 2;
    wires += `<path class="wire" d="M${x0} 4 Q${xm} ${4 + sag * 2} ${x1} 4"/>`;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * xm + t * t * x1;
      const y = (1 - t) ** 2 * 4 + 2 * (1 - t) * t * (4 + sag * 2) + t * t * 4;
      const color = colors[c % colors.length];
      const delay = -((c * 0.9) % 3.6).toFixed(2);
      bulbs += `<g style="color:${color}"><rect class="cap" x="${(x - 2.5).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="5" height="6" rx="1"/>` +
               `<circle class="bulb" cx="${x.toFixed(1)}" cy="${(y + 10).toFixed(1)}" r="6" fill="currentColor" style="animation-delay:${delay}s"/></g>`;
      c++;
    }
  }
  el.innerHTML = `<svg width="${W}" height="54" viewBox="0 0 ${W} 54">${wires}${bulbs}</svg>`;
}
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(buildLights, 200); });

// ── Fenêtres ─────────────────────────────────────────────────
function openModal(html, onMount) {
  closeModal();
  $modal.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = $modal.firstElementChild;
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModal(); });
  const modal = backdrop.querySelector(".modal");
  const firstInput = modal.querySelector("input:not([type=file]):not([type=radio]):not([type=checkbox]), textarea");
  if (firstInput) firstInput.focus({ preventScroll: true });
  if (onMount) onMount(modal);
}
function closeModal() { $modal.innerHTML = ""; state.thread = null; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Une image cassée disparaît au lieu d'afficher une icône moche
document.addEventListener("error", (e) => {
  if (e.target && e.target.tagName === "IMG") e.target.classList.add("broken");
}, true);

// ─────────────────────────────────────────────────────────────
//  Écran : configuration manquante
// ─────────────────────────────────────────────────────────────
function renderSetup() {
  $app.innerHTML = `
    <section class="welcome"><span class="gift-emoji">🛠️</span><h1>Presque prêt !</h1>
      <p>Ouvre le fichier <b>firebase-config.js</b> et colle-y les valeurs de ton projet Firebase. Le guide pas à pas est dans le README.</p>
    </section>`;
}

// ─────────────────────────────────────────────────────────────
//  Écran : connexion / inscription
// ─────────────────────────────────────────────────────────────
function renderAuth() {
  const signup = state.authMode === "signup";
  const joining = /^#\/rejoindre\//.test(location.hash);
  $app.innerHTML = `
    <section class="welcome">
      <span class="gift-emoji">🎁</span>
      <h1>Listes de Noël</h1>
      <p>${joining ? "Connecte-toi pour rejoindre la liste qu'on t'a envoyée 🎄"
                   : "Chacun note ses envies, tout le monde offre, personne ne gâche la surprise."}</p>
    </section>
    <form class="panel stack" id="auth-form" novalidate>
      ${signup ? `<div class="field"><label for="a-name">Ton prénom</label>
        <input class="input" id="a-name" autocomplete="given-name" maxlength="30" placeholder="Camille"></div>` : ""}
      <div class="field"><label for="a-email">Email</label>
        <input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" placeholder="camille@exemple.fr"></div>
      <div class="field"><label for="a-pass">Mot de passe</label>
        <input class="input" id="a-pass" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "6 caractères minimum" : ""}"></div>
      <div class="error" id="a-error" role="alert" hidden></div>
      <button class="btn btn-primary btn-block" type="submit">${signup ? "Créer mon compte" : "Me connecter"}</button>
      ${signup ? "" : `<button class="link-btn" type="button" data-action="reset-password">Mot de passe oublié ?</button>`}
    </form>
    <p class="switch muted">${signup ? "Déjà un compte ?" : "Nouveau ici ?"}
      <button class="link-btn" type="button" data-action="switch-auth">${signup ? "Se connecter" : "Créer un compte"}</button></p>`;

  const form = document.getElementById("auth-form");
  const errBox = document.getElementById("a-error");
  const showError = (m) => { errBox.textContent = m; errBox.hidden = !m; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const email = form.querySelector("#a-email").value.trim();
    const pass = form.querySelector("#a-pass").value;
    const name = signup ? form.querySelector("#a-name").value.trim() : "";
    if (signup && !name) return showError("Dis-nous ton prénom pour que les autres te reconnaissent.");
    if (!email || !pass) return showError("Renseigne ton email et ton mot de passe.");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (signup) {
        let done;
        state.signup = new Promise((resolve) => { done = resolve; });
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          await updateProfile(cred.user, { displayName: name });
          await setDoc(doc(db, "users", cred.user.uid), { name }, { merge: true });
        } finally { done(); state.signup = null; }
        if (state.view === "home") renderHome();
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch (err) {
      showError(friendlyError(err));
      btn.disabled = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  Écran : accueil (mes listes)
// ─────────────────────────────────────────────────────────────
function renderHome() {
  const lists = [...state.lists].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  $app.innerHTML = `
    <div class="topbar">
      <h1 class="grow">Salut ${esc(firstName())} 🎅</h1>
      <button class="icon-btn" data-action="account" aria-label="Mon compte">⚙️</button>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-action="new-list">✨ Créer une liste</button>
      <button class="btn btn-soft" data-action="join-list">🔑 Rejoindre</button>
    </div>
    <h2 class="subhead">Mes listes</h2>
    ${lists.length ? `<div class="stack">${lists.map((l) => {
      const n = state.newCounts.get(l.id) || 0;
      return `<button class="list-card" data-action="open-list" data-id="${esc(l.id)}">
        <span class="badge" aria-hidden="true">🎄</span>
        <span class="grow"><h3>${esc(l.name)}</h3>
          ${n ? `<span class="new-pill">✨ ${n} nouveau${n > 1 ? "x" : ""} cadeau${n > 1 ? "x" : ""}</span>` : ""}</span>
        <span class="go" aria-hidden="true">›</span>
      </button>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="big">🎈</span><strong>Pas encore de liste</strong>
        Crée la première (« Noël en famille », « Copains »…) ou rejoins celle d'un proche avec son code.</div>`}`;
}

// Nouveaux cadeaux (des autres) depuis ma dernière visite, pour chaque liste
function syncBadges() {
  if (!state.user) return;
  const me = myUid();
  const want = new Map(state.lists.map((l) => [l.id, ms(l.lastSeen ?? l.joinedAt, startedAt)]));
  for (const [id, b] of state.badgeSubs) {
    if (want.has(id) && want.get(id) === b.since) continue;
    b.unsub();
    state.badgeSubs.delete(id);
    if (!want.has(id)) state.newCounts.delete(id);
  }
  for (const [id, since] of want) {
    if (state.badgeSubs.has(id)) continue;
    const q = query(collection(db, "lists", id, "gifts"), where("createdAt", ">", new Date(since)));
    const unsub = onSnapshot(q, (s) => {
      const n = s.docs.filter((d) => { const g = d.data(); return g.createdBy !== me && g.ownerId !== me; }).length;
      state.newCounts.set(id, n);
      if (state.view === "home") renderHome();
    }, () => {});
    state.badgeSubs.set(id, { since, unsub });
  }
}
function stopBadges() {
  state.badgeSubs.forEach((b) => b.unsub());
  state.badgeSubs = new Map();
  state.newCounts = new Map();
}

function markSeen(listId) {
  if (!state.user || !listId) return;
  setDoc(doc(db, "users", myUid(), "myLists", listId), { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.view === "list") markSeen(state.listId);
});

function openNewListModal() {
  openModal(`
    <h2>Nouvelle liste</h2>
    <form class="stack" id="new-list-form">
      <div class="field"><label for="nl-name">Nom de la liste</label>
        <input class="input" id="nl-name" maxlength="50" placeholder="Noël en famille 2026">
        <span class="hint">Tu pourras ensuite inviter tout le monde avec un code ou un lien.</span></div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
        <button class="btn btn-primary" type="submit">Créer la liste</button></div>
    </form>`, (m) => {
    m.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#nl-name").value.trim();
      if (!name) return toast("Donne un nom à ta liste 🎄");
      e.submitter && (e.submitter.disabled = true);
      try {
        const id = randomCode();
        await setDoc(doc(db, "lists", id), { name, ownerId: myUid(), ownerName: myName(), createdAt: serverTimestamp() });
        await addMember(id);
        await setDoc(doc(db, "users", myUid(), "myLists", id), { name, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
        closeModal();
        location.hash = `#/liste/${id}`;
      } catch (err) { toast(friendlyError(err)); e.submitter && (e.submitter.disabled = false); }
    });
  });
}

function openJoinModal() {
  openModal(`
    <h2>Rejoindre une liste</h2>
    <form class="stack" id="join-form">
      <div class="field"><label for="j-code">Code de la liste</label>
        <input class="input" id="j-code" maxlength="120" autocapitalize="characters" autocomplete="off" placeholder="K7M2QX9P">
        <span class="hint">Tu peux aussi coller le lien d'invitation.</span></div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
        <button class="btn btn-primary" type="submit">Rejoindre</button></div>
    </form>`, (m) => {
    m.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = m.querySelector("#j-code").value.trim();
      const code = raw.split("/").pop().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length < 4) return toast("Ce code n'a pas l'air complet.");
      closeModal();
      location.hash = `#/rejoindre/${code}`;
    });
  });
}

async function addMember(listId) {
  await setDoc(doc(db, "lists", listId, "members", myUid()), {
    uid: myUid(), name: myName(), joinedAt: serverTimestamp(), notify: { mode: "all", from: [] },
  });
}

async function joinFlow(code) {
  state.view = "loading";
  stopList();
  $app.innerHTML = `<div class="loading">On t'ouvre la porte… 🚪</div>`;
  try {
    const mine = await getDoc(doc(db, "lists", code, "members", myUid()));
    if (!mine.exists()) {
      try { await addMember(code); }
      catch { toast("Ce code ne correspond à aucune liste 🤔"); location.hash = "#/"; return; }
    }
    const listSnap = await getDoc(doc(db, "lists", code));
    await setDoc(doc(db, "users", myUid(), "myLists", code),
      { name: listSnap.get("name") || "Liste de Noël", joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
    location.hash = `#/liste/${code}`;
  } catch (err) {
    toast(friendlyError(err));
    location.hash = "#/";
  }
}

// ─────────────────────────────────────────────────────────────
//  Écran : une liste — données en direct
// ─────────────────────────────────────────────────────────────
function stopList(saveSeen = true) {
  if (saveSeen && state.listId) markSeen(state.listId);
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.memberSubs.forEach((subs) => subs.forEach((u) => u()));
  state.memberSubs = new Map();
  state.purchaseDocs = new Map(); state.secretDocs = new Map();
  state.purchases = new Map(); state.joins = new Map(); state.ideas = new Map(); state.comments = new Map();
  state.listId = null; state.list = null; state.members = []; state.gifts = [];
  state.since = null; state.selectedUid = null; state.thread = null; state.nameSynced = false;
}

function openList(id) {
  if (state.view === "list" && state.listId === id) return;
  stopList();
  state.view = "list";
  state.listId = id;
  $app.innerHTML = `<div class="loading">Chargement de la liste… 🎄</div>`;
  const fail = (err) => {
    if (state.listId !== id) return;
    // Pas encore membre : le code de la liste suffit pour la rejoindre
    if (err && err.code === "permission-denied") { location.hash = `#/rejoindre/${id}`; return; }
    toast("Impossible d'ouvrir cette liste.");
    location.hash = "#/";
  };

  // « Nouveau » = ajouté depuis ma dernière visite
  (async () => {
    try {
      const s = await getDoc(doc(db, "users", myUid(), "myLists", id));
      if (state.listId !== id) return;
      state.since = s.exists() ? ms(s.get("lastSeen") ?? s.get("joinedAt")) : Date.now();
    } catch { state.since = Date.now(); }
    renderList();
    markSeen(id);
  })();

  state.unsubs.push(onSnapshot(doc(db, "lists", id), (s) => {
    if (!s.exists()) return fail();
    state.list = { id, ...s.data() };
    renderList();
  }, fail));

  state.unsubs.push(onSnapshot(collection(db, "lists", id, "members"), (s) => {
    state.members = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    syncOwnName();
    syncMemberListeners();
    renderList();
  }, () => {}));

  let firstGifts = true;
  state.unsubs.push(onSnapshot(query(collection(db, "lists", id, "gifts"), orderBy("createdAt", "asc")), (s) => {
    state.gifts = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!firstGifts) announceNewGifts(s.docChanges());
    firstGifts = false;
    renderList();
  }, () => {}));
}

// Achats et idées secrètes sont rangés par destinataire. On n'écoute que ceux des AUTRES :
// les règles Firestore interdisent de toute façon de lire ceux qui nous concernent.
function syncMemberListeners() {
  const me = myUid(), lid = state.listId;
  const wanted = new Set(state.members.filter((m) => m.uid !== me).map((m) => m.uid));
  for (const [uid, subs] of state.memberSubs) {
    if (wanted.has(uid)) continue;
    subs.forEach((u) => u());
    state.memberSubs.delete(uid);
    state.purchaseDocs.delete(uid);
    state.secretDocs.delete(uid);
    rebuildPurchases(); rebuildSecret();
  }
  for (const uid of wanted) {
    if (state.memberSubs.has(uid)) continue;
    const u1 = onSnapshot(collection(db, "lists", lid, "purchases", uid, "items"), (s) => {
      state.purchaseDocs.set(uid, s.docs.map((d) => ({ id: d.id, ...d.data() })));
      rebuildPurchases();
      renderList();
    }, () => {});
    const u2 = onSnapshot(collection(db, "lists", lid, "secret", uid, "items"), (s) => {
      state.secretDocs.set(uid, s.docs.map((d) => ({ id: d.id, ownerUid: uid, ...d.data() })));
      rebuildSecret();
      renderList();
      renderThread();
    }, () => {});
    state.memberSubs.set(uid, [u1, u2]);
  }
}

// Si ma fiche affiche autre chose que mon prénom (ex. le début de mon email), on la corrige toute seule
function syncOwnName() {
  if (state.nameSynced || !state.user || !state.user.displayName) return;
  const mine = state.members.find((m) => m.uid === myUid());
  if (!mine) return;
  state.nameSynced = true;
  if (mine.name !== state.user.displayName) {
    updateDoc(doc(db, "lists", state.listId, "members", myUid()), { name: state.user.displayName }).catch(() => {});
  }
}

function rebuildPurchases() {
  state.purchases = new Map();
  state.joins = new Map();
  for (const [uid, docs] of state.purchaseDocs) {
    for (const d of docs) {
      if (d.kind === "join") {
        const arr = state.joins.get(d.giftId) || [];
        arr.push(d);
        state.joins.set(d.giftId, arr);
      } else {
        state.purchases.set(d.id, { ...d, giftOwnerId: uid });
      }
    }
  }
  for (const arr of state.joins.values()) arr.sort((a, b) => ms(a.at) - ms(b.at));
}

function rebuildSecret() {
  state.ideas = new Map();
  state.comments = new Map();
  for (const docs of state.secretDocs.values()) {
    for (const d of docs) {
      if (d.kind === "idea") {
        const arr = state.ideas.get(d.ownerUid) || [];
        arr.push(d);
        state.ideas.set(d.ownerUid, arr);
      } else if (d.kind === "comment") {
        const arr = state.comments.get(d.refId) || [];
        arr.push(d);
        state.comments.set(d.refId, arr);
      }
    }
  }
  for (const arr of [...state.ideas.values(), ...state.comments.values()]) {
    arr.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  }
}

const memberOf = (uid) => state.members.find((m) => m.uid === uid);
// Le nom affiché vient toujours de la fiche membre : si quelqu'un change de prénom, tout suit.
const nameOf = (uid, fallback = "quelqu'un") => { const m = memberOf(uid); return (m && m.name) || fallback; };
// « Acheté » = coché. Un ancien achat sans champ « done » compte comme acheté.
const isDone = (p) => p.done === true || (!p.group && p.done === undefined);
const isChild = (m) => !!m && m.kind === "child";
const iManage = (m) => isChild(m) && (m.managerIds || []).includes(myUid());
const canEditFor = (ownerUid) => ownerUid === myUid() || iManage(memberOf(ownerUid));
const giftById = (id) => state.gifts.find((g) => g.id === id);
const isNewGift = (g) => state.since !== null && g.createdBy !== myUid() && g.ownerId !== myUid() && ms(g.createdAt) > state.since;

function myNotifyPrefs() {
  const me = memberOf(myUid());
  return (me && me.notify) || { mode: "all", from: [] };
}

// Message affiché quand quelqu'un ajoute un cadeau pendant que la liste est ouverte
function announceNewGifts(changes) {
  const prefs = myNotifyPrefs();
  for (const ch of changes) {
    if (ch.type !== "added" || ch.doc.metadata.hasPendingWrites) continue;
    const g = ch.doc.data();
    if ((g.createdBy || g.ownerId) === myUid() || g.ownerId === myUid()) continue;
    const wanted = prefs.mode === "all" || (prefs.mode === "some" && (prefs.from || []).includes(g.ownerId));
    if (wanted) toast(`🎁 ${nameOf(g.ownerId, g.ownerName)} vient d'ajouter « ${g.name} »`, 7000);
  }
}

// ─────────────────────────────────────────────────────────────
//  Écran : une liste — affichage
// ─────────────────────────────────────────────────────────────
// ── Photos : une seule = image simple ; plusieurs = carrousel bien visible ──
function carouselHtml(imgs, key, large) {
  const n = imgs.length;
  return `<div class="carousel${large ? " large" : ""}" data-key="${key}" role="group" aria-roledescription="carrousel" aria-label="${n} photos">
    <div class="car-track" tabindex="0">${imgs.map((src, i) => `<div class="car-slide"><img src="${esc(src)}" alt="Photo ${i + 1} sur ${n}"
      loading="${i ? "lazy" : "eager"}" referrerpolicy="no-referrer"${large ? "" : ` data-action="zoom" data-ref="${key}" data-index="${i}"`}></div>`).join("")}</div>
    <span class="car-count">📷 <b>1</b> / ${n}</span>
    <button class="car-arrow prev off" data-action="car-prev" aria-label="Photo précédente">‹</button>
    <button class="car-arrow next" data-action="car-next" aria-label="Photo suivante">›</button>
    <div class="car-dots" aria-hidden="true">${imgs.map((_, i) => `<i${i === 0 ? ' class="on"' : ""}></i>`).join("")}</div>
  </div>`;
}
function mediaHtml(item) {
  const imgs = imagesOf(item);
  if (!imgs.length) return "";
  const key = esc(item.id);
  if (imgs.length > 1) return carouselHtml(imgs, key, false);
  return `<button class="pic-btn" data-action="zoom" data-ref="${key}" data-index="0" aria-label="Agrandir la photo">
    <img class="pic" src="${esc(imgs[0])}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`;
}
function updateCarousel(car) {
  const track = car.querySelector(".car-track");
  const n = track.children.length;
  if (!track.clientWidth) return;
  const i = Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
  car.querySelector(".car-count b").textContent = i + 1;
  car.querySelectorAll(".car-dots i").forEach((d, k) => d.classList.toggle("on", k === i));
  car.querySelector(".prev").classList.toggle("off", i === 0);
  car.querySelector(".next").classList.toggle("off", i === n - 1);
}
document.addEventListener("scroll", (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains("car-track")) { const car = t.closest(".carousel"); if (car) updateCarousel(car); }
}, true);
const findItem = (ref) => giftById(ref) || [...state.ideas.values()].flat().find((n) => n.id === ref);

// Photo en grand (avec le même carrousel si plusieurs)
function openLightbox(item, index = 0) {
  const imgs = imagesOf(item);
  if (!imgs.length) return;
  closeModal();
  $modal.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Photos de ${esc(item.name)}">
    <button class="icon-btn lb-close" data-action="close-modal" aria-label="Fermer">✕</button>
    ${imgs.length > 1 ? carouselHtml(imgs, "lb", true)
      : `<div class="car-track"><div class="car-slide"><img src="${esc(imgs[0])}" alt="" referrerpolicy="no-referrer"></div></div>`}
  </div>`;
  const lb = $modal.firstElementChild;
  lb.addEventListener("click", (e) => {
    if (e.target === lb || e.target.classList.contains("car-slide") || e.target.classList.contains("car-track")) closeModal();
  });
  const car = lb.querySelector(".carousel");
  if (car) { const t = car.querySelector(".car-track"); t.scrollLeft = index * t.clientWidth; updateCarousel(car); }
}

function tagsHtml(g, extra = "") {
  const tags = [];
  if (g.star) tags.push(`<span class="tag tag-star">⭐ Envie forte</span>`);
  if (typeof g.price === "number") tags.push(`<span class="tag tag-price">≈ ${esc(priceFmt.format(g.price))}</span>`);
  if (extra) tags.push(extra);
  return tags.length ? `<div class="tags">${tags.join("")}</div>` : "";
}

function threadButton(refId, ownerUid, title) {
  const n = (state.comments.get(refId) || []).length;
  return `<button class="btn btn-line btn-small" data-action="thread" data-ref="${esc(refId)}" data-owner="${esc(ownerUid)}" data-title="${esc(title)}">💬 ${n ? `Commentaires (${n})` : "Commenter"}</button>`;
}

function purchaseZone(g) {
  const p = state.purchases.get(g.id);
  const me = myUid();
  const id = esc(g.id);
  if (!p) {
    return `<div class="gift-foot">
      <button class="btn btn-primary btn-small" data-action="buy" data-id="${id}">🛍️ Je le prends</button>
      <button class="btn btn-soft btn-small" data-action="pool" data-id="${id}">👥 À plusieurs</button></div>`;
  }
  const done = isDone(p);
  const iAmOrganiser = p.boughtBy === me;
  const who = nameOf(p.boughtBy, p.boughtByName);
  const undo = iAmOrganiser
    ? `<span class="spacer"></span><button class="btn btn-ghost btn-small" data-action="undo-done" data-id="${id}">Décocher</button>` : "";

  if (!p.group) {
    if (done) return `<div class="gift-foot"><span class="status">✅ Acheté par ${iAmOrganiser ? "toi" : esc(who)}</span>${undo}</div>`;
    return iAmOrganiser
      ? `<div class="status pool">🛍️ Tu le prends</div>
         <div class="gift-foot"><button class="btn btn-primary btn-small" data-action="mark-done" data-id="${id}">✅ C'est acheté</button>
         <button class="btn btn-ghost btn-small" data-action="unbuy" data-id="${id}">Annuler</button></div>`
      : `<div class="gift-foot"><span class="status pool">🛍️ ${esc(who)} le prend</span></div>`;
  }

  // Cadeau à plusieurs
  const joins = (state.joins.get(g.id) || []).filter((j) => j.gid === p.gid);
  const label = (uid, name, organiser) => `${uid === me ? "toi" : esc(nameOf(uid, name))}${organiser ? " (organise)" : ""}`;
  const names = [label(p.boughtBy, p.boughtByName, true), ...joins.map((j) => label(j.uid, j.name, false))].join(", ");
  const iJoined = joins.some((j) => j.uid === me);
  if (done) return `<div class="gift-foot"><span class="status">✅ Acheté à plusieurs : ${names}</span>${undo}</div>`;
  return `<div class="status pool">👥 On l'offre à plusieurs : ${names}</div>
    <div class="gift-foot">${iAmOrganiser
      ? `<button class="btn btn-primary btn-small" data-action="mark-done" data-id="${id}">✅ C'est acheté</button>
         <button class="btn btn-ghost btn-small" data-action="unbuy" data-id="${id}">Annuler</button>`
      : iJoined
        ? `<button class="btn btn-line btn-small" data-action="leave-pool" data-id="${id}">Je ne participe plus</button>`
        : `<button class="btn btn-soft btn-small" data-action="join-pool" data-id="${id}">🙋 Je participe</button>`}</div>`;
}

function giftCard(g, { isMe, canEdit }) {
  const p = isMe ? null : state.purchases.get(g.id);
  const link = normalizeUrl(g.url);
  const cls = p ? (isDone(p) ? " bought" : " taken") : "";
  const mark = p && !isDone(p) ? (p.group ? "👥" : "🛍") : "";
  return `<article class="gift${cls}"${mark ? ` data-mark="${mark}"` : ""}>
    ${mediaHtml(g)}
    <div class="gift-body">
      <h3>${esc(g.name)}</h3>
      ${tagsHtml(g, isNewGift(g) ? `<span class="tag tag-new">Nouveau</span>` : "")}
      ${g.description ? `<p>${esc(g.description)}</p>` : ""}
      ${link ? `<a class="gift-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(link))}</a>` : ""}
      ${isMe ? "" : purchaseZone(g)}
      <div class="gift-foot">
        ${isMe ? "" : threadButton(g.id, g.ownerId, g.name)}
        ${canEdit ? `<span class="spacer"></span>
          <button class="btn btn-line btn-small" data-action="edit-gift" data-id="${esc(g.id)}">Modifier</button>
          <button class="btn btn-ghost btn-small" data-action="delete-gift" data-id="${esc(g.id)}">Supprimer</button>` : ""}
      </div>
    </div>
  </article>`;
}

function ideaCard(n) {
  const link = normalizeUrl(n.url);
  const mine = n.addedBy === myUid();
  return `<article class="gift idea">
    ${mediaHtml(n)}
    <div class="gift-body">
      <h3>${esc(n.name)}</h3>
      ${tagsHtml(n, `<span class="tag">Proposé par ${mine ? "toi" : esc(nameOf(n.addedBy, n.addedByName))}</span>`)}
      ${n.description ? `<p>${esc(n.description)}</p>` : ""}
      ${link ? `<a class="gift-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(link))}</a>` : ""}
      <div class="gift-foot">
        ${threadButton(n.id, n.ownerUid, n.name)}
        ${mine ? `<span class="spacer"></span>
          <button class="btn btn-line btn-small" data-action="edit-idea" data-owner="${esc(n.ownerUid)}" data-id="${esc(n.id)}">Modifier</button>
          <button class="btn btn-ghost btn-small" data-action="delete-note" data-kind="idea" data-owner="${esc(n.ownerUid)}" data-id="${esc(n.id)}">Supprimer</button>` : ""}
      </div>
    </div>
  </article>`;
}

const TODO = "__todo";

function orderedMembers() {
  const me = myUid();
  const rank = (m) => (m.uid === me ? 0 : iManage(m) ? 1 : 2);
  return [...state.members].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), "fr"));
}
// Les envies fortes d'abord, puis par ordre d'ajout
const sortedGifts = (uid) => state.gifts.filter((g) => g.ownerId === uid)
  .map((g, i) => [g, i]).sort((a, b) => (b[0].star ? 1 : 0) - (a[0].star ? 1 : 0) || a[1] - b[1]).map((x) => x[0]);

// Tout ce que JE me suis engagé à acheter (seul·e ou à plusieurs)
function myPurchaseItems() {
  const me = myUid(), items = [];
  for (const [giftId, p] of state.purchases) {
    const g = giftById(giftId);
    if (!g) continue;
    if (p.boughtBy === me) items.push({ g, p, role: "buyer", done: isDone(p) });
    else if (p.group && (state.joins.get(giftId) || []).some((j) => j.uid === me && j.gid === p.gid)) {
      items.push({ g, p, role: "joiner", done: isDone(p) });
    }
  }
  return items.sort((a, b) => String(nameOf(a.g.ownerId, a.g.ownerName)).localeCompare(String(nameOf(b.g.ownerId, b.g.ownerName)), "fr"));
}

function todoRow({ g, p, role, done }) {
  const link = normalizeUrl(g.url);
  const recipient = memberOf(g.ownerId);
  let note = "";
  if (p.group) {
    const others = (state.joins.get(g.id) || []).filter((j) => j.gid === p.gid).map((j) => esc(nameOf(j.uid, j.name)));
    note = role === "buyer"
      ? (others.length ? `👥 À plusieurs avec ${others.join(", ")}` : "👥 À plusieurs")
      : `👥 Organisé par ${esc(nameOf(p.boughtBy, p.boughtByName))}`;
  }
  return `<div class="todo-row${done ? " is-done" : ""}">
    <input class="check" type="checkbox" data-action="toggle-done" data-id="${esc(g.id)}"${done ? " checked" : ""}${role === "joiner" ? " disabled" : ""} aria-label="Acheté : ${esc(g.name)}">
    <div class="grow todo-main">
      <div class="todo-name">${esc(g.name)}</div>
      <div class="muted small">pour ${isChild(recipient) ? "🧸 " : ""}${esc(nameOf(g.ownerId, g.ownerName))}</div>
      ${tagsHtml(g, note ? `<span class="tag">${note}</span>` : "")}
      ${link ? `<a class="gift-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(link))}</a>` : ""}
    </div>
    <button class="icon-btn icon-btn-small" data-action="${role === "joiner" ? "leave-pool" : "unbuy"}" data-confirm="1" data-id="${esc(g.id)}"
      aria-label="${role === "joiner" ? "Ne plus participer à" : "Retirer de mes achats :"} ${esc(g.name)}" title="${role === "joiner" ? "Ne plus participer" : "Retirer de mes achats"}">✕</button>
  </div>`;
}

function todoHtml() {
  const items = myPurchaseItems();
  const open = items.filter((i) => !i.done), closed = items.filter((i) => i.done);
  const total = open.filter((i) => !i.p.group && typeof i.g.price === "number").reduce((s, i) => s + i.g.price, 0);
  const hasGroup = open.some((i) => i.p.group);
  const pct = items.length ? Math.round((closed.length / items.length) * 100) : 0;
  if (!items.length) {
    return `<div class="section-head"><h2>🛍️ Mes achats</h2></div>
      <div class="empty"><span class="big">🛒</span><strong>Rien à acheter pour l'instant</strong>
        Sur la liste d'un proche, appuie sur « Je le prends » : il apparaîtra ici comme dans une liste de courses, avec une case à cocher.</div>`;
  }
  return `<div class="section-head"><h2>🛍️ Mes achats</h2></div>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="bar" style="width:${pct}%"></div></div>
    <p class="hint">${closed.length} sur ${items.length} acheté${closed.length > 1 ? "s" : ""}${total ? ` · reste environ ${esc(priceFmt.format(total))}${hasGroup ? " (hors cadeaux à plusieurs)" : ""}` : ""}</p>
    ${open.length ? `<h3 class="subhead">À acheter (${open.length})</h3><div class="todo">${open.map(todoRow).join("")}</div>` : `<div class="secret-note calm">🎉 Tout est acheté, bravo !</div>`}
    ${closed.length ? `<h3 class="subhead">Déjà achetés (${closed.length})</h3><div class="todo">${closed.map(todoRow).join("")}</div>` : ""}`;
}

function personHtml(person) {
  const me = myUid();
  const isMe = person.uid === me;
  const child = isChild(person);
  const managing = iManage(person);
  const canEdit = isMe || managing;
  const gifts = sortedGifts(person.uid);
  const ideas = state.ideas.get(person.uid) || [];

  let intro = "";
  if (isMe) intro = `<div class="secret-note">🤫 Tu ne verras jamais qui a acheté quoi : la surprise reste entière !</div>`;
  else if (managing) intro = `<div class="secret-note">🧸 Tu gères la liste de ${esc(person.name)} : toi seul·e peux la modifier, et tu vois ce qui est déjà acheté.</div>`;
  else if (child) intro = `<div class="secret-note calm">🧸 Liste gérée par ${esc(nameOf((person.managerIds || [])[0], person.managerName || "un parent"))}.</div>`;

  return `
    <div class="section-head">
      <h2>${isMe ? "Ma liste" : `La liste de ${esc(person.name)}`}</h2>
      ${canEdit ? `<button class="btn btn-primary btn-small" data-action="add-gift" data-owner="${esc(person.uid)}">＋ Ajouter</button>` : ""}
    </div>
    ${intro}
    ${gifts.length
      ? `<div class="gifts">${gifts.map((g) => giftCard(g, { isMe, canEdit })).join("")}</div>`
      : `<div class="empty"><span class="big">${canEdit ? "✍️" : "🎈"}</span>
          <strong>${isMe ? "Ta liste est vide" : canEdit ? `La liste de ${esc(person.name)} est vide` : `${esc(person.name)} n'a encore rien ajouté`}</strong>
          ${canEdit ? "Ajoute un premier souhait : un livre, un pull, un truc un peu fou…" : "Repasse plus tard : un message apparaîtra ici dès qu'un cadeau est ajouté."}</div>`}

    ${isMe ? "" : `
    <div class="section-head ideas-head">
      <h2>💡 Idées secrètes</h2>
      <button class="btn btn-soft btn-small" data-action="add-idea" data-owner="${esc(person.uid)}">＋ Proposer</button>
    </div>
    <p class="hint">Visibles par tout le monde sauf ${esc(person.name)}. Pratique pour noter une idée sans la lui gâcher.</p>
    ${ideas.length ? `<div class="gifts">${ideas.map(ideaCard).join("")}</div>` : `<p class="muted">Aucune idée pour l'instant.</p>`}`}

    ${managing ? `<div class="danger-zone"><button class="btn btn-ghost btn-small" data-action="delete-child" data-uid="${esc(person.uid)}">Supprimer la liste de ${esc(person.name)}</button></div>` : ""}`;
}

function renderList() {
  if (state.view !== "list") return;
  const { list, members } = state;
  if (!list || !members.length) { $app.innerHTML = `<div class="loading">Chargement de la liste… 🎄</div>`; return; }

  const me = myUid();
  const ordered = orderedMembers();
  const todoMode = state.selectedUid === TODO;
  const person = todoMode ? null : (ordered.find((m) => m.uid === state.selectedUid) || ordered.find((m) => m.uid === me) || ordered[0]);
  const scrollX = document.querySelector(".people")?.scrollLeft || 0;
  const carPos = new Map();
  $app.querySelectorAll(".carousel").forEach((c) => {
    const t = c.querySelector(".car-track");
    if (t.clientWidth) carPos.set(c.dataset.key, t.scrollLeft / t.clientWidth);
  });

  const chip = (m) => {
    const n = state.gifts.filter((g) => g.ownerId === m.uid && isNewGift(g)).length;
    return `<button class="chip" data-action="pick-person" data-uid="${esc(m.uid)}" aria-pressed="${!todoMode && m.uid === person.uid}">
      ${avatar(m.uid, m.name, m.kind)}<span>${m.uid === me ? "Moi" : esc(m.name)}</span>
      ${n ? `<span class="dot" title="${n} nouveau${n > 1 ? "x" : ""}">${n}</span>` : ""}</button>`;
  };
  const openCount = myPurchaseItems().filter((i) => !i.done).length;

  $app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-action="back" aria-label="Retour à mes listes">←</button>
      <h1 class="grow">${esc(list.name)}</h1>
      <button class="icon-btn" data-action="pdf" aria-label="Créer un PDF">📄</button>
      <button class="icon-btn" data-action="settings" aria-label="Réglages de la liste">🔔</button>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <span class="code-chip">Code <b>${esc(list.id)}</b>
        <button class="btn btn-soft btn-small" data-action="share">Inviter</button></span>
    </div>

    <div class="people" role="group" aria-label="Personnes de la liste">
      <button class="chip chip-todo" data-action="pick-person" data-uid="${TODO}" aria-pressed="${todoMode}">🛍️ <span>Mes achats</span>
        ${openCount ? `<span class="dot">${openCount}</span>` : ""}</button>
      ${ordered.map(chip).join("")}
      <button class="chip chip-add" data-action="add-child">🧸 ＋ Enfant</button>
    </div>

    ${todoMode ? todoHtml() : personHtml(person)}`;

  const people = document.querySelector(".people");
  if (people) people.scrollLeft = scrollX;
  $app.querySelectorAll(".carousel").forEach((c) => {
    const t = c.querySelector(".car-track"), idx = carPos.get(c.dataset.key);
    if (idx) t.scrollLeft = Math.round(idx) * t.clientWidth;
    updateCarousel(c);
  });
}

// ── Liste d'un enfant ────────────────────────────────────────
function openChildModal() {
  openModal(`
    <h2>Liste pour un enfant 🧸</h2>
    <form class="stack" id="child-form">
      <div class="field"><label for="c-name">Prénom de l'enfant</label>
        <input class="input" id="c-name" maxlength="30" placeholder="Emma">
        <span class="hint">Tu gères sa liste avec ton compte : toi seul·e peux la modifier, et tu vois ce que les autres ont acheté.</span></div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
        <button class="btn btn-primary" type="submit">Créer sa liste</button></div>
    </form>`, (m) => {
    m.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#c-name").value.trim();
      if (!name) return toast("Quel est son prénom ?");
      e.submitter && (e.submitter.disabled = true);
      try {
        const id = "c_" + randomCode(10);
        await setDoc(doc(db, "lists", state.listId, "members", id), {
          uid: id, name, kind: "child", managerIds: [myUid()], managerName: myName(), joinedAt: serverTimestamp(),
        });
        state.selectedUid = id;
        closeModal();
        renderList();
        toast(`La liste de ${name} est créée 🧸`);
      } catch (err) { toast(friendlyError(err)); e.submitter && (e.submitter.disabled = false); }
    });
  });
}

async function deleteChild(uid) {
  const child = memberOf(uid);
  if (!child || !confirm(`Supprimer la liste de ${child.name} et tous ses cadeaux ?`)) return;
  try {
    for (const g of state.gifts.filter((x) => x.ownerId === uid)) {
      await deleteDoc(doc(db, "lists", state.listId, "gifts", g.id));
    }
    await deleteDoc(doc(db, "lists", state.listId, "members", uid));
    state.selectedUid = null;
    toast("Liste supprimée.");
  } catch (err) { toast(friendlyError(err)); }
}

// ── Ajouter / modifier un cadeau ou une idée ─────────────────
async function fileToDataUrl(file, max = 520) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

// kind = "gift" (souhait de la personne) ou "idea" (idée secrète pour quelqu'un d'autre)
function openGiftModal({ item = null, kind = "gift", ownerUid = myUid() } = {}) {
  const editing = !!item;
  const isIdea = kind === "idea";
  const target = memberOf(ownerUid);
  const targetName = ownerUid === myUid() ? "" : (target ? target.name : "");
  const title = editing ? (isIdea ? "Modifier l'idée" : "Modifier le cadeau")
    : isIdea ? `Une idée pour ${esc(targetName)} 💡`
    : targetName ? `Un souhait pour ${esc(targetName)}` : "Un nouveau souhait";

  openModal(`
    <h2>${title}</h2>
    ${isIdea ? `<p class="hint">${esc(targetName)} ne verra jamais cette idée.</p>` : ""}
    <form class="stack" id="gift-form" novalidate>
      <div class="field"><label for="g-name">${isIdea ? "L'idée" : "Nom du cadeau"}</label>
        <input class="input" id="g-name" maxlength="80" placeholder="Une lampe de lecture" value="${esc(item?.name || "")}"></div>
      <div class="field"><label for="g-desc">Détails <span class="muted">(facultatif)</span></label>
        <textarea class="input" id="g-desc" maxlength="500" placeholder="Taille, couleur, modèle précis…">${esc(item?.description || "")}</textarea></div>
      <div class="field"><label for="g-price">Prix approximatif en € <span class="muted">(facultatif)</span></label>
        <input class="input" id="g-price" inputmode="decimal" placeholder="25" value="${typeof item?.price === "number" ? esc(String(item.price).replace(".", ",")) : ""}"></div>
      ${isIdea ? "" : `<label class="opt"><input type="checkbox" id="g-star"${item?.star ? " checked" : ""}> ⭐ Envie forte</label>`}
      <div class="field"><label for="g-url">Lien vers le produit <span class="muted">(facultatif)</span></label>
        <input class="input" id="g-url" inputmode="url" autocapitalize="none" placeholder="https://…" value="${esc(item?.url || "")}"></div>
      <div class="field"><span class="label">Photos <span class="muted">(facultatif, jusqu'à ${MAX_IMAGES})</span></span>
        <div class="thumbs" id="g-thumbs"></div>
        <label class="btn btn-soft btn-small" for="g-file" id="g-file-label">📷 Ajouter des photos</label>
        <input class="file-input" id="g-file" type="file" accept="image/*" multiple>
        <div class="row"><input class="input grow" id="g-img-url" inputmode="url" autocapitalize="none" placeholder="Ou colle l'adresse d'une image" aria-label="Adresse d'une image">
          <button type="button" class="btn btn-line btn-small" id="g-add-url">Ajouter</button></div>
        <span class="hint" id="g-count"></span></div>
      <div class="btns sticky"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
        <button class="btn btn-primary" type="submit">${editing ? "Enregistrer" : isIdea ? "Ajouter l'idée" : "Ajouter à la liste"}</button></div>
    </form>`, (m) => {
    let imgs = imagesOf(item);
    const $thumbs = m.querySelector("#g-thumbs");
    const $count = m.querySelector("#g-count");
    const $url = m.querySelector("#g-img-url");
    const $file = m.querySelector("#g-file");
    const renderThumbs = () => {
      $thumbs.hidden = !imgs.length;
      $thumbs.innerHTML = imgs.map((src, i) => `<div class="thumb">
        <img src="${esc(src)}" alt="Photo ${i + 1}" referrerpolicy="no-referrer">
        ${i === 0 && imgs.length > 1 ? `<span class="main-tag">Principale</span>` : ""}
        <button type="button" data-rm="${i}" aria-label="Retirer la photo ${i + 1}">✕</button></div>`).join("");
      $count.textContent = imgs.length ? `${imgs.length} photo${imgs.length > 1 ? "s" : ""} sur ${MAX_IMAGES}. La première est affichée en premier.` : "";
    };
    renderThumbs();
    $thumbs.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm]");
      if (!b) return;
      imgs.splice(Number(b.dataset.rm), 1);
      renderThumbs();
    });

    // Ajout d'une adresse d'image (renvoie false si elle est invalide)
    const addUrl = () => {
      const raw = $url.value.trim();
      if (!raw) return true;
      const u = normalizeUrl(raw);
      if (!u) { toast("L'adresse de l'image n'a pas l'air valide."); return false; }
      if (imgs.length >= MAX_IMAGES) { toast(`Maximum ${MAX_IMAGES} photos par cadeau.`); return false; }
      imgs.push(u);
      $url.value = "";
      renderThumbs();
      return true;
    };
    m.querySelector("#g-add-url").addEventListener("click", addUrl);
    $url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } });

    $file.addEventListener("change", async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      const room = MAX_IMAGES - imgs.length;
      if (!files.length) return;
      if (room <= 0) return toast(`Maximum ${MAX_IMAGES} photos par cadeau.`);
      for (const f of files.slice(0, room)) {
        try { imgs.push(await fileToDataUrl(f)); renderThumbs(); }
        catch { toast(`« ${f.name} » n'a pas pu être lue. Essaie-en une autre.`); }
      }
      if (files.length > room) toast(`Maximum ${MAX_IMAGES} photos : les suivantes n'ont pas été ajoutées.`);
    });

    m.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#g-name").value.trim();
      const rawUrl = m.querySelector("#g-url").value.trim();
      const url = normalizeUrl(rawUrl);
      if (!name) return toast(isIdea ? "Décris ton idée 💡" : "Donne un nom à ton cadeau 🎁");
      if (rawUrl && !url) return toast("Ce lien produit n'a pas l'air valide.");
      if (!addUrl()) return;                                     // adresse d'image saisie mais pas encore ajoutée
      if (imgs.reduce((sum, x) => sum + x.length, 0) > 850000) return toast("Ces photos sont trop lourdes ensemble : retires-en une.");
      const data = {
        name,
        description: m.querySelector("#g-desc").value.trim(),
        url,
        images: imgs,
        imageUrl: imgs[0] || "",                                  // pour les anciennes versions
        price: parsePrice(m.querySelector("#g-price").value),
      };
      if (!isIdea) data.star = m.querySelector("#g-star").checked;
      e.submitter && (e.submitter.disabled = true);
      try {
        const lid = state.listId, me = myUid();
        if (isIdea) {
          if (editing) {
            await updateDoc(doc(db, "lists", lid, "secret", ownerUid, "items", item.id), { ...data, updatedAt: serverTimestamp() });
          } else {
            await addDoc(collection(db, "lists", lid, "secret", ownerUid, "items"), {
              ...data, kind: "idea", addedBy: me, addedByName: myName(), createdAt: serverTimestamp(),
            });
          }
        } else if (editing) {
          await updateDoc(doc(db, "lists", lid, "gifts", item.id), { ...data, updatedAt: serverTimestamp() });
        } else {
          await addDoc(collection(db, "lists", lid, "gifts"), {
            ...data, ownerId: ownerUid, ownerName: ownerUid === me ? myName() : (target?.name || ""),
            createdBy: me, createdAt: serverTimestamp(),
          });
        }
        closeModal();
        toast(editing ? "C'est à jour ✨" : isIdea ? "Idée ajoutée 💡" : "Ajouté à la liste 🎁");
      } catch (err) { toast(friendlyError(err)); e.submitter && (e.submitter.disabled = false); }
    });
  });
}

// ── Commentaires secrets sur un cadeau ou une idée ───────────
function openThread(refId, ownerUid, title) {
  const owner = memberOf(ownerUid);
  openModal(`
    <h2>💬 ${esc(title)}</h2>
    <p class="hint">Visible par tout le monde sauf ${esc(owner ? owner.name : "la personne concernée")}.</p>
    <div class="thread" id="thread-body"></div>
    <form class="row" id="thread-form">
      <input class="input grow" id="t-text" maxlength="300" autocomplete="off" placeholder="Ex. quelle taille ? il l'a déjà…">
      <button class="btn btn-primary btn-small" type="submit">Envoyer</button>
    </form>
    <div class="btns"><button type="button" class="btn btn-ghost" data-action="close-modal">Fermer</button></div>`, (m) => {
    m.querySelector("#thread-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = m.querySelector("#t-text");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try {
        await addDoc(collection(db, "lists", state.listId, "secret", ownerUid, "items"), {
          kind: "comment", refId, text, addedBy: myUid(), addedByName: myName(), createdAt: serverTimestamp(),
        });
      } catch (err) { input.value = text; toast(friendlyError(err)); }
    });
  });
  state.thread = { refId, ownerUid };
  renderThread();
}

function renderThread() {
  const box = document.getElementById("thread-body");
  if (!box || !state.thread) return;
  const items = state.comments.get(state.thread.refId) || [];
  box.innerHTML = items.length
    ? items.map((c) => `<div class="bubble${c.addedBy === myUid() ? " mine" : ""}">
        <b>${c.addedBy === myUid() ? "Toi" : esc(nameOf(c.addedBy, c.addedByName))}</b><span>${esc(c.text)}</span>
        ${c.addedBy === myUid() ? `<button class="link-btn" data-action="delete-note" data-owner="${esc(c.ownerUid)}" data-id="${esc(c.id)}">Supprimer</button>` : ""}</div>`).join("")
    : `<p class="hint">Pas encore de commentaire. Lance la discussion !</p>`;
  box.scrollTop = box.scrollHeight;
}

// ── Réglages : qui me prévient + quitter ─────────────────────
function openSettingsModal() {
  const uid = myUid();
  const others = state.members.filter((m) => m.uid !== uid && !iManage(m))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  const prefs = myNotifyPrefs();

  openModal(`
    <h2>Réglages de la liste</h2>
    <div class="subhead">Qui te prévient d'un nouveau cadeau ?</div>
    <p class="hint">Un message apparaît en haut de l'écran quand la liste est ouverte. Sur l'accueil, une pastille indique les nouveautés depuis ta dernière visite.</p>
    <div class="stack" id="notify-form">
      <label class="opt"><input type="radio" name="mode" value="all"> Tout le monde</label>
      <label class="opt"><input type="radio" name="mode" value="some"> Certaines personnes</label>
      <div class="stack" id="notify-people" hidden>
        ${others.length ? others.map((m) => `
          <label class="opt"><input type="checkbox" name="from" value="${esc(m.uid)}">${avatar(m.uid, m.name, m.kind)} ${esc(m.name)}</label>`).join("")
          : `<p class="hint">Personne d'autre n'a encore rejoint la liste.</p>`}
      </div>
      <label class="opt"><input type="radio" name="mode" value="none"> Personne</label>
    </div>

    <div class="btns" style="margin-top:22px">
      <button class="btn btn-ghost" data-action="leave-list">Quitter cette liste</button>
      <button class="btn btn-primary" data-action="close-modal">Terminé</button>
    </div>`, (m) => {
    const radios = [...m.querySelectorAll("input[name=mode]")];
    const boxes = [...m.querySelectorAll("input[name=from]")];
    const $people = m.querySelector("#notify-people");
    radios.forEach((r) => (r.checked = r.value === prefs.mode));
    boxes.forEach((b) => (b.checked = (prefs.from || []).includes(b.value)));
    const sync = () => { $people.hidden = !radios.find((r) => r.value === "some").checked; };
    sync();
    const save = async () => {
      sync();
      const mode = radios.find((r) => r.checked)?.value || "all";
      const from = boxes.filter((b) => b.checked).map((b) => b.value);
      try {
        await updateDoc(doc(db, "lists", state.listId, "members", uid), { notify: { mode, from } });
      } catch (err) { toast(friendlyError(err)); }
    };
    [...radios, ...boxes].forEach((el) => el.addEventListener("change", save));
  });
}

async function leaveList() {
  if (!confirm("Quitter cette liste ? Tes cadeaux (et les listes enfants que tu gères) seront retirés.")) return;
  const lid = state.listId;
  try {
    const mineIds = [myUid(), ...state.members.filter(iManage).map((m) => m.uid)];
    for (const g of state.gifts.filter((x) => mineIds.includes(x.ownerId))) {
      await deleteDoc(doc(db, "lists", lid, "gifts", g.id));
    }
    for (const c of state.members.filter(iManage)) await deleteDoc(doc(db, "lists", lid, "members", c.uid));
    stopList(false);          // on coupe les écoutes avant de perdre l'accès
    state.view = "loading";
    await deleteDoc(doc(db, "lists", lid, "members", myUid()));
    await deleteDoc(doc(db, "users", myUid(), "myLists", lid));
    closeModal();
    location.hash = "#/";
    toast("Tu as quitté la liste.");
  } catch (err) { toast(friendlyError(err)); }
}

// ─────────────────────────────────────────────────────────────
//  Mon compte : changer le prénom affiché
// ─────────────────────────────────────────────────────────────
function openAccountModal() {
  openModal(`
    <h2>Mon compte</h2>
    <form class="stack" id="account-form">
      <div class="field"><label for="acc-name">Prénom affiché</label>
        <input class="input" id="acc-name" maxlength="30" autocomplete="given-name" value="${esc(myName())}">
        <span class="hint">C'est le prénom que voient les autres, dans toutes tes listes.</span></div>
      <div class="field"><span class="label">Email de connexion</span><span class="muted">${esc(state.user.email || "")}</span></div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-action="logout">Me déconnecter</button>
        <button class="btn btn-primary" type="submit">Enregistrer</button></div>
    </form>`, (m) => {
    m.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#acc-name").value.trim();
      if (!name) return toast("Ton prénom ne peut pas être vide.");
      e.submitter && (e.submitter.disabled = true);
      try {
        if (name !== state.user.displayName) await updateProfile(auth.currentUser, { displayName: name });
        await setDoc(doc(db, "users", myUid()), { name }, { merge: true });
        // Ta fiche dans chacune de tes listes : les autres voient le nouveau prénom tout de suite
        await Promise.all(state.lists.map((l) =>
          updateDoc(doc(db, "lists", l.id, "members", myUid()), { name }).catch(() => {})));
        closeModal();
        if (state.view === "home") renderHome();
        toast("Prénom mis à jour ✨");
      } catch (err) { toast(friendlyError(err)); e.submitter && (e.submitter.disabled = false); }
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  PDF : une ou plusieurs listes, à lire ou imprimer
//  (la bibliothèque pdf-lib est chargée à la demande depuis cdnjs)
// ─────────────────────────────────────────────────────────────
const PDFLIB_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";

function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Impossible de charger le générateur de PDF. Vérifie ta connexion internet."));
    document.head.append(s);
  });
}

// Les polices de base d'un PDF ne connaissent pas les emojis : on les retire.
const PDF_KEEP = /[^\u0020-\u007E\u00A0-\u00FF\u20AC\u0152\u0153\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g;
const pdfClean = (s) => String(s ?? "").replace(/[\u202F\u00A0]/g, " ").split("\n")
  .map((l) => l.replace(PDF_KEEP, "").replace(/\s+/g, " ").trim()).join("\n").trim();

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (!word) continue;
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth) {          // mot plus large que la page : on le coupe
        let cut = w.length;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}
function truncateText(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxWidth) t = t.slice(0, -1);
  return t + "...";
}

function pdfStatus(g) {
  const p = state.purchases.get(g.id);
  if (!p) return { text: "À acheter", kind: "free" };
  const done = isDone(p);
  const who = nameOf(p.boughtBy, p.boughtByName);
  if (p.group) {
    const joins = (state.joins.get(g.id) || []).filter((j) => j.gid === p.gid).map((j) => nameOf(j.uid, j.name));
    const names = [`${who} (organise)`, ...joins].join(", ");
    return { text: `${done ? "Acheté" : "En cours"} à plusieurs : ${names}`, kind: done ? "done" : "taken" };
  }
  return done ? { text: `Acheté par ${who}`, kind: "done" } : { text: `Pris en charge par ${who}`, kind: "taken" };
}

async function buildPdf({ people, includeStatus, pagePerPerson }) {
  await loadScript(PDFLIB_URL, "PDFLib");
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const listName = pdfClean(state.list?.name || "Liste de Noël");
  pdf.setTitle(`Liste de Noël - ${listName}`);
  pdf.setCreator("Listes de Noël");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PW = 595.28, PH = 841.89, M = 48, CW = PW - 2 * M, BOTTOM = 60, TEXT_X = M + 24;
  const C = {
    red: rgb(0.843, 0.149, 0.239), pine: rgb(0.122, 0.373, 0.29), ink: rgb(0.133, 0.188, 0.227),
    soft: rgb(0.357, 0.42, 0.463), gold: rgb(0.62, 0.42, 0), line: rgb(0.8, 0.86, 0.89),
    link: rgb(0.1, 0.4, 0.7), white: rgb(1, 1, 1),
  };
  let page, y;
  const newPage = () => { page = pdf.addPage([PW, PH]); y = PH - M; };
  const ensure = (h) => { if (y - h < BOTTOM) newPage(); };
  const draw = (t, x, size, f, color) => page.drawText(t, { x, y: y - size, size, font: f, color });
  const addLink = (x, baseline, w, url) => {
    const ref = pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [x, baseline - 2, x + w, baseline + 9], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }));
    let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) { annots = pdf.context.obj([]); page.node.set(PDFName.of("Annots"), annots); }
    annots.push(ref);
  };

  newPage();
  // En-tête
  for (const l of wrapText(listName, bold, 26, CW)) { draw(l, M, 26, bold, C.red); y -= 32; }
  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  draw(pdfClean(`Liste de Noël - ${date}`), M, 10, font, C.soft); y -= 20;
  page.drawLine({ start: { x: M, y: y }, end: { x: PW - M, y: y }, thickness: 1, color: C.line }); y -= 22;

  people.forEach((person, idx) => {
    if (pagePerPerson && idx > 0) newPage();
    const gifts = sortedGifts(person.uid);
    const showStatus = includeStatus && person.uid !== myUid();

    ensure(90);
    page.drawRectangle({ x: M, y: y - 26, width: CW, height: 26, color: C.red });
    const nm = pdfClean(person.uid === myUid() ? `${person.name} (ma liste)` : isChild(person) ? `${person.name} (enfant)` : person.name);
    page.drawText(truncateText(nm, bold, 14, CW - 110), { x: M + 10, y: y - 18, size: 14, font: bold, color: C.white });
    const count = `${gifts.length} cadeau${gifts.length > 1 ? "x" : ""}`;
    page.drawText(count, { x: PW - M - 10 - font.widthOfTextAtSize(count, 10), y: y - 17, size: 10, font, color: C.white });
    y -= 40;

    if (!gifts.length) { draw("Aucun cadeau pour l'instant.", M, 11, font, C.soft); y -= 26; return; }

    for (const g of gifts) {
      const price = typeof g.price === "number" ? pdfClean(`env. ${priceFmt.format(g.price)}`) : "";
      const priceW = price ? bold.widthOfTextAtSize(price, 11) + 8 : 0;
      const nameLines = wrapText(pdfClean(g.name) || "(sans nom)", bold, 12.5, CW - 24 - priceW);
      const desc = pdfClean(g.description);
      const descLines = desc ? wrapText(desc, font, 10.5, CW - 24) : [];
      const url = normalizeUrl(g.url);
      const st = showStatus ? pdfStatus(g) : null;
      const h = nameLines.length * 16 + (g.star ? 13 : 0) + descLines.length * 14 + (url ? 15 : 0) + (st ? 16 : 0) + 16;
      ensure(h);

      // case à cocher (cochée si déjà acheté)
      page.drawRectangle({ x: M, y: y - 15, width: 13, height: 13, borderColor: C.pine, borderWidth: 1.3 });
      if (st && st.kind === "done") {
        page.drawLine({ start: { x: M + 2.5, y: y - 9 }, end: { x: M + 5.5, y: y - 12.5 }, thickness: 1.8, color: C.pine });
        page.drawLine({ start: { x: M + 5.5, y: y - 12.5 }, end: { x: M + 11, y: y - 4.5 }, thickness: 1.8, color: C.pine });
      }
      nameLines.forEach((l, i) => {
        draw(l, TEXT_X, 12.5, bold, C.ink);
        if (i === 0 && price) page.drawText(price, { x: PW - M - bold.widthOfTextAtSize(price, 11), y: y - 12.5, size: 11, font: bold, color: C.soft });
        y -= 16;
      });
      if (g.star) { draw("Envie forte", TEXT_X, 9.5, bold, C.gold); y -= 13; }
      for (const l of descLines) { draw(l, TEXT_X, 10.5, font, C.soft); y -= 14; }
      if (url) {
        const shown = truncateText(pdfClean(url.replace(/^https?:\/\/(www\.)?/, "")), font, 9.5, CW - 24);
        const w = font.widthOfTextAtSize(shown, 9.5), base = y - 9.5;
        draw(shown, TEXT_X, 9.5, font, C.link);
        page.drawLine({ start: { x: TEXT_X, y: base - 1.5 }, end: { x: TEXT_X + w, y: base - 1.5 }, thickness: 0.5, color: C.link });
        addLink(TEXT_X, base, w, url);
        y -= 15;
      }
      if (st) {
        draw(pdfClean(st.text), TEXT_X, 10, st.kind === "done" ? bold : font,
          st.kind === "done" ? C.pine : st.kind === "taken" ? C.gold : C.soft);
        y -= 16;
      }
      y -= 4;
      page.drawLine({ start: { x: M, y: y }, end: { x: PW - M, y: y }, thickness: 0.5, color: C.line });
      y -= 12;
    }
    y -= 8;
  });

  // Pied de page
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const t = `Listes de Noël - page ${i + 1}/${pages.length}`;
    pg.drawText(t, { x: (PW - font.widthOfTextAtSize(t, 8.5)) / 2, y: 30, size: 8.5, font, color: C.soft });
  });
  return pdf.save();
}

function downloadPdf(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function openPdfModal() {
  const me = myUid();
  const ordered = orderedMembers();
  const start = state.selectedUid && state.selectedUid !== TODO && memberOf(state.selectedUid) ? state.selectedUid : me;
  openModal(`
    <h2>Créer un PDF 📄</h2>
    <p class="hint">Choisis les listes à inclure. Le PDF se télécharge, prêt à lire ou à imprimer.</p>
    <div class="stack" id="pdf-people">
      ${ordered.map((m) => {
        const n = state.gifts.filter((g) => g.ownerId === m.uid).length;
        return `<label class="opt"><input type="checkbox" name="p" value="${esc(m.uid)}">${avatar(m.uid, m.name, m.kind)}
          <span class="grow">${m.uid === me ? "Moi" : esc(m.name)}</span><span class="muted small">${n} cadeau${n > 1 ? "x" : ""}</span></label>`;
      }).join("")}
    </div>
    <p style="margin:8px 0 0"><button class="link-btn" type="button" id="pdf-all">Tout sélectionner</button></p>
    <div class="subhead">Options</div>
    <div class="stack">
      <label class="opt"><input type="checkbox" id="pdf-status" checked><span>Indiquer ce qui est déjà acheté <span class="muted small">(jamais pour ma propre liste)</span></span></label>
      <label class="opt"><input type="checkbox" id="pdf-pages"><span>Une personne par page</span></label>
    </div>
    <div class="btns sticky" style="margin-top:18px"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="button" id="pdf-go">Télécharger le PDF</button></div>`, (m) => {
    const boxes = [...m.querySelectorAll("input[name=p]")];
    boxes.forEach((b) => (b.checked = b.value === start));
    m.querySelector("#pdf-all").addEventListener("click", () => {
      const all = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !all));
    });
    const go = m.querySelector("#pdf-go");
    go.addEventListener("click", async () => {
      const chosen = ordered.filter((mem) => boxes.some((b) => b.checked && b.value === mem.uid));
      if (!chosen.length) return toast("Coche au moins une liste.");
      go.disabled = true;
      go.textContent = "Création…";
      try {
        const bytes = await buildPdf({
          people: chosen,
          includeStatus: m.querySelector("#pdf-status").checked,
          pagePerPerson: m.querySelector("#pdf-pages").checked,
        });
        const slug = (chosen.length === 1 ? chosen[0].name : state.list?.name || "listes")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "listes";
        downloadPdf(bytes, `liste-noel-${slug}.pdf`);
        closeModal();
        toast("PDF téléchargé 📄");
      } catch (err) {
        toast(friendlyError(err), 7000);
        go.disabled = false;
        go.textContent = "Télécharger le PDF";
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  Achats, participations
// ─────────────────────────────────────────────────────────────
const purchaseRef = (g, docId = g.id) => doc(db, "lists", state.listId, "purchases", g.ownerId, "items", docId);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const joinUrl = () => `${location.origin}${location.pathname}#/rejoindre/${state.listId}`;

// ─────────────────────────────────────────────────────────────
//  Actions (boutons marqués data-action)
// ─────────────────────────────────────────────────────────────
const actions = {
  "switch-auth": () => { state.authMode = state.authMode === "signup" ? "login" : "signup"; renderAuth(); },
  "reset-password": async () => {
    const email = (document.getElementById("a-email")?.value || "").trim();
    if (!email) return toast("Écris ton email ci-dessus, puis reclique ici.");
    try { await sendPasswordResetEmail(auth, email); toast("Email envoyé ! Regarde aussi dans les spams 📬", 7000); }
    catch (err) { toast(friendlyError(err)); }
  },
  "logout": () => signOut(auth),
  "account": () => openAccountModal(),
  "pdf": () => openPdfModal(),
  "close-modal": () => closeModal(),
  "new-list": () => openNewListModal(),
  "join-list": () => openJoinModal(),
  "open-list": (el) => { location.hash = `#/liste/${el.dataset.id}`; },
  "back": () => { location.hash = "#/"; },
  "pick-person": (el) => { state.selectedUid = el.dataset.uid; renderList(); },
  "add-child": () => openChildModal(),
  "delete-child": (el) => deleteChild(el.dataset.uid),

  "add-gift": (el) => openGiftModal({ kind: "gift", ownerUid: el.dataset.owner }),
  "edit-gift": (el) => { const g = giftById(el.dataset.id); if (g) openGiftModal({ kind: "gift", item: g, ownerUid: g.ownerId }); },
  "delete-gift": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g || !confirm(`Supprimer « ${g.name} » de la liste ?`)) return;
    try { await deleteDoc(doc(db, "lists", state.listId, "gifts", g.id)); toast("Cadeau supprimé."); }
    catch (err) { toast(friendlyError(err)); }
  },

  "buy": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try {
      await setDoc(purchaseRef(g), { kind: "buy", boughtBy: myUid(), boughtByName: myName(), group: false, done: false, at: serverTimestamp() });
      toast("Noté, chut ! 🤫 Tu le retrouves dans « Mes achats ».");
    } catch (err) {
      toast(err.code === "permission-denied" ? "Quelqu'un vient déjà de s'en occuper !" : friendlyError(err));
    }
  },
  "pool": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try {
      await setDoc(purchaseRef(g), {
        kind: "buy", boughtBy: myUid(), boughtByName: myName(), group: true, gid: randomCode(6), done: false, at: serverTimestamp(),
      });
      toast("C'est lancé : les autres peuvent maintenant participer 👥");
    } catch (err) {
      toast(err.code === "permission-denied" ? "Quelqu'un vient déjà de s'en occuper !" : friendlyError(err));
    }
  },
  "join-pool": async (el) => {
    const g = giftById(el.dataset.id), p = g && state.purchases.get(g.id);
    if (!g || !p) return;
    try {
      await setDoc(purchaseRef(g, `${g.id}__${myUid()}`), {
        kind: "join", giftId: g.id, gid: p.gid, uid: myUid(), name: myName(), at: serverTimestamp(),
      });
      toast("Tu participes 🙋");
    } catch (err) { toast(friendlyError(err)); }
  },
  "leave-pool": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    if (el.dataset.confirm && !confirm(`Ne plus participer à « ${g.name} » ?`)) return;
    try { await deleteDoc(purchaseRef(g, `${g.id}__${myUid()}`)); }
    catch (err) { toast(friendlyError(err)); }
  },
  "mark-done": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try { await updateDoc(purchaseRef(g), { done: true }); toast("Bravo, c'est acheté ! 🎉"); }
    catch (err) { toast(friendlyError(err)); }
  },
  "undo-done": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try { await updateDoc(purchaseRef(g), { done: false }); }
    catch (err) { toast(friendlyError(err)); }
  },
  // Case à cocher de « Mes achats »
  "toggle-done": async (el) => {
    const g = giftById(el.dataset.id), p = g && state.purchases.get(g.id);
    if (!g || !p || p.boughtBy !== myUid()) return;
    const nowDone = !isDone(p);
    try { await updateDoc(purchaseRef(g), { done: nowDone }); if (nowDone) toast("Bravo, c'est acheté ! 🎉"); }
    catch (err) { toast(friendlyError(err)); }
  },
  "unbuy": async (el) => {
    const g = giftById(el.dataset.id), p = g && state.purchases.get(g.id);
    if (!g) return;
    if (el.dataset.confirm && !confirm(`Retirer « ${g.name} » de tes achats ? Il redeviendra disponible pour les autres.`)) return;
    const others = p && p.group ? (state.joins.get(g.id) || []).filter((j) => j.gid === p.gid).length : 0;
    if (others && !confirm("D'autres personnes participent. Annuler pour tout le monde ?")) return;
    try { await deleteDoc(purchaseRef(g)); }
    catch (err) { toast(friendlyError(err)); }
  },

  "add-idea": (el) => openGiftModal({ kind: "idea", ownerUid: el.dataset.owner }),
  "edit-idea": (el) => {
    const n = (state.ideas.get(el.dataset.owner) || []).find((x) => x.id === el.dataset.id);
    if (n) openGiftModal({ kind: "idea", item: n, ownerUid: n.ownerUid });
  },
  "delete-note": async (el) => {
    if (el.dataset.kind === "idea" && !confirm("Supprimer cette idée ?")) return;
    try { await deleteDoc(doc(db, "lists", state.listId, "secret", el.dataset.owner, "items", el.dataset.id)); }
    catch (err) { toast(friendlyError(err)); }
  },
  "thread": (el) => openThread(el.dataset.ref, el.dataset.owner, el.dataset.title),
  "zoom": (el) => { const it = findItem(el.dataset.ref); if (it) openLightbox(it, Number(el.dataset.index) || 0); },
  "car-prev": (el) => { const t = el.closest(".carousel").querySelector(".car-track"); t.scrollBy({ left: -t.clientWidth, behavior: "smooth" }); },
  "car-next": (el) => { const t = el.closest(".carousel").querySelector(".car-track"); t.scrollBy({ left: t.clientWidth, behavior: "smooth" }); },

  "share": async () => {
    const url = joinUrl();
    const text = `Rejoins ma liste de Noël « ${state.list?.name || ""} » 🎄`;
    if (navigator.share) {
      try { await navigator.share({ title: "Liste de Noël", text, url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    toast((await copyText(url)) ? "Lien copié ! Envoie-le à tes proches 🎄" : `Lien à partager : ${url}`, 7000);
  },
  "settings": () => openSettingsModal(),
  "leave-list": () => leaveList(),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  Promise.resolve(actions[el.dataset.action](el, e)).catch((err) => toast(friendlyError(err)));
});

// ─────────────────────────────────────────────────────────────
//  Navigation (adresse après le #) et démarrage
// ─────────────────────────────────────────────────────────────
function route() {
  if (!state.user) { stopList(false); state.view = "auth"; renderAuth(); return; }
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/rejoindre\/([A-Za-z0-9]+)/))) { joinFlow(m[1].toUpperCase()); return; }
  if ((m = h.match(/^#\/liste\/([A-Za-z0-9]+)/))) { openList(m[1].toUpperCase()); return; }
  stopList();
  state.view = "home";
  renderHome();
}

buildLights();

if (!configured) {
  renderSetup();
} else {
  window.addEventListener("hashchange", () => { closeModal(); route(); });
  onAuthStateChanged(auth, async (user) => {
    if (state.signup) await state.signup;   // évite d'inscrire l'email à la place du prénom
    state.user = user;
    if (state.unsubLists) { state.unsubLists(); state.unsubLists = null; }
    if (!user) { stopBadges(); state.lists = []; closeModal(); route(); return; }

    setDoc(doc(db, "users", user.uid), { name: myName() }, { merge: true }).catch(() => {});
    state.unsubLists = onSnapshot(collection(db, "users", user.uid, "myLists"), (snap) => {
      state.lists = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      syncBadges();
      if (state.view === "home") renderHome();
    }, () => {});
    route();
  });
}
