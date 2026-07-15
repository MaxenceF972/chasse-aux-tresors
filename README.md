# 🧭 TOYAH GAMES

Chasse au trésor en temps réel, mobile-first, jouée sur smartphone en extérieur.
Next.js 15 (App Router, TypeScript) + Tailwind CSS 4 + Framer Motion + Supabase + PWA.

## Mise en route

### 1. Base de données Supabase

Deux options pour appliquer le schéma (tables, RLS, RPC, algo round-robin) :

- **Option A** — Dashboard Supabase → SQL Editor → coller le contenu de
  [`supabase/setup.sql`](supabase/setup.sql) → Run.
- **Option B** — Ajouter `DATABASE_URL` dans `.env.local` (Settings → Database →
  Connection string, *session pooler*) puis :
  ```bash
  npm run db:apply
  ```

Le script est idempotent : ré-exécutable sans danger.

### 2. Réglages du dashboard Supabase (une fois)

- **Authentication → Sign In / Up → “Allow anonymous sign-ins” : ON**
  (indispensable : les joueurs n'ont pas de compte).
- Optionnel : Authentication → “Confirm email” : OFF pour créer des comptes
  organisateur sans validation par mail.

### 3. Lancer l'app

```bash
npm install
npm run dev
```

Les clés Supabase sont dans `.env.local` (voir `.env.example`).

### 4. Logo

Déposer le logo officiel dans `public/logo.png` (un lettrage de secours s'affiche sinon).

## Parcours type

1. **Organisateur** : `/org/login` → crée une partie → ajoute des étapes
   (balises NFC, énigmes texte, mini-jeux) → onglet **Balises** pour écrire les
   puces NFC (Chrome Android) et imprimer les QR/codes de secours.
2. **Joueurs** : `/play` → code partie → créent/rejoignent une équipe au lobby.
3. **Organisateur** : dashboard **Live** → 🚀 Lancer. L'algorithme round-robin
   (carré latin) attribue à chaque équipe le même parcours dans un ordre décalé —
   jamais deux équipes sur la même énigme au même index de progression. Les
   paliers communs restent fixes, le sprint final est commun et débloqué en dernier.
4. Suivi temps réel, envoi d'indices, validation manuelle, pause/fin depuis le Live.

## Architecture (résumé)

- **Toutes les mutations de jeu passent par des RPC Postgres `SECURITY DEFINER`**
  (`validate_step`, `start_game`, `unlock_hint`, …) — le RLS ne gère que la lecture.
- **`step_secrets`** (réponses, identifiants NFC, indices) n'est jamais lisible par
  les joueurs : impossible de tricher via l'API.
- **Validations idempotentes** (`idem_key`) + file offline IndexedDB : une
  validation faite sans réseau est rejouée automatiquement au retour de connexion.
- **Realtime** Supabase = signal d'invalidation ; l'état de vérité est refetché.
- **Mini-jeux** : registry extensible (`components/minigames/registry.ts`) —
  interface commune `MiniGameProps` (config, seed déterministe, `onComplete`).

## Déploiement Vercel

Importer le repo, définir `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
et `SUPABASE_SERVICE_ROLE_KEY` (utilisée uniquement côté serveur par
`/api/upload-url` pour signer les uploads de médias) dans les variables
d'environnement, déployer.
⚠️ Web NFC exige HTTPS (ok sur Vercel) et Chrome Android ; QR + code manuel
fonctionnent partout.
