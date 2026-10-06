/**
 * Applique supabase/setup.sql dans un Postgres embarqué (PGlite) : le schéma
 * complet, les 40 fonctions et la RLS, sans base distante ni Docker.
 *
 * Ce qui est simulé ici est ce que Supabase fournit et que PGlite n'a pas :
 * le schéma `auth` (dont auth.uid(), pilotée par un réglage de session), les
 * rôles anon/authenticated, le bucket de stockage et la publication realtime.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const STUBS = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('test.uid', true), '')::uuid
$fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb)
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated')
$fn$;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
-- unaccent est une extension Supabase : sur des réponses déjà normalisées
-- côté client, l'identité suffit pour ce que testent ces scénarios.
create or replace function extensions.unaccent(text) returns text language sql immutable as $fn$
  select $1
$fn$;
`;

/** Le schéma tel qu'on le colle dans le SQL Editor de Supabase. */
const schema = () =>
  readFileSync(join(ROOT, "supabase", "setup.sql"), "utf8")
    // PGlite n'embarque pas unaccent : le stub ci-dessus en tient lieu.
    .replace(/create extension if not exists unaccent[^;]*;/g, "");

/** Une base neuve avec le schéma appliqué, plus quelques raccourcis de test. */
export async function freshDb() {
  const db = await PGlite.create();
  await db.exec(STUBS);
  await db.exec(schema());

  // Les droits de table que Supabase pose lui-même sur le schéma `public` :
  // `anon` et `authenticated` peuvent tout tenter, et ce sont les POLITIQUES
  // qui décident. Sans eux, impossible de prendre le rôle `authenticated` dans
  // un test — et donc impossible d'exercer la RLS.
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
  `);

  /** Lignes d'une requête. */
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  /**
   * Qui appelle : un identifiant, ou `{ uid, email }`.
   *
   * L'ADRESSE compte depuis les organisateurs invités : `is_game_staff` lit
   * `auth.jwt()->>'email'`, pas l'identifiant. Un visiteur en session anonyme
   * n'en a aucune, et c'est précisément ce qui l'empêche d'être pris pour du
   * personnel — un test sans e-mail exerce donc bien ce cas-là.
   */
  const qui = (v) => (typeof v === "object" && v !== null ? v : { uid: v, email: null });
  const poser = (v) => {
    const { uid, email } = qui(v);
    return db.query(
      `select set_config('test.uid', $1, false), set_config('test.jwt', $2, false)`,
      [uid ?? "", email ? JSON.stringify({ email }) : ""]
    );
  };

  /** Se faire passer pour cet utilisateur (ce que renvoie auth.uid()). */
  const as = poser;
  /** Une valeur scalaire. */
  const one = async (sql, params) => Object.values((await rows(sql, params))[0])[0];
  /**
   * Une lecture SOUS LA RLS, comme la ferait un navigateur.
   *
   * `as()` ne change que ce que rend `auth.uid()` : les requêtes continuent de
   * tourner en superutilisateur, qui CONTOURNE la RLS. C'est sans conséquence
   * pour la plupart des scénarios — ils passent par des fonctions
   * `security definer` qui portent leurs propres contrôles — mais ça veut dire
   * qu'une politique fausse ne se verrait pas.
   *
   * Ici on prend vraiment le rôle `authenticated`, donc les politiques
   * s'appliquent. À utiliser dès qu'on teste QUI A LE DROIT DE LIRE quoi.
   */
  const sousRls = async (uid, fn) => {
    await poser(uid);
    await db.exec(`set role authenticated`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role`);
    }
  };

  /** Un compte utilisateur (organisateur ou visiteur). */
  const newUser = async () =>
    (await rows(`insert into auth.users default values returning id`))[0].id;

  /**
   * Ré-applique setup.sql sur la base EXISTANTE — ce que fait l'organisateur
   * à chaque mise à jour, parties en cours comprises. Sert à prouver qu'une
   * migration laisse intactes les données d'avant.
   */
  const reappliquer = () => db.exec(schema());

  return { db, rows, one, as, sousRls, newUser, reappliquer };
}

/** Millisecondes → minutes arrondies : les scénarios raisonnent en minutes. */
export const minutes = (ms) => Math.round(Number(ms) / 60000);
