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

1. **Organisateur** : `/org/login` → crée une partie (et choisit son
   déroulement, voir ci-dessous) → ajoute des étapes (balises NFC, énigmes
   texte, mini-jeux, photos, balises GPS) → onglet **Balises** pour écrire les
   puces NFC (Chrome Android) et imprimer les QR/codes de secours.
2. **Joueurs** : `/play` → code partie → créent/rejoignent une équipe au lobby,
   et vérifient leur téléphone (son, localisation, boussole, NFC…) en attendant.
3. **Organisateur** : dashboard **Live** → 🚀 Lancer. L'algorithme round-robin
   (carré latin) attribue à chaque équipe le même parcours dans un ordre décalé —
   jamais deux équipes sur la même énigme au même index de progression. Les
   paliers communs restent fixes, le sprint final est commun et débloqué en dernier.
4. Suivi temps réel, envoi d'indices, validation manuelle, pause/fin depuis le Live.
5. **Statistiques** (`/org/games/[id]/stats`) : la partie en chiffres, les notes
   des joueurs, les équipes et leurs contacts, les photos — et des
   **organisateurs invités** en lecture seule (invitation par e-mail).

## Déroulement d'une partie — à choisir partie par partie

Tout se règle dans l'éditeur (carte « ⚙️ Déroulement de la partie ») et reste
modifiable tant que la partie n'est pas terminée. Par défaut, rien ne change
par rapport au fonctionnement historique.

| Réglage (`games.settings`) | Défaut | Effet |
|---|---|---|
| `continuous` | non | **Départ groupé** (défaut) : inscriptions au lobby, l'organisateur lance tout le monde. **En continu** : la partie s'ouvre (même sans équipe), chacun arrive et part quand il veut — seul (« Je pars seul ») ou en équipe (« Partir maintenant ») — avec **son propre chrono** (`teams.started_at`, `start_team()`). |
| `route_mode` | `disperse` | Chaque équipe son ordre (anti-peloton), ou `fixe` : l'ordre de l'éditeur pour toutes. |
| `unattended` | non | Sans surveillance : la photo bloquante ne bloque plus, l'énigme bonus se juge seule, l'app ne promet pas d'aide humaine en direct. |
| `ask_rating` | non | Note de 1 à 5 étoiles demandée à chaque joueur arrivé. |
| `ask_contact` | non | Contact facultatif (e-mail/téléphone) à la création d'équipe, pour prévenir les gagnants — visible des organisateurs seuls (`team_contacts`). |
| `auto_close` + `close_hour` + `timezone` | non | Fermeture automatique chaque soir (cron Vercel → `/api/cron/close-day`). |

Le parcours reste modifiable pendant la partie : supprimer une étape passe par
`org_delete_step`, qui fait d'abord avancer les équipes qui sont dessus.

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

## Tests

```bash
npm test          # algos critiques (round-robin, PRNG, mini-jeux, boussole,
                  # diagnostic, stockage, configuration) + scénarios SQL
npm run test:sql  # seulement les scénarios SQL
```

Les scénarios SQL appliquent **tout** `supabase/setup.sql` dans un Postgres
embarqué (PGlite) et jouent des parties types (départ groupé, jeu en continu,
pause, sans surveillance, invités, duplication…) : aucune base distante, aucun
Docker. Le nécessaire de Supabase (`auth.uid()`, rôles, RLS) est simulé dans
`tests/sql/harness.mjs` ; `sousRls()` exerce vraiment les politiques RLS.

## Déploiement Vercel

Importer le repo, définir `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
et `SUPABASE_SERVICE_ROLE_KEY` (utilisée uniquement côté serveur par
`/api/upload-url`, `/api/cleanup-media`, `/api/duplicate-media` et le cron)
dans les variables d'environnement, déployer.

Pour la fermeture automatique du soir : définir aussi `CRON_SECRET` (valeur
aléatoire longue). `vercel.json` planifie `/api/cron/close-day` chaque jour à
23 h UTC (19 h aux Antilles, 1 h en France) ; la route ne ferme que les parties
qui ont coché l'option. Le passage n'a lieu qu'une fois par jour : c'est la base
qui fait respecter l'heure choisie, en refusant inscriptions et départs dès
qu'elle est passée (`auto_close_due` dans `supabase/setup.sql`).

⚠️ Les variables `NEXT_PUBLIC_*` sont figées **au build** : après les avoir
changées chez Vercel, relancer un déploiement.
⚠️ Web NFC exige HTTPS (ok sur Vercel) et Chrome Android ; QR + code manuel
fonctionnent partout.
