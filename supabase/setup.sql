-- ============================================================================
-- TOYAH GAMES — Schéma complet Supabase
-- À exécuter dans le SQL Editor du dashboard (ou via `npm run db:apply`).
-- Ré-exécutable sans danger (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;

-- ----------------------------------------------------------------------------
-- Types
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.game_status as enum ('lobby','running','paused','finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.step_type as enum ('nfc','text','minigame','photo','gps');
exception when duplicate_object then null; end $$;

-- Migration pour les bases créées avant l'épreuve photo
alter type public.step_type add value if not exists 'photo';

-- Migration pour les bases créées avant les balises GPS
alter type public.step_type add value if not exists 'gps';

do $$ begin
  create type public.route_status as enum ('locked','current','done');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  status      public.game_status not null default 'lobby',
  created_by  uuid not null references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  paused_total_ms bigint not null default 0,  -- cumul des pauses (chrono figé)
  paused_at   timestamptz                      -- début de la pause en cours
);

alter table public.games add column if not exists paused_total_ms bigint not null default 0;
alter table public.games add column if not exists paused_at timestamptz;
-- Ordre de visite des blocs du pool, tiré une fois pour la partie (anti-peloton).
-- Persisté : en jeu continu, une équipe qui arrive à 16 h doit hériter du même
-- ordre que celle de 9 h, sinon la garantie ne vaut que pour le départ groupé.
alter table public.games add column if not exists route_perm int[];

-- ------------------------------------------------------------------------
-- LES ORGANISATEURS INVITES — LECTURE SEULE, et rien d'autre.
--
-- Une partie a UN proprietaire (games.created_by), et ca ne change pas : les
-- onze fonctions d'ecriture (`org_set_status`, `org_force_validate`,
-- `org_delete_step`…) continuent toutes de comparer a `created_by`. Un invite
-- ne peut donc ni mettre en pause, ni valider, ni supprimer quoi que ce soit —
-- non pas parce que l'interface le lui cache, mais parce que le serveur refuse.
-- C'est la seule forme de lecture seule qui tienne.
--
-- L'invitation se fait par E-MAIL et sans jeton. La personne cree son compte
-- avec cette adresse (l'ecran de connexion propose deja « Creer un compte »)
-- ou on le cree pour elle, et l'acces suit l'adresse. Pas de lien secret a
-- faire circuler — un lien qui ouvre les coordonnees des visiteurs se
-- transfere trop facilement.
--
-- Ce qu'un invite NE VOIT PAS : `step_secrets`. Les reponses, les
-- identifiants de balise et les coordonnees restent au proprietaire. Ce n'est
-- pas de la mefiance, c'est que les statistiques n'en ont pas besoin.
-- ------------------------------------------------------------------------
create table if not exists public.game_staff (
  game_id    uuid not null references public.games(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, email)
);
alter table public.game_staff enable row level security;

create table if not exists public.steps (
  id                   uuid primary key default gen_random_uuid(),
  game_id              uuid not null references public.games(id) on delete cascade,
  type                 public.step_type not null,
  title                text not null,
  content              jsonb not null default '{}'::jsonb,
  media_urls           text[] not null default '{}',
  is_common_checkpoint boolean not null default false,
  is_final             boolean not null default false,
  is_start             boolean not null default false,  -- épreuve de départ (première pour tous)
  order_hint           int not null default 0,
  points               int not null default 100,   -- points gagnés (mode points)
  time_limit_sec       int,                        -- limite de temps optionnelle
  chain_group          text,                       -- étapes liées : même groupe = jouées à la suite
  created_at           timestamptz not null default now()
);

alter table public.steps add column if not exists points int not null default 100;
alter table public.steps add column if not exists time_limit_sec int;
alter table public.steps add column if not exists is_start boolean not null default false;
alter table public.steps add column if not exists chain_group text;

-- Secrets d'étape : réponses, identifiants de balise, indices.
-- JAMAIS lisibles par les joueurs (vérifiés uniquement en RPC).
create table if not exists public.step_secrets (
  step_id     uuid primary key references public.steps(id) on delete cascade,
  answers     text[] not null default '{}',
  nfc_tag_id  text,
  manual_code text,
  hints       jsonb not null default '[]'::jsonb, -- [{text, penalty_sec?, unlock_after_sec?}]
  gps_lat     double precision,                   -- balise GPS : coordonnées cibles
  gps_lng     double precision,
  gps_radius_m int                                -- rayon de validation (défaut 30 m)
);

alter table public.step_secrets add column if not exists gps_lat double precision;
alter table public.step_secrets add column if not exists gps_lng double precision;
alter table public.step_secrets add column if not exists gps_radius_m int;

create table if not exists public.teams (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games(id) on delete cascade,
  name            text not null,
  team_code       text not null,
  color           text not null default '#C0392B',
  roster          text[] not null default '{}',   -- membres listés par le capitaine
  penalty_seconds int not null default 0,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (game_id, team_code)
);

-- Migrations pour les bases déjà créées
alter table public.teams add column if not exists roster text[] not null default '{}';
alter table public.teams add column if not exists final_time_ms bigint;  -- temps effectif figé à l'arrivée
alter table public.teams add column if not exists bonus_points int not null default 0;  -- bonus attribués par l'organisateur
-- CHRONO PAR ÉQUIPE : en jeu continu, la partie dure la journée mais chaque
-- équipe court son propre temps. Sans ça, la première visite du matin
-- terminerait avec huit heures au compteur.
alter table public.teams add column if not exists started_at timestamptz;      -- départ de CETTE équipe
alter table public.teams add column if not exists paused_total_ms bigint not null default 0;  -- pauses subies depuis son départ

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  nickname   text not null,
  auth_uid   uuid not null unique,
  device_token text,
  created_at timestamptz not null default now(),
  -- Dernière position partagée (avec consentement) pour le suivi organisateur
  last_lat   double precision,
  last_lng   double precision,
  pos_updated_at timestamptz
);

alter table public.players add column if not exists last_lat double precision;
alter table public.players add column if not exists last_lng double precision;
alter table public.players add column if not exists pos_updated_at timestamptz;
-- La note d'experience, de 1 a 5 etoiles. Par JOUEUR et non par equipe : dans
-- un groupe de quatre, la premiere personne a toucher l'ecran deciderait pour
-- les trois autres, et la moyenne ne voudrait plus rien dire.
alter table public.players add column if not exists rating smallint;
alter table public.players add column if not exists rated_at timestamptz;
alter table public.players drop constraint if exists players_rating_check;
alter table public.players
  add constraint players_rating_check check (rating is null or rating between 1 and 5);

create table if not exists public.team_routes (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  step_id      uuid not null references public.steps(id) on delete cascade,
  position     int not null,
  status       public.route_status not null default 'locked',
  validated_at timestamptz,
  skipped      boolean not null default false,  -- mini-jeu passé (pénalité tant que non rattrapé)
  timed_out    boolean not null default false,  -- passée après expiration du timer (0 point, sans pénalité)
  unique (team_id, position),
  unique (team_id, step_id)
);

alter table public.team_routes add column if not exists skipped boolean not null default false;
alter table public.team_routes add column if not exists timed_out boolean not null default false;
-- Rattrapage d'une épreuve sautée : date de réussite (null = pas encore rattrapée).
-- `skipped` reste vrai (trace historique) ; un rattrapage réussi rend le gain
-- de l'étape ET annule la pénalité du skip.
alter table public.team_routes add column if not exists redeemed_at timestamptz;

-- PARTIES LANCÉES AVANT LE CHRONO PAR ÉQUIPE : leurs équipes ont un parcours
-- mais pas de départ propre (teams.started_at vient d'apparaître, vide). Elles
-- sont pourtant bien parties — avec la partie. Sans ce rattrapage, l'écran de
-- jeu les renverrait au lobby, où « Partir » referait leur parcours de zéro :
-- progression perdue en pleine chasse. Elles prennent donc le départ de la
-- partie et ses pauses, ce qui laisse leur chrono exactement où il était.
-- Idempotent : ne touche que des équipes sans départ qui ont déjà un parcours.
update public.teams t
set started_at = g.started_at, paused_total_ms = g.paused_total_ms
from public.games g
where g.id = t.game_id
  and t.started_at is null
  and g.started_at is not null
  and exists (select 1 from public.team_routes r where r.team_id = t.id);

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games(id) on delete cascade,
  team_id    uuid references public.teams(id) on delete set null,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  idem_key   uuid unique,
  created_at timestamptz not null default now()
);

-- Photos soumises par les équipes (épreuve photo), validées par l'organisateur
create table if not exists public.submissions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  step_id    uuid not null references public.steps(id) on delete cascade,
  url        text not null,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_winner  boolean not null default false,   -- 🏆 meilleure photo de la partie
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.submissions add column if not exists is_winner boolean not null default false;
-- Énigme bonus : la « soumission » est une RÉPONSE écrite, pas une photo.
-- L'équipe répond une fois, avance aussitôt, et l'organisateur juge après coup.
alter table public.submissions add column if not exists answer text;
alter table public.submissions alter column url drop not null;

-- Abonnements aux notifications push (aucun accès direct : RPC + service role)
create table if not exists public.push_subscriptions (
  auth_uid     uuid primary key,
  game_id      uuid references public.games(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete cascade,
  subscription jsonb not null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.minigame_results (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  step_id     uuid not null references public.steps(id) on delete cascade,
  score       numeric,
  duration_ms int,
  created_at  timestamptz not null default now(),
  unique (team_id, step_id)
);

create index if not exists idx_steps_game        on public.steps(game_id);
create index if not exists idx_teams_game        on public.teams(game_id);
create index if not exists idx_players_game      on public.players(game_id);
create index if not exists idx_players_team      on public.players(team_id);
create index if not exists idx_routes_game       on public.team_routes(game_id);
create index if not exists idx_routes_team       on public.team_routes(team_id);
create index if not exists idx_events_game       on public.events(game_id, id desc);
create index if not exists idx_mg_results_team   on public.minigame_results(team_id);
create index if not exists idx_submissions_game  on public.submissions(game_id, status);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Normalisation des réponses : minuscules, sans accents, sans ponctuation ni espaces.
create or replace function public.normalize_answer(t text) returns text
language sql stable
set search_path = public, extensions
as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]', '', 'g')
$$;

-- Génère un code lisible (sans caractères ambigus O/0/I/1/L).
create or replace function public.gen_code(p_len int default 6) returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text := '';
  i       int;
begin
  for i in 1..p_len loop
    v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;
  return v_code;
end $$;

-- Distance en mètres entre deux points GPS (haversine).
create or replace function public.gps_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable
set search_path = public
as $$
  select 6371000 * 2 * asin(sqrt(
    pow(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Équipe / partie du joueur courant (security definer → pas de récursion RLS).
create or replace function public.my_team_id() returns uuid
language sql stable security definer
set search_path = public
as $$ select team_id from public.players where auth_uid = auth.uid() $$;

create or replace function public.my_game_id() returns uuid
language sql stable security definer
set search_path = public
as $$ select game_id from public.players where auth_uid = auth.uid() $$;

-- Le caller est-il l'organisateur (compte non anonyme) de cette partie ?
create or replace function public.is_game_owner(p_game_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id and g.created_by = auth.uid()
  )
$$;

-- Le caller est-il un organisateur INVITE sur cette partie ?
--
-- L'adresse du jeton fait foi. Les joueurs sont en session anonyme et n'en ont
-- aucune : la garde sur la chaine vide est donc ce qui empeche une partie
-- entiere de visiteurs de passer pour du personnel.
create or replace function public.is_game_staff(p_game_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select nullif(lower(trim(coalesce(auth.jwt()->>'email', ''))), '') is not null
     and exists (
       select 1 from public.game_staff s
       where s.game_id = p_game_id
         and s.email = lower(trim(auth.jwt()->>'email'))
     )
$$;

-- Qui a le droit de LIRE cette partie : son proprietaire, ou un invite.
-- Utilisee par les seules politiques de SELECT — jamais par une ecriture.
create or replace function public.can_read_game(p_game_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_game_owner(p_game_id) or public.is_game_staff(p_game_id)
$$;

-- Temps de jeu effectif (ms) : chrono figé pendant les pauses.
create or replace function public.game_elapsed_ms(g public.games) returns bigint
language sql stable
set search_path = public
as $$
  select case
    when g.started_at is null then 0
    else greatest(0,
      (extract(epoch from (coalesce(g.finished_at, now()) - g.started_at)) * 1000)::bigint
      - g.paused_total_ms
      - case when g.paused_at is not null
             then (extract(epoch from (now() - g.paused_at)) * 1000)::bigint
             else 0 end)
  end
$$;

-- Temps de course d'UNE ÉQUIPE (ms) — la référence du jeu continu.
--
-- Le chrono part de teams.started_at (le moment où CETTE équipe s'est lancée),
-- pas de games.started_at : la partie, elle, couvre la journée entière.
-- Trois précautions :
--   • repli sur games.started_at tant qu'une équipe n'a pas de départ propre
--     (parties créées avant cette colonne — le classement reste lisible) ;
--   • les pauses ne sont déduites que si elles ont eu lieu APRÈS le départ de
--     l'équipe : une équipe partie pendant la pause n'a rien à récupérer ;
--   • une fois l'équipe arrivée, son temps est figé sur son propre finished_at.
create or replace function public.team_elapsed_ms(p_team_id uuid) returns bigint
language sql stable
set search_path = public
as $$
  select case
    when coalesce(t.started_at, g.started_at) is null then 0
    else greatest(0,
      (extract(epoch from (
         coalesce(t.finished_at, g.finished_at, now())
         - coalesce(t.started_at, g.started_at))) * 1000)::bigint
      -- Équipe sans départ propre : on retombe sur le cumul de pauses de la partie.
      - case when t.started_at is null then g.paused_total_ms else t.paused_total_ms end
      -- Pause en cours : déduite seulement pour une équipe partie avant elle
      -- et pas encore arrivée (sinon son temps figé se mettrait à reculer).
      - case when g.paused_at is not null
                  and t.finished_at is null
                  and coalesce(t.started_at, g.started_at) <= g.paused_at
             then (extract(epoch from (now() - g.paused_at)) * 1000)::bigint
             else 0 end)
  end
  from public.teams t
  join public.games g on g.id = t.game_id
  where t.id = p_team_id
$$;

-- Temps de PAUSE de la partie survenu depuis un instant donné (ms).
--
-- Le chrono de course d'une équipe est bien gelé pendant une pause
-- (teams.paused_total_ms), mais le repère d'une ÉTAPE — compte à rebours,
-- délai qui rend un indice gratuit, saut automatique — se comparait à now()
-- brut. Trente minutes d'averse étaient donc trente minutes prises sur
-- l'épreuve en cours : l'équipe reprenait devant un chrono déjà mort.
--
-- `paused_total_ms` est un compteur cumulé, sans histoire : impossible d'en
-- déduire ce qui s'est passé APRÈS un instant donné. Les bornes, elles, sont
-- dans les événements `game_paused` / `game_resumed`, qui portent leur date.
-- Une journée en compte quelques-uns, et events est indexé par partie.
create or replace function public.paused_ms_since(p_game_id uuid, p_since timestamptz)
returns bigint
language sql stable
set search_path = public
as $$
  with bornes as (
    select e.created_at as debut,
           (select min(r.created_at) from public.events r
             where r.game_id = e.game_id and r.type = 'game_resumed'
               and r.created_at > e.created_at) as fin
    from public.events e
    where e.game_id = p_game_id and e.type = 'game_paused'
      and e.created_at <= now()
  )
  select coalesce(sum(
           greatest(0, (extract(epoch from (
             least(coalesce(fin, now()), now()) - greatest(debut, p_since)
           )) * 1000)::bigint)
         ), 0)
  from bornes
  where coalesce(fin, now()) > p_since
$$;

-- JEU EN CONTINU — chaque équipe part quand elle est prête.
--
-- Réglage de la partie (`settings.continuous`), ÉTEINT par défaut : le mode
-- historique de TOYAH reste le départ groupé (les équipes s'inscrivent au
-- lobby, l'organisateur lance tout le monde d'un coup).
--
-- Allumé, la partie s'ouvre éventuellement SANS équipe, les inscriptions
-- restent ouvertes pendant qu'elle tourne, et chaque équipe se lance elle-même
-- par start_team() — solo ou en groupe — avec son propre chrono
-- (teams.started_at). Le départ groupé continue de fonctionner à l'ouverture :
-- les équipes déjà au lobby partent ensemble.
create or replace function public.is_continuous(g public.games) returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce((g.settings->>'continuous')::boolean, false)
$$;

-- MODE SANS SURVEILLANCE — personne ne regarde le tableau de bord.
--
-- Quand aucun maître du jeu n'est derrière un écran (jeu en libre accès, lieu
-- ouvert au public…), tout ce qui ATTEND une décision humaine devient un
-- cul-de-sac. Ce réglage lève ces attentes : la photo bloquante n'arrête plus
-- l'équipe, et l'énigme bonus se juge seule.
--
-- Il ne ferme RIEN : la fermeture du soir est un réglage à part
-- (`settings.auto_close`), éteint par défaut. Une chasse tourne jusqu'à ce
-- qu'on la coupe.
create or replace function public.is_unattended(g public.games) returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce((g.settings->>'unattended')::boolean, false)
$$;

-- LE SENS DU PARCOURS — deux façons de mener la journée.
--
--   • 'disperse' (défaut) : chaque équipe reçoit le pool dans un ordre qui lui
--     est propre, et l'app la réoriente en direct vers l'épreuve la moins
--     fréquentée. Personne ne se suit, personne n'attend devant une énigme
--     déjà occupée. C'est le comportement historique.
--   • 'fixe' : tout le monde suit L'ORDRE DE L'ÉDITEUR, du premier au dernier.
--     Le lieu impose un sens de circulation (un musée, un parcours fléché, une
--     histoire qui se raconte dans l'ordre) et on veut que la chasse le
--     respecte. Le prix à payer est assumé : deux équipes parties à cinq
--     minutes d'écart se croiseront.
--
-- Le réglage ne concerne QUE l'ordre à l'intérieur du pool. L'épreuve de
-- départ, les paliers communs et le sprint final gardent leur rang dans les
-- deux cas — c'est la trame, elle ne bouge jamais.
create or replace function public.is_route_fixed(g public.games) returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(g.settings->>'route_mode', 'disperse') = 'fixe'
$$;

-- FERMETURE DU SOIR : l'heure est-elle passée pour cette partie ?
--
-- Une seule règle pour deux usages : le passage quotidien qui ferme les
-- parties (close_expired_games), et les inscriptions et départs, refusés dès
-- l'heure passée. Le second compte autant que le premier : le passage n'a lieu
-- qu'une fois par jour (cron Vercel, 23 h UTC), et sans ce refus une partie
-- qui devait fermer à 21 h accueillerait encore, le lendemain matin, les
-- visiteurs du jour suivant.
--
--   • l'heure se lit dans le fuseau de la partie. Un fuseau que Postgres ne
--     connaît pas retombe sur celui par défaut au lieu de faire échouer
--     l'appel — et, avec lui, la fermeture de toutes les autres parties ;
--   • 0 h veut dire MINUIT : la partie ferme au changement de jour. Lu
--     « heure >= 0 », il la fermait dès son ouverture ;
--   • une partie ouverte un jour antérieur est toujours échue.
create or replace function public.auto_close_due(g public.games) returns boolean
language plpgsql stable
set search_path = public
as $$
declare
  v_tz    text := coalesce(nullif(g.settings->>'timezone', ''), 'America/Martinique');
  v_heure int;
  v_local timestamp;
begin
  if not coalesce((g.settings->>'auto_close')::boolean, false)
     or g.status not in ('running', 'paused')
     or g.started_at is null then
    return false;
  end if;
  if not exists (select 1 from pg_timezone_names where lower(name) = lower(v_tz)) then
    v_tz := 'America/Martinique';
  end if;
  v_heure := coalesce(floor(nullif(g.settings->>'close_hour', '')::numeric)::int, 19);
  v_local := now() at time zone v_tz;
  return v_local::date > (g.started_at at time zone v_tz)::date
      or (v_heure > 0 and extract(hour from v_local) >= v_heure);
end $$;

-- Choisit la PROCHAINE étape d'une équipe — ANTI-PELOTON et RYTHME.
-- La trame des positions reste maîtresse (épreuve de départ, paliers communs et
-- sprint final gardent leur rang, un groupe lié reste soudé), mais À L'INTÉRIEUR
-- du segment courant on envoie l'équipe sur l'étape du pool la MOINS fréquentée
-- à cet instant. Le placement de départ (start_game) répartit ; ceci corrige en
-- direct la dérive due aux équipes qui n'avancent pas à la même vitesse.
-- À égalité de fréquentation, on évite en plus d'enchaîner deux mini-jeux :
-- ils servent à temporiser entre deux déplacements, pas à s'empiler.
create or replace function public.next_route_for(p_team_id uuid)
returns public.team_routes
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_lowest  public.team_routes%rowtype;
  v_best    public.team_routes%rowtype;
  v_gate    int;
  v_chain   text;
  v_last_type public.step_type;
  v_fixed   boolean;
begin
  select game_id into v_game_id from public.teams where id = p_team_id;
  if v_game_id is null then return null; end if;

  -- Repli (et trame) : la position verrouillée la plus basse
  select * into v_lowest from public.team_routes
  where team_id = p_team_id and status = 'locked'
  order by position limit 1;
  if not found then return null; end if;

  -- SENS FIXE : la trame EST le parcours. La position la plus basse encore
  -- verrouillée est la suivante, point final — pas de réorientation, sinon le
  -- sens de circulation voulu par l'organisateur ne tiendrait pas dix minutes.
  select public.is_route_fixed(g) into v_fixed from public.games g where g.id = v_game_id;
  if v_fixed then return v_lowest; end if;

  -- La dernière étape validée : son groupe (pour enchaîner une chaîne entamée)
  -- et son type (pour ne pas coller deux mini-jeux de suite).
  select nullif(trim(coalesce(s.chain_group, '')), '') , s.type
  into v_chain, v_last_type
  from public.team_routes tr
  join public.steps s on s.id = tr.step_id
  where tr.team_id = p_team_id and tr.status = 'done' and tr.validated_at is not null
  order by tr.validated_at desc, tr.position desc
  limit 1;
  if v_chain is not null then
    select tr.* into v_best
    from public.team_routes tr
    join public.steps s on s.id = tr.step_id
    where tr.team_id = p_team_id and tr.status = 'locked'
      and nullif(trim(coalesce(s.chain_group, '')), '') = v_chain
    order by tr.position limit 1;
    if v_best.id is not null then return v_best; end if;
  end if;

  -- Le prochain palier commun / départ / finale encore verrouillé borne le
  -- segment : on ne permute jamais une étape par-dessus lui.
  select min(tr.position) into v_gate
  from public.team_routes tr
  join public.steps s on s.id = tr.step_id
  where tr.team_id = p_team_id and tr.status = 'locked'
    and (s.is_common_checkpoint or s.is_final or s.is_start);

  select tr.* into v_best
  from public.team_routes tr
  join public.steps s on s.id = tr.step_id
  where tr.team_id = p_team_id and tr.status = 'locked'
    and not s.is_common_checkpoint and not s.is_final and not s.is_start
    and (v_gate is null or tr.position < v_gate)
    -- un groupe lié ne s'entame que par sa première étape non faite
    and not exists (
      select 1 from public.team_routes tr2
      join public.steps s2 on s2.id = tr2.step_id
      where tr2.team_id = p_team_id and tr2.status = 'locked'
        and nullif(trim(coalesce(s2.chain_group, '')), '') is not null
        and nullif(trim(coalesce(s2.chain_group, '')), '')
            = nullif(trim(coalesce(s.chain_group, '')), '')
        and tr2.position < tr.position
    )
  order by
    -- 1) RYTHME — jamais deux mini-jeux d'affilée. Une chasse se marche autant
    --    qu'elle se réfléchit : deux casse-têtes assis à la suite, c'est le
    --    moment où le groupe décroche. Ce critère passe AVANT l'anti-peloton,
    --    sinon il ne sert quasiment jamais (simulation 12 équipes : 9 % des
    --    enchaînements restaient des mini-jeu → mini-jeu contre 0,2 % ici) ;
    --    le peloton, lui, ne remonte que de 27,5 % à 30,3 %.
    --    Simple critère de TRI : si toutes les épreuves libres sont des
    --    mini-jeux, on n'immobilise personne. Le coalesce neutralise le terme
    --    au tout premier choix (aucune étape validée avant).
    (coalesce(v_last_type, 'text') = 'minigame' and s.type = 'minigame'),
    -- 2) personne dessus en ce moment
    (select count(*) from public.team_routes o
     where o.game_id = v_game_id and o.status = 'current' and o.step_id = tr.step_id),
    -- 3) personne n'en vient de partir (l'équipe précédente traîne encore sur place)
    (select count(*) from public.team_routes o
     where o.game_id = v_game_id and o.step_id = tr.step_id
       and o.validated_at is not null and o.validated_at > now() - interval '8 minutes'),
    -- 4) départage propre à l'équipe : deux équipes qui choisissent à la même
    --    seconde ne partent pas sur la même étape
    md5(p_team_id::text || tr.step_id::text)
  limit 1;

  if v_best.id is not null then return v_best; end if;
  return v_lowest;
end $$;

-- Jamais appelable par un joueur : elle révélerait la prochaine étape.
revoke all on function public.next_route_for(uuid) from public, anon, authenticated;

-- Helper interne : le chrono d'une équipe se lit par get_play_state et
-- get_ranking, jamais en direct (ils décident de ce qui est visible).
revoke all on function public.team_elapsed_ms(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.games            enable row level security;
alter table public.steps            enable row level security;
alter table public.step_secrets     enable row level security;
-- ------------------------------------------------------------------------
-- LE CONTACT D'UNE EQUIPE — table separee, et c'est la seule chose a retenir.
--
-- Il n'est PAS une colonne de `teams`. La politique `teams_select` laisse tout
-- joueur d'une partie lire toutes les equipes de cette partie : une adresse
-- posee la serait lisible par n'importe quel visiteur du jour. Ici, une seule
-- politique de lecture, et elle ne repond qu'a l'organisateur.
--
-- Aucune politique d'ecriture non plus : seul `create_team`, en security
-- definer, y ecrit. Rien ne peut donc etre insere depuis un navigateur.
--
-- Donnee personnelle, et traitee comme telle : elle sert a prevenir un
-- gagnant, pas a constituer un fichier. Le champ est FACULTATIF cote joueur,
-- et l'ecran le dit.
-- ------------------------------------------------------------------------
create table if not exists public.team_contacts (
  team_id    uuid primary key references public.teams(id) on delete cascade,
  game_id    uuid not null references public.games(id) on delete cascade,
  contact    text not null,
  created_at timestamptz not null default now()
);
create index if not exists team_contacts_game_idx on public.team_contacts(game_id);
alter table public.team_contacts enable row level security;

alter table public.teams            enable row level security;
alter table public.players          enable row level security;
alter table public.team_routes      enable row level security;
alter table public.events           enable row level security;
alter table public.minigame_results enable row level security;
alter table public.submissions      enable row level security;
alter table public.push_subscriptions enable row level security;

-- games
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (created_by = auth.uid() or public.is_game_staff(id) or id = public.my_game_id());

drop policy if exists games_insert on public.games;
create policy games_insert on public.games for insert to authenticated
  with check (
    created_by = auth.uid()
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
  );

drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using (created_by = auth.uid());

drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (created_by = auth.uid());

-- steps : l'organisateur voit tout ; un joueur ne voit que les étapes
-- 'current'/'done' de SA route (jamais les étapes futures).
drop policy if exists steps_select on public.steps;
create policy steps_select on public.steps for select to authenticated
  using (
    public.can_read_game(game_id)
    or exists (
      select 1 from public.team_routes tr
      where tr.step_id = steps.id
        and tr.team_id = public.my_team_id()
        and tr.status in ('current','done')
    )
  );

drop policy if exists steps_write on public.steps;
create policy steps_write on public.steps for all to authenticated
  using (public.is_game_owner(game_id))
  with check (public.is_game_owner(game_id));

-- step_secrets : organisateur uniquement
drop policy if exists step_secrets_all on public.step_secrets;
create policy step_secrets_all on public.step_secrets for all to authenticated
  using (public.is_game_owner((select s.game_id from public.steps s where s.id = step_id)))
  with check (public.is_game_owner((select s.game_id from public.steps s where s.id = step_id)));

-- teams
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (public.can_read_game(game_id) or game_id = public.my_game_id());

drop policy if exists team_contacts_select on public.team_contacts;
create policy team_contacts_select on public.team_contacts for select to authenticated
  using (public.can_read_game(game_id));

-- La liste des invites ne regarde que le proprietaire : c'est lui qui la tient.
drop policy if exists game_staff_select on public.game_staff;
create policy game_staff_select on public.game_staff for select to authenticated
  using (public.is_game_owner(game_id));
-- Pas de policy d'ecriture : org_add_staff / org_remove_staff sont le seul chemin.
-- Pas de policy d'ecriture : create_team (security definer) est le seul chemin.

drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated
  using (public.is_game_owner(game_id))
  with check (public.is_game_owner(game_id));

-- players
-- Un joueur ne lit que les lignes de SON equipe. La RLS filtre des lignes, pas
-- des colonnes : ouvrir la table a toute la partie, c'etait servir
-- `last_lat`/`last_lng` de tout le monde au premier curieux qui l'interroge —
-- les autres familles suivies en direct sur le site. Les ecrans joueur n'ont
-- besoin de rien ici : les pseudos du lobby viennent de `get_lobby`, security
-- definer, qui continue de lister tout le monde. L'organisateur garde sa vue
-- complete par `is_game_owner`.
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (public.can_read_game(game_id) or team_id = public.my_team_id());

drop policy if exists players_update_self on public.players;
create policy players_update_self on public.players for update to authenticated
  using (auth_uid = auth.uid());

drop policy if exists players_delete_owner on public.players;
create policy players_delete_owner on public.players for delete to authenticated
  using (public.is_game_owner(game_id));

-- Aucune écriture directe de players côté client (tout passe par des RPC
-- security definer) : sans ce revoke, un joueur pourrait changer son
-- team_id/game_id sans connaître le code équipe.
revoke update on public.players from authenticated, anon;

-- team_routes : lecture par toute la partie (classement live), écriture via RPC only
drop policy if exists routes_select on public.team_routes;
create policy routes_select on public.team_routes for select to authenticated
  using (public.can_read_game(game_id) or game_id = public.my_game_id());

-- events : organisateur = tout ; joueur = les events de son équipe + globaux
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (
    public.can_read_game(game_id)
    or (game_id = public.my_game_id() and (team_id = public.my_team_id() or team_id is null))
  );

-- minigame_results
drop policy if exists mg_select on public.minigame_results;
create policy mg_select on public.minigame_results for select to authenticated
  using (public.can_read_game(game_id) or team_id = public.my_team_id());

-- submissions : organisateur = tout, joueur = celles de son équipe (écriture via RPC)
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (public.can_read_game(game_id) or team_id = public.my_team_id());

-- push_subscriptions : aucun accès direct (RPC save_push_subscription + service role)

-- ----------------------------------------------------------------------------
-- RPC — Organisateur
-- ----------------------------------------------------------------------------

-- Crée une partie avec un code unique à 6 caractères.
create or replace function public.org_create_game(p_name text, p_settings jsonb default '{}'::jsonb)
returns public.games
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_game public.games%rowtype;
  i int;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'ORG_COMPTE_REQUIS';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'NOM_REQUIS';
  end if;
  for i in 1..25 loop
    begin
      insert into public.games (code, name, created_by, settings)
      values (public.gen_code(6), trim(p_name), auth.uid(), coalesce(p_settings, '{}'::jsonb))
      returning * into v_game;
      return v_game;
    exception when unique_violation then
      -- code déjà pris, on retente
    end;
  end loop;
  raise exception 'CODE_GENERATION_IMPOSSIBLE';
end $$;

-- Démarre la partie : génère les routes (carré latin / round-robin) puis passe en 'running'.
-- ANTI-PELOTON, 1er réglage — l'ordre dans lequel les RANGS piochent dans le
-- pool est mélangé, une fois pour la partie, identique pour toutes les équipes.
-- Sans lui, toutes parcourent le pool dans le même ordre cyclique : une équipe
-- une étape derrière une autre tombe alors MÉCANIQUEMENT sur la même énigme
-- (le peloton était garanti). Avec un ordre mélangé, l'écart entre deux rangs
-- consécutifs varie sans cesse : les rencontres deviennent des coïncidences.
--
-- Persisté sur la partie : en continu, l'équipe de 16 h doit hériter du tirage
-- de celle de 9 h. Re-tiré si le pool a changé de taille entre-temps
-- (l'organisateur a ajouté ou retiré une énigme dans la journée).
create or replace function public.game_route_perm(p_game_id uuid, p_block_count int)
returns int[]
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_perm int[];
begin
  if p_block_count <= 0 then return array[]::int[]; end if;

  select route_perm into v_perm from public.games where id = p_game_id for update;
  if v_perm is not null and coalesce(array_length(v_perm, 1), 0) = p_block_count then
    return v_perm;
  end if;

  select coalesce(array_agg(i::int order by random()), array[]::int[]) into v_perm
  from generate_series(0, p_block_count - 1) i;
  update public.games set route_perm = v_perm where id = p_game_id;
  return v_perm;
end $$;

-- Nombre de BLOCS du pool : les étapes d'un même chain_group comptent pour un.
create or replace function public.game_block_count(p_game_id uuid) returns int
language sql stable
set search_path = public
as $$
  select count(*)::int from (
    select 1 from public.steps
    where game_id = p_game_id and not is_common_checkpoint and not is_final and not is_start
    group by coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text)
  ) q
$$;

-- Construit le parcours d'UNE équipe. Extrait de start_game pour que
-- start_team() puisse faire naître un parcours seul, en cours de journée.
--
-- p_offset est le décalage de l'équipe dans le pool : c'est lui, et lui seul,
-- qui distingue deux parcours. Le départ groupé le répartit sur tout le pool ;
-- l'arrivée isolée vise le bloc le moins fréquenté (voir start_team).
create or replace function public.build_team_route(p_team_id uuid, p_offset int)
returns int
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_team    public.teams%rowtype;
  v_blocks  jsonb;   -- blocs du pool (chaînes) : [[stepA1, stepA2], [stepB], …]
  v_slots   jsonb;   -- séquence ordonnée : {common:id} (fixe) ou {mobile:true}
  v_finals  uuid[];
  v_starts  uuid[];
  v_perm    int[];
  v_slot    jsonb;
  v_blk     jsonb;
  v_b       int;
  v_off     int;
  v_m       int := 0;
  v_j       int;
  v_pos     int := 0;
  v_step_id uuid;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then raise exception 'EQUIPE_INTROUVABLE'; end if;

  -- Pool découpé en BLOCS : les étapes d'un même chain_group forment un bloc
  -- ordonné et indivisible ; une étape sans groupe = un bloc à elle seule.
  -- Le round-robin décale les BLOCS (pas les étapes) → un groupe reste soudé
  -- et joué dans l'ordre, tout en tombant à un endroit distinct par équipe.
  select coalesce(jsonb_agg(steps order by sort_key, gkey), '[]'::jsonb) into v_blocks
  from (
    select min(order_hint) as sort_key,
           coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text) as gkey,
           jsonb_agg(id::text order by order_hint, created_at) as steps
    from public.steps
    where game_id = v_team.game_id and not is_common_checkpoint and not is_final and not is_start
    group by coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text)
  ) q;
  v_b := jsonb_array_length(v_blocks);

  -- Séquence des emplacements (paliers communs fixes + un marqueur mobile par
  -- bloc), ordonnée par order_hint. Les marqueurs mobiles sont dans le même
  -- ordre que v_blocks → le m-ième marqueur correspond au m-ième bloc.
  select coalesce(jsonb_agg(slot order by sort_key, kind), '[]'::jsonb) into v_slots
  from (
    select order_hint::numeric as sort_key, 0 as kind,
           jsonb_build_object('common', id::text) as slot
    from public.steps
    where game_id = v_team.game_id and is_common_checkpoint and not is_final and not is_start
    union all
    select sort_key, 1 as kind, jsonb_build_object('mobile', true) as slot
    from (
      select min(order_hint) as sort_key,
             coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text) as gkey
      from public.steps
      where game_id = v_team.game_id and not is_common_checkpoint and not is_final and not is_start
      group by coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text)
    ) b
  ) s;

  select coalesce(array_agg(id order by order_hint, created_at), '{}') into v_finals
  from public.steps where game_id = v_team.game_id and is_final;

  -- Épreuve(s) de départ : identiques pour tous, toujours en premier
  select coalesce(array_agg(id order by order_hint, created_at), '{}') into v_starts
  from public.steps where game_id = v_team.game_id and is_start and not is_final;

  -- SENS FIXE : ni tirage ni décalage. Le m-ième emplacement mobile reçoit le
  -- m-ième bloc, c'est-à-dire l'ordre exact de l'éditeur. Le tirage persisté de
  -- la partie n'est même pas consulté : le repasser en dispersé le retrouvera
  -- intact, et une journée entière peut ainsi changer d'avis sans rien casser.
  if (select public.is_route_fixed(g) from public.games g where g.id = v_team.game_id) then
    select coalesce(array_agg(i::int order by i), array[]::int[]) into v_perm
    from generate_series(0, greatest(v_b, 1) - 1) i;
    v_off := 0;
  else
    v_perm := public.game_route_perm(v_team.game_id, v_b);
    -- Décalage ramené dans [0, b) : les appelants raisonnent en rangs, pas en modulo.
    v_off := case when v_b > 0 then ((p_offset % v_b) + v_b) % v_b else 0 end;
  end if;

  -- Relance après erreur, ou re-génération d'un parcours : on repart propre.
  delete from public.team_routes where team_id = p_team_id;

  -- L'épreuve de départ ouvre le parcours de chaque équipe
  if array_length(v_starts, 1) is not null then
    foreach v_step_id in array v_starts loop
      insert into public.team_routes (game_id, team_id, step_id, position, status)
      values (v_team.game_id, p_team_id, v_step_id, v_pos,
              case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
      v_pos := v_pos + 1;
    end loop;
  end if;

  for v_slot in select value from jsonb_array_elements(v_slots) loop
    if v_slot->>'common' is not null then
      -- Palier commun : position fixe pour tous
      v_step_id := (v_slot->>'common')::uuid;
      insert into public.team_routes (game_id, team_id, step_id, position, status)
      values (v_team.game_id, p_team_id, v_step_id, v_pos,
              case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
      v_pos := v_pos + 1;
    else
      -- Emplacement mobile : le bloc (rang mélangé + décalage de l'équipe)
      -- est inséré en entier, dans l'ordre
      v_blk := v_blocks -> ((v_perm[v_m + 1] + v_off) % v_b);
      for v_j in 0 .. jsonb_array_length(v_blk) - 1 loop
        v_step_id := (v_blk->>v_j)::uuid;
        insert into public.team_routes (game_id, team_id, step_id, position, status)
        values (v_team.game_id, p_team_id, v_step_id, v_pos,
                case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
        v_pos := v_pos + 1;
      end loop;
      v_m := v_m + 1;
    end if;
  end loop;

  -- Le sprint final : identique pour tous, toujours en dernier,
  -- débloqué seulement quand tout le reste est validé (routes séquentielles).
  if array_length(v_finals, 1) is not null then
    foreach v_step_id in array v_finals loop
      insert into public.team_routes (game_id, team_id, step_id, position, status)
      values (v_team.game_id, p_team_id, v_step_id, v_pos,
              case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
      v_pos := v_pos + 1;
    end loop;
  end if;

  return v_pos;
end $$;

-- Jamais appelables par un joueur : elles fabriquent les parcours.
revoke all on function public.game_route_perm(uuid,int) from public, anon, authenticated;
revoke all on function public.build_team_route(uuid,int) from public, anon, authenticated;

-- Ouvre la partie.
--
-- Deux usages, un seul code :
--   • départ groupé (défaut) — les équipes sont déjà dans le lobby, elles
--     partent ensemble, décalées sur tout le pool ;
--   • jeu en continu (`settings.continuous`) — la partie peut ouvrir SANS
--     équipe, et chacune se lance ensuite par start_team() en arrivant.
create or replace function public.start_game(p_game_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_game    public.games%rowtype;
  v_teams   uuid[];
  v_b       int;
  v_t       int;
  v_k       int;
  v_total_steps int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.created_by <> auth.uid() then
    raise exception 'INTERDIT';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'PARTIE_DEJA_LANCEE';
  end if;

  select count(*) into v_total_steps from public.steps where game_id = p_game_id;
  if v_total_steps = 0 then
    raise exception 'AUCUNE_ETAPE';
  end if;

  select coalesce(array_agg(id order by created_at), '{}') into v_teams
  from public.teams where game_id = p_game_id;
  v_t := coalesce(array_length(v_teams, 1), 0);

  -- Départ groupé : il faut au moins une équipe au lobby. En continu, la
  -- partie peut ouvrir vide — les équipes arriveront et partiront d'elles-mêmes.
  if v_t = 0 and not public.is_continuous(v_game) then
    raise exception 'AUCUNE_EQUIPE';
  end if;

  v_b := public.game_block_count(p_game_id);
  -- LA GARANTIE DU DÉPART GROUPÉ : « jamais deux équipes sur le même bloc au
  -- même rang » suppose au moins autant de blocs que d'équipes au départ.
  --
  -- En continu, elle ne protège plus rien et coûterait l'ouverture : la partie
  -- peut ouvrir avec cinq équipes déjà arrivées et quatre énigmes, et c'est
  -- start_team() qui répartit ensuite les arrivants, bloc le moins fréquenté
  -- d'abord. Un pool trop petit y est un embouteillage, pas une panne.
  if not public.is_continuous(v_game) and v_b > 0 and v_t > v_b then
    raise exception 'POOL_TROP_PETIT';
  end if;

  -- ANTI-PELOTON, 2e réglage — le décalage est réparti sur TOUT le pool :
  -- l'ancien pas (k × floor(b/t)) valait 1 dès que le pool dépassait le nombre
  -- d'équipes, et les blocs au-delà du t-ième n'étaient attribués à personne au
  -- départ (énigmes désertes).
  perform public.game_route_perm(p_game_id, v_b);

  -- Nettoyage au cas où (relance après erreur)
  delete from public.team_routes where game_id = p_game_id;

  for v_k in 1..v_t loop
    perform public.build_team_route(
      v_teams[v_k],
      case when v_b > 0 then (((v_k - 1) * v_b) / v_t) % v_b else 0 end
    );
  end loop;

  update public.games set status = 'running', started_at = now() where id = p_game_id;
  -- Départ groupé : les équipes déjà là partent avec la partie. En jeu continu,
  -- il n'y en a aucune ici — chacune recevra son départ par start_team().
  update public.teams
  set started_at = now(), paused_total_ms = 0
  where game_id = p_game_id and started_at is null;
  insert into public.events (game_id, type, payload)
  values (p_game_id, 'game_started', jsonb_build_object('teams', v_t, 'steps', v_total_steps));

  return jsonb_build_object('ok', true, 'teams', v_t, 'steps', v_total_steps);
end $$;

-- Lance MON équipe, en cours de journée — le cœur du jeu continu.
--
-- Le parcours ne naît qu'ici : c'est ce qui permet à un visiteur d'arriver à
-- n'importe quelle heure. Le chrono de l'équipe part au même instant.
--
-- Choix du décalage : le bloc le MOINS fréquenté à cet instant. Dans un départ
-- groupé, la répartition est arithmétique (t équipes, b blocs) ; ici il n'y a
-- pas de « t » — on regarde simplement où sont les autres et on envoie
-- l'arrivant ailleurs. next_route_for corrige ensuite en direct, étape après
-- étape.
create or replace function public.start_team()
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_b      int;
  v_perm   int[];
  v_first  int;
  v_offset int := 0;
  v_count  int;
begin
  select * into v_team from public.teams where id = public.my_team_id() for update;
  if not found then raise exception 'NON_INSCRIT'; end if;
  select * into v_game from public.games where id = v_team.game_id;

  if v_game.status = 'lobby' then raise exception 'PARTIE_PAS_OUVERTE'; end if;
  -- La pause a son propre code : elle est momentanée et l'équipe, elle, est
  -- bien inscrite (create_team l'accepte). Sans cette ligne, l'écran ne peut
  -- pas distinguer « ça reprend dans un instant » de « c'est fermé ».
  if v_game.status = 'paused' then raise exception 'PARTIE_EN_PAUSE'; end if;
  if v_game.status <> 'running' then raise exception 'PARTIE_NON_ACTIVE'; end if;

  -- Idempotent : un double appui sur « Partir », ou deux coéquipiers qui
  -- appuient en même temps, ne doivent pas remettre le chrono à zéro ni
  -- refabriquer un parcours sous les pieds de l'équipe.
  if v_team.started_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Une équipe qui a DÉJÀ un parcours est partie, même sans départ inscrit
  -- (partie lancée avant la colonne started_at, si le rattrapage en tête de
  -- fichier n'a pas encore tourné). La relancer referait son parcours :
  -- build_team_route efface d'abord l'existant. On inscrit le départ de la
  -- partie, et rien d'autre.
  if exists (select 1 from public.team_routes where team_id = v_team.id) then
    update public.teams
    set started_at = coalesce(v_game.started_at, now()),
        paused_total_ms = v_game.paused_total_ms
    where id = v_team.id;
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Passé l'heure de fermeture du soir, plus de départ (voir auto_close_due).
  if public.auto_close_due(v_game) then raise exception 'PARTIE_TERMINEE'; end if;

  v_b := public.game_block_count(v_team.game_id);
  if v_b = 0 and not exists (select 1 from public.steps where game_id = v_team.game_id) then
    raise exception 'AUCUNE_ETAPE';
  end if;

  -- En sens fixe, il n'y a rien à répartir : tout le monde suit le même ordre.
  -- Le décalage reste à 0 et build_team_route l'ignore de toute façon.
  if v_b > 0 and not public.is_route_fixed(v_game) then
    v_perm := public.game_route_perm(v_team.game_id, v_b);
    -- Fréquentation de chaque bloc : combien d'équipes encore en course y sont
    -- EN CE MOMENT. Le moins fréquenté gagne ; à égalité, au hasard.
    select b.idx into v_first
    from (
      select row_number() over (order by sort_key, gkey) - 1 as idx, step_ids
      from (
        select min(order_hint) as sort_key,
               coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text) as gkey,
               array_agg(id) as step_ids
        from public.steps
        where game_id = v_team.game_id
          and not is_common_checkpoint and not is_final and not is_start
        group by coalesce(nullif(trim(chain_group), ''), '__solo_' || id::text)
      ) q
    ) b
    order by (
      -- Où sont les autres EN CE MOMENT : c'est ce qui évite de se croiser.
      (select count(*)
       from public.team_routes tr
       join public.teams t2 on t2.id = tr.team_id
       where t2.game_id = v_team.game_id and t2.finished_at is null
         and tr.status = 'current' and tr.step_id = any(b.step_ids))
      -- ET par où elles ont ATTAQUÉ le pool : sans ce second terme, une partie
      -- qui commence par une épreuve de départ commune met tout le monde au
      -- même endroit, aucun bloc n'est « occupé », et deux équipes arrivées à
      -- cinq minutes d'écart tirent le même décalage au hasard. Le premier
      -- bloc du parcours est la signature du décalage : la compter les répartit
      -- même quand personne n'a encore atteint le pool.
      + (select count(*)
         from (
           select distinct on (tr.team_id) tr.step_id
           from public.team_routes tr
           join public.steps s2 on s2.id = tr.step_id
           join public.teams t2 on t2.id = tr.team_id
           where t2.game_id = v_team.game_id and t2.finished_at is null
             and not s2.is_start and not s2.is_final and not s2.is_common_checkpoint
           order by tr.team_id, tr.position
         ) premier
         where premier.step_id = any(b.step_ids))
    ), random()
    limit 1;
    -- Le décalage qui amène le 1er emplacement mobile sur ce bloc-là.
    v_offset := ((v_first - v_perm[1]) % v_b + v_b) % v_b;
  end if;

  v_count := public.build_team_route(v_team.id, v_offset);
  if v_count = 0 then raise exception 'AUCUNE_ETAPE'; end if;

  update public.teams
  set started_at = now(), paused_total_ms = 0
  where id = v_team.id;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'team_started',
          jsonb_build_object('name', v_team.name, 'steps', v_count));

  return jsonb_build_object('ok', true, 'steps', v_count);
end $$;

-- Pause / reprise / fin.
create or replace function public.org_set_status(p_game_id uuid, p_status text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.created_by <> auth.uid() then
    raise exception 'INTERDIT';
  end if;
  if p_status = 'paused' and v_game.status = 'running' then
    -- le chrono se fige : on mémorise le début de pause
    update public.games set status = 'paused', paused_at = now() where id = p_game_id;
    insert into public.events (game_id, type) values (p_game_id, 'game_paused');
  elsif p_status = 'running' and v_game.status = 'paused' then
    -- La pause est reportée sur le chrono de chaque équipe DÉJÀ partie et pas
    -- encore arrivée : une équipe entrée pendant la pause n'a rien perdu, et
    -- une équipe arrivée avant a déjà son temps figé.
    update public.teams
    set paused_total_ms = paused_total_ms + coalesce(
          (extract(epoch from (now() - v_game.paused_at)) * 1000)::bigint, 0)
    where game_id = p_game_id and finished_at is null
      and started_at is not null and started_at <= v_game.paused_at;
    update public.games
    set status = 'running',
        paused_total_ms = paused_total_ms + coalesce(
          (extract(epoch from (now() - paused_at)) * 1000)::bigint, 0),
        paused_at = null
    where id = p_game_id;
    insert into public.events (game_id, type) values (p_game_id, 'game_resumed');
  elsif p_status = 'finished' and v_game.status in ('running','paused') then
    -- Fermeture pendant une pause : même report, sinon les équipes encore en
    -- course garderaient la pause dans leur temps.
    if v_game.paused_at is not null then
      update public.teams
      set paused_total_ms = paused_total_ms + coalesce(
            (extract(epoch from (now() - v_game.paused_at)) * 1000)::bigint, 0)
      where game_id = p_game_id and finished_at is null
        and started_at is not null and started_at <= v_game.paused_at;
    end if;
    update public.games
    set status = 'finished', finished_at = now(),
        paused_total_ms = paused_total_ms + case when paused_at is not null
          then coalesce((extract(epoch from (now() - paused_at)) * 1000)::bigint, 0) else 0 end,
        paused_at = null
    where id = p_game_id;
    insert into public.events (game_id, type) values (p_game_id, 'game_finished');
  else
    raise exception 'TRANSITION_INVALIDE';
  end if;
end $$;

-- Valide manuellement l'étape en cours d'une équipe (puce défectueuse, etc.).
create or replace function public.org_force_validate(p_team_id uuid, p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_team  public.teams%rowtype;
  v_route public.team_routes%rowtype;
  v_next  public.team_routes%rowtype;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or not public.is_game_owner(v_team.game_id) then
    raise exception 'INTERDIT';
  end if;
  select * into v_route from public.team_routes
  where team_id = p_team_id and step_id = p_step_id for update;
  if not found or v_route.status = 'done' then
    return jsonb_build_object('ok', false, 'error', 'ETAPE_INTROUVABLE_OU_FAITE');
  end if;

  update public.team_routes set status = 'done', validated_at = now() where id = v_route.id;

  v_next := public.next_route_for(p_team_id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(p_team_id)
    where id = p_team_id and finished_at is null;
    insert into public.events (game_id, team_id, type) values (v_team.game_id, p_team_id, 'team_finished');
  end if;

  insert into public.events (game_id, team_id, type, payload)
  values (v_team.game_id, p_team_id, 'manual_validate',
          jsonb_build_object('step_id', p_step_id, 'position', v_route.position));
  return jsonb_build_object('ok', true);
end $$;

-- Duplique une partie : mêmes étapes, mêmes secrets (identifiants NFC et codes
-- manuels inclus → les puces déjà écrites et les QR déjà imprimés restent valides).
create or replace function public.org_duplicate_game(p_game_id uuid)
returns public.games
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_src  public.games%rowtype;
  v_new  public.games%rowtype;
  v_step public.steps%rowtype;
  v_new_step_id uuid;
  i int;
begin
  select * into v_src from public.games where id = p_game_id;
  if not found or v_src.created_by <> auth.uid() then
    raise exception 'INTERDIT';
  end if;

  for i in 1..25 loop
    begin
      insert into public.games (code, name, created_by, settings)
      values (public.gen_code(6), v_src.name || ' (copie)', auth.uid(), v_src.settings)
      returning * into v_new;
      exit;
    exception when unique_violation then
      -- code déjà pris, on retente
    end;
  end loop;

  for v_step in
    select * from public.steps where game_id = p_game_id order by order_hint, created_at
  loop
    insert into public.steps (game_id, type, title, content, media_urls,
                              is_common_checkpoint, is_final, is_start, order_hint,
                              points, time_limit_sec, chain_group)
    values (v_new.id, v_step.type, v_step.title, v_step.content, v_step.media_urls,
            v_step.is_common_checkpoint, v_step.is_final, v_step.is_start, v_step.order_hint,
            v_step.points, v_step.time_limit_sec, v_step.chain_group)
    returning id into v_new_step_id;

    insert into public.step_secrets (step_id, answers, nfc_tag_id, manual_code, hints,
                                     gps_lat, gps_lng, gps_radius_m)
    select v_new_step_id, s.answers, s.nfc_tag_id, s.manual_code, s.hints,
           s.gps_lat, s.gps_lng, s.gps_radius_m
    from public.step_secrets s where s.step_id = v_step.id;
  end loop;

  return v_new;
end $$;

-- Bonus attribué par l'organisateur (records, fair-play…) : points en mode
-- points, secondes (négatives = temps rendu) en mode chrono.
create or replace function public.org_award_bonus(
  p_team_id uuid, p_points int, p_seconds int, p_reason text
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or not public.is_game_owner(v_team.game_id) then
    raise exception 'INTERDIT';
  end if;
  update public.teams
  set bonus_points   = bonus_points + coalesce(p_points, 0),
      penalty_seconds = penalty_seconds + coalesce(p_seconds, 0)
  where id = p_team_id;
  insert into public.events (game_id, team_id, type, payload)
  values (v_team.game_id, p_team_id, 'bonus_awarded',
          jsonb_build_object('points', coalesce(p_points, 0),
                             'seconds', coalesce(p_seconds, 0),
                             'reason', coalesce(trim(p_reason), '')));
end $$;

-- Annule un bonus déjà attribué (repéré par son event de journal) : les
-- montants sont reversés à l'équipe et l'event d'origine est marqué révoqué
-- (la trace reste dans le journal). Sert aussi de « modifier » côté UI :
-- annuler puis ré-attribuer avec le bon montant.
create or replace function public.org_revoke_bonus(p_event_id bigint)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_ev  public.events%rowtype;
  v_pts int;
  v_sec int;
begin
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or v_ev.type <> 'bonus_awarded' then
    return jsonb_build_object('ok', false, 'error', 'BONUS_INTROUVABLE');
  end if;
  if not public.is_game_owner(v_ev.game_id) then
    raise exception 'INTERDIT';
  end if;
  if coalesce((v_ev.payload->>'revoked')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'DEJA_ANNULE');
  end if;
  if v_ev.team_id is null or not exists (select 1 from public.teams where id = v_ev.team_id) then
    return jsonb_build_object('ok', false, 'error', 'EQUIPE_INTROUVABLE');
  end if;

  v_pts := coalesce((v_ev.payload->>'points')::int, 0);
  v_sec := coalesce((v_ev.payload->>'seconds')::int, 0);

  update public.teams
  set bonus_points    = bonus_points - v_pts,
      penalty_seconds = penalty_seconds - v_sec
  where id = v_ev.team_id;

  update public.events
  set payload = payload || jsonb_build_object('revoked', true, 'revoked_at', now())
  where id = p_event_id;

  insert into public.events (game_id, team_id, type, payload)
  values (v_ev.game_id, v_ev.team_id, 'bonus_revoked',
          jsonb_build_object('points', v_pts, 'seconds', v_sec,
                             'reason', coalesce(v_ev.payload->>'reason', ''),
                             'source_event_id', p_event_id));

  return jsonb_build_object('ok', true);
end $$;

-- Ajoute un organisateur invité, par son adresse. Propriétaire uniquement.
--
-- Rien n'est envoyé, rien n'est créé côté comptes : on enregistre une adresse,
-- et l'accès s'ouvrira dès que quelqu'un se connectera avec elle. C'est aussi
-- pour ça que l'ordre n'importe pas — on peut inviter avant que la personne
-- ait son compte.
create or replace function public.org_add_staff(p_game_id uuid, p_email text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_game_owner(p_game_id) then raise exception 'INTERDIT'; end if;
  -- Contrôle volontairement léger : il attrape la faute de frappe, pas
  -- l'adresse exotique. Une adresse refusée à tort bloque une vraie personne.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'EMAIL_INVALIDE';
  end if;
  if exists (select 1 from public.games g
             where g.id = p_game_id
               and lower(coalesce(g.created_by::text, '')) <> ''
               and v_email = lower(trim(coalesce(auth.jwt()->>'email', '')))) then
    raise exception 'DEJA_PROPRIETAIRE';
  end if;

  insert into public.game_staff (game_id, email) values (p_game_id, v_email)
  on conflict (game_id, email) do nothing;

  insert into public.events (game_id, type, payload)
  values (p_game_id, 'staff_added', jsonb_build_object('email', v_email));
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- Retire un invité. L'accès tombe au prochain chargement de page : il n'y a
-- pas de jeton à révoquer, c'est la ligne qui fait foi.
create or replace function public.org_remove_staff(p_game_id uuid, p_email text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_game_owner(p_game_id) then raise exception 'INTERDIT'; end if;
  delete from public.game_staff where game_id = p_game_id and email = v_email;
  insert into public.events (game_id, type, payload)
  values (p_game_id, 'staff_removed', jsonb_build_object('email', v_email));
  return jsonb_build_object('ok', true);
end $$;

-- Envoie un message/indice à une équipe (toast temps réel côté joueur).
create or replace function public.org_send_hint(p_team_id uuid, p_message text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or not public.is_game_owner(v_team.game_id) then
    raise exception 'INTERDIT';
  end if;
  insert into public.events (game_id, team_id, type, payload)
  values (v_team.game_id, p_team_id, 'hint_sent', jsonb_build_object('message', p_message));
end $$;

-- Message général : part vers TOUTES les équipes de la partie d'un coup.
-- team_id null = event global (la policy events_select le laisse passer à
-- tous les joueurs de la partie). Trois niveaux, du plus calme au plus fort :
--   info    annonce      (« rendez-vous à 16 h pour le goûter »)
--   warning avertissement (« la zone du port est interdite »)
--   alert   alerte        (« orage, rentrez au point de départ »)
create or replace function public.org_broadcast(
  p_game_id uuid, p_kind text, p_message text
) returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_msg   text := trim(coalesce(p_message, ''));
  v_kind  text := lower(trim(coalesce(p_kind, 'info')));
  v_teams int;
begin
  if not public.is_game_owner(p_game_id) then
    raise exception 'INTERDIT';
  end if;
  if v_msg = '' then
    raise exception 'MESSAGE_VIDE';
  end if;
  if v_kind not in ('info', 'warning', 'alert') then
    raise exception 'TYPE_INCONNU';
  end if;

  select count(*) into v_teams from public.teams where game_id = p_game_id;

  insert into public.events (game_id, team_id, type, payload)
  values (p_game_id, null, 'org_broadcast',
          jsonb_build_object('kind', v_kind, 'message', left(v_msg, 1000)));

  return jsonb_build_object('ok', true, 'teams', v_teams);
end $$;

-- ----------------------------------------------------------------------------
-- RPC — Joueur
-- ----------------------------------------------------------------------------

-- Infos publiques d'une partie via son code (avant même d'avoir rejoint).
create or replace function public.get_lobby(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_teams jsonb;
  v_me jsonb := null;
begin
  select * into v_game from public.games where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('error', 'PARTIE_INTROUVABLE');
  end if;

  select coalesce(jsonb_agg(t order by t->>'created_at'), '[]'::jsonb) into v_teams
  from (
    select jsonb_build_object(
      'id', tm.id, 'name', tm.name, 'color', tm.color, 'created_at', tm.created_at,
      'roster', to_jsonb(tm.roster),
      -- Jeu continu : une équipe peut être créée sans être partie. C'est ce
      -- champ, pas le statut de la partie, qui dit si le parcours a commencé.
      'started_at', tm.started_at,
      'players', coalesce((select jsonb_agg(p.nickname order by p.created_at)
                           from public.players p where p.team_id = tm.id), '[]'::jsonb)
    ) as t
    from public.teams tm
    where tm.game_id = v_game.id
      -- Ne sont listees que les equipes REJOIGNABLES. Afficher une equipe
      -- partie ou arrivee, c'est proposer a un inconnu de se greffer sur une
      -- famille en pleine course : le refus cote `join_team` ne suffit pas, la
      -- carte ne doit plus etre la.
      -- Exception : la MIENNE. L'accueil (`app/page.tsx`) et le lobby la
      -- cherchent dans cette liste pour lire son `started_at` et basculer sur
      -- l'ecran de jeu — l'en retirer figerait le capitaine au lobby.
      and (
        (tm.started_at is null and tm.finished_at is null)
        or tm.id = (select p.team_id from public.players p where p.auth_uid = auth.uid())
      )
  ) sub;

  select jsonb_build_object('team_id', p.team_id, 'nickname', p.nickname) into v_me
  from public.players p where p.auth_uid = auth.uid() and p.game_id = v_game.id;

  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'code', v_game.code, 'name', v_game.name,
                               'status', v_game.status, 'settings', v_game.settings),
    'teams', v_teams,
    'me', v_me
  );
end $$;

-- Deux joueurs avec le même pseudo dans une équipe → suffixe automatique
-- (« Max », « Max 2 »…) : aucun état cassé quelle que soit la saisie.
create or replace function public.unique_nickname(p_team_id uuid, p_nick text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_nick text := trim(coalesce(p_nick, ''));
  v_base text := trim(coalesce(p_nick, ''));
  i int := 1;
begin
  while exists (
    select 1 from public.players
    where team_id = p_team_id and nickname = v_nick and auth_uid <> auth.uid()
  ) loop
    i := i + 1;
    v_nick := v_base || ' ' || i;
  end loop;
  return v_nick;
end $$;

-- Pose le contact d'une équipe, ou l'efface si le champ est laissé vide.
--
-- Écrite à part parce que `create_team` a DEUX sorties : la création, et la
-- reprise d'une équipe déjà là mais pas encore partie (voir CLAUDE.md, « Une
-- équipe par visiteur »). Un contact posé sur un seul des deux chemins se
-- perdrait une fois sur deux, sans que rien ne le signale.
--
-- Un champ vidé EFFACE la ligne : c'est le seul geste dont dispose un visiteur
-- qui se ravise, et il doit marcher.
create or replace function public.poser_contact(
  p_game_id uuid, p_team_id uuid, p_contact text
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if p_contact is null or length(trim(p_contact)) = 0 then
    delete from public.team_contacts where team_id = p_team_id;
    return;
  end if;
  insert into public.team_contacts (team_id, game_id, contact)
  values (p_team_id, p_game_id, left(trim(p_contact), 160))
  on conflict (team_id) do update set contact = excluded.contact;
end $$;

-- INTERNE : seul create_team (security definer) l'appelle. Laissée ouverte,
-- elle permettait à n'importe quel visiteur de réécrire — ou d'effacer — le
-- contact de n'importe quelle équipe, celui-là même qui sert à prévenir le
-- gagnant : les identifiants d'équipe et de partie sont publics (get_ranking,
-- get_lobby), et la fonction ne vérifie rien.
revoke all on function public.poser_contact(uuid, uuid, text) from public, anon, authenticated;

-- Crée une équipe et y inscrit le caller (capitaine), avec la liste d'équipage.
-- Les anciennes signatures sont RETIREES et pas seulement remplacees :
-- `create or replace` sur une liste d'arguments differente cree une SURCHARGE,
-- et PostgREST ne saurait plus laquelle appeler.
drop function if exists public.create_team(text, text, text);
drop function if exists public.create_team(text, text, text, text[]);
create or replace function public.create_team(
  p_code text, p_team_name text, p_nickname text, p_members text[] default '{}',
  p_contact text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_team  public.teams%rowtype;
  v_count int;
  v_max   int;
  v_colors constant text[] := array['#C0392B','#F5A623','#2E5E3A','#2980B9','#8E44AD','#D35400','#16A085','#34495E'];
  v_reuse uuid;
  i int;
begin
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found then raise exception 'PARTIE_INTROUVABLE'; end if;
  if v_game.status not in ('lobby', 'running', 'paused') then
    raise exception 'PARTIE_TERMINEE';
  end if;
  -- DÉPART GROUPÉ (défaut) : les inscriptions ferment au lancement.
  --
  -- JEU EN CONTINU : une équipe peut naître pendant que la partie tourne — c'est
  -- le groupe qui arrive à 15 h. Elle ne PART pas pour autant : son parcours
  -- et son chrono attendent start_team(). Pendant une pause aussi : refuser
  -- l'inscription renverrait « c'est fermé » à quelqu'un qui est devant le
  -- point de départ. On l'inscrit, et start_team seul le fait patienter — son
  -- chrono n'a pas commencé, il ne perd donc rien à attendre.
  if v_game.status <> 'lobby' and not public.is_continuous(v_game) then
    raise exception 'PARTIE_DEJA_LANCEE';
  end if;
  -- Passé l'heure de fermeture du soir, plus d'inscription (voir auto_close_due).
  if public.auto_close_due(v_game) then raise exception 'PARTIE_TERMINEE'; end if;
  if p_team_name is null or length(trim(p_team_name)) = 0 then raise exception 'NOM_EQUIPE_REQUIS'; end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then raise exception 'PSEUDO_REQUIS'; end if;

  -- UN VISITEUR N'A QU'UNE ÉQUIPE.
  --
  -- Chaque appel fabriquait une équipe neuve et y DÉPLAÇAIT le joueur (le
  -- `on conflict (auth_uid)` plus bas) : la précédente restait, vide, au
  -- classement. Un départ qui échoue après la création — partie pas encore
  -- ouverte, réseau — puis un second appui, et la journée se remplit
  -- d'équipes fantômes. Vu en vrai : treize « Max » vides pour un visiteur.
  --
  -- Tant que son équipe n'est PAS PARTIE et qu'il y est seul, on la reprend et
  -- on la renomme. Une équipe déjà lancée, ou avec des coéquipiers, n'est
  -- jamais touchée : là, une nouvelle équipe est bien ce qu'on demande.
  select t.id into v_reuse
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.auth_uid = auth.uid() and p.game_id = v_game.id
    and t.started_at is null
    and (select count(*) from public.players p2 where p2.team_id = t.id) = 1;
  if v_reuse is not null then
    update public.teams
    set name = trim(p_team_name),
        roster = coalesce((select array_agg(trim(m)) from unnest(coalesce(p_members, '{}')) m
                           where length(trim(m)) > 0), '{}')
    where id = v_reuse
    returning * into v_team;
    update public.players
    set nickname = public.unique_nickname(v_team.id, p_nickname)
    where auth_uid = auth.uid();
    perform public.poser_contact(v_game.id, v_team.id, p_contact);
    return jsonb_build_object('team_id', v_team.id, 'team_code', v_team.team_code,
                              'color', v_team.color, 'game_id', v_game.id, 'reused', true);
  end if;

  select count(*) into v_count from public.teams where game_id = v_game.id;
  -- PLAFOND D'ÉQUIPES — 0, null ou absent valent ILLIMITÉ.
  --
  -- Le champ de l'organisateur montre un plafond vide comme « pas de limite »,
  -- ce qui fait lire 0 de la même façon. L'ancien test le prenait au mot :
  -- « v_count >= 0 » est vrai dès la première équipe, et la journée se fermait
  -- en silence — plus une seule création possible, et aucun écran pour dire
  -- pourquoi. Une valeur vide ou négative se lit pareil : pas de plafond.
  v_max := nullif(v_game.settings->>'max_teams', '')::int;
  if v_max is not null and v_max > 0 and v_count >= v_max then
    raise exception 'MAX_EQUIPES_ATTEINT';
  end if;

  for i in 1..25 loop
    begin
      insert into public.teams (game_id, name, team_code, color, roster)
      values (v_game.id, trim(p_team_name), public.gen_code(6),
              v_colors[(v_count % array_length(v_colors, 1)) + 1],
              coalesce((select array_agg(trim(m)) from unnest(coalesce(p_members, '{}')) m
                        where length(trim(m)) > 0), '{}'))
      returning * into v_team;
      exit;
    exception when unique_violation then
      -- team_code déjà pris dans cette partie, on retente
    end;
  end loop;

  insert into public.players (game_id, team_id, nickname, auth_uid)
  values (v_game.id, v_team.id, public.unique_nickname(v_team.id, p_nickname), auth.uid())
  on conflict (auth_uid) do update
    set game_id = excluded.game_id, team_id = excluded.team_id, nickname = excluded.nickname;

  perform public.poser_contact(v_game.id, v_team.id, p_contact);

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'team_created', jsonb_build_object('name', v_team.name));

  return jsonb_build_object('team_id', v_team.id, 'team_code', v_team.team_code,
                            'color', v_team.color, 'game_id', v_game.id);
end $$;

-- Rejoint une équipe existante.
create or replace function public.join_team(p_code text, p_team_id uuid, p_nickname text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_team  public.teams%rowtype;
  v_count int;
  v_max   int;
begin
  select * into v_game from public.games where code = upper(trim(p_code));
  if not found then raise exception 'PARTIE_INTROUVABLE'; end if;
  -- Une pause n'est pas une fermeture : le coéquipier qui arrive pendant
  -- rejoint son équipe, c'est le départ (start_team) qui attend la reprise.
  if v_game.status not in ('lobby','running','paused') then raise exception 'PARTIE_TERMINEE'; end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then raise exception 'PSEUDO_REQUIS'; end if;

  select * into v_team from public.teams where id = p_team_id and game_id = v_game.id;
  if not found then raise exception 'EQUIPE_INTROUVABLE'; end if;

  -- Une equipe deja partie ou deja arrivee ne se rejoint plus depuis la liste
  -- du lobby : son chrono court, son parcours est distribue, et l'inconnu qui
  -- s'y greffe lit les enigmes et les photos d'une famille qui ne l'a pas
  -- invite. Le coequipier en retard, lui, a le CODE D'EQUIPE : c'est
  -- `join_by_team_code` qui porte l'invitation, et lui reste ouvert.
  -- Exemption pour qui en est deja membre — deux appuis, une reprise apres
  -- rafraichissement ne doivent rien casser (meme logique que EQUIPE_PLEINE
  -- juste en dessous).
  if not exists (select 1 from public.players where auth_uid = auth.uid() and team_id = v_team.id) then
    -- L'arrivee se teste AVANT le depart : une equipe arrivee a forcement un
    -- started_at (finished_at ne se pose qu'a la validation de la derniere
    -- etape, donc apres start_team). Dans l'autre ordre, EQUIPE_DEJA_ARRIVEE
    -- est inatteignable et le lobby ne montre jamais « Cette equipe a termine
    -- sa chasse. » : c'est le message le plus juste qui doit gagner.
    if v_team.finished_at is not null then raise exception 'EQUIPE_DEJA_ARRIVEE'; end if;
    if v_team.started_at is not null then raise exception 'EQUIPE_DEJA_PARTIE'; end if;
  end if;

  select count(*) into v_count from public.players where team_id = v_team.id;
  -- Même règle que le plafond d'équipes : 0, null ou absent = ILLIMITÉ.
  -- À 0, l'ancien test rendait toute équipe pleine d'avance : un coéquipier ne
  -- pouvait plus jamais rejoindre le groupe.
  v_max := nullif(v_game.settings->>'max_players_per_team', '')::int;
  if v_max is not null and v_max > 0
     and v_count >= v_max
     and not exists (select 1 from public.players where auth_uid = auth.uid() and team_id = v_team.id) then
    raise exception 'EQUIPE_PLEINE';
  end if;

  insert into public.players (game_id, team_id, nickname, auth_uid)
  values (v_game.id, v_team.id, public.unique_nickname(v_team.id, p_nickname), auth.uid())
  on conflict (auth_uid) do update
    set game_id = excluded.game_id, team_id = excluded.team_id, nickname = excluded.nickname;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'player_joined', jsonb_build_object('nickname', trim(p_nickname)));

  return jsonb_build_object('team_id', v_team.id, 'team_code', v_team.team_code,
                            'color', v_team.color, 'game_id', v_game.id);
end $$;

-- État de jeu complet de MON équipe (bootstrap de l'écran énigme).
create or replace function public.get_play_state()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_player  public.players%rowtype;
  v_team    public.teams%rowtype;
  v_game    public.games%rowtype;
  v_route   public.team_routes%rowtype;
  v_step    public.steps%rowtype;
  v_secret  public.step_secrets%rowtype;
  v_done    int;
  v_total   int;
  v_started timestamptz;
  v_hints   jsonb := '[]'::jsonb;
  v_current jsonb := null;
  v_h       jsonb;
  v_idx     int := 0;
  v_unlocked boolean;
  v_elapsed numeric;
  v_after   numeric;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then
    return jsonb_build_object('error', 'NON_INSCRIT');
  end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;

  select count(*) filter (where status = 'done'), count(*)
  into v_done, v_total
  from public.team_routes where team_id = v_team.id;

  select * into v_route from public.team_routes
  where team_id = v_team.id and status = 'current' limit 1;

  if found and v_game.status in ('running','paused') then
    select * into v_step from public.steps where id = v_route.step_id;
    select * into v_secret from public.step_secrets where step_id = v_step.id;

    -- Repère de l'étape en cours : la validation précédente, sinon LE DÉPART DE
    -- L'ÉQUIPE. Le repli sur games.started_at était le matin de la partie : une
    -- équipe lancée à 16 h sur une partie ouverte à 9 h héritait de sept heures
    -- d'avance, donc d'un compte à rebours déjà expiré et d'indices gratuits
    -- d'office, dès sa première étape. games.started_at ne reste qu'en dernier
    -- recours, pour les parties d'avant la colonne teams.started_at.
    --
    -- ET C'EST LA DERNIÈRE VALIDATION DE L'ÉQUIPE, TOUTES POSITIONS
    -- CONFONDUES. La requête se limitait aux positions INFÉRIEURES à l'étape
    -- courante — ce qui suppose qu'on visite dans l'ordre. En mode dispersé,
    -- qui est le défaut, next_route_for n'ordonne jamais par position :
    -- l'équipe envoyée sur la position 1 après avoir validé la 6 récupérait le
    -- repère d'une étape qu'elle n'a jamais faite, ou le repli du départ. Elle
    -- arrivait sur l'épreuve avec le chronomètre déjà expiré et les indices
    -- offerts. Quatre sites partagent ce calcul : ici, validate_step,
    -- unlock_hint et skip_step_timeout.
    v_started := coalesce(
      (select max(validated_at) from public.team_routes
       where team_id = v_team.id),
      v_team.started_at, v_game.started_at, now());
    -- … et ce repère est REPOUSSÉ du temps d'arrêt, au lieu d'être seulement
    -- retranché de v_elapsed : il part TEL QUEL dans la charge utile
    -- ('started_at' plus bas) et le client REFAIT le compte à rebours à partir
    -- de lui. Ne corriger que v_elapsed laissait l'écran décompter pendant la
    -- pause, puis afficher jusqu'à la fin de l'étape moins de temps que le
    -- serveur n'en accorde — le bouton « temps écoulé » s'affichait et
    -- skip_step_timeout le renvoyait sur TIMER_PAS_ECOULE.
    v_started := v_started
      + public.paused_ms_since(v_game.id, v_started) * interval '1 millisecond';
    v_elapsed := extract(epoch from (now() - v_started));

    if v_secret.step_id is not null then
      for v_h in select * from jsonb_array_elements(coalesce(v_secret.hints, '[]'::jsonb)) loop
        v_unlocked := exists (
          select 1 from public.events e
          where e.team_id = v_team.id and e.type = 'hint_unlocked'
            and e.payload->>'step_id' = v_step.id::text
            and (e.payload->>'hint_index')::int = v_idx
        );
        v_after := nullif(v_h->>'unlock_after_sec', '')::numeric;
        v_hints := v_hints || jsonb_build_object(
          'index', v_idx,
          'penalty_sec', nullif(v_h->>'penalty_sec', '')::int,
          'unlock_after_sec', nullif(v_h->>'unlock_after_sec', '')::int,
          'available_in_sec', case when v_after is null then 0
                                   else greatest(0, ceil(v_after - v_elapsed))::int end,
          'unlocked', v_unlocked,
          -- La NATURE de l'indice est publique (« indice photo », « indice
          -- lieu ») : elle aide à choisir sans rien divulguer. Le contenu
          -- (texte, média, coordonnées) n'arrive qu'une fois débloqué.
          'kind', coalesce(nullif(v_h->>'kind', ''), 'text'),
          'text', case when v_unlocked then v_h->>'text' else null end,
          'media_url', case when v_unlocked then nullif(v_h->>'media_url', '') else null end,
          'gps', case when v_unlocked then v_h->'gps' else null end
        );
        v_idx := v_idx + 1;
      end loop;
    end if;

    v_current := jsonb_build_object(
      'step', jsonb_build_object(
        'id', v_step.id, 'type', v_step.type, 'title', v_step.title,
        'content', v_step.content, 'media_urls', to_jsonb(v_step.media_urls),
        'is_final', v_step.is_final, 'is_common', v_step.is_common_checkpoint,
        'is_start', v_step.is_start,
        -- Groupe d'enchaînement : le client prévient qu'un skip saute tout le groupe
        'chain_group', nullif(trim(coalesce(v_step.chain_group, '')), ''),
        'points', v_step.points, 'time_limit_sec', v_step.time_limit_sec,
        -- Guidage BOUSSOLE uniquement : on révèle la cible de l'étape EN COURS
        -- (chaud/froid et « aucun indice » ne divulguent jamais rien). Vaut
        -- pour la balise GPS comme pour le point d'une énigme / balise NFC :
        -- là, l'arrivée guide seulement, la validation reste l'épreuve.
        'gps_target', case
          when coalesce(v_step.content->>'gps_guidance', 'compass') = 'compass'
               and v_secret.gps_lat is not null and v_secret.gps_lng is not null
          then jsonb_build_object('lat', v_secret.gps_lat, 'lng', v_secret.gps_lng,
                                  'radius', coalesce(v_secret.gps_radius_m, 30))
          else null end
      ),
      'position', v_route.position,
      'started_at', v_started,
      'hints', v_hints,
      'submission', case when v_step.type = 'photo' then
        (select jsonb_build_object('status', s.status, 'url', s.url)
         from public.submissions s
         where s.team_id = v_team.id and s.step_id = v_step.id
         order by s.created_at desc limit 1)
      else null end
    );
  end if;

  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'code', v_game.code, 'name', v_game.name,
                               'status', v_game.status, 'started_at', v_game.started_at,
                               'finished_at', v_game.finished_at, 'settings', v_game.settings,
                               'elapsed_ms', public.game_elapsed_ms(v_game)),
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'color', v_team.color,
                               'team_code', v_team.team_code,
                               'penalty_seconds', v_team.penalty_seconds,
                               'finished_at', v_team.finished_at,
                               'final_time_ms', v_team.final_time_ms,
                               -- Le chrono de l'écran de jeu : celui de l'équipe,
                               -- pas celui de la journée.
                               'started_at', v_team.started_at,
                               'elapsed_ms', public.team_elapsed_ms(v_team.id)),
    'progress', jsonb_build_object('done', v_done, 'total', v_total),
    'current', v_current,
    -- Compat ancien client : les mini-jeux à rattraper (ancien format)
    'skipped_minigames', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'content', s.content)
                       order by tr.position)
      from public.team_routes tr
      join public.steps s on s.id = tr.step_id
      where tr.team_id = v_team.id and tr.skipped and tr.redeemed_at is null
        and s.type = 'minigame'
        and coalesce((s.content->>'redeemable')::boolean, true)
    ), '[]'::jsonb),
    -- Épreuves sautées et rattrapables (tous types, réglage par étape ;
    -- défaut : les mini-jeux). Cible GPS révélée pour le mode boussole —
    -- comme pour l'étape courante, il faut de toute façon s'y rendre.
    'skipped_steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'title', s.title, 'type', s.type, 'content', s.content,
               'media_urls', to_jsonb(s.media_urls),
               'gps_target', case
                 when coalesce(s.content->>'gps_guidance', 'compass') = 'compass'
                      and sec.gps_lat is not null and sec.gps_lng is not null
                 then jsonb_build_object('lat', sec.gps_lat, 'lng', sec.gps_lng,
                                         'radius', coalesce(sec.gps_radius_m, 30))
                 else null end
             ) order by tr.position)
      from public.team_routes tr
      join public.steps s on s.id = tr.step_id
      left join public.step_secrets sec on sec.step_id = s.id
      where tr.team_id = v_team.id and tr.skipped and tr.redeemed_at is null
        and coalesce((s.content->>'redeemable')::boolean, s.type = 'minigame')
    ), '[]'::jsonb),
    -- Dernier message général de l'organisateur. Le temps réel ne touche que
    -- les téléphones réveillés : celui-ci rattrape ceux qui dormaient, qui
    -- étaient hors réseau ou qui ont rechargé la page. Le client garde l'id
    -- déjà vu pour ne pas le réafficher en boucle.
    'broadcast', (
      select jsonb_build_object(
               'id', e.id,
               'kind', coalesce(nullif(e.payload->>'kind', ''), 'info'),
               'message', e.payload->>'message',
               'at', e.created_at)
      from public.events e
      where e.game_id = v_game.id and e.type = 'org_broadcast'
      order by e.id desc limit 1
    ),
    'finished', (v_total > 0 and v_done = v_total)
  );
end $$;

-- URLs des médias de l'étape SUIVANTE (préchargement, sans divulguer l'énoncé).
create or replace function public.get_next_media()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_next    public.team_routes%rowtype;
  v_urls    text[];
begin
  v_team_id := public.my_team_id();
  if v_team_id is null then return '[]'::jsonb; end if;
  -- Même choix que l'avancement réel (anti-peloton) : on précharge le bon média
  v_next := public.next_route_for(v_team_id);
  if v_next.id is null then return '[]'::jsonb; end if;
  select media_urls into v_urls from public.steps where id = v_next.step_id;
  return coalesce(to_jsonb(v_urls), '[]'::jsonb);
end $$;

-- Validation d'une étape (texte / NFC / QR / code manuel / mini-jeu).
-- Idempotente via p_idem_key → sûre à rejouer depuis la file offline.
-- Un mini-jeu se juge-t-il sur une RÉPONSE, ou sur le fait d'avoir été joué ?
--
-- Deux jeux seulement attendent une réponse : le Code César et le Cadenas. Les
-- quinze autres se gagnent sur le plateau. Le serveur, lui, ne regardait que
-- `step_secrets.answers` : une étape passée de « César » à « Hanoï » gardait
-- ses réponses, le jeu n'en envoyait aucune, et l'étape devenait DÉFINITIVEMENT
-- invalidable — rattrapage compris. L'organisateur voyait un mini-jeu normal et
-- l'équipe un mur.
--
-- La liste double celle de components/minigames/registry.ts (`needsAnswer`) :
-- c'est ici qu'est la vérité, parce qu'ici seul on ne peut pas tricher. Ajouter
-- un mini-jeu à réponse veut dire toucher les deux.
create or replace function public.minigame_needs_answer(p_step public.steps) returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(p_step.content->'minigame'->>'kind', '') in ('caesar', 'lock')
$$;

create or replace function public.validate_step(
  p_idem_key uuid,
  p_step_id  uuid,
  p_kind     text,
  p_payload  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_existing public.events%rowtype;
  v_player   public.players%rowtype;
  v_team     public.teams%rowtype;
  v_game     public.games%rowtype;
  v_route    public.team_routes%rowtype;
  v_step     public.steps%rowtype;
  v_secret   public.step_secrets%rowtype;
  v_next     public.team_routes%rowtype;
  v_ok       boolean := false;
  v_submitted text;
  v_result   jsonb;
  v_finished boolean := false;
  v_step_started timestamptz;
  v_dist     double precision;
begin
  -- Rejeu idempotent
  select * into v_existing from public.events where idem_key = p_idem_key;
  if found then
    return coalesce(v_existing.payload->'result', jsonb_build_object('ok', false));
  end if;

  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;

  if v_game.status = 'paused' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_EN_PAUSE');
  end if;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE');
  end if;
  if v_route.status = 'done' then
    return jsonb_build_object('ok', true, 'correct', true, 'already', true);
  end if;
  if v_route.status = 'locked' then
    -- Balise d'une autre étape que la sienne → refus explicite
    return jsonb_build_object('ok', false, 'error', 'ETAPE_VERROUILLEE');
  end if;

  select * into v_step from public.steps where id = p_step_id;
  select * into v_secret from public.step_secrets where step_id = p_step_id;

  if v_step.type = 'photo' then
    -- L'épreuve photo se valide via submit_photo + revue de l'organisateur
    return jsonb_build_object('ok', false, 'error', 'ETAPE_PHOTO');
  end if;

  if v_step.type = 'text' then
    v_submitted := p_payload->>'answer';
    v_ok := exists (
      select 1 from unnest(coalesce(v_secret.answers, '{}')) a
      where public.normalize_answer(a) <> '' and public.normalize_answer(a) = public.normalize_answer(v_submitted)
    );
  elsif v_step.type = 'nfc' then
    -- Accepte l'identifiant brut, l'URL complète de la balise, ou le code manuel
    v_submitted := regexp_replace(trim(coalesce(p_payload->>'tag', '')), '^https?://[^/]+/t/', '');
    v_ok := (v_secret.nfc_tag_id is not null and v_submitted = v_secret.nfc_tag_id)
         or (v_secret.manual_code is not null and upper(v_submitted) = upper(v_secret.manual_code));
  elsif v_step.type = 'gps' then
    -- Balise GPS : le téléphone envoie sa position, le serveur vérifie le rayon
    if v_secret.gps_lat is not null and v_secret.gps_lng is not null
       and (p_payload->>'lat') is not null and (p_payload->>'lng') is not null then
      v_dist := public.gps_distance_m(
        (p_payload->>'lat')::double precision, (p_payload->>'lng')::double precision,
        v_secret.gps_lat, v_secret.gps_lng);
      v_ok := v_dist <= coalesce(v_secret.gps_radius_m, 30);
    end if;
  elsif v_step.type = 'minigame' then
    if public.minigame_needs_answer(v_step)
       and coalesce(array_length(v_secret.answers, 1), 0) > 0 then
      v_submitted := p_payload->>'answer';
      v_ok := exists (
        select 1 from unnest(v_secret.answers) a
        where public.normalize_answer(a) <> '' and public.normalize_answer(a) = public.normalize_answer(v_submitted)
      );
    else
      -- Mini-jeu auto-validé : anti-triche minimal, un temps de jeu plausible
      -- est exigé depuis l'arrivée sur l'étape (empêche l'appel direct à la RPC).
      v_step_started := coalesce(
        (select max(validated_at) from public.team_routes
         where team_id = v_team.id),
        v_team.started_at, v_game.started_at, now());
      if extract(epoch from (now() - v_step_started))
         - public.paused_ms_since(v_game.id, v_step_started) / 1000.0 < 10 then
        return jsonb_build_object('ok', false, 'error', 'TROP_RAPIDE');
      end if;
      v_ok := true;
    end if;
    if v_ok then
      insert into public.minigame_results (game_id, team_id, step_id, score, duration_ms)
      values (v_game.id, v_team.id, p_step_id,
              nullif(p_payload->>'score', '')::numeric,
              nullif(p_payload->>'duration_ms', '')::int)
      on conflict (team_id, step_id) do nothing;
    end if;
  end if;

  if not v_ok then
    v_result := jsonb_build_object('ok', true, 'correct', false);
    -- Balise GPS : renvoyer la distance restante guide l'équipe sur le terrain
    -- (sauf mode « aucun indice », qui ne divulgue jamais rien)
    if v_step.type = 'gps' and v_dist is not null
       and coalesce(v_step.content->>'gps_guidance', 'compass') <> 'none' then
      v_result := v_result || jsonb_build_object('distance_m', round(v_dist));
    end if;
    insert into public.events (game_id, team_id, type, payload, idem_key)
    values (v_game.id, v_team.id, 'wrong_answer',
            jsonb_build_object('step_id', p_step_id, 'kind', p_kind,
                               'step_title', v_step.title, 'result', v_result),
            p_idem_key);
    return v_result;
  end if;

  update public.team_routes set status = 'done', validated_at = now() where id = v_route.id;

  v_next := public.next_route_for(v_team.id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    v_finished := true;
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team.id)
    where id = v_team.id and finished_at is null;
    insert into public.events (game_id, team_id, type)
    values (v_game.id, v_team.id, 'team_finished');
  end if;

  v_result := jsonb_build_object('ok', true, 'correct', true, 'finished', v_finished);
  insert into public.events (game_id, team_id, type, payload, idem_key)
  values (v_game.id, v_team.id, 'step_validated',
          jsonb_build_object('step_id', p_step_id, 'kind', p_kind,
                             'step_title', v_step.title, 'position', v_route.position,
                             'result', v_result),
          p_idem_key);
  return v_result;
end $$;

-- Scan d'une balise via son URL (puce NFC ou QR ouvert avec l'appareil photo) :
-- résout l'étape en cours de l'équipe du caller puis délègue à validate_step.
-- Renvoie toujours game_code pour que la page /t/[tag] sache où rediriger.
create or replace function public.validate_tag(p_idem_key uuid, p_tag text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_tag    text;
  v_test_title text;
  v_test_code  text;
  v_redeem_id  uuid;
begin
  -- Mode test organisateur : scanner sa propre balise la vérifie sans rien valider
  v_tag := regexp_replace(trim(coalesce(p_tag, '')), '^https?://[^/]+/t/', '');
  select s.title, g.code into v_test_title, v_test_code
  from public.step_secrets sec
  join public.steps s on s.id = sec.step_id
  join public.games g on g.id = s.game_id
  where g.created_by = auth.uid() and sec.nfc_tag_id = v_tag
  limit 1;
  if found then
    return jsonb_build_object('ok', true, 'test_mode', true,
                              'step_title', v_test_title, 'game_code', v_test_code);
  end if;

  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT');
  end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;

  -- Balise d'une épreuve SAUTÉE et rattrapable : le scan la rattrape direct
  select tr.step_id into v_redeem_id
  from public.team_routes tr
  join public.steps s on s.id = tr.step_id
  join public.step_secrets sec on sec.step_id = s.id
  where tr.team_id = v_team.id and tr.skipped and tr.redeemed_at is null
    and s.type = 'nfc'
    and coalesce((s.content->>'redeemable')::boolean, false)
    and (sec.nfc_tag_id = v_tag
         or (sec.manual_code is not null and upper(v_tag) = upper(sec.manual_code)))
  limit 1;
  if found then
    return public.redeem_step(p_idem_key, v_redeem_id, jsonb_build_object('tag', p_tag))
           || jsonb_build_object('game_code', v_game.code, 'redeemed', true);
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and status = 'current' limit 1;
  if not found then
    -- « Aucune etape courante » recouvre DEUX situations opposees : le parcours
    -- est boucle, ou il n'a jamais commence. Le parcours ne naît que dans
    -- start_team() : tant que le visiteur n'a pas appuye sur « Partir », son
    -- equipe n'a pas une seule ligne dans team_routes. Lui repondre
    -- « parcours deja boucle » lui dit l'exact contraire de la verite, et
    -- l'ecran de balise l'envoie au classement d'une chasse qu'il n'a pas faite.
    -- La condition regarde AUSSI team_routes : une equipe d'avant la colonne
    -- teams.started_at a un parcours sans depart propre, et celle-la est bien
    -- partie — c'est le meme repli que partout ailleurs.
    if v_team.started_at is null
       and not exists (select 1 from public.team_routes where team_id = v_team.id) then
      return jsonb_build_object('ok', false, 'error', 'PAS_PARTIE', 'game_code', v_game.code);
    end if;
    return jsonb_build_object('ok', false, 'error', 'PARCOURS_TERMINE', 'game_code', v_game.code);
  end if;

  select * into v_step from public.steps where id = v_route.step_id;
  if v_step.type <> 'nfc' then
    return jsonb_build_object('ok', false, 'error', 'ETAPE_PAS_BALISE', 'game_code', v_game.code);
  end if;

  return public.validate_step(p_idem_key, v_step.id, 'nfc',
                              jsonb_build_object('tag', p_tag))
         || jsonb_build_object('game_code', v_game.code);
end $$;

-- Rejoint son équipe via le code équipe (reconnexion : nouveau téléphone, etc.).
create or replace function public.join_by_team_code(p_code text, p_team_code text, p_nickname text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_team public.teams%rowtype;
begin
  select * into v_game from public.games where code = upper(trim(p_code));
  if not found then raise exception 'PARTIE_INTROUVABLE'; end if;
  if v_game.status not in ('lobby','running','paused') then raise exception 'PARTIE_TERMINEE'; end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then raise exception 'PSEUDO_REQUIS'; end if;

  select * into v_team from public.teams
  where game_id = v_game.id and upper(team_code) = upper(trim(p_team_code));
  if not found then raise exception 'CODE_EQUIPE_INVALIDE'; end if;

  insert into public.players (game_id, team_id, nickname, auth_uid)
  values (v_game.id, v_team.id, public.unique_nickname(v_team.id, p_nickname), auth.uid())
  on conflict (auth_uid) do update
    set game_id = excluded.game_id, team_id = excluded.team_id, nickname = excluded.nickname;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'player_joined', jsonb_build_object('nickname', trim(p_nickname), 'via', 'team_code'));

  return jsonb_build_object('team_id', v_team.id, 'team_code', v_team.team_code,
                            'color', v_team.color, 'game_id', v_game.id);
end $$;

-- Renomme / supprime une équipe (organisateur).
create or replace function public.org_rename_team(p_team_id uuid, p_name text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare v_team public.teams%rowtype;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or not public.is_game_owner(v_team.game_id) then raise exception 'INTERDIT'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'NOM_REQUIS'; end if;
  update public.teams set name = trim(p_name) where id = p_team_id;
end $$;

create or replace function public.org_delete_team(p_team_id uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
  v_game public.games%rowtype;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found or not public.is_game_owner(v_team.game_id) then raise exception 'INTERDIT'; end if;
  select * into v_game from public.games where id = v_team.game_id;
  -- En continu la partie tourne toute la journée : sans cette ouverture,
  -- l'organisateur ne pourrait plus jamais retirer une équipe de test.
  if v_game.status = 'finished' then raise exception 'PARTIE_TERMINEE'; end if;
  delete from public.teams where id = p_team_id;  -- cascade sur players
end $$;

-- Position GPS du joueur (partagée avec consentement, pour le suivi organisateur).
create or replace function public.report_position(p_lat double precision, p_lng double precision)
returns void
language sql volatile security definer
set search_path = public
as $$
  update public.players
  set last_lat = p_lat, last_lng = p_lng, pos_updated_at = now()
  where auth_uid = auth.uid();
$$;

-- Distance vers la balise GPS de l'étape EN COURS (mode chaud/froid) : lecture
-- seule, ne valide rien et n'émet aucun event. Alimente le thermomètre
-- chaud/froid côté joueur SANS jamais renvoyer la position de la cible au
-- client (contrairement au mode boussole). Bornée à l'étape courante de mon
-- équipe pour éviter de sonder d'autres balises.
create or replace function public.gps_ping(
  p_step_id uuid, p_lat double precision, p_lng double precision
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_secret  public.step_secrets%rowtype;
  v_dist    double precision;
  v_radius  int;
  v_guidance text;
begin
  v_team_id := public.my_team_id();
  if v_team_id is null then
    return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT');
  end if;

  -- Étape courante, ou épreuve sautée rattrapable (thermomètre du rattrapage)
  if not exists (
    select 1 from public.team_routes tr
    join public.steps s on s.id = tr.step_id
    where tr.team_id = v_team_id and tr.step_id = p_step_id
      and (tr.status = 'current'
           or (tr.skipped and tr.redeemed_at is null
               and coalesce((s.content->>'redeemable')::boolean, false)))
  ) then
    return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE');
  end if;

  select * into v_secret from public.step_secrets where step_id = p_step_id;
  if v_secret.gps_lat is null or v_secret.gps_lng is null
     or p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'error', 'POSITION_INDISPONIBLE');
  end if;

  v_radius := coalesce(v_secret.gps_radius_m, 30);
  v_dist := public.gps_distance_m(p_lat, p_lng, v_secret.gps_lat, v_secret.gps_lng);

  -- Mode « aucun indice » : on ne divulgue QUE l'arrivée — ni distance ni
  -- rayon, même dans l'inspecteur réseau d'un petit malin.
  select coalesce(s.content->>'gps_guidance', 'compass') into v_guidance
  from public.steps s where s.id = p_step_id;
  if v_guidance = 'none' then
    return jsonb_build_object('ok', true, 'within', v_dist <= v_radius);
  end if;

  return jsonb_build_object(
    'ok', true,
    'distance_m', round(v_dist),
    'radius', v_radius,
    'within', v_dist <= v_radius
  );
end $$;

-- Soumet la photo d'une épreuve photo (validée ensuite par l'organisateur).
create or replace function public.submit_photo(p_step_id uuid, p_url text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_next   public.team_routes%rowtype;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and status = 'current'
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE'); end if;

  select * into v_step from public.steps where id = p_step_id;
  if v_step.type <> 'photo' then return jsonb_build_object('ok', false, 'error', 'ETAPE_PAS_PHOTO'); end if;
  if p_url is null or p_url !~ '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'URL_INVALIDE');
  end if;

  insert into public.submissions (game_id, team_id, step_id, url)
  values (v_game.id, v_team.id, p_step_id, p_url);

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'photo_submitted',
          jsonb_build_object('step_id', p_step_id, 'step_title', v_step.title, 'url', p_url));

  -- Mode « photo bloquante » : l'équipe reste sur l'étape tant que
  -- l'organisateur n'a pas approuvé la photo (org_review_photo avance alors).
  -- SANS SURVEILLANCE, ce mode est désactivé : personne ne juge en direct, et
  -- une équipe bloquée devant sa photo attendrait jusqu'au soir. La photo part
  -- quand même en revue — elle sera regardée plus tard, à tête reposée.
  if coalesce(v_step.content->>'photo_mode', 'bonus') = 'gate'
     and not public.is_unattended(v_game) then
    return jsonb_build_object('ok', true, 'pending', true);
  end if;

  -- Mode bonus (défaut) : l'équipe avance immédiatement ; l'organisateur
  -- jugera la photo plus tard (refusée = 0 point sur l'étape).
  update public.team_routes set status = 'done', validated_at = now()
  where id = v_route.id;

  v_next := public.next_route_for(v_team.id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
    insert into public.events (game_id, team_id, type, payload)
    values (v_game.id, v_team.id, 'step_validated',
            jsonb_build_object('step_id', p_step_id, 'kind', 'photo',
                               'step_title', v_step.title, 'position', v_route.position));
    return jsonb_build_object('ok', true, 'correct', true, 'finished', false);
  else
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team.id)
    where id = v_team.id and finished_at is null;
    insert into public.events (game_id, team_id, type)
    values (v_game.id, v_team.id, 'team_finished');
    insert into public.events (game_id, team_id, type, payload)
    values (v_game.id, v_team.id, 'step_validated',
            jsonb_build_object('step_id', p_step_id, 'kind', 'photo',
                               'step_title', v_step.title, 'position', v_route.position));
    return jsonb_build_object('ok', true, 'correct', true, 'finished', true);
  end if;
end $$;

-- Énigme BONUS : l'équipe a droit à UNE réponse, elle avance immédiatement
-- quelle qu'elle soit, et l'organisateur juge après coup (bonne réponse =
-- bonus). Aucune pénalité en cas d'erreur : c'est un bonus, pas un péage.
-- Permet les questions ouvertes qu'aucune liste de réponses ne peut valider.
create or replace function public.submit_bonus_answer(p_step_id uuid, p_answer text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_secret public.step_secrets%rowtype;
  v_next   public.team_routes%rowtype;
  v_sub_id uuid;
  v_juste  boolean;
  v_pts    int := 0;
  v_sec    int := 0;
  v_finished boolean := false;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and status = 'current'
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE'); end if;

  select * into v_step from public.steps where id = p_step_id;
  if v_step.type <> 'text'
     or coalesce(v_step.content->>'text_mode', 'normal') <> 'bonus' then
    return jsonb_build_object('ok', false, 'error', 'ETAPE_PAS_BONUS');
  end if;
  if p_answer is null or length(trim(p_answer)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'REPONSE_VIDE');
  end if;

  insert into public.submissions (game_id, team_id, step_id, answer)
  values (v_game.id, v_team.id, p_step_id, left(trim(p_answer), 400))
  returning id into v_sub_id;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'bonus_answer',
          jsonb_build_object('step_id', p_step_id, 'step_title', v_step.title,
                             'answer', left(trim(p_answer), 400)));

  -- SANS SURVEILLANCE : la réponse se juge sur-le-champ, sinon le bonus ne
  -- tombe jamais et le joueur ne comprend pas pourquoi.
  --
  -- On ne l'accorde PAS aveuglément : s'il existe des réponses attendues, on
  -- compare — c'est la même normalisation que les énigmes classiques. Un bonus
  -- distribué à tout le monde ne récompense plus rien. Sans réponse attendue
  -- (question ouverte, « racontez-nous »), on accorde : le jeu ne peut pas
  -- juger, et un bonus ne pénalise jamais.
  if public.is_unattended(v_game) then
    select * into v_secret from public.step_secrets where step_id = p_step_id;
    if coalesce(array_length(v_secret.answers, 1), 0) = 0 then
      v_juste := true;
    else
      v_juste := exists (
        select 1 from unnest(v_secret.answers) a
        where public.normalize_answer(a) <> ''
          and public.normalize_answer(a) = public.normalize_answer(p_answer)
      );
    end if;

    if v_juste then
      if coalesce(v_game.settings->>'scoring', 'time') = 'points' then
        v_pts := coalesce(nullif(v_step.content->>'bonus_points', '')::int, 100);
      else
        v_sec := -coalesce(nullif(v_step.content->>'bonus_sec', '')::int, 60);
      end if;
      update public.submissions set status = 'approved', decided_at = now()
      where id = v_sub_id;
      update public.teams
      set bonus_points = bonus_points + v_pts,
          penalty_seconds = penalty_seconds + v_sec
      where id = v_team.id;
      insert into public.events (game_id, team_id, type, payload)
      values (v_game.id, v_team.id, 'bonus_awarded',
              jsonb_build_object('points', v_pts, 'seconds', v_sec,
                                 'reason', '🧠 ' || coalesce(v_step.title, 'énigme bonus'),
                                 'submission_id', v_sub_id));
    else
      -- Refusée, mais sans aucune peine : un bonus manqué n'est pas un péage.
      update public.submissions set status = 'rejected', decided_at = now()
      where id = v_sub_id;
    end if;
  end if;

  -- L'équipe avance TOUJOURS : la justesse ne conditionne que le bonus.
  update public.team_routes set status = 'done', validated_at = now() where id = v_route.id;

  v_next := public.next_route_for(v_team.id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    v_finished := true;
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team.id)
    where id = v_team.id and finished_at is null;
    insert into public.events (game_id, team_id, type)
    values (v_game.id, v_team.id, 'team_finished');
  end if;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'step_validated',
          jsonb_build_object('step_id', p_step_id, 'kind', 'bonus_answer',
                             'step_title', v_step.title, 'position', v_route.position));

  return jsonb_build_object('ok', true, 'correct', true, 'finished', v_finished);
end $$;

-- L'organisateur juge la réponse d'une énigme bonus. Validée : l'équipe
-- encaisse le bonus de l'étape (points, ou temps rendu en mode chrono), tracé
-- comme n'importe quelle récompense — donc visible des joueurs avec son motif
-- et annulable depuis l'écran Récompenses. Refusée : rien, aucune pénalité.
-- Rejuger dans l'autre sens reprend ou rend le bonus, sans jamais le doubler.
create or replace function public.org_review_answer(p_submission_id uuid, p_approve boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_sub    public.submissions%rowtype;
  v_game   public.games%rowtype;
  v_step   public.steps%rowtype;
  v_pts    int := 0;
  v_sec    int := 0;
  v_given  boolean;
begin
  select * into v_sub from public.submissions where id = p_submission_id for update;
  if not found or not public.is_game_owner(v_sub.game_id) then raise exception 'INTERDIT'; end if;
  select * into v_game from public.games where id = v_sub.game_id;
  select * into v_step from public.steps where id = v_sub.step_id;

  if coalesce(v_game.settings->>'scoring', 'time') = 'points' then
    v_pts := coalesce(nullif(v_step.content->>'bonus_points', '')::int, 100);
  else
    v_sec := -coalesce(nullif(v_step.content->>'bonus_sec', '')::int, 60);
  end if;

  -- Bonus déjà accordé pour CETTE réponse (et non annulé depuis) ?
  v_given := exists (
    select 1 from public.events e
    where e.game_id = v_sub.game_id and e.type = 'bonus_awarded'
      and e.payload->>'submission_id' = p_submission_id::text
      and not coalesce((e.payload->>'revoked')::boolean, false)
  );

  if p_approve then
    update public.submissions set status = 'approved', decided_at = now() where id = p_submission_id;
    if not v_given then
      update public.teams
      set bonus_points = bonus_points + v_pts,
          penalty_seconds = penalty_seconds + v_sec
      where id = v_sub.team_id;
      insert into public.events (game_id, team_id, type, payload)
      values (v_sub.game_id, v_sub.team_id, 'bonus_awarded',
              jsonb_build_object('points', v_pts, 'seconds', v_sec,
                                 'reason', '🧠 ' || coalesce(v_step.title, 'énigme bonus'),
                                 'submission_id', p_submission_id));
    end if;
  else
    update public.submissions set status = 'rejected', decided_at = now() where id = p_submission_id;
    if v_given then
      -- Reprise du bonus : on reverse les montants et on marque l'événement
      -- d'origine annulé (la trace reste dans le journal).
      update public.teams
      set bonus_points = bonus_points - v_pts,
          penalty_seconds = penalty_seconds - v_sec
      where id = v_sub.team_id;
      update public.events
      set payload = payload || jsonb_build_object('revoked', true, 'revoked_at', now())
      where game_id = v_sub.game_id and type = 'bonus_awarded'
        and payload->>'submission_id' = p_submission_id::text
        and not coalesce((payload->>'revoked')::boolean, false);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'points', v_pts, 'seconds', v_sec);
end $$;

-- L'organisateur juge une photo (pendant OU en fin de partie). Refuser coûte
-- le malus réglé sur l'étape (ou celui de la partie), dans les deux modes :
-- en mode bonus l'équipe perd en plus les points de l'étape ; en mode bloquant
-- elle doit renvoyer une photo, et chaque refus coûte à nouveau. Le malus est
-- tracé comme un ajustement négatif : les joueurs le voient avec son motif, et
-- valider la photo après coup le rend.
-- Une photo refusée disparaît aussi des souvenirs de l'équipe (get_ranking
-- écarte les 'rejected' de team_photos).
create or replace function public.org_review_photo(p_submission_id uuid, p_approve boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_sub   public.submissions%rowtype;
  v_game  public.games%rowtype;
  v_step  public.steps%rowtype;
  v_route public.team_routes%rowtype;
  v_next  public.team_routes%rowtype;
  v_pts   int := 0;
  v_sec   int := 0;
  v_applied boolean;
begin
  select * into v_sub from public.submissions where id = p_submission_id for update;
  if not found or not public.is_game_owner(v_sub.game_id) then raise exception 'INTERDIT'; end if;
  select * into v_game from public.games where id = v_sub.game_id;
  select * into v_step from public.steps where id = v_sub.step_id;

  -- Malus d'un refus : réglage PROPRE À L'ÉTAPE, sinon celui de la partie.
  -- Points : score retiré (en plus des points de l'étape, déjà perdus).
  -- Chrono : minutes ajoutées au temps final.
  if coalesce(v_game.settings->>'scoring', 'time') = 'points' then
    v_pts := -coalesce(nullif(v_step.content->>'photo_penalty_points', '')::int,
                       nullif(v_game.settings->>'photo_penalty_points', '')::int, 50);
  else
    v_sec := coalesce(nullif(v_step.content->>'photo_penalty_sec', '')::int,
                      nullif(v_game.settings->>'photo_penalty_sec', '')::int, 180);
  end if;

  -- Malus déjà appliqué à CETTE photo (et non annulé depuis) ?
  v_applied := exists (
    select 1 from public.events e
    where e.game_id = v_sub.game_id and e.type = 'bonus_awarded'
      and e.payload->>'submission_id' = p_submission_id::text
      and not coalesce((e.payload->>'revoked')::boolean, false)
  );

  if p_approve then
    -- L'orga corrige un refus : le malus est rendu, et sa trace annulée.
    if v_applied then
      update public.teams
      set bonus_points = bonus_points - v_pts,
          penalty_seconds = penalty_seconds - v_sec
      where id = v_sub.team_id;
      update public.events
      set payload = payload || jsonb_build_object('revoked', true, 'revoked_at', now())
      where game_id = v_sub.game_id and type = 'bonus_awarded'
        and payload->>'submission_id' = p_submission_id::text
        and not coalesce((payload->>'revoked')::boolean, false);
    end if;
    update public.submissions set status = 'approved', decided_at = now() where id = p_submission_id;
    insert into public.events (game_id, team_id, type, payload)
    values (v_sub.game_id, v_sub.team_id, 'photo_approved', jsonb_build_object('step_id', v_sub.step_id));

    -- Photo bloquante : l'approbation fait avancer l'équipe qui attendait
    if coalesce(v_step.content->>'photo_mode', 'bonus') = 'gate' then
      select * into v_route from public.team_routes
      where team_id = v_sub.team_id and step_id = v_sub.step_id and status = 'current'
      for update;
      if found then
        update public.team_routes set status = 'done', validated_at = now() where id = v_route.id;
        v_next := public.next_route_for(v_sub.team_id);
        if v_next.id is not null then
          update public.team_routes set status = 'current' where id = v_next.id;
        else
          update public.teams
          set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_sub.team_id)
          where id = v_sub.team_id and finished_at is null;
          insert into public.events (game_id, team_id, type)
          values (v_sub.game_id, v_sub.team_id, 'team_finished');
        end if;
        insert into public.events (game_id, team_id, type, payload)
        values (v_sub.game_id, v_sub.team_id, 'step_validated',
                jsonb_build_object('step_id', v_sub.step_id, 'kind', 'photo',
                                   'step_title', v_step.title, 'position', v_route.position));
      end if;
    end if;
  else
    -- Malus du refus, dans les DEUX modes. Une seule fois par photo refusée :
    -- en mode bloquant l'équipe peut en renvoyer plusieurs, et chaque photo
    -- refusée coûte — mais rejuger la même ne double jamais la peine.
    -- Tracé comme un ajustement négatif → visible des joueurs avec son motif,
    -- et rendu si la photo est finalement validée.
    if not v_applied and (v_pts <> 0 or v_sec <> 0) then
      update public.teams
      set bonus_points = bonus_points + v_pts,
          penalty_seconds = penalty_seconds + v_sec
      where id = v_sub.team_id;
      insert into public.events (game_id, team_id, type, payload)
      values (v_sub.game_id, v_sub.team_id, 'bonus_awarded',
              jsonb_build_object('points', v_pts, 'seconds', v_sec,
                                 'reason', '📸 photo refusée — ' || coalesce(v_step.title, 'épreuve photo'),
                                 'submission_id', p_submission_id));
    end if;
    update public.submissions set status = 'rejected', decided_at = now() where id = p_submission_id;
    insert into public.events (game_id, team_id, type, payload)
    values (v_sub.game_id, v_sub.team_id, 'photo_rejected', jsonb_build_object('step_id', v_sub.step_id));
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Marque/démarque une photo comme « à l'honneur » (affichée à la fin pour
-- tout le monde). Interrupteur INDÉPENDANT : on peut en désigner plusieurs.
create or replace function public.org_set_photo_winner(p_submission_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_sub public.submissions%rowtype;
begin
  select * into v_sub from public.submissions where id = p_submission_id;
  if not found or not public.is_game_owner(v_sub.game_id) then raise exception 'INTERDIT'; end if;
  if v_sub.is_winner then
    update public.submissions set is_winner = false where id = p_submission_id;
    return jsonb_build_object('ok', true, 'winner', false);
  end if;
  update public.submissions set is_winner = true where id = p_submission_id;
  insert into public.events (game_id, team_id, type, payload)
  values (v_sub.game_id, v_sub.team_id, 'photo_winner', jsonb_build_object('submission_id', p_submission_id));
  return jsonb_build_object('ok', true, 'winner', true);
end $$;

-- Enregistre l'abonnement push du device (lié à son équipe pour le ciblage).
create or replace function public.save_push_subscription(p_subscription jsonb)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare v_player public.players%rowtype;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then raise exception 'NON_INSCRIT'; end if;
  insert into public.push_subscriptions (auth_uid, game_id, team_id, subscription, updated_at)
  values (auth.uid(), v_player.game_id, v_player.team_id, p_subscription, now())
  on conflict (auth_uid) do update
    set subscription = excluded.subscription, game_id = excluded.game_id,
        team_id = excluded.team_id, updated_at = now();
end $$;

-- Classement complet d'une partie (respecte le mode de score temps/points).
-- Accessible à tout participant : sert la page finale et les récompenses.
create or replace function public.get_ranking(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_teams jsonb;
  v_scoring text;
begin
  select * into v_game from public.games where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'PARTIE_INTROUVABLE'); end if;
  v_scoring := coalesce(v_game.settings->>'scoring', 'time');

  -- L'ORDRE DU CLASSEMENT.
  --
  -- Au chrono, la progression NE PEUT PAS être la première clé. Les équipes
  -- n'ont pas toutes le même nombre d'étapes — l'organisateur peut en ajouter
  -- une en cours de journée, et org_neutralize_step / org_delete_step font
  -- avancer celles qui étaient dessus. Trier d'abord sur `done` mettait donc
  -- une équipe partie l'après-midi, 6 étapes sur 10 en trois heures, devant
  -- une équipe du matin ARRIVÉE en vingt minutes.
  --
  -- Trois familles, dans cet ordre : celles qui ont fini (leur temps final
  -- tranche, c'est tout ce qui compte), celles qui courent encore (la
  -- progression puis le temps courant), celles qui ne sont pas parties.
  -- En mode points, rien ne change : tout le monde dans la même famille,
  -- départagé au barème.
  select coalesce(jsonb_agg(trow order by
           case when v_scoring = 'points' then 0
                when (trow->>'time_ms') is not null then 0
                when (trow->>'elapsed_ms') is not null then 1
                else 2 end,
           case when v_scoring = 'points' then -(trow->>'points')::numeric
                when (trow->>'time_ms') is not null then 0
                else -(trow->>'done')::numeric end,
           -- Arrivée : le temps final tranche. Encore en course : son temps
           -- courant, pénalités comprises — en chrono par équipe, deux équipes
           -- à égalité de progression n'ont pas couru la même durée, celle qui
           -- a mis le moins de temps est devant. Pas encore partie : en fin de
           -- liste (9e15).
           coalesce((trow->>'time_ms')::numeric,
                    (trow->>'elapsed_ms')::numeric
                      + (trow->>'penalty_seconds')::numeric * 1000,
                    9e15),
           (trow->>'penalty_seconds')::numeric,
           trow->>'name'), '[]'::jsonb)
  into v_teams
  from (
    select jsonb_build_object(
      'id', t.id, 'name', t.name, 'color', t.color, 'roster', to_jsonb(t.roster),
      'penalty_seconds', t.penalty_seconds,
      'finished_at', t.finished_at,
      -- Départ propre à l'équipe : en jeu continu, chacune part à son heure.
      'started_at', t.started_at,
      -- Temps de course à cet instant, pauses déduites, HORS pénalités (null
      -- tant que l'équipe n'est pas partie). Le classement en direct s'appuie
      -- dessus ; time_ms, lui, reste le temps final figé de l'arrivée.
      -- Pas de repli sur l'ouverture de la partie : en jeu continu, une équipe
      -- qui attend au lobby afficherait au classement tout le temps écoulé
      -- depuis le matin. Seule exception, l'équipe d'avant la colonne
      -- started_at : elle a un parcours, elle est bien partie.
      'elapsed_ms', case when t.started_at is null
                              and not exists (select 1 from public.team_routes r
                                              where r.team_id = t.id)
                         then null else public.team_elapsed_ms(t.id) end,
      'done', (select count(*) from public.team_routes tr where tr.team_id = t.id and tr.status = 'done'),
      'total', (select count(*) from public.team_routes tr where tr.team_id = t.id),
      'time_ms', case when t.finished_at is not null
                      -- plancher à 0 : un gros bonus temps ne doit pas produire
                      -- un temps de course négatif à l'affichage
                      then greatest(0, coalesce(t.final_time_ms, 0) + t.penalty_seconds * 1000)
                      else null end,
      -- Points : la somme des points d'étape gagnés (photo refusée = 0,
      -- mini-jeu passé = 0, timeout = 0) moins les pénalités de skip et d'indices.
      'points',
        coalesce((
          select sum(
            case
              when tr.timed_out then 0
              -- Sautée et jamais rattrapée = 0 ; rattrapée = points regagnés
              -- (la pénalité de skip, elle, reste déduite plus bas)
              when tr.skipped and tr.redeemed_at is null then 0
              when s.type = 'photo' and (
                select sub.status from public.submissions sub
                where sub.team_id = t.id and sub.step_id = s.id
                order by sub.created_at desc limit 1
              ) = 'rejected' then 0
              else s.points
            end)
          from public.team_routes tr
          join public.steps s on s.id = tr.step_id
          where tr.team_id = t.id and tr.status = 'done'
        ), 0)
        - (select coalesce(sum(
             coalesce((s.content->>'skip_penalty_points')::int,
                      (v_game.settings->>'skip_penalty_points')::int, 50)), 0)
           from public.team_routes tr
           join public.steps s on s.id = tr.step_id
           -- rattrapée = pénalité de skip annulée
           where tr.team_id = t.id and tr.skipped and tr.redeemed_at is null)
        - floor(t.penalty_seconds / 60.0) * 10
        + t.bonus_points,
      'bonus_points', t.bonus_points,
      'fastest_step_ms', (
        select min((extract(epoch from (x.validated_at - x.prev_ts)) * 1000)::bigint)
        from (
          select tr.validated_at,
                 -- Le repère de la 1re étape est le départ de L'ÉQUIPE : depuis
                 -- celui de la partie, la meilleure étape d'un visiteur de
                 -- l'après-midi ferait des heures.
                 coalesce(lag(tr.validated_at) over (order by tr.validated_at),
                          t.started_at, v_game.started_at) as prev_ts
          from public.team_routes tr
          where tr.team_id = t.id and tr.validated_at is not null
        ) x
        where x.prev_ts is not null
      )
    ) as trow
    from public.teams t where t.game_id = v_game.id
  ) sub;

  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'code', v_game.code, 'name', v_game.name,
                               'status', v_game.status, 'started_at', v_game.started_at,
                               'finished_at', v_game.finished_at, 'scoring', v_scoring,
                               'elapsed_ms', public.game_elapsed_ms(v_game),
                               -- Ce que l'écran de fin doit savoir de la partie :
                               -- en continu, « partie terminée » et « mon équipe
                               -- est arrivée » ne coïncident plus ; et la note
                               -- n'est demandée que si l'organisateur l'a voulu.
                               'continuous', public.is_continuous(v_game),
                               'ask_rating', coalesce((v_game.settings->>'ask_rating')::boolean, false)),
    'teams', v_teams,
    -- L'équipe du demandeur (null pour l'organisateur et la page publique) :
    -- l'écran de fin la retrouve ainsi même après avoir oublié la session
    -- locale — ce qu'il fait dès que la partie est close. Sans elle, la note
    -- et les photos souvenir disparaissaient à l'instant de la fermeture.
    'my_team_id', (select p.team_id from public.players p
                   where p.auth_uid = auth.uid() and p.game_id = v_game.id),
    -- Récompenses de l'organisateur AVEC leur motif : sans ça, les joueurs
    -- voient des points tomber sans comprendre pourquoi. Servies ici (security
    -- definer) car la RLS d'events ne montre à un joueur que sa propre équipe.
    'bonuses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', e.team_id,
               'points',  coalesce((e.payload->>'points')::int, 0),
               'seconds', coalesce((e.payload->>'seconds')::int, 0),
               'reason',  coalesce(e.payload->>'reason', ''),
               'created_at', e.created_at)
             order by e.id)
      from public.events e
      where e.game_id = v_game.id
        and e.type = 'bonus_awarded'
        and e.team_id is not null
        and not coalesce((e.payload->>'revoked')::boolean, false)
    ), '[]'::jsonb),
    -- PHOTOS SOUVENIR — chaque équipe retrouve SES photos, et seulement les
    -- siennes, pour les revoir et les télécharger à la fin.
    --
    -- Servies ici parce que c'est le seul endroit qui connaît à la fois le
    -- classement et l'identité du demandeur. Le filtre est le joueur lui-même :
    -- l'organisateur, la page publique et la clé de service n'ont pas de ligne
    -- dans `players`, ils repartent donc avec une liste vide — voulu : les
    -- photos montrées à tous restent celles « à l'honneur » (winner_photos),
    -- choisies par l'organisateur.
    --
    -- Les photos refusées sont écartées : refuser une photo déplacée doit la
    -- faire disparaître aussi de l'écran de ceux qui l'ont prise.
    'team_photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sub.id, 'url', sub.url,
               'step_title', s.title, 'created_at', sub.created_at)
             order by sub.created_at)
      from public.submissions sub
      join public.steps s on s.id = sub.step_id
      where sub.game_id = v_game.id
        and sub.url is not null
        and sub.status <> 'rejected'
        and sub.team_id = (select p.team_id from public.players p
                           where p.auth_uid = auth.uid() and p.game_id = v_game.id)
    ), '[]'::jsonb),
    -- Servies ici (security definer) car la RLS de submissions ne permet pas
    -- aux autres équipes de lire les photos à l'honneur en direct.
    'winner_photos', coalesce((
      select jsonb_agg(jsonb_build_object('url', sub.url, 'team_id', sub.team_id)
                       order by sub.created_at)
      from public.submissions sub
      where sub.game_id = v_game.id and sub.is_winner
    ), '[]'::jsonb),
    -- Compat ancien client : la 1re photo à l'honneur
    'winner_photo', (
      select jsonb_build_object('url', sub.url, 'team_id', sub.team_id)
      from public.submissions sub
      where sub.game_id = v_game.id and sub.is_winner
      order by sub.created_at
      limit 1
    )
  );
end $$;

-- Débloque un indice : gratuit si le délai est écoulé, sinon pénalité de temps.
create or replace function public.unlock_hint(p_step_id uuid, p_hint_index int)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player  public.players%rowtype;
  v_team    public.teams%rowtype;
  v_game    public.games%rowtype;
  v_route   public.team_routes%rowtype;
  v_secret  public.step_secrets%rowtype;
  v_hint    jsonb;
  v_started timestamptz;
  v_elapsed numeric;
  v_after   numeric;
  v_penalty int := 0;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and status = 'current';
  if not found then return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE'); end if;

  select * into v_secret from public.step_secrets where step_id = p_step_id;
  v_hint := coalesce(v_secret.hints, '[]'::jsonb) -> p_hint_index;
  if v_hint is null then return jsonb_build_object('ok', false, 'error', 'INDICE_INTROUVABLE'); end if;

  -- Déjà débloqué → renvoie le texte sans re-pénaliser
  if exists (
    select 1 from public.events e
    where e.team_id = v_team.id and e.type = 'hint_unlocked'
      and e.payload->>'step_id' = p_step_id::text
      and (e.payload->>'hint_index')::int = p_hint_index
  ) then
    return jsonb_build_object('ok', true, 'text', v_hint->>'text', 'penalty_sec', 0);
  end if;

  v_started := coalesce(
    (select max(validated_at) from public.team_routes
     where team_id = v_team.id),
    v_team.started_at, v_game.started_at, now());
  v_elapsed := extract(epoch from (now() - v_started))
               - public.paused_ms_since(v_game.id, v_started) / 1000.0;
  v_after := nullif(v_hint->>'unlock_after_sec', '')::numeric;

  if v_after is not null and v_elapsed >= v_after then
    v_penalty := 0;  -- délai écoulé → gratuit
  else
    v_penalty := coalesce(nullif(v_hint->>'penalty_sec', '')::int,
                          nullif(v_game.settings->>'hint_default_penalty_sec', '')::int,
                          120);
    if v_after is not null and nullif(v_hint->>'penalty_sec', '') is null then
      -- indice uniquement temporel, pas encore disponible
      return jsonb_build_object('ok', false, 'error', 'INDICE_PAS_ENCORE',
                                'available_in_sec', greatest(0, ceil(v_after - v_elapsed))::int);
    end if;
  end if;

  if v_penalty > 0 then
    update public.teams set penalty_seconds = penalty_seconds + v_penalty where id = v_team.id;
  end if;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'hint_unlocked',
          jsonb_build_object('step_id', p_step_id, 'hint_index', p_hint_index,
                             'penalty_sec', v_penalty));

  return jsonb_build_object('ok', true, 'text', v_hint->>'text', 'penalty_sec', v_penalty);
end $$;

-- Passe l'étape en cours (bloqué sur le terrain) : l'équipe avance et subit
-- la pénalité de skip PROPRE À L'ÉTAPE (content.skip_penalty_sec/points) ou,
-- à défaut, le réglage global de la partie. Fonctionne pour TOUS les types.
-- Étape d'un GROUPE (chain_group) : c'est tout le reste du groupe qui saute
-- d'un bloc (une pénalité par épreuve) — un groupe ne se saute jamais à moitié.
-- Les épreuves marquées « rattrapables » (content.redeemable, défaut : les
-- mini-jeux) restent jouables plus tard via redeem_step.
create or replace function public.skip_step(p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_next   public.team_routes%rowtype;
  v_grp    text;
  v_r      record;
  v_finished boolean := false;
  v_pen    int;
  v_total_pen int := 0;
  v_count  int := 0;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and status = 'current' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE'); end if;

  select * into v_step from public.steps where id = p_step_id;
  v_grp := nullif(trim(coalesce(v_step.chain_group, '')), '');

  -- L'étape courante + tout le reste de son groupe éventuel, dans l'ordre
  for v_r in
    select tr.id as route_id, s.id as sid, s.title, s.type, s.content
    from public.team_routes tr
    join public.steps s on s.id = tr.step_id
    where tr.team_id = v_team.id
      and tr.status in ('current', 'locked')
      and (tr.step_id = p_step_id
           or (v_grp is not null and nullif(trim(coalesce(s.chain_group, '')), '') = v_grp))
    order by tr.position
  loop
    update public.team_routes set status = 'done', validated_at = now(), skipped = true
    where id = v_r.route_id;
    v_count := v_count + 1;

    -- Mode chrono : pénalité de temps PAR épreuve sautée (propre ou globale).
    if coalesce(v_game.settings->>'scoring', 'time') = 'time' then
      v_pen := coalesce((v_r.content->>'skip_penalty_sec')::int,
                        (v_game.settings->>'skip_penalty_sec')::int, 180);
      v_total_pen := v_total_pen + v_pen;
    end if;
    -- Mode points : la pénalité est soustraite dans get_ranking (par étape).

    insert into public.events (game_id, team_id, type, payload)
    values (v_game.id, v_team.id, 'step_skipped',
            jsonb_build_object('step_id', v_r.sid, 'step_title', v_r.title,
                               'step_type', v_r.type, 'chain_group', v_grp));
  end loop;

  if v_total_pen > 0 then
    update public.teams set penalty_seconds = penalty_seconds + v_total_pen where id = v_team.id;
  end if;

  v_next := public.next_route_for(v_team.id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    v_finished := true;
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team.id)
    where id = v_team.id and finished_at is null;
    insert into public.events (game_id, team_id, type)
    values (v_game.id, v_team.id, 'team_finished');
  end if;

  return jsonb_build_object('ok', true, 'finished', v_finished, 'skipped_count', v_count);
end $$;

-- Compat : ancien nom, délègue à skip_step.
create or replace function public.skip_minigame(p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
begin
  return public.skip_step(p_step_id);
end $$;

-- Rattrape une épreuve sautée (marquée « rattrapable » par l'organisateur —
-- défaut : les mini-jeux). Validation selon le type : réponse (texte,
-- mini-jeu à réponse), balise (NFC/code), position (GPS), photo (envoyée en
-- revue). Réussir ANNULE la pénalité du skip et rend le gain de l'étape —
-- le détour sur le terrain est le vrai prix. Les épreuves d'un groupe se
-- rattrapent dans l'ordre du groupe.
create or replace function public.redeem_step(p_idem_key uuid, p_step_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_existing public.events%rowtype;
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_secret public.step_secrets%rowtype;
  v_grp    text;
  v_blocking text;
  v_submitted text;
  v_dist   double precision;
  v_ok     boolean := false;
  v_result jsonb;
begin
  select * into v_existing from public.events where idem_key = p_idem_key;
  if found then
    return coalesce(v_existing.payload->'result', jsonb_build_object('ok', false));
  end if;

  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and skipped and redeemed_at is null
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'PAS_EN_RATTRAPAGE'); end if;

  select * into v_step from public.steps where id = p_step_id;
  select * into v_secret from public.step_secrets where step_id = p_step_id;

  if not coalesce((v_step.content->>'redeemable')::boolean, v_step.type = 'minigame') then
    return jsonb_build_object('ok', false, 'error', 'PAS_RATTRAPABLE');
  end if;

  -- Groupe d'épreuves liées : rattrapage dans l'ordre du groupe uniquement
  v_grp := nullif(trim(coalesce(v_step.chain_group, '')), '');
  if v_grp is not null then
    select s.title into v_blocking
    from public.team_routes tr
    join public.steps s on s.id = tr.step_id
    where tr.team_id = v_team.id and tr.skipped and tr.redeemed_at is null
      and nullif(trim(coalesce(s.chain_group, '')), '') = v_grp
      and tr.position < v_route.position
      and coalesce((s.content->>'redeemable')::boolean, s.type = 'minigame')
    order by tr.position limit 1;
    if found then
      return jsonb_build_object('ok', false, 'error', 'GROUPE_ORDRE', 'blocking_title', v_blocking);
    end if;
  end if;

  if v_step.type = 'text' then
    v_ok := exists (
      select 1 from unnest(coalesce(v_secret.answers, '{}')) a
      where public.normalize_answer(a) <> ''
        and public.normalize_answer(a) = public.normalize_answer(p_payload->>'answer')
    );
  elsif v_step.type = 'nfc' then
    v_submitted := regexp_replace(trim(coalesce(p_payload->>'tag', '')), '^https?://[^/]+/t/', '');
    v_ok := (v_secret.nfc_tag_id is not null and v_submitted = v_secret.nfc_tag_id)
         or (v_secret.manual_code is not null and upper(v_submitted) = upper(v_secret.manual_code));
  elsif v_step.type = 'gps' then
    if v_secret.gps_lat is not null and v_secret.gps_lng is not null
       and (p_payload->>'lat') is not null and (p_payload->>'lng') is not null then
      v_dist := public.gps_distance_m(
        (p_payload->>'lat')::double precision, (p_payload->>'lng')::double precision,
        v_secret.gps_lat, v_secret.gps_lng);
      v_ok := v_dist <= coalesce(v_secret.gps_radius_m, 30);
    end if;
  elsif v_step.type = 'minigame' then
    if public.minigame_needs_answer(v_step)
       and coalesce(array_length(v_secret.answers, 1), 0) > 0 then
      v_ok := exists (
        select 1 from unnest(v_secret.answers) a
        where public.normalize_answer(a) <> ''
          and public.normalize_answer(a) = public.normalize_answer(p_payload->>'answer')
      );
    else
      v_ok := true;
    end if;
  elsif v_step.type = 'photo' then
    -- La photo part en revue organisateur, comme sur l'épreuve normale
    -- (refusée = 0 point sur l'étape, get_ranking s'en charge déjà).
    if p_payload->>'url' is null or (p_payload->>'url') !~ '^https?://' then
      return jsonb_build_object('ok', false, 'error', 'URL_INVALIDE');
    end if;
    insert into public.submissions (game_id, team_id, step_id, url)
    values (v_game.id, v_team.id, p_step_id, p_payload->>'url');
    insert into public.events (game_id, team_id, type, payload)
    values (v_game.id, v_team.id, 'photo_submitted',
            jsonb_build_object('step_id', p_step_id, 'step_title', v_step.title,
                               'url', p_payload->>'url', 'redeem', true));
    v_ok := true;
  end if;

  if not v_ok then
    v_result := jsonb_build_object('ok', true, 'correct', false);
    if v_step.type = 'gps' and v_dist is not null
       and coalesce(v_step.content->>'gps_guidance', 'compass') <> 'none' then
      v_result := v_result || jsonb_build_object('distance_m', round(v_dist));
    end if;
    insert into public.events (game_id, team_id, type, payload, idem_key)
    values (v_game.id, v_team.id, 'wrong_answer',
            jsonb_build_object('step_id', p_step_id, 'kind', 'redeem',
                               'step_title', v_step.title, 'result', v_result), p_idem_key);
    return v_result;
  end if;

  -- Rattrapée ! La pénalité du skip saute : temps rendu ici, points recomptés
  -- par get_ranking (`skipped` reste vrai comme trace historique).
  update public.team_routes set redeemed_at = now() where id = v_route.id;
  if coalesce(v_game.settings->>'scoring', 'time') = 'time' then
    -- On retire exactement la pénalité appliquée au skip (par étape ou globale)
    -- — PAS de plancher à 0 : une pénalité négative est un bonus temps légitime.
    update public.teams
    set penalty_seconds = penalty_seconds - coalesce((v_step.content->>'skip_penalty_sec')::int,
                                                     (v_game.settings->>'skip_penalty_sec')::int, 180)
    where id = v_team.id;
  end if;
  if v_step.type = 'minigame' then
    insert into public.minigame_results (game_id, team_id, step_id, score, duration_ms)
    values (v_game.id, v_team.id, p_step_id,
            nullif(p_payload->>'score', '')::numeric, nullif(p_payload->>'duration_ms', '')::int)
    on conflict (team_id, step_id) do nothing;
  end if;

  v_result := jsonb_build_object('ok', true, 'correct', true);
  insert into public.events (game_id, team_id, type, payload, idem_key)
  values (v_game.id, v_team.id, 'step_redeemed',
          jsonb_build_object('step_id', p_step_id, 'step_title', v_step.title,
                             'step_type', v_step.type, 'result', v_result), p_idem_key);
  return v_result;
end $$;

-- Compat ancien client : le rattrapage mini-jeu délègue au rattrapage générique.
create or replace function public.redeem_minigame(p_idem_key uuid, p_step_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
begin
  return public.redeem_step(p_idem_key, p_step_id, p_payload);
end $$;

-- Timer d'étape expiré : passage sans pénalité (0 point sur l'étape).
create or replace function public.skip_step_timeout(p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_team   public.teams%rowtype;
  v_game   public.games%rowtype;
  v_route  public.team_routes%rowtype;
  v_step   public.steps%rowtype;
  v_next   public.team_routes%rowtype;
  v_started timestamptz;
  v_finished boolean := false;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT'); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;
  if v_game.status <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'PARTIE_NON_ACTIVE');
  end if;

  select * into v_route from public.team_routes
  where team_id = v_team.id and step_id = p_step_id and status = 'current' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ETAPE_INVALIDE'); end if;

  select * into v_step from public.steps where id = p_step_id;
  if v_step.time_limit_sec is null then
    return jsonb_build_object('ok', false, 'error', 'PAS_DE_TIMER');
  end if;

  v_started := coalesce(
    (select max(validated_at) from public.team_routes
     where team_id = v_team.id),
    v_team.started_at, v_game.started_at, now());
  if extract(epoch from (now() - v_started))
     - public.paused_ms_since(v_game.id, v_started) / 1000.0 < v_step.time_limit_sec then
    return jsonb_build_object('ok', false, 'error', 'TIMER_PAS_ECOULE');
  end if;

  update public.team_routes set status = 'done', validated_at = now(), timed_out = true
  where id = v_route.id;

  v_next := public.next_route_for(v_team.id);
  if v_next.id is not null then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    v_finished := true;
    update public.teams
    set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team.id)
    where id = v_team.id and finished_at is null;
    insert into public.events (game_id, team_id, type)
    values (v_game.id, v_team.id, 'team_finished');
  end if;

  insert into public.events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'step_timeout',
          jsonb_build_object('step_id', p_step_id, 'step_title', v_step.title));

  return jsonb_build_object('ok', true, 'finished', v_finished);
end $$;

-- Message d'une équipe au maître du jeu (affiché en priorité dans le journal).
-- La note d'expérience, de 1 à 5 étoiles, à la fin du parcours.
--
-- Elle se REPOSE : quelqu'un qui touche trois étoiles puis change d'avis doit
-- pouvoir corriger. Une note qu'on ne peut donner qu'une fois se donne mal.
--
-- Aucune condition d'arrivée : une équipe qui abandonne à mi-parcours est
-- justement celle dont l'avis manque le plus, et c'est l'écran qui choisit
-- quand poser la question.
create or replace function public.rate_experience(p_rating int)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'NOTE_INVALIDE';
  end if;
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then raise exception 'NON_INSCRIT'; end if;
  update public.players
  set rating = p_rating, rated_at = now()
  where id = v_player.id;
end $$;

-- Les notes d'une partie, pour l'organisateur : moyenne, compte, et le détail
-- par étoile. La moyenne seule ment — 1 et 5 font 3, comme 3 et 3.
create or replace function public.get_ratings(p_game_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_count int;
  v_avg   numeric;
  v_dist  jsonb;
begin
  -- Les invités y ont droit : les étoiles sont la première chose qu'on leur
  -- ouvre. `can_read_game` et non `is_game_owner`.
  if not public.can_read_game(p_game_id) then raise exception 'NON_AUTORISE'; end if;
  select count(*), round(avg(rating)::numeric, 2)
    into v_count, v_avg
    from public.players
   where game_id = p_game_id and rating is not null;
  select coalesce(jsonb_object_agg(note, n), '{}'::jsonb)
    into v_dist
    from (select rating::text as note, count(*) as n
            from public.players
           where game_id = p_game_id and rating is not null
           group by rating) g;
  return jsonb_build_object('count', v_count, 'average', v_avg, 'distribution', v_dist);
end $$;

create or replace function public.send_team_message(p_message text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then raise exception 'NON_INSCRIT'; end if;
  if p_message is null or length(trim(p_message)) = 0 then raise exception 'MESSAGE_VIDE'; end if;
  insert into public.events (game_id, team_id, type, payload)
  values (v_player.game_id, v_player.team_id, 'team_message',
          jsonb_build_object('message', left(trim(p_message), 300), 'nickname', v_player.nickname));
end $$;

-- Balise cassée / lieu inaccessible : l'étape est validée pour TOUTES les équipes.
create or replace function public.org_neutralize_step(p_game_id uuid, p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_route public.team_routes%rowtype;
  v_next  public.team_routes%rowtype;
  v_count int := 0;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.created_by <> auth.uid() then raise exception 'INTERDIT'; end if;
  if v_game.status not in ('running','paused') then raise exception 'PARTIE_NON_ACTIVE'; end if;

  for v_route in
    select * from public.team_routes
    where game_id = p_game_id and step_id = p_step_id and status <> 'done'
    for update
  loop
    update public.team_routes set status = 'done', validated_at = now()
    where id = v_route.id;
    v_count := v_count + 1;

    if v_route.status = 'current' then
      v_next := public.next_route_for(v_route.team_id);
      if v_next.id is not null then
        update public.team_routes set status = 'current' where id = v_next.id;
      else
        update public.teams
        set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_route.team_id)
        where id = v_route.team_id and finished_at is null;
        insert into public.events (game_id, team_id, type)
        values (p_game_id, v_route.team_id, 'team_finished');
      end if;
    end if;
  end loop;

  insert into public.events (game_id, type, payload)
  values (p_game_id, 'step_neutralized',
          jsonb_build_object('step_id', p_step_id,
                             'step_title', (select title from public.steps where id = p_step_id),
                             'teams_affected', v_count));

  return jsonb_build_object('ok', true, 'teams_affected', v_count);
end $$;

-- Retire une étape du parcours — y compris pendant que la journée tourne.
--
-- Une chasse en continu n'a pas de fenêtre d'édition : la partie ouvre le
-- matin et ne se referme que le soir. L'organisateur DOIT pouvoir corriger un
-- parcours en cours de route (une balise arrachée, une énigme illisible).
--
-- Le danger n'est pas la suppression, c'est le vide qu'elle laisse : les
-- team_routes tombent en cascade, et une équipe dont l'étape COURANTE
-- disparaît se retrouve sans rien à faire, écran figé, sans le moindre
-- message. On la fait donc avancer d'abord — même logique que la
-- neutralisation d'une balise cassée.
--
-- Les équipes déjà passées gardent leur temps : le tour est joué, la valider
-- ou la supprimer ne change rien à ce qu'elles ont vécu.
create or replace function public.org_delete_step(p_step_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game    public.games%rowtype;
  v_title   text;
  v_teams   uuid[];
  v_team_id uuid;
  v_next    public.team_routes%rowtype;
begin
  select title into v_title from public.steps where id = p_step_id;
  if not found then raise exception 'ETAPE_INTROUVABLE'; end if;
  select g.* into v_game from public.games g
  join public.steps s on s.game_id = g.id where s.id = p_step_id;
  if v_game.created_by <> auth.uid() then raise exception 'INTERDIT'; end if;

  -- Les équipes qui sont DESSUS en ce moment : ce sont les seules à secourir.
  select coalesce(array_agg(distinct team_id), '{}') into v_teams
  from public.team_routes
  where step_id = p_step_id and status = 'current';

  delete from public.steps where id = p_step_id;   -- cascade sur team_routes

  foreach v_team_id in array v_teams loop
    v_next := public.next_route_for(v_team_id);
    if v_next.id is not null then
      update public.team_routes set status = 'current' where id = v_next.id;
    else
      -- Plus rien à jouer : c'était la dernière. L'équipe a fini sa journée.
      update public.teams
      set finished_at = now(), final_time_ms = public.team_elapsed_ms(v_team_id)
      where id = v_team_id and finished_at is null;
      insert into public.events (game_id, team_id, type)
      values (v_game.id, v_team_id, 'team_finished');
    end if;
  end loop;

  insert into public.events (game_id, type, payload)
  values (v_game.id, 'step_deleted',
          jsonb_build_object('step_title', v_title,
                             'teams_affected', coalesce(array_length(v_teams, 1), 0)));

  return jsonb_build_object('ok', true,
                            'teams_affected', coalesce(array_length(v_teams, 1), 0));
end $$;

-- FERMETURE AUTOMATIQUE — OPTIONNELLE, et éteinte par défaut.
--
-- Une chasse tourne jusqu'à ce que l'organisateur la coupe. Cette fonction ne
-- touche donc QUE les parties dont l'organisateur a EXPLICITEMENT demandé la
-- fermeture du soir (`settings.auto_close`) — typiquement un jeu en continu
-- ouvert au public, que personne ne pense à fermer à l'heure.
--
-- Rien de temporel ne ferme une partie autrement. En particulier, la règle
-- « ouverte un jour antérieur » ne s'applique qu'à l'intérieur de ce réglage,
-- où elle sert de rattrapage quand le cron a sauté une nuit — jamais comme
-- péremption d'une chasse qu'on voulait laisser courir un mois.
--
-- Appelée une fois par jour depuis /api/cron/close-day (clé service_role).
-- Idempotente : rappelée dix fois, elle ne ferme que ce qui doit l'être.
--
-- Les équipes encore en route ne sont PAS marquées arrivées : elles n'ont pas
-- fini. Elles restent au classement avec leur progression, ce qui est la
-- vérité de leur partie.
create or replace function public.close_expired_games()
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game   public.games%rowtype;
  v_heure  int;
  v_closed jsonb := '[]'::jsonb;
begin
  for v_game in
    select * from public.games
    where status in ('running', 'paused')
      -- Le réglage est le seul déclencheur. Absent = la partie court.
      and coalesce((settings->>'auto_close')::boolean, false)
      and started_at is not null
    for update
  loop
    -- L'heure se lit dans le fuseau posé par l'éditeur (celui du navigateur
    -- de l'organisateur) : voir auto_close_due, qui sert aussi aux départs.
    v_heure := coalesce(floor(nullif(v_game.settings->>'close_hour', '')::numeric)::int, 19);

    if public.auto_close_due(v_game) then
      -- Même comptabilité de pause que la fermeture manuelle : une partie
      -- fermée pendant une pause ne doit pas laisser la pause dans le temps
      -- des équipes encore en course.
      if v_game.paused_at is not null then
        update public.teams
        set paused_total_ms = paused_total_ms + coalesce(
              (extract(epoch from (now() - v_game.paused_at)) * 1000)::bigint, 0)
        where game_id = v_game.id and finished_at is null
          and started_at is not null and started_at <= v_game.paused_at;
      end if;

      update public.games
      set status = 'finished', finished_at = now(),
          paused_total_ms = paused_total_ms + case when paused_at is not null
            then coalesce((extract(epoch from (now() - paused_at)) * 1000)::bigint, 0) else 0 end,
          paused_at = null
      where id = v_game.id;

      insert into public.events (game_id, type, payload)
      values (v_game.id, 'game_finished', jsonb_build_object('auto', true, 'close_hour', v_heure));

      v_closed := v_closed || jsonb_build_object('id', v_game.id, 'code', v_game.code);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'closed', v_closed);
end $$;

-- Jamais appelable par un joueur ni par l'organisateur depuis le navigateur :
-- elle ferme des parties. Seule la clé service_role (le cron) y accède.
revoke all on function public.close_expired_games() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Permissions d'exécution : session requise (anonyme ou non), rien pour anon pur.
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'org_create_game(text,jsonb)', 'org_duplicate_game(uuid)', 'start_game(uuid)',
    'org_set_status(uuid,text)', 'org_force_validate(uuid,uuid)', 'org_send_hint(uuid,text)',
    'org_broadcast(uuid,text,text)',
    'org_rename_team(uuid,text)', 'org_delete_team(uuid)', 'org_review_photo(uuid,boolean)',
    'org_set_photo_winner(uuid)', 'org_neutralize_step(uuid,uuid)',
    'org_delete_step(uuid)', 'get_ratings(uuid)',
    'org_add_staff(uuid,text)', 'org_remove_staff(uuid,text)',
    'org_award_bonus(uuid,int,int,text)', 'org_revoke_bonus(bigint)',
    'get_lobby(text)', 'create_team(text,text,text,text[],text)', 'join_team(text,uuid,text)',
    'start_team()',
    'join_by_team_code(text,text,text)', 'get_play_state()', 'get_next_media()', 'get_ranking(text)',
    'validate_step(uuid,uuid,text,jsonb)', 'validate_tag(uuid,text)', 'unlock_hint(uuid,int)',
    'skip_minigame(uuid)', 'skip_step(uuid)', 'redeem_minigame(uuid,uuid,jsonb)',
    'redeem_step(uuid,uuid,jsonb)', 'skip_step_timeout(uuid)',
    'send_team_message(text)', 'rate_experience(int)',
    'report_position(double precision,double precision)', 'submit_photo(uuid,text)',
    'submit_bonus_answer(uuid,text)', 'org_review_answer(uuid,boolean)',
    'gps_ping(uuid,double precision,double precision)',
    'save_push_subscription(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Storage : bucket public "media".
-- NOTE : pas de policy sur storage.objects ici — Supabase n'autorise plus leur
-- création via SQL. Les uploads passent par /api/upload-url (URL signée générée
-- côté serveur avec la clé service_role, après vérification que le caller est
-- bien l'organisateur de la partie). La lecture se fait via les URLs publiques.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/*', 'video/*', 'audio/*'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['image/*', 'video/*', 'audio/*'];

-- ----------------------------------------------------------------------------
-- Realtime : publication des tables suivies en live
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.teams;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.team_routes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Recharge le cache de schéma de l'API (PostgREST) : sans ça, les nouvelles
-- colonnes/fonctions peuvent rester invisibles pour l'app plusieurs minutes
-- après l'exécution du script (« … in the schema cache »).
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- FIN — Pense aussi à activer "Allow anonymous sign-ins"
-- (Dashboard → Authentication → Sign In / Up) pour les joueurs.
-- ============================================================================
