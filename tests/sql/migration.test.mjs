/**
 * Ré-appliquer setup.sql PENDANT une partie — ce que fait l'organisateur à
 * chaque mise à jour, sans forcément attendre la fin de ses chasses.
 *
 * Le chrono par équipe a ajouté `teams.started_at`. Une partie lancée avant
 * cette colonne a des équipes en route, avec un parcours, mais sans départ
 * inscrit. Il ne faut ni les renvoyer au lobby, ni — surtout — refaire leur
 * parcours : `build_team_route` efface d'abord l'existant, et l'équipe
 * repartirait de zéro en pleine chasse.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/**
 * Une partie classique lancée depuis une heure, dont les équipes ressemblent
 * à celles d'avant la colonne : un parcours, une étape déjà faite pour la
 * première, mais ni départ propre ni pauses à elles.
 */
async function partieDAvant() {
  const ctx = await freshDb();
  const { rows, as, newUser } = ctx;
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,'{}'::jsonb)`, [
    "Chasse d'avant la mise à jour",
  ]);
  for (let i = 0; i < 3; i++) {
    await rows(
      `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,$3)`,
      [game.id, `Énigme ${i + 1}`, i + 1]
    );
  }
  const joueurs = [];
  for (const nom of ["Les Corsaires", "Les Flibustiers"]) {
    const uid = await newUser();
    await as(uid);
    const r = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, nom, nom]))[0].r;
    joueurs.push({ uid, ...r });
  }
  await as(org);
  await rows(`select public.start_game($1)`, [game.id]);

  // La progression à préserver : la première équipe a fait sa première étape.
  await rows(
    `with r as (
       select id, row_number() over (order by position) as n
       from public.team_routes where team_id = $1
     )
     update public.team_routes tr
     set status = case r.n when 1 then 'done'::public.route_status
                           else 'current'::public.route_status end,
         validated_at = case r.n when 1 then now() else null end
     from r where tr.id = r.id and r.n <= 2`,
    [joueurs[0].team_id]
  );

  // Ce qu'en voit la base juste après l'ajout de la colonne : elle est là,
  // vide. La partie, elle, tourne depuis une heure et a connu 90 s de pause.
  await rows(
    `update public.games set started_at = now() - interval '1 hour', paused_total_ms = 90000
     where id = $1`,
    [game.id]
  );
  await rows(`update public.teams set started_at = null, paused_total_ms = 0 where game_id = $1`, [
    game.id,
  ]);
  return { ...ctx, org, game, joueurs };
}

const parcours = (rows, teamId) =>
  rows(`select id, status from public.team_routes where team_id = $1 order by position`, [teamId]);

test("ré-appliquer le SQL rend leur départ aux équipes d'une partie en cours", async () => {
  const { rows, reappliquer, game, joueurs } = await partieDAvant();
  const avant = await Promise.all(
    joueurs.map(async (j) => Number((await rows(`select public.team_elapsed_ms($1) as ms`, [j.team_id]))[0].ms))
  );

  await reappliquer();

  const [g] = await rows(`select started_at from public.games where id = $1`, [game.id]);
  for (const [i, j] of joueurs.entries()) {
    const [t] = await rows(`select started_at, paused_total_ms from public.teams where id = $1`, [
      j.team_id,
    ]);
    assert.ok(t.started_at != null, `${j.team_id} : départ rattrapé`);
    assert.equal(t.started_at.getTime(), g.started_at.getTime(), "parties avec la partie");
    assert.equal(Number(t.paused_total_ms), 90000, "les pauses déjà subies restent déduites");
    const apres = Number((await rows(`select public.team_elapsed_ms($1) as ms`, [j.team_id]))[0].ms);
    assert.ok(Math.abs(apres - avant[i]) < 5000, "le chrono n'a pas bougé");
  }
});

test("« Partir » sur une équipe déjà en route ne refait pas son parcours", async () => {
  // Le scénario qui effaçait une progression : l'écran de jeu voit un départ
  // vide, renvoie au lobby, et le lobby propose « PARTIR MAINTENANT ».
  const { rows, as, game, joueurs } = await partieDAvant();
  const [a] = joueurs;
  const avant = await parcours(rows, a.team_id);
  assert.equal(avant[0].status, "done");

  await as(a.uid);
  const res = (await rows(`select public.start_team() as r`))[0].r;
  assert.equal(res.already, true, "l'équipe était déjà partie");

  assert.deepEqual(await parcours(rows, a.team_id), avant, "même parcours, même progression");
  const [t] = await rows(`select started_at from public.teams where id = $1`, [a.team_id]);
  const [g] = await rows(`select started_at from public.games where id = $1`, [game.id]);
  assert.equal(t.started_at.getTime(), g.started_at.getTime(), "son départ est celui de la partie");
});

test("au classement, une équipe d'avant la colonne garde son temps de course", async () => {
  const { rows, game, joueurs } = await partieDAvant();
  const r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  for (const j of joueurs) {
    const ligne = r.teams.find((t) => t.id === j.team_id);
    assert.ok(ligne.elapsed_ms != null, "elle a un parcours : elle est partie");
    assert.ok(ligne.elapsed_ms > 50 * 60000, "environ une heure de course");
  }
});

test("le rattrapage ne touche pas une équipe qui n'est pas encore partie", async () => {
  const { rows, as, newUser, reappliquer, org } = await partieDAvant();
  await as(org);
  const [autre] = await rows(`select * from public.org_create_game($1,'{"continuous":true}'::jsonb)`, [
    "Journée continue",
  ]);
  await rows(`insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Le phare',1)`, [
    autre.id,
  ]);
  await rows(`select public.start_game($1)`, [autre.id]);
  const uid = await newUser();
  await as(uid);
  const t = (await rows(`select public.create_team($1,'Les Tortues','Simon') as r`, [autre.code]))[0].r;

  await reappliquer();

  const [row] = await rows(`select started_at from public.teams where id = $1`, [t.team_id]);
  assert.equal(row.started_at, null, "pas de parcours, pas de départ : elle attend toujours le sien");
});
