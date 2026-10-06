/**
 * Chrono par équipe — le cœur du jeu en continu.
 *
 * Une partie = une journée, mais chaque visiteur court SON temps : le premier
 * du matin ne doit pas finir avec huit heures au compteur parce que la partie,
 * elle, a ouvert à l'aube.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, minutes } from "./harness.mjs";

/** Une partie du jour, deux épreuves, deux équipes, parcours distribués. */
async function journee() {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  const visiteur1 = await newUser();
  const visiteur2 = await newUser();

  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, [
    "Journée du 19 août",
  ]);
  for (const [i, titre] of ["Le phare", "La vieille fontaine"].entries()) {
    await rows(
      `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,$3)`,
      [game.id, titre, i]
    );
  }

  await as(visiteur1);
  const matin = (await rows(`select public.create_team($1,$2,$3) as r`, [
    game.code, "Les Corsaires", "Aline",
  ]))[0].r;
  await as(visiteur2);
  const apresMidi = (await rows(`select public.create_team($1,$2,$3) as r`, [
    game.code, "Les Flibustiers", "Simon",
  ]))[0].r;

  await as(org);
  await rows(`select public.start_game($1)`, [game.id]);

  const elapsed = async (id) =>
    Number((await rows(`select public.team_elapsed_ms($1) as ms`, [id]))[0].ms);
  const finir = async (teamId) => {
    const routes = await rows(
      `select step_id from public.team_routes where team_id = $1 order by position`, [teamId]
    );
    for (const r of routes) await rows(`select public.org_force_validate($1,$2)`, [teamId, r.step_id]);
  };

  return { rows, as, org, visiteur1, visiteur2, game, matin, apresMidi, elapsed, finir };
}

test("start_game donne son propre départ à chaque équipe", async () => {
  const { rows, game } = await journee();
  const n = Number((await rows(
    `select count(*) as n from public.teams where game_id = $1 and started_at is not null`,
    [game.id]
  ))[0].n);
  assert.equal(n, 2);
});

test("le chrono part du départ de l'équipe, pas de l'ouverture de la partie", async () => {
  const { rows, game, matin, apresMidi, elapsed } = await journee();
  // La partie a ouvert il y a 8 h. « Les Corsaires » est le visiteur du matin,
  // « Les Flibustiers » vient tout juste d'arriver.
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '8 hours' where id = $1`, [matin.team_id]);
  await rows(`update public.teams set started_at = now() - interval '35 minutes' where id = $1`, [apresMidi.team_id]);

  assert.equal(minutes(await elapsed(matin.team_id)), 480);
  assert.equal(minutes(await elapsed(apresMidi.team_id)), 35);
});

test("le temps figé à l'arrivée est celui de l'équipe", async () => {
  const { rows, game, matin, apresMidi, finir } = await journee();
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '8 hours' where id = $1`, [matin.team_id]);
  await rows(`update public.teams set started_at = now() - interval '35 minutes' where id = $1`, [apresMidi.team_id]);
  await finir(matin.team_id);
  await finir(apresMidi.team_id);

  const temps = Object.fromEntries(
    (await rows(`select name, final_time_ms from public.teams where game_id = $1`, [game.id]))
      .map((t) => [t.name, minutes(t.final_time_ms)])
  );
  assert.equal(temps["Les Corsaires"], 480);
  // Le bug d'origine donnait 480 ici aussi : le chrono partait de la partie.
  assert.equal(temps["Les Flibustiers"], 35);
});

test("le classement du jour départage sur le temps de course", async () => {
  const { rows, game, matin, apresMidi, finir } = await journee();
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '8 hours' where id = $1`, [matin.team_id]);
  await rows(`update public.teams set started_at = now() - interval '35 minutes' where id = $1`, [apresMidi.team_id]);
  await finir(matin.team_id);
  await finir(apresMidi.team_id);

  const ranking = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(ranking.teams[0].name, "Les Flibustiers", "la plus rapide passe devant la plus matinale");
  for (const t of ranking.teams) {
    assert.ok("started_at" in t && "elapsed_ms" in t, "départ et temps courant exposés");
  }
  // La meilleure étape se mesure depuis le départ de l'équipe : depuis celui de
  // la partie, un visiteur de l'après-midi afficherait des heures.
  assert.ok(minutes(ranking.teams[0].fastest_step_ms) <= 35);
});

test("une équipe encore en course est classée sur son temps courant", async () => {
  const { rows, game, matin, apresMidi } = await journee();
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  // Même progression (aucune étape validée), mais l'une court depuis 3 h.
  await rows(`update public.teams set started_at = now() - interval '3 hours' where id = $1`, [matin.team_id]);
  await rows(`update public.teams set started_at = now() - interval '10 minutes' where id = $1`, [apresMidi.team_id]);

  const ranking = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(ranking.teams[0].name, "Les Flibustiers");
  assert.equal(minutes(ranking.teams[0].elapsed_ms), 10);
});

test("get_play_state sert au joueur le chrono de son équipe", async () => {
  const { rows, as, visiteur2, game, apresMidi } = await journee();
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '12 minutes' where id = $1`, [apresMidi.team_id]);

  await as(visiteur2);
  const state = (await rows(`select public.get_play_state() as r`))[0].r;
  assert.equal(minutes(state.team.elapsed_ms), 12);
  assert.ok(state.team.started_at != null);
  // Le chrono de la journée reste servi à part : il n'est plus celui du joueur.
  assert.equal(minutes(state.game.elapsed_ms), 480);
});

test("la pause n'est déduite que des équipes en course pendant qu'elle dure", async () => {
  const { rows, as, org, game, matin, apresMidi, elapsed } = await journee();
  await rows(`update public.games set started_at = now() - interval '1 hour' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '1 hour' where id = $1`, [matin.team_id]);
  // « Les Flibustiers » n'est pas encore partie.
  await rows(`update public.teams set started_at = null where id = $1`, [apresMidi.team_id]);

  await as(org);
  await rows(`select public.org_set_status($1,'paused')`, [game.id]);
  await rows(`update public.games set paused_at = now() - interval '10 minutes' where id = $1`, [game.id]);
  assert.equal(minutes(await elapsed(matin.team_id)), 50, "chrono figé pendant la pause");

  // Elle se lance PENDANT la pause : cette pause-là ne la concerne pas.
  await rows(`update public.teams set started_at = now() - interval '5 minutes' where id = $1`, [apresMidi.team_id]);
  await rows(`select public.org_set_status($1,'running')`, [game.id]);

  const pauses = Object.fromEntries(
    (await rows(`select name, paused_total_ms from public.teams where game_id = $1`, [game.id]))
      .map((t) => [t.name, Number(t.paused_total_ms)])
  );
  assert.equal(minutes(pauses["Les Corsaires"]), 10);
  assert.equal(pauses["Les Flibustiers"], 0);
  assert.equal(minutes(await elapsed(matin.team_id)), 50, "la pause reste déduite après reprise");
  assert.equal(minutes(await elapsed(apresMidi.team_id)), 5);
});

test("sans départ propre, le chrono retombe sur celui de la partie", async () => {
  const { rows, game, matin, elapsed } = await journee();
  // Cas des parties créées avant teams.started_at : le classement reste lisible.
  await rows(`update public.games set started_at = now() - interval '90 minutes' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = null where id = $1`, [matin.team_id]);
  assert.equal(minutes(await elapsed(matin.team_id)), 90);
});

/**
 * Le compte à rebours d'étape, et les indices qui se libèrent avec le temps,
 * partaient du matin de la partie et non du départ de l'équipe. Une équipe
 * lancée l'après-midi arrivait donc sur sa première épreuve avec le chrono
 * déjà expiré et les indices déjà offerts — sans avoir rien fait.
 */
test("le repère de la première étape est le départ de l'équipe, pas l'ouverture de la partie", async () => {
  const { rows, as, visiteur2, game, apresMidi } = await journee();
  // La partie a ouvert il y a huit heures ; l'équipe est partie il y a deux minutes.
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '2 minutes' where id = $1`, [
    apresMidi.team_id,
  ]);

  await as(visiteur2);
  const state = (await rows(`select public.get_play_state() as r`))[0].r;
  const depuis = (Date.now() - Date.parse(state.current.started_at)) / 60000;
  assert.ok(depuis < 5, `l'étape doit dater de 2 minutes, pas de ${Math.round(depuis)} minutes`);
});

test("un indice à délai n'est pas offert d'office à l'équipe de l'après-midi", async () => {
  const { rows, as, visiteur2, game, apresMidi } = await journee();
  const [route] = await rows(
    `select step_id from public.team_routes where team_id = $1 and status = 'current'`,
    [apresMidi.team_id]
  );
  await rows(
    `insert into public.step_secrets (step_id, answers, hints)
     values ($1, array['x'], jsonb_build_array(
       jsonb_build_object('text','Sous le ponton','unlock_after_sec',600,'penalty_sec',180)))
     on conflict (step_id) do update set hints = excluded.hints`,
    [route.step_id]
  );
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '1 minute' where id = $1`, [
    apresMidi.team_id,
  ]);

  await as(visiteur2);
  const res = (await rows(`select public.unlock_hint($1, 0) as r`, [route.step_id]))[0].r;
  assert.equal(res.ok, true);
  assert.equal(res.penalty_sec, 180, "l'indice coûte encore ses minutes : 10 min ne sont pas écoulées");
});

test("le saut automatique sur expiration ne frappe pas une équipe qui vient de partir", async () => {
  const { rows, as, visiteur2, game, apresMidi } = await journee();
  const [route] = await rows(
    `select step_id from public.team_routes where team_id = $1 and status = 'current'`,
    [apresMidi.team_id]
  );
  await rows(`update public.steps set time_limit_sec = 300 where id = $1`, [route.step_id]);
  await rows(`update public.games set started_at = now() - interval '8 hours' where id = $1`, [game.id]);
  await rows(`update public.teams set started_at = now() - interval '1 minute' where id = $1`, [
    apresMidi.team_id,
  ]);

  await as(visiteur2);
  const res = (await rows(`select public.skip_step_timeout($1) as r`, [route.step_id]))[0].r;
  assert.equal(res.ok, false);
  assert.equal(res.error, "TIMER_PAS_ECOULE");
});
