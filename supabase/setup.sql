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
  create type public.step_type as enum ('nfc','text','minigame');
exception when duplicate_object then null; end $$;

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
  finished_at timestamptz
);

create table if not exists public.steps (
  id                   uuid primary key default gen_random_uuid(),
  game_id              uuid not null references public.games(id) on delete cascade,
  type                 public.step_type not null,
  title                text not null,
  content              jsonb not null default '{}'::jsonb,
  media_urls           text[] not null default '{}',
  is_common_checkpoint boolean not null default false,
  is_final             boolean not null default false,
  order_hint           int not null default 0,
  created_at           timestamptz not null default now()
);

-- Secrets d'étape : réponses, identifiants de balise, indices.
-- JAMAIS lisibles par les joueurs (vérifiés uniquement en RPC).
create table if not exists public.step_secrets (
  step_id     uuid primary key references public.steps(id) on delete cascade,
  answers     text[] not null default '{}',
  nfc_tag_id  text,
  manual_code text,
  hints       jsonb not null default '[]'::jsonb  -- [{text, penalty_sec?, unlock_after_sec?}]
);

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

-- Migration pour les bases déjà créées
alter table public.teams add column if not exists roster text[] not null default '{}';

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  nickname   text not null,
  auth_uid   uuid not null unique,
  device_token text,
  created_at timestamptz not null default now()
);

create table if not exists public.team_routes (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  step_id      uuid not null references public.steps(id) on delete cascade,
  position     int not null,
  status       public.route_status not null default 'locked',
  validated_at timestamptz,
  unique (team_id, position),
  unique (team_id, step_id)
);

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games(id) on delete cascade,
  team_id    uuid references public.teams(id) on delete set null,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  idem_key   uuid unique,
  created_at timestamptz not null default now()
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

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.games            enable row level security;
alter table public.steps            enable row level security;
alter table public.step_secrets     enable row level security;
alter table public.teams            enable row level security;
alter table public.players          enable row level security;
alter table public.team_routes      enable row level security;
alter table public.events           enable row level security;
alter table public.minigame_results enable row level security;

-- games
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (created_by = auth.uid() or id = public.my_game_id());

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
    public.is_game_owner(game_id)
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
  using (public.is_game_owner(game_id) or game_id = public.my_game_id());

drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated
  using (public.is_game_owner(game_id))
  with check (public.is_game_owner(game_id));

-- players
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (public.is_game_owner(game_id) or game_id = public.my_game_id());

drop policy if exists players_update_self on public.players;
create policy players_update_self on public.players for update to authenticated
  using (auth_uid = auth.uid());

drop policy if exists players_delete_owner on public.players;
create policy players_delete_owner on public.players for delete to authenticated
  using (public.is_game_owner(game_id));

-- team_routes : lecture par toute la partie (classement live), écriture via RPC only
drop policy if exists routes_select on public.team_routes;
create policy routes_select on public.team_routes for select to authenticated
  using (public.is_game_owner(game_id) or game_id = public.my_game_id());

-- events : organisateur = tout ; joueur = les events de son équipe + globaux
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (
    public.is_game_owner(game_id)
    or (game_id = public.my_game_id() and (team_id = public.my_team_id() or team_id is null))
  );

-- minigame_results
drop policy if exists mg_select on public.minigame_results;
create policy mg_select on public.minigame_results for select to authenticated
  using (public.is_game_owner(game_id) or team_id = public.my_team_id());

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
create or replace function public.start_game(p_game_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_game    public.games%rowtype;
  v_teams   uuid[];
  v_pool    uuid[];
  v_finals  uuid[];
  v_slot    record;
  v_t       int;
  v_n       int;
  v_k       int;
  v_offset  int;
  v_pool_i  int;
  v_pos     int;
  v_step_id uuid;
  v_total_steps int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.created_by <> auth.uid() then
    raise exception 'INTERDIT';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'PARTIE_DEJA_LANCEE';
  end if;

  select coalesce(array_agg(id order by created_at), '{}') into v_teams
  from public.teams where game_id = p_game_id;
  v_t := coalesce(array_length(v_teams, 1), 0);
  if v_t = 0 then
    raise exception 'AUCUNE_EQUIPE';
  end if;

  select count(*) into v_total_steps from public.steps where game_id = p_game_id;
  if v_total_steps = 0 then
    raise exception 'AUCUNE_ETAPE';
  end if;

  -- Ordre canonique du pool, mélangé UNE fois : chaque équipe le parcourt
  -- avec un décalage distinct → jamais deux équipes sur la même énigme au même index.
  select coalesce(array_agg(id order by random()), '{}') into v_pool
  from public.steps
  where game_id = p_game_id and not is_common_checkpoint and not is_final;
  v_n := coalesce(array_length(v_pool, 1), 0);

  if v_n > 0 and v_t > v_n then
    raise exception 'POOL_TROP_PETIT';
  end if;

  select coalesce(array_agg(id order by order_hint, created_at), '{}') into v_finals
  from public.steps where game_id = p_game_id and is_final;

  -- Nettoyage au cas où (relance après erreur)
  delete from public.team_routes where game_id = p_game_id;

  for v_k in 1..v_t loop
    v_offset := case when v_n > 0 then ((v_k - 1) * greatest(1, v_n / v_t)) % v_n else 0 end;
    v_pos := 0;
    v_pool_i := 0;

    for v_slot in
      select id, is_common_checkpoint
      from public.steps
      where game_id = p_game_id and not is_final
      order by order_hint, created_at
    loop
      if v_slot.is_common_checkpoint then
        v_step_id := v_slot.id;  -- palier commun : position fixe pour tous
      else
        v_step_id := v_pool[((v_pool_i + v_offset) % v_n) + 1];
        v_pool_i := v_pool_i + 1;
      end if;
      insert into public.team_routes (game_id, team_id, step_id, position, status)
      values (p_game_id, v_teams[v_k], v_step_id, v_pos,
              case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
      v_pos := v_pos + 1;
    end loop;

    -- Le sprint final : identique pour tous, toujours en dernier,
    -- débloqué seulement quand tout le reste est validé (routes séquentielles).
    if array_length(v_finals, 1) is not null then
      foreach v_step_id in array v_finals loop
        insert into public.team_routes (game_id, team_id, step_id, position, status)
        values (p_game_id, v_teams[v_k], v_step_id, v_pos,
                case when v_pos = 0 then 'current' else 'locked' end::public.route_status);
        v_pos := v_pos + 1;
      end loop;
    end if;
  end loop;

  update public.games set status = 'running', started_at = now() where id = p_game_id;
  insert into public.events (game_id, type, payload)
  values (p_game_id, 'game_started', jsonb_build_object('teams', v_t, 'steps', v_total_steps));

  return jsonb_build_object('ok', true, 'teams', v_t, 'steps', v_total_steps);
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
    update public.games set status = 'paused' where id = p_game_id;
    insert into public.events (game_id, type) values (p_game_id, 'game_paused');
  elsif p_status = 'running' and v_game.status = 'paused' then
    update public.games set status = 'running' where id = p_game_id;
    insert into public.events (game_id, type) values (p_game_id, 'game_resumed');
  elsif p_status = 'finished' and v_game.status in ('running','paused') then
    update public.games set status = 'finished', finished_at = now() where id = p_game_id;
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

  select * into v_next from public.team_routes
  where team_id = p_team_id and status = 'locked' order by position limit 1;
  if found then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    update public.teams set finished_at = now() where id = p_team_id and finished_at is null;
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
                              is_common_checkpoint, is_final, order_hint)
    values (v_new.id, v_step.type, v_step.title, v_step.content, v_step.media_urls,
            v_step.is_common_checkpoint, v_step.is_final, v_step.order_hint)
    returning id into v_new_step_id;

    insert into public.step_secrets (step_id, answers, nfc_tag_id, manual_code, hints)
    select v_new_step_id, s.answers, s.nfc_tag_id, s.manual_code, s.hints
    from public.step_secrets s where s.step_id = v_step.id;
  end loop;

  return v_new;
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
      'players', coalesce((select jsonb_agg(p.nickname order by p.created_at)
                           from public.players p where p.team_id = tm.id), '[]'::jsonb)
    ) as t
    from public.teams tm where tm.game_id = v_game.id
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

-- Crée une équipe et y inscrit le caller (capitaine), avec la liste d'équipage.
drop function if exists public.create_team(text, text, text);
create or replace function public.create_team(
  p_code text, p_team_name text, p_nickname text, p_members text[] default '{}'
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_team  public.teams%rowtype;
  v_count int;
  v_colors constant text[] := array['#C0392B','#F5A623','#2E5E3A','#2980B9','#8E44AD','#D35400','#16A085','#34495E'];
  i int;
begin
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found then raise exception 'PARTIE_INTROUVABLE'; end if;
  if v_game.status <> 'lobby' then raise exception 'PARTIE_DEJA_LANCEE'; end if;
  if p_team_name is null or length(trim(p_team_name)) = 0 then raise exception 'NOM_EQUIPE_REQUIS'; end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then raise exception 'PSEUDO_REQUIS'; end if;

  select count(*) into v_count from public.teams where game_id = v_game.id;
  if (v_game.settings->>'max_teams') is not null
     and v_count >= (v_game.settings->>'max_teams')::int then
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
  values (v_game.id, v_team.id, trim(p_nickname), auth.uid())
  on conflict (auth_uid) do update
    set game_id = excluded.game_id, team_id = excluded.team_id, nickname = excluded.nickname;

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
begin
  select * into v_game from public.games where code = upper(trim(p_code));
  if not found then raise exception 'PARTIE_INTROUVABLE'; end if;
  if v_game.status not in ('lobby','running') then raise exception 'PARTIE_TERMINEE'; end if;
  if p_nickname is null or length(trim(p_nickname)) = 0 then raise exception 'PSEUDO_REQUIS'; end if;

  select * into v_team from public.teams where id = p_team_id and game_id = v_game.id;
  if not found then raise exception 'EQUIPE_INTROUVABLE'; end if;

  select count(*) into v_count from public.players where team_id = v_team.id;
  if (v_game.settings->>'max_players_per_team') is not null
     and v_count >= (v_game.settings->>'max_players_per_team')::int
     and not exists (select 1 from public.players where auth_uid = auth.uid() and team_id = v_team.id) then
    raise exception 'EQUIPE_PLEINE';
  end if;

  insert into public.players (game_id, team_id, nickname, auth_uid)
  values (v_game.id, v_team.id, trim(p_nickname), auth.uid())
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

    v_started := coalesce(
      (select max(validated_at) from public.team_routes
       where team_id = v_team.id and position < v_route.position),
      v_game.started_at, now());
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
          'text', case when v_unlocked then v_h->>'text' else null end
        );
        v_idx := v_idx + 1;
      end loop;
    end if;

    v_current := jsonb_build_object(
      'step', jsonb_build_object(
        'id', v_step.id, 'type', v_step.type, 'title', v_step.title,
        'content', v_step.content, 'media_urls', to_jsonb(v_step.media_urls),
        'is_final', v_step.is_final, 'is_common', v_step.is_common_checkpoint
      ),
      'position', v_route.position,
      'started_at', v_started,
      'hints', v_hints
    );
  end if;

  return jsonb_build_object(
    'game', jsonb_build_object('id', v_game.id, 'code', v_game.code, 'name', v_game.name,
                               'status', v_game.status, 'started_at', v_game.started_at,
                               'finished_at', v_game.finished_at, 'settings', v_game.settings),
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'color', v_team.color,
                               'team_code', v_team.team_code,
                               'penalty_seconds', v_team.penalty_seconds,
                               'finished_at', v_team.finished_at),
    'progress', jsonb_build_object('done', v_done, 'total', v_total),
    'current', v_current,
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
  v_urls text[];
begin
  v_team_id := public.my_team_id();
  if v_team_id is null then return '[]'::jsonb; end if;
  select s.media_urls into v_urls
  from public.team_routes tr
  join public.steps s on s.id = tr.step_id
  where tr.team_id = v_team_id and tr.status = 'locked'
  order by tr.position
  limit 1;
  return coalesce(to_jsonb(v_urls), '[]'::jsonb);
end $$;

-- Validation d'une étape (texte / NFC / QR / code manuel / mini-jeu).
-- Idempotente via p_idem_key → sûre à rejouer depuis la file offline.
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
  elsif v_step.type = 'minigame' then
    if coalesce(array_length(v_secret.answers, 1), 0) > 0 then
      v_submitted := p_payload->>'answer';
      v_ok := exists (
        select 1 from unnest(v_secret.answers) a
        where public.normalize_answer(a) <> '' and public.normalize_answer(a) = public.normalize_answer(v_submitted)
      );
    else
      v_ok := true;  -- mini-jeu auto-validé par sa complétion
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
    insert into public.events (game_id, team_id, type, payload, idem_key)
    values (v_game.id, v_team.id, 'wrong_answer',
            jsonb_build_object('step_id', p_step_id, 'kind', p_kind,
                               'step_title', v_step.title, 'result', v_result),
            p_idem_key);
    return v_result;
  end if;

  update public.team_routes set status = 'done', validated_at = now() where id = v_route.id;

  select * into v_next from public.team_routes
  where team_id = v_team.id and status = 'locked' order by position limit 1;
  if found then
    update public.team_routes set status = 'current' where id = v_next.id;
  else
    v_finished := true;
    update public.teams set finished_at = now() where id = v_team.id and finished_at is null;
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
begin
  select * into v_player from public.players where auth_uid = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NON_INSCRIT');
  end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_game from public.games where id = v_team.game_id;

  select * into v_route from public.team_routes
  where team_id = v_team.id and status = 'current' limit 1;
  if not found then
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
     where team_id = v_team.id and position < v_route.position),
    v_game.started_at, now());
  v_elapsed := extract(epoch from (now() - v_started));
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

-- ----------------------------------------------------------------------------
-- Permissions d'exécution : session requise (anonyme ou non), rien pour anon pur.
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'org_create_game(text,jsonb)', 'org_duplicate_game(uuid)', 'start_game(uuid)',
    'org_set_status(uuid,text)', 'org_force_validate(uuid,uuid)', 'org_send_hint(uuid,text)',
    'get_lobby(text)', 'create_team(text,text,text,text[])', 'join_team(text,uuid,text)',
    'get_play_state()', 'get_next_media()',
    'validate_step(uuid,uuid,text,jsonb)', 'validate_tag(uuid,text)', 'unlock_hint(uuid,int)'
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
values ('media', 'media', true, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['image/*', 'video/*'];

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

-- ============================================================================
-- FIN — Pense aussi à activer "Allow anonymous sign-ins"
-- (Dashboard → Authentication → Sign In / Up) pour les joueurs.
-- ============================================================================
