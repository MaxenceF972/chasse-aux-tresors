/**
 * Le sens du parcours, et sa modification en cours de journée.
 *
 * Deux façons de mener la chasse : chacune son ordre (défaut, anti-peloton) ou
 * le même pour toutes (sens de circulation imposé par la visite). Et, dans les
 * deux cas, un parcours qui reste corrigeable pendant que la journée tourne —
 * une chasse en continu n'a pas de fenêtre d'édition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/** Une journée : 1 départ, 5 épreuves au parcours, 1 finale. */
async function journee({ sens } = {}) {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const reglages = JSON.stringify({ continuous: true, ...(sens ? { route_mode: sens } : {}) });
  const [game] = await rows(`select * from public.org_create_game($1,$2::jsonb)`, [
    "Journée type",
    reglages,
  ]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint, is_start)
     values ($1,'text','Le point de départ',0,true)`, [game.id]
  );
  for (let i = 0; i < 5; i++) {
    await rows(
      `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,$3)`,
      [game.id, `Épreuve ${i + 1}`, i + 1]
    );
  }
  await rows(
    `insert into public.steps (game_id, type, title, order_hint, is_final)
     values ($1,'text','Le coffre',99,true)`, [game.id]
  );
  await rows(`select public.start_game($1)`, [game.id]);

  const arrive = async (nom) => {
    const uid = await newUser();
    await as(uid);
    const team = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, nom, nom]))[0].r;
    await rows(`select public.start_team() as r`);
    await as(org);
    return { uid, ...team };
  };

  /** Les titres du parcours d'une équipe, dans l'ordre de jeu. */
  const parcours = async (teamId) =>
    (await rows(
      `select s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
       where tr.team_id = $1 order by tr.position`, [teamId]
    )).map((r) => r.title);

  /** Valide l'étape courante d'une équipe (par la main de l'organisateur : les
   *  étapes sont insérées à cru, elles n'ont pas de réponse à donner). */
  const valide = async (equipe) => {
    await as(org);
    const [cur] = await rows(
      `select step_id from public.team_routes where team_id = $1 and status = 'current'`,
      [equipe.team_id]
    );
    if (cur) {
      await rows(`select public.org_force_validate($1,$2) as r`, [equipe.team_id, cur.step_id]);
    }
  };

  return { rows, as, newUser, org, game, arrive, parcours, valide };
}

test("sens fixe : toutes les équipes reçoivent exactement l'ordre de l'éditeur", async () => {
  const { arrive, parcours } = await journee({ sens: "fixe" });
  const attendu = [
    "Le point de départ",
    "Épreuve 1", "Épreuve 2", "Épreuve 3", "Épreuve 4", "Épreuve 5",
    "Le coffre",
  ];
  for (const nom of ["Les Corsaires", "Les Requins", "Les Tortues"]) {
    const equipe = await arrive(nom);
    assert.deepEqual(await parcours(equipe.team_id), attendu);
  }
});

test("sens fixe : next_route_for ne réoriente jamais — la 2e équipe suit la 1re", async () => {
  const { rows, arrive, valide } = await journee({ sens: "fixe" });
  const a = await arrive("Les Corsaires");
  const b = await arrive("Les Requins");
  await valide(a);
  await valide(b);
  const courantes = await rows(
    `select tr.team_id, s.title from public.team_routes tr
     join public.steps s on s.id = tr.step_id where tr.status = 'current'`
  );
  assert.equal(courantes.length, 2);
  assert.equal(new Set(courantes.map((c) => c.title)).size, 1,
    "le sens imposé assume les embouteillages : les deux équipes sont sur la même épreuve");
  assert.equal(courantes[0].title, "Épreuve 1");
});

test("sens dispersé (défaut) : deux équipes n'attaquent pas le parcours au même endroit", async () => {
  const { arrive, parcours } = await journee();
  const a = await parcours((await arrive("Les Corsaires")).team_id);
  const b = await parcours((await arrive("Les Requins")).team_id);
  assert.equal(a[0], "Le point de départ", "le départ reste commun");
  assert.equal(b[0], "Le point de départ");
  assert.notEqual(a[1], b[1], "mais la première épreuve du parcours diffère");
  assert.equal(a.at(-1), "Le coffre", "et la finale reste en dernier");
});

test("le sens fixe n'efface pas le tirage de la journée : repasser en dispersé le retrouve", async () => {
  const { rows, game, arrive, parcours } = await journee();
  const [avant] = await rows(`select route_perm from public.games where id = $1`, [game.id]);
  await rows(
    `update public.games set settings = settings || '{"route_mode":"fixe"}'::jsonb where id = $1`,
    [game.id]
  );
  await arrive("Les Corsaires");
  const [pendant] = await rows(`select route_perm from public.games where id = $1`, [game.id]);
  assert.deepEqual(pendant.route_perm, avant.route_perm);
  await rows(
    `update public.games set settings = settings || '{"route_mode":"disperse"}'::jsonb where id = $1`,
    [game.id]
  );
  const apres = await parcours((await arrive("Les Requins")).team_id);
  assert.equal(apres.length, 7, "le parcours dispersé se rebâtit normalement");
});

test("une étape s'ajoute pendant que la journée tourne, sans toucher aux équipes parties", async () => {
  const { rows, game, arrive, parcours } = await journee({ sens: "fixe" });
  const tot = await arrive("Les Corsaires");
  const avant = await parcours(tot.team_id);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Épreuve 6',6)`,
    [game.id]
  );
  assert.deepEqual(await parcours(tot.team_id), avant, "l'équipe déjà partie garde son parcours");
  const tard = await arrive("Les Requins");
  assert.ok((await parcours(tard.team_id)).includes("Épreuve 6"),
    "celle qui part ensuite reçoit la nouvelle épreuve");
});

test("supprimer l'étape COURANTE d'une équipe l'envoie à la suivante, sans écran figé", async () => {
  const { rows, org, as, arrive } = await journee({ sens: "fixe" });
  const equipe = await arrive("Les Corsaires");
  await as(org);
  const [cur] = await rows(
    `select tr.step_id, s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
     where tr.team_id = $1 and tr.status = 'current'`, [equipe.team_id]
  );
  assert.equal(cur.title, "Le point de départ");
  const [res] = await rows(`select public.org_delete_step($1) as r`, [cur.step_id]);
  assert.equal(res.r.teams_affected, 1);

  const [apres] = await rows(
    `select s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
     where tr.team_id = $1 and tr.status = 'current'`, [equipe.team_id]
  );
  assert.equal(apres.title, "Épreuve 1", "l'équipe a été poussée à l'épreuve suivante");
  const [t] = await rows(`select finished_at from public.teams where id = $1`, [equipe.team_id]);
  assert.equal(t.finished_at, null, "elle n'est surtout pas marquée arrivée");
});

test("supprimer la DERNIÈRE étape restante fait terminer l'équipe proprement", async () => {
  const { rows, org, as, game, arrive } = await journee({ sens: "fixe" });
  // Une journée d'une seule épreuve : la supprimer ne laisse rien à jouer.
  await rows(`delete from public.steps where game_id = $1 and not is_start`, [game.id]);
  const equipe = await arrive("Les Corsaires");
  await as(org);
  const [cur] = await rows(
    `select step_id from public.team_routes where team_id = $1 and status = 'current'`,
    [equipe.team_id]
  );
  await rows(`select public.org_delete_step($1) as r`, [cur.step_id]);
  const [t] = await rows(`select finished_at, final_time_ms from public.teams where id = $1`, [equipe.team_id]);
  assert.ok(t.finished_at != null, "l'équipe est arrivée : il n'y avait plus rien après");
  assert.ok(t.final_time_ms != null && t.final_time_ms >= 0);
});

test("supprimer une étape que personne ne joue ne dérange aucune équipe", async () => {
  const { rows, org, as, game, arrive } = await journee({ sens: "fixe" });
  const equipe = await arrive("Les Corsaires");
  await as(org);
  const [loin] = await rows(
    `select id from public.steps where game_id = $1 and title = 'Épreuve 5'`, [game.id]
  );
  const [res] = await rows(`select public.org_delete_step($1) as r`, [loin.id]);
  assert.equal(res.r.teams_affected, 0);
  const [cur] = await rows(
    `select s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
     where tr.team_id = $1 and tr.status = 'current'`, [equipe.team_id]
  );
  assert.equal(cur.title, "Le point de départ");
  const restantes = await rows(
    `select 1 from public.team_routes where team_id = $1`, [equipe.team_id]
  );
  assert.equal(restantes.length, 6, "son parcours a simplement perdu une épreuve");
});

test("un tiers ne peut pas supprimer l'étape d'une partie qui n'est pas la sienne", async () => {
  const { rows, as, newUser, game } = await journee({ sens: "fixe" });
  const [etape] = await rows(
    `select id from public.steps where game_id = $1 and title = 'Épreuve 2'`, [game.id]
  );
  await as(await newUser());
  await assert.rejects(
    () => rows(`select public.org_delete_step($1) as r`, [etape.id]),
    /INTERDIT/
  );
});
