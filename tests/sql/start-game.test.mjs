/**
 * Départ groupé (mode par défaut de TOYAH) — la refonte de start_game en
 * build_team_route ne doit rien changer pour les équipes qui partent ensemble.
 * Et le jeu en continu (`settings.continuous`) ne s'allume que sur demande.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/** Une partie avec `pool` énigmes libres, `equipes` équipes dans le lobby. */
async function lobby(pool, equipes, settings = {}) {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,$2::jsonb)`,
    ["Départ groupé", JSON.stringify(settings)]);
  for (let i = 0; i < pool; i++) {
    await rows(`insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,$3)`,
      [game.id, `Énigme ${i + 1}`, i + 1]);
  }
  const teams = [];
  for (let i = 0; i < equipes; i++) {
    const uid = await newUser();
    await as(uid);
    teams.push((await rows(`select public.create_team($1,$2,$3) as r`,
      [game.code, `Équipe ${i + 1}`, `Joueur ${i + 1}`]))[0].r);
  }
  await as(org);
  return { rows, as, newUser, org, game, teams };
}

test("start_game distribue toutes les équipes d'un coup", async () => {
  const { rows, game, teams } = await lobby(6, 4);
  const res = (await rows(`select public.start_game($1) as r`, [game.id]))[0].r;
  assert.equal(res.teams, 4);

  for (const t of teams) {
    const n = Number((await rows(`select count(*) as n from public.team_routes where team_id = $1`,
      [t.team_id]))[0].n);
    assert.equal(n, 6, "chaque équipe parcourt tout le pool");
  }
  const partis = Number((await rows(
    `select count(*) as n from public.teams where game_id = $1 and started_at is not null`, [game.id]
  ))[0].n);
  assert.equal(partis, 4, "toutes partent avec la partie");
});

test("carré latin : jamais deux équipes sur la même énigme au même rang", async () => {
  const { rows, game } = await lobby(6, 4);
  await rows(`select public.start_game($1)`, [game.id]);
  const routes = await rows(
    `select team_id, position, step_id from public.team_routes where game_id = $1`, [game.id]
  );
  const parRang = new Map();
  for (const r of routes) {
    const clef = `${r.position}:${r.step_id}`;
    assert.ok(!parRang.has(clef), `collision au rang ${r.position}`);
    parRang.set(clef, r.team_id);
  }
});

test("départ groupé : un pool plus petit que le nombre d'équipes est refusé", async () => {
  const { rows, game } = await lobby(2, 4);
  await assert.rejects(() => rows(`select public.start_game($1)`, [game.id]), /POOL_TROP_PETIT/);
});

test("jeu en continu : un pool trop petit n'empêche pas d'ouvrir", async () => {
  const { rows, game, teams } = await lobby(2, 4, { continuous: true });
  const res = (await rows(`select public.start_game($1) as r`, [game.id]))[0].r;
  assert.equal(res.teams, 4, "la partie ouvre quand même");
  for (const t of teams) {
    const n = Number((await rows(`select count(*) as n from public.team_routes where team_id = $1`,
      [t.team_id]))[0].n);
    assert.equal(n, 2, "chaque équipe reçoit tout le pool, quitte à croiser une autre");
  }
});

test("départ groupé : ouvrir sans aucune équipe est refusé", async () => {
  const { rows, game } = await lobby(4, 0);
  await assert.rejects(() => rows(`select public.start_game($1)`, [game.id]), /AUCUNE_EQUIPE/);
});

test("jeu en continu : la partie peut ouvrir sans aucune équipe", async () => {
  const { rows, game } = await lobby(4, 0, { continuous: true });
  const res = (await rows(`select public.start_game($1) as r`, [game.id]))[0].r;
  assert.equal(res.ok, true);
  assert.equal(res.teams, 0);
});

test("départ groupé : les inscriptions ferment au lancement", async () => {
  const { rows, as, newUser, game } = await lobby(4, 2);
  await rows(`select public.start_game($1)`, [game.id]);
  await as(await newUser());
  await assert.rejects(
    () => rows(`select public.create_team($1,$2,$3)`, [game.code, "Les Retardataires", "Léo"]),
    /PARTIE_DEJA_LANCEE/
  );
});

test("jeu en continu : on s'inscrit et on part pendant que la partie tourne", async () => {
  const { rows, as, newUser, game } = await lobby(4, 2, { continuous: true });
  await rows(`select public.start_game($1)`, [game.id]);
  const uid = await newUser();
  await as(uid);
  const team = (await rows(`select public.create_team($1,$2,$3) as r`,
    [game.code, "Les Retardataires", "Léo"]))[0].r;
  const avant = (await rows(`select started_at from public.teams where id = $1`, [team.team_id]))[0];
  assert.equal(avant.started_at, null, "inscrite, pas encore partie");
  const res = (await rows(`select public.start_team() as r`))[0].r;
  assert.equal(res.ok, true);
  const n = Number((await rows(`select count(*) as n from public.team_routes where team_id = $1`,
    [team.team_id]))[0].n);
  assert.equal(n, 4, "son parcours naît à son départ");
});

test("une partie sans étape est refusée", async () => {
  const { rows, game } = await lobby(0, 2);
  await assert.rejects(() => rows(`select public.start_game($1)`, [game.id]), /AUCUNE_ETAPE/);
});

test("relancer une partie déjà lancée est refusé", async () => {
  const { rows, game } = await lobby(4, 2);
  await rows(`select public.start_game($1)`, [game.id]);
  await assert.rejects(() => rows(`select public.start_game($1)`, [game.id]), /PARTIE_DEJA_LANCEE/);
});

test("les fabriques de parcours ne sont pas exposées aux joueurs", async () => {
  const { rows } = await lobby(4, 2);
  // PGlite exécute tout en propriétaire : on vérifie donc les droits dans le
  // catalogue, pas en tentant l'appel (qui passerait ici mais pas sur Supabase).
  for (const f of ["public.build_team_route(uuid,int)", "public.game_route_perm(uuid,int)",
                   "public.next_route_for(uuid)", "public.team_elapsed_ms(uuid)"]) {
    for (const role of ["anon", "authenticated"]) {
      const [r] = await rows(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f]);
      assert.equal(r.ok, false, `${role} ne doit pas pouvoir exécuter ${f}`);
    }
  }
  // …alors que celles du jeu, si.
  const [r] = await rows(
    `select has_function_privilege('authenticated', 'public.start_team()', 'execute') as ok`
  );
  assert.equal(r.ok, true);
});
