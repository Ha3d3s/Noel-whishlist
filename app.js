// ─────────────────────────────────────────────────────────────
//  Listes de Noël — application 100 % statique (GitHub Pages) + Firebase
//  Auth (email / mot de passe) · Firestore · Cloud Messaging (facultatif)
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot,
  query, where, orderBy, serverTimestamp, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getMessaging, getToken, deleteToken, isSupported,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { firebaseConfig, VAPID_KEY } from "./firebase-config.js";

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
  view: "auth",          // auth | home | list
  authMode: "login",     // login | signup
  lists: [],             // mes listes (accueil)
  listId: null,
  list: null,
  members: [],
  gifts: [],
  purchases: new Map(),  // giftId -> achat (jamais visible pour le destinataire)
  purchaseUnsubs: new Map(), // destinataire -> écoute de ses achats
  selectedUid: null,
  unsubs: [],
  unsubLists: null,
};

// ── Petits outils ────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const myUid = () => state.user.uid;
const myName = () => state.user.displayName || (state.user.email || "Moi").split("@")[0];
const firstName = () => myName().split(" ")[0];

function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes(".") ? parsed.href : "";
  } catch { return ""; }
}
const safeLink = (u) => normalizeUrl(u);
const safeImage = (u) => (String(u || "").startsWith("data:image/") ? u : normalizeUrl(u));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const AVATAR_COLORS = ["#ffd76a", "#f7a8b8", "#bfe3d2", "#bfd9f2", "#f9c9a5", "#d9c7f0"];
function avatar(uid, name) {
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = (String(name || "?").trim()[0] || "?").toUpperCase();
  return `<span class="avatar" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${esc(initial)}</span>`;
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
function closeModal() { $modal.innerHTML = ""; }
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
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, "users", cred.user.uid), { name }, { merge: true });
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
      <h1>Salut ${esc(firstName())} 🎅</h1>
      <button class="btn btn-ghost btn-small" data-action="logout">Déconnexion</button>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-action="new-list">✨ Créer une liste</button>
      <button class="btn btn-soft" data-action="join-list">🔑 Rejoindre</button>
    </div>
    <h2 class="subhead">Mes listes</h2>
    ${lists.length ? `<div class="stack">${lists.map((l) => `
      <button class="list-card" data-action="open-list" data-id="${esc(l.id)}">
        <span class="badge" aria-hidden="true">🎄</span>
        <h3>${esc(l.name)}</h3><span class="go" aria-hidden="true">›</span>
      </button>`).join("")}</div>`
    : `<div class="empty"><span class="big">🎈</span><strong>Pas encore de liste</strong>
        Crée la première (« Noël en famille », « Copains »…) ou rejoins celle d'un proche avec son code.</div>`}`;
}

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
        await setDoc(doc(db, "users", myUid(), "myLists", id), { name, joinedAt: serverTimestamp() });
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
      { name: listSnap.get("name") || "Liste de Noël", joinedAt: serverTimestamp() }, { merge: true });
    location.hash = `#/liste/${code}`;
  } catch (err) {
    toast(friendlyError(err));
    location.hash = "#/";
  }
}

// ─────────────────────────────────────────────────────────────
//  Écran : une liste
// ─────────────────────────────────────────────────────────────
function stopList() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.purchaseUnsubs.forEach((u) => u());
  state.purchaseUnsubs = new Map();
  state.listId = null; state.list = null; state.members = []; state.gifts = [];
  state.purchases = new Map(); state.selectedUid = null;
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

  state.unsubs.push(onSnapshot(doc(db, "lists", id), (s) => {
    if (!s.exists()) return fail();
    state.list = { id, ...s.data() };
    renderList();
  }, fail));

  state.unsubs.push(onSnapshot(collection(db, "lists", id, "members"), (s) => {
    state.members = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    syncPurchaseListeners();
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

// Les achats sont rangés par destinataire. On n'écoute que ceux des AUTRES :
// les règles Firestore interdisent de toute façon de lire ceux qui nous concernent.
function syncPurchaseListeners() {
  const me = myUid(), lid = state.listId;
  const wanted = new Set(state.members.filter((m) => m.uid !== me).map((m) => m.uid));
  for (const [uid, unsub] of state.purchaseUnsubs) {
    if (wanted.has(uid)) continue;
    unsub();
    state.purchaseUnsubs.delete(uid);
    for (const [gid, p] of state.purchases) if (p.giftOwnerId === uid) state.purchases.delete(gid);
  }
  for (const uid of wanted) {
    if (state.purchaseUnsubs.has(uid)) continue;
    const unsub = onSnapshot(collection(db, "lists", lid, "purchases", uid, "items"), (s) => {
      for (const [gid, p] of state.purchases) if (p.giftOwnerId === uid) state.purchases.delete(gid);
      s.docs.forEach((d) => state.purchases.set(d.id, { giftOwnerId: uid, ...d.data() }));
      renderList();
    }, () => {});
    state.purchaseUnsubs.set(uid, unsub);
  }
}

function myNotifyPrefs() {
  const me = state.members.find((m) => m.uid === myUid());
  return (me && me.notify) || { mode: "all", from: [] };
}

function announceNewGifts(changes) {
  const prefs = myNotifyPrefs();
  for (const ch of changes) {
    if (ch.type !== "added" || ch.doc.metadata.hasPendingWrites) continue;
    const g = ch.doc.data();
    if (g.ownerId === myUid()) continue;
    const wanted = prefs.mode === "all" || (prefs.mode === "some" && (prefs.from || []).includes(g.ownerId));
    if (wanted) toast(`🎁 ${g.ownerName} vient d'ajouter « ${g.name} »`, 7000);
  }
}

function giftCard(g, isMe) {
  const purchase = isMe ? null : state.purchases.get(g.id);
  const img = safeImage(g.imageUrl);
  const link = safeLink(g.url);
  let foot = "";
  if (isMe) {
    foot = `<span class="spacer"></span>
      <button class="btn btn-line btn-small" data-action="edit-gift" data-id="${esc(g.id)}">Modifier</button>
      <button class="btn btn-ghost btn-small" data-action="delete-gift" data-id="${esc(g.id)}">Supprimer</button>`;
  } else if (!purchase) {
    foot = `<button class="btn btn-primary btn-small" data-action="buy" data-id="${esc(g.id)}">🛍️ Je l'achète</button>`;
  } else if (purchase.boughtBy === myUid()) {
    foot = `<span class="status">Acheté par toi</span><span class="spacer"></span>
      <button class="btn btn-ghost btn-small" data-action="unbuy" data-id="${esc(g.id)}">Annuler</button>`;
  } else {
    foot = `<span class="status">Acheté par ${esc(purchase.boughtByName || "quelqu'un")}</span>`;
  }
  return `<article class="gift${purchase ? " bought" : ""}">
    ${img ? `<img class="pic" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
    <div class="gift-body">
      <h3>${esc(g.name)}</h3>
      ${g.description ? `<p>${esc(g.description)}</p>` : ""}
      ${link ? `<a class="gift-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(link))}</a>` : ""}
      <div class="gift-foot">${foot}</div>
    </div>
  </article>`;
}

function renderList() {
  if (state.view !== "list") return;
  const { list, members } = state;
  if (!list || !members.length) { $app.innerHTML = `<div class="loading">Chargement de la liste… 🎄</div>`; return; }

  const me = myUid();
  const ordered = [...members].sort((a, b) =>
    a.uid === me ? -1 : b.uid === me ? 1 : String(a.name).localeCompare(String(b.name), "fr"));
  const sel = ordered.some((m) => m.uid === state.selectedUid) ? state.selectedUid : me;
  const person = ordered.find((m) => m.uid === sel);
  const isMe = sel === me;
  const gifts = state.gifts.filter((g) => g.ownerId === sel);
  const scrollX = document.querySelector(".people")?.scrollLeft || 0;

  $app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-action="back" aria-label="Retour à mes listes">←</button>
      <h1 class="grow">${esc(list.name)}</h1>
      <button class="icon-btn" data-action="settings" aria-label="Notifications et réglages">🔔</button>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <span class="code-chip">Code <b>${esc(list.id)}</b>
        <button class="btn btn-soft btn-small" data-action="share">Inviter</button></span>
    </div>

    <div class="people" role="group" aria-label="Personnes de la liste">
      ${ordered.map((m) => `
        <button class="chip" data-action="pick-person" data-uid="${esc(m.uid)}" aria-pressed="${m.uid === sel}">
          ${avatar(m.uid, m.name)}<span>${m.uid === me ? "Moi" : esc(m.name)}</span>
        </button>`).join("")}
    </div>

    <div class="section-head">
      <h2>${isMe ? "Ma liste" : `La liste de ${esc(person.name)}`}</h2>
      ${isMe ? `<button class="btn btn-primary btn-small" data-action="add-gift">＋ Ajouter</button>` : ""}
    </div>
    ${isMe ? `<div class="secret-note">🤫 Tu ne verras jamais qui a acheté quoi : la surprise reste entière !</div>` : ""}
    ${gifts.length
      ? `<div class="gifts">${gifts.map((g) => giftCard(g, isMe)).join("")}</div>`
      : `<div class="empty"><span class="big">${isMe ? "✍️" : "🎈"}</span>
          <strong>${isMe ? "Ta liste est vide" : `${esc(person.name)} n'a encore rien ajouté`}</strong>
          ${isMe ? "Ajoute un premier souhait : un livre, un pull, un truc un peu fou…" : "Repasse plus tard, ou active les notifications pour être prévenu·e."}</div>`}`;

  const people = document.querySelector(".people");
  if (people) people.scrollLeft = scrollX;
}

// ── Ajouter / modifier un cadeau ─────────────────────────────
async function fileToDataUrl(file, max = 520) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function openGiftModal(gift) {
  const editing = !!gift;
  let fileImage = gift && String(gift.imageUrl || "").startsWith("data:image/") ? gift.imageUrl : "";
  const startUrl = gift && !fileImage ? gift.imageUrl || "" : "";

  openModal(`
    <h2>${editing ? "Modifier le cadeau" : "Un nouveau souhait"}</h2>
    <form class="stack" id="gift-form" novalidate>
      <div class="field"><label for="g-name">Nom du cadeau</label>
        <input class="input" id="g-name" maxlength="80" placeholder="Une lampe de lecture" value="${esc(gift?.name || "")}"></div>
      <div class="field"><label for="g-desc">Détails <span class="muted">(facultatif)</span></label>
        <textarea class="input" id="g-desc" maxlength="500" placeholder="Taille, couleur, modèle précis…">${esc(gift?.description || "")}</textarea></div>
      <div class="field"><label for="g-url">Lien vers le produit <span class="muted">(facultatif)</span></label>
        <input class="input" id="g-url" inputmode="url" autocapitalize="none" placeholder="https://…" value="${esc(gift?.url || "")}"></div>
      <div class="field"><span class="label">Image <span class="muted">(facultatif)</span></span>
        <div class="preview" id="g-preview" hidden><img alt="" referrerpolicy="no-referrer">
          <button type="button" class="btn btn-line btn-small" id="g-remove">Retirer</button></div>
        <input class="input" id="g-img-url" inputmode="url" autocapitalize="none" placeholder="Colle l'adresse d'une image" value="${esc(startUrl)}" aria-label="Adresse de l'image">
        <label class="btn btn-soft btn-small" for="g-file">📷 Choisir une photo</label>
        <input class="file-input" id="g-file" type="file" accept="image/*"></div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
        <button class="btn btn-primary" type="submit">${editing ? "Enregistrer" : "Ajouter à ma liste"}</button></div>
    </form>`, (m) => {
    const $url = m.querySelector("#g-img-url");
    const $prev = m.querySelector("#g-preview");
    const $img = $prev.querySelector("img");
    const currentImage = () => fileImage || normalizeUrl($url.value);
    const refresh = () => {
      const src = currentImage();
      $prev.hidden = !src;
      if (src) { $img.classList.remove("broken"); $img.src = src; }
    };
    refresh();
    $url.addEventListener("input", () => { fileImage = ""; refresh(); });
    m.querySelector("#g-remove").addEventListener("click", () => { fileImage = ""; $url.value = ""; refresh(); });
    m.querySelector("#g-file").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { fileImage = await fileToDataUrl(f); $url.value = ""; refresh(); }
      catch { toast("Cette photo n'a pas pu être lue. Essaie-en une autre."); }
    });

    m.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = m.querySelector("#g-name").value.trim();
      const rawUrl = m.querySelector("#g-url").value.trim();
      const url = normalizeUrl(rawUrl);
      if (!name) return toast("Donne un nom à ton cadeau 🎁");
      if (rawUrl && !url) return toast("Ce lien produit n'a pas l'air valide.");
      if ($url.value.trim() && !fileImage && !normalizeUrl($url.value)) return toast("L'adresse de l'image n'a pas l'air valide.");
      const data = {
        name,
        description: m.querySelector("#g-desc").value.trim(),
        url,
        imageUrl: currentImage(),
      };
      e.submitter && (e.submitter.disabled = true);
      try {
        const lid = state.listId;
        if (editing) {
          await updateDoc(doc(db, "lists", lid, "gifts", gift.id), { ...data, updatedAt: serverTimestamp() });
        } else {
          await addDoc(collection(db, "lists", lid, "gifts"), {
            ...data, ownerId: myUid(), ownerName: myName(), createdAt: serverTimestamp(),
          });
        }
        closeModal();
        toast(editing ? "Cadeau mis à jour ✨" : "Ajouté à ta liste 🎁");
      } catch (err) { toast(friendlyError(err)); e.submitter && (e.submitter.disabled = false); }
    });
  });
}

// ── Réglages : notifications + quitter ───────────────────────
const PUSH_KEY = "noel-push-token";
const pushConfigured = () => !String(VAPID_KEY).startsWith("VOTRE");
async function pushSupported() {
  try { return "Notification" in window && "serviceWorker" in navigator && (await isSupported()); }
  catch { return false; }
}
const swUrl = () => `firebase-messaging-sw.js?${new URLSearchParams(firebaseConfig).toString()}`;

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Les notifications sont bloquées dans les réglages de ton navigateur.");
  const reg = await navigator.serviceWorker.register(swUrl());
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Impossible d'activer les notifications sur cet appareil.");
  await setDoc(doc(db, "users", myUid()), { name: myName(), fcmTokens: arrayUnion(token) }, { merge: true });
  localStorage.setItem(PUSH_KEY, token);
}
async function disablePush() {
  const token = localStorage.getItem(PUSH_KEY);
  if (token) await updateDoc(doc(db, "users", myUid()), { fcmTokens: arrayRemove(token) });
  try { await deleteToken(getMessaging(app)); } catch { /* déjà supprimé */ }
  localStorage.removeItem(PUSH_KEY);
}
// Le jeton d'un appareil peut changer : on le remet à jour discrètement à chaque connexion.
async function refreshPushToken() {
  try {
    if (!pushConfigured() || !localStorage.getItem(PUSH_KEY) || Notification.permission !== "granted") return;
    if (await pushSupported()) await enablePush();
  } catch { /* silencieux */ }
}

function openSettingsModal() {
  const uid = myUid();
  const others = state.members.filter((m) => m.uid !== uid)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  const prefs = myNotifyPrefs();

  openModal(`
    <h2>Réglages de la liste</h2>
    <div class="subhead">Qui te prévient d'un nouveau cadeau ?</div>
    <div class="stack" id="notify-form">
      <label class="opt"><input type="radio" name="mode" value="all"> Tout le monde</label>
      <label class="opt"><input type="radio" name="mode" value="some"> Certaines personnes</label>
      <div class="stack" id="notify-people" hidden>
        ${others.length ? others.map((m) => `
          <label class="opt">${avatar(m.uid, m.name)}<input type="checkbox" name="from" value="${esc(m.uid)}"> ${esc(m.name)}</label>`).join("")
          : `<p class="hint">Personne d'autre n'a encore rejoint la liste.</p>`}
      </div>
      <label class="opt"><input type="radio" name="mode" value="none"> Personne</label>
    </div>

    <div class="subhead">Sur cet appareil</div>
    <p class="hint" id="push-hint">Quand la liste est ouverte, un message apparaît toujours en haut de l'écran.</p>
    <button class="btn btn-soft btn-block" id="push-btn" hidden></button>

    <div class="btns" style="margin-top:22px">
      <button class="btn btn-ghost" data-action="leave-list">Quitter cette liste</button>
      <button class="btn btn-primary" data-action="close-modal">Terminé</button>
    </div>`, (m) => {
    // -- Choix des personnes suivies
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

    // -- Notifications même appli fermée
    const $btn = m.querySelector("#push-btn");
    const $hint = m.querySelector("#push-hint");
    (async () => {
      if (!pushConfigured()) {
        $hint.textContent = "Les notifications appli fermée ne sont pas encore activées pour ce site (voir le README). En attendant, un message apparaît quand la liste est ouverte.";
        return;
      }
      if (!(await pushSupported())) {
        $hint.textContent = "Ce navigateur ne gère pas les notifications appli fermée. Sur iPhone, ajoute d'abord le site à l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »).";
        return;
      }
      const on = Notification.permission === "granted" && !!localStorage.getItem(PUSH_KEY);
      $hint.textContent = on ? "Les notifications sont activées sur cet appareil." : "Reçois une notification même quand l'appli est fermée.";
      $btn.textContent = on ? "Désactiver sur cet appareil" : "🔔 Activer sur cet appareil";
      $btn.hidden = false;
      $btn.onclick = async () => {
        $btn.disabled = true;
        try {
          if (on) { await disablePush(); toast("Notifications désactivées sur cet appareil."); }
          else { await enablePush(); toast("Notifications activées 🎉"); }
          closeModal();
        } catch (err) { toast(friendlyError(err)); $btn.disabled = false; }
      };
    })();
  });
}

async function leaveList() {
  if (!confirm("Quitter cette liste ? Tes cadeaux seront retirés de la liste.")) return;
  const lid = state.listId;
  try {
    for (const g of state.gifts.filter((x) => x.ownerId === myUid())) {
      await deleteDoc(doc(db, "lists", lid, "gifts", g.id));
    }
    stopList();               // on coupe les écoutes avant de perdre l'accès
    state.view = "loading";
    await deleteDoc(doc(db, "lists", lid, "members", myUid()));
    await deleteDoc(doc(db, "users", myUid(), "myLists", lid));
    closeModal();
    location.hash = "#/";
    toast("Tu as quitté la liste.");
  } catch (err) { toast(friendlyError(err)); }
}

// ─────────────────────────────────────────────────────────────
//  Actions (boutons marqués data-action)
// ─────────────────────────────────────────────────────────────
const giftById = (id) => state.gifts.find((g) => g.id === id);
const joinUrl = () => `${location.origin}${location.pathname}#/rejoindre/${state.listId}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const actions = {
  "switch-auth": () => { state.authMode = state.authMode === "signup" ? "login" : "signup"; renderAuth(); },
  "reset-password": async () => {
    const email = (document.getElementById("a-email")?.value || "").trim();
    if (!email) return toast("Écris ton email ci-dessus, puis reclique ici.");
    try { await sendPasswordResetEmail(auth, email); toast("Email envoyé ! Regarde aussi dans les spams 📬", 7000); }
    catch (err) { toast(friendlyError(err)); }
  },
  "logout": () => signOut(auth),
  "close-modal": () => closeModal(),
  "new-list": () => openNewListModal(),
  "join-list": () => openJoinModal(),
  "open-list": (el) => { location.hash = `#/liste/${el.dataset.id}`; },
  "back": () => { location.hash = "#/"; },
  "pick-person": (el) => { state.selectedUid = el.dataset.uid; renderList(); },
  "add-gift": () => openGiftModal(null),
  "edit-gift": (el) => { const g = giftById(el.dataset.id); if (g) openGiftModal(g); },
  "delete-gift": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g || !confirm(`Supprimer « ${g.name} » de ta liste ?`)) return;
    try { await deleteDoc(doc(db, "lists", state.listId, "gifts", g.id)); toast("Cadeau supprimé."); }
    catch (err) { toast(friendlyError(err)); }
  },
  "buy": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try {
      await setDoc(doc(db, "lists", state.listId, "purchases", g.ownerId, "items", g.id), {
        boughtBy: myUid(), boughtByName: myName(), at: serverTimestamp(),
      });
      toast("C'est noté, chut ! 🤫");
    } catch (err) {
      toast(err.code === "permission-denied" ? "Quelqu'un vient déjà de l'acheter !" : friendlyError(err));
    }
  },
  "unbuy": async (el) => {
    const g = giftById(el.dataset.id);
    if (!g) return;
    try { await deleteDoc(doc(db, "lists", state.listId, "purchases", g.ownerId, "items", g.id)); }
    catch (err) { toast(friendlyError(err)); }
  },
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
  if (!state.user) { stopList(); state.view = "auth"; renderAuth(); return; }
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
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    if (state.unsubLists) { state.unsubLists(); state.unsubLists = null; }
    if (!user) { state.lists = []; closeModal(); route(); return; }

    setDoc(doc(db, "users", user.uid), { name: myName() }, { merge: true }).catch(() => {});
    state.unsubLists = onSnapshot(collection(db, "users", user.uid, "myLists"), (snap) => {
      state.lists = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (state.view === "home") renderHome();
    }, () => {});
    route();
    refreshPushToken();
  });
}
