# 🎄 Listes de Noël

Une petite appli pour que chacun note ses envies de Noël, que les autres cochent ce qu'ils achètent… et que la personne concernée ne voie jamais rien.

- **Se connecter** avec email + mot de passe (prénom demandé à l'inscription)
- **Créer une liste** (« Noël en famille », « Copains »…) et **inviter** avec un code ou un lien
- **Ajouter des cadeaux** : nom, détails, lien produit, image (adresse web ou photo)
- **Marquer « acheté »** sur la liste des autres. Sur sa propre liste, on ne voit jamais qui a acheté quoi
- **Notifications** quand quelqu'un ajoute un cadeau : tout le monde, certaines personnes ou personne, réglable par liste

Tout tourne sur GitHub Pages (site statique) + Firebase (comptes et base de données). Aucune installation, aucun serveur à gérer.

---

## Installation en 20 minutes

### 1. Créer le projet Firebase

1. Va sur <https://console.firebase.google.com> → **Ajouter un projet** (Google Analytics : inutile).
2. Dans le projet : **Paramètres du projet** (⚙️) → **Vos applications** → icône **Web `</>`** → donne un nom → **Enregistrer**.
3. Copie l'objet `firebaseConfig` affiché et colle ses valeurs dans **`firebase-config.js`**.

### 2. Activer les comptes

**Authentication** → **Commencer** → **Adresse e-mail/Mot de passe** → activer → **Enregistrer**.

### 3. Créer la base de données et ses règles

1. **Firestore Database** → **Créer une base de données** → choisis une région en Europe → **mode production**.
2. Onglet **Règles** → remplace tout par le contenu de **`firestore.rules`** → **Publier**.

> 🔒 C'est ici que la surprise est protégée : les règles interdisent *côté serveur* à quelqu'un de lire les achats faits pour lui. Même en bidouillant le code, c'est impossible.

### 4. Mettre le site en ligne (GitHub Pages)

1. Crée un dépôt GitHub (ex. `liste-noel`) et envoie-y tous ces fichiers.
2. **Settings** → **Pages** → *Source* : **Deploy from a branch** → branche `main`, dossier `/ (root)` → **Save**.
3. Après ~1 minute, ton site est sur `https://TON-PSEUDO.github.io/liste-noel/`.

### 5. Autoriser ton site à se connecter

Firebase → **Authentication** → **Paramètres** → **Domaines autorisés** → **Ajouter un domaine** → `TON-PSEUDO.github.io`.

C'est fini pour l'essentiel : ouvre le site, crée un compte, crée une liste, et envoie le lien d'invitation. 🎁

---

## Notifications quand l'appli est fermée (facultatif)

Sans cette étape, les notifications fonctionnent déjà **quand la liste est ouverte** (un message apparaît en haut de l'écran). Pour recevoir aussi une vraie notification téléphone/ordinateur appli fermée :

1. **Clé Web Push** : Firebase → ⚙️ **Paramètres du projet** → **Cloud Messaging** → **Certificats Web Push** → **Générer une paire de clés** → colle la clé dans `VAPID_KEY` (`firebase-config.js`).
2. **Passer au forfait Blaze** (paiement à l'usage) : c'est obligatoire pour les Cloud Functions. Pour une famille, le coût est de 0 € en pratique (quotas gratuits très larges). Ajoute quand même une **alerte de budget** (ex. 1 €) dans Google Cloud.
3. **Déployer la fonction** qui envoie les notifications :
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add            # choisis ton projet
   # ouvre functions/index.js et adapte APP_URL et REGION
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
4. Dans l'appli, chacun ouvre **🔔 Réglages de la liste** → **Activer sur cet appareil**.

**iPhone / iPad** : Apple n'autorise les notifications web que si le site est installé sur l'écran d'accueil (Safari → Partager → *Sur l'écran d'accueil*), puis ouvert depuis cette icône (iOS 16.4 minimum).

---

## Comment ça marche

| Élément | Rôle |
|---|---|
| `lists/{code}` | une liste. Le **code est l'identifiant** : sans lui, on ne peut pas la trouver |
| `lists/{code}/members/{uid}` | les participants + leurs choix de notifications |
| `lists/{code}/gifts/{id}` | les cadeaux souhaités (visibles par tous les membres) |
| `lists/{code}/purchases/{destinataire}/items/{id}` | les achats, **illisibles par le destinataire** |
| `users/{uid}` | profil et appareils à notifier (privé) |

Les photos sont réduites (520 px max) et stockées directement dans le cadeau : pas besoin de Firebase Storage ni de forfait payant pour cela.

## Bon à savoir

- **Qui peut rejoindre ?** Toute personne ayant le code ou le lien. Ne le publie pas en clair sur les réseaux.
- **Mot de passe oublié ?** Le lien sur l'écran de connexion envoie un email de réinitialisation.
- **Deux personnes achètent le même cadeau au même instant ?** La première l'emporte, l'autre est prévenue.
- **Quitter une liste** retire aussi tes propres cadeaux de cette liste.
- Les clés de `firebase-config.js` ne sont pas secrètes (elles sont visibles dans tout site Firebase) : ce sont les règles Firestore qui protègent les données.

## Structure du projet

```
index.html · style.css · app.js         l'appli
firebase-config.js                      à remplir avec tes clés
firebase-messaging-sw.js                affiche les notifications appli fermée
manifest.webmanifest · icon-*.png       installation sur l'écran d'accueil
firestore.rules · firebase.json         règles de sécurité
functions/                              envoi des notifications (facultatif)
```
