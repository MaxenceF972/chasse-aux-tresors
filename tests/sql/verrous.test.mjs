/**
 * Les verrous posés avant la mise en production.
 *
 * Chaque scénario ici correspond à un défaut constaté dans l'état des lieux :
 * une équipe qu'un inconnu pouvait rejoindre en pleine course, un plafond à 0
 * qui fermait la journée, un classement qui mettait une équipe lente devant
 * une équipe arrivée, un compte à rebours d'étape qui tournait pendant la
 * pause.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/** Une journée ouverte : 1 épreuve de départ, 6 énigmes, 1 finale. */
async function journee(settings = {}) {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,$2::jsonb)`, [
    "Journée du 27 août",
    JSON.stringify({ continuous: true, ...settings }),
  ]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint, is_start)
     values ($1,'text','Le point de départ',0,true)`, [game.id]
  );
  for (let i = 0; i < 6; i++) {
    await rows(
      `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,$3)`,
      [game.id, `Énigme ${i + 1}`, i + 1]
    );
  }
  await rows(
    `insert into public.steps (game_id, type, title, order_hint, is_final)
     values ($1,'text','Le coffre',99,true)`, [game.id]
  );
  await rows(`select public.start_game($1)`, [game.id]);

  /** Un visiteur arrive : équipe créée, lancée ou non. Rend la main à l'org. */
  const arrive = async (nom, pseudo, { lance = true } = {}) => {
    const uid = await newUser();
    await as(uid);
    const team = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, nom, pseudo]))[0].r;
    if (lance) await rows(`select public.start_team() as r`);
    await as(org);
    return { uid, ...team };
  };

  return { rows, as, org, newUser, game, arrive };
}

// --- Une équipe en course ne se rejoint plus depuis la liste du lobby -------

test("on ne rejoint pas une équipe déjà partie", async () => {
  const { rows, as, newUser, game, arrive } = await journee();
  const partie = await arrive("Les Corsaires", "Aline");

  const inconnu = await newUser();
  await as(inconnu);
  await assert.rejects(
    () => rows(`select public.join_team($1,$2,$3)`, [game.code, partie.team_id, "Curieux"]),
    /EQUIPE_DEJA_PARTIE/
  );
  const n = Number((await rows(
    `select count(*) as n from public.players where team_id = $1`, [partie.team_id]
  ))[0].n);
  assert.equal(n, 1, "personne ne s'est greffé");
});

test("on ne rejoint pas une équipe arrivée", async () => {
  const { rows, as, newUser, game, arrive } = await journee();
  const equipe = await arrive("Les Flibustiers", "Simon", { lance: false });
  await rows(`update public.teams set finished_at = now() where id = $1`, [equipe.team_id]);

  const inconnu = await newUser();
  await as(inconnu);
  await assert.rejects(
    () => rows(`select public.join_team($1,$2,$3)`, [game.code, equipe.team_id, "Curieux"]),
    /EQUIPE_DEJA_ARRIVEE/
  );
});

test("un membre de l'équipe peut rappeler join_team sans être éjecté", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Requins", "Max");
  await as(equipe.uid);
  await rows(`select public.join_team($1,$2,$3)`, [game.code, equipe.team_id, "Max"]);
  const n = Number((await rows(
    `select count(*) as n from public.players where team_id = $1`, [equipe.team_id]
  ))[0].n);
  assert.equal(n, 1, "deux appuis ne font pas deux joueurs");
});

test("le lobby ne liste que les équipes rejoignables — et la mienne", async () => {
  const { rows, as, newUser, game, arrive } = await journee();
  const enCourse = await arrive("Les Sirènes", "Aline");
  const enFormation = await arrive("Les Tortues", "Simon", { lance: false });

  const inconnu = await newUser();
  await as(inconnu);
  const vue = (await rows(`select public.get_lobby($1) as r`, [game.code]))[0].r;
  const ids = vue.teams.map((t) => t.id);
  assert.ok(ids.includes(enFormation.team_id), "l'équipe en formation est proposée");
  assert.ok(!ids.includes(enCourse.team_id), "l'équipe en course a disparu de la liste");

  // …mais son capitaine, lui, doit continuer de la voir : c'est ce que lit
  // l'accueil pour proposer « Reprendre ma chasse ».
  await as(enCourse.uid);
  const sienne = (await rows(`select public.get_lobby($1) as r`, [game.code]))[0].r;
  assert.ok(sienne.teams.some((t) => t.id === enCourse.team_id && t.started_at != null));
});

// --- Les plafonds à 0 valent « illimité » -----------------------------------

test("max_teams à 0 n'empêche aucune équipe", async () => {
  const { arrive, rows, game } = await journee({ max_teams: 0 });
  await arrive("Les Corsaires", "Aline", { lance: false });
  await arrive("Les Flibustiers", "Simon", { lance: false });
  const n = Number((await rows(
    `select count(*) as n from public.teams where game_id = $1`, [game.id]
  ))[0].n);
  assert.equal(n, 2);
});

test("max_players_per_team à 0 n'empêche aucun coéquipier", async () => {
  const { rows, as, newUser, game, arrive } = await journee({ max_players_per_team: 0 });
  const equipe = await arrive("Les Moussaillons", "Aline", { lance: false });
  const ami = await newUser();
  await as(ami);
  await rows(`select public.join_team($1,$2,$3)`, [game.code, equipe.team_id, "Simon"]);
  const n = Number((await rows(
    `select count(*) as n from public.players where team_id = $1`, [equipe.team_id]
  ))[0].n);
  assert.equal(n, 2);
});

// --- Une journée s'ouvre même avec un pool plus petit que le lobby ---------

test("start_game ouvre la journée même sans aucune équipe", async () => {
  const { rows, game } = await journee();
  const [g] = await rows(`select status from public.games where id = $1`, [game.id]);
  assert.equal(g.status, "running");
});

// --- Le classement : les arrivées d'abord, au chrono ------------------------

test("une équipe arrivée passe devant une équipe plus avancée mais encore en course", async () => {
  const { rows, game, arrive } = await journee();
  const rapide = await arrive("Les Corsaires", "Aline");
  const lente = await arrive("Les Flibustiers", "Simon");

  // La rapide boucle en 20 minutes. Deux de ses étapes ont été neutralisées
  // en cours de journée : elle en a donc moins au compteur que l'autre.
  await rows(
    `delete from public.team_routes where team_id = $1
      and position in (select position from public.team_routes where team_id = $1
                       order by position desc limit 3)`, [rapide.team_id]
  );
  await rows(
    `update public.team_routes set status = 'done', validated_at = now() where team_id = $1`,
    [rapide.team_id]
  );
  await rows(
    `update public.teams set started_at = now() - interval '20 minutes',
            finished_at = now(), final_time_ms = 20 * 60 * 1000 where id = $1`,
    [rapide.team_id]
  );

  // La lente court depuis trois heures et a validé plus d'étapes.
  await rows(`update public.teams set started_at = now() - interval '3 hours' where id = $1`,
    [lente.team_id]);
  await rows(
    `update public.team_routes set status = 'done', validated_at = now()
      where team_id = $1 and position < 6`, [lente.team_id]
  );

  const r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(r.teams[0].id, rapide.team_id, "l'arrivée est première, quel que soit son nombre d'étapes");
  assert.ok(r.teams[0].done < r.teams[1].done, "et elle en a bien fait MOINS");
});

// --- Le repère d'une étape : la dernière validation, où qu'elle soit --------

test("le compte à rebours d'une étape part de la dernière validation, pas de la position", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Albatros", "Aline");
  await rows(`update public.teams set started_at = now() - interval '3 hours' where id = $1`,
    [equipe.team_id]);

  const routes = await rows(
    `select id, position, step_id from public.team_routes
      where team_id = $1 order by position`, [equipe.team_id]
  );
  // Mode dispersé : l'équipe vient de valider une position HAUTE et se
  // retrouve sur une position BASSE. C'est le cas normal, pas une anomalie.
  await rows(`update public.team_routes set status='done', validated_at = now() where id = $1`,
    [routes[5].id]);
  await rows(`update public.team_routes set status='current' where id = $1`, [routes[1].id]);
  await rows(`update public.team_routes set status='locked' where id = $1 and status='current'`,
    [routes[0].id]);
  await rows(`update public.steps set time_limit_sec = 600 where id = $1`, [routes[1].step_id]);

  await as(equipe.uid);
  const res = (await rows(`select public.skip_step_timeout($1) as r`, [routes[1].step_id]))[0].r;
  assert.equal(res.ok, false);
  assert.equal(res.error, "TIMER_PAS_ECOULE",
    "l'équipe vient d'arriver sur l'étape : son chrono ne peut pas être écoulé");
});

// --- La pause ne mange pas le temps d'une épreuve ---------------------------

test("une pause de la partie ne fait pas expirer le compte à rebours d'une étape", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Boucaniers", "Simon");
  await rows(`update public.teams set started_at = now() - interval '20 minutes' where id = $1`,
    [equipe.team_id]);
  const [route] = await rows(
    `select id, step_id from public.team_routes
      where team_id = $1 and status = 'current'`, [equipe.team_id]
  );
  await rows(`update public.steps set time_limit_sec = 600 where id = $1`, [route.step_id]);

  // Douze minutes de pause dans ces vingt minutes : il ne reste que huit
  // minutes de jeu réel, l'épreuve en dure dix.
  await rows(
    `insert into public.events (game_id, type, created_at)
     values ($1,'game_paused', now() - interval '15 minutes'),
            ($1,'game_resumed', now() - interval '3 minutes')`, [game.id]
  );

  await as(equipe.uid);
  const pendant = (await rows(`select public.skip_step_timeout($1) as r`, [route.step_id]))[0].r;
  assert.equal(pendant.error, "TIMER_PAS_ECOULE", "la pause est déduite du temps d'épreuve");

  // Sans la pause, les vingt minutes suffisent largement.
  await rows(`delete from public.events where game_id = $1 and type in ('game_paused','game_resumed')`,
    [game.id]);
  const sans = (await rows(`select public.skip_step_timeout($1) as r`, [route.step_id]))[0].r;
  assert.equal(sans.ok, true, "sans pause, le temps est bien écoulé");
});

// --- Un visiteur pas encore parti qui scanne une balise --------------------

test("une balise scannée avant le départ ne répond pas « parcours bouclé »", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Mouettes", "Aline", { lance: false });
  await as(equipe.uid);
  const res = (await rows(
    `select public.validate_tag(gen_random_uuid(), $1) as r`, ["balise-du-lavoir"]
  ))[0].r;
  assert.equal(res.ok, false);
  assert.equal(res.error, "PAS_PARTIE");
  assert.equal(res.game_code, game.code);
});

// --- Refuser une photo : malus TOYAH, rendu si l'on se ravise --------------

test("refuser une photo coûte le malus, la valider ensuite le rend", async () => {
  const { rows, as, org, game, arrive } = await journee();
  const equipe = await arrive("Les Corsaires", "Simon");
  const [photo] = await rows(
    `insert into public.steps (game_id, type, title, order_hint, content)
     values ($1,'photo','Le selfie au phare',50,'{"photo_mode":"bonus"}'::jsonb) returning id`, [game.id]
  );
  const [route] = await rows(
    `select id, step_id from public.team_routes where team_id = $1 and status = 'current'`,
    [equipe.team_id]
  );
  await rows(`update public.team_routes set step_id = $1 where id = $2`, [photo.id, route.id]);

  await as(equipe.uid);
  await rows(`select public.submit_photo($1,$2)`, [photo.id, "https://exemple.test/photo.jpg"]);
  const [sub] = await rows(`select id from public.submissions where team_id = $1`, [equipe.team_id]);

  await as(org);
  await rows(`select public.org_review_photo($1,false)`, [sub.id]);
  let [t] = await rows(`select penalty_seconds from public.teams where id = $1`, [equipe.team_id]);
  assert.equal(Number(t.penalty_seconds), 180, "le malus par défaut tombe (3 min)");

  // Rejuger la même photo ne double jamais la peine.
  await rows(`select public.org_review_photo($1,false)`, [sub.id]);
  [t] = await rows(`select penalty_seconds from public.teams where id = $1`, [equipe.team_id]);
  assert.equal(Number(t.penalty_seconds), 180, "une seule peine par photo");

  // Refusée = absente des souvenirs de l'équipe.
  await as(equipe.uid);
  let r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(r.team_photos.length, 0, "la photo refusée sort des souvenirs");

  // L'organisateur se ravise : le malus est rendu, la photo revient.
  await as(org);
  await rows(`select public.org_review_photo($1,true)`, [sub.id]);
  [t] = await rows(`select penalty_seconds from public.teams where id = $1`, [equipe.team_id]);
  assert.equal(Number(t.penalty_seconds), 0, "le malus est rendu");
  await as(equipe.uid);
  r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(r.team_photos.length, 1, "la photo est de retour dans les souvenirs");
});

// --- Un mini-jeu sans réponse reste jouable même si l'étape en garde une ----

test("un mini-jeu sans réponse se valide malgré des réponses restées en base", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Moussaillons", "Aline");
  await rows(`update public.teams set started_at = now() - interval '5 minutes' where id = $1`,
    [equipe.team_id]);

  const [route] = await rows(
    `select id, step_id from public.team_routes where team_id = $1 and status = 'current'`,
    [equipe.team_id]
  );
  // L'étape était un Code César, elle est passée à Hanoï : le champ des
  // réponses a disparu de l'écran, la valeur est restée en base.
  await rows(
    `update public.steps set type = 'minigame',
            content = '{"minigame":{"kind":"hanoi","config":{}}}'::jsonb
      where id = $1`, [route.step_id]
  );
  await rows(
    `insert into public.step_secrets (step_id, answers) values ($1, array['LA CLE EST SOUS LE FOUDRE'])
     on conflict (step_id) do update set answers = excluded.answers`, [route.step_id]
  );

  await as(equipe.uid);
  const res = (await rows(
    `select public.validate_step(gen_random_uuid(), $1, 'minigame', '{"score":900,"duration_ms":42000}'::jsonb) as r`,
    [route.step_id]
  ))[0].r;
  assert.equal(res.ok, true);
  assert.equal(res.correct, true, "le plateau gagné suffit : le jeu n'attend aucune réponse");
});

// --- Les durées d'étape ne peuvent pas être négatives ----------------------

test("la meilleure étape se mesure dans l'ordre vécu, pas dans l'ordre des positions", async () => {
  const { rows, game, arrive } = await journee();
  const equipe = await arrive("Les Goélands", "Aline");
  await rows(`update public.teams set started_at = now() - interval '50 minutes' where id = $1`,
    [equipe.team_id]);

  const routes = await rows(
    `select id, position from public.team_routes where team_id = $1 order by position`,
    [equipe.team_id]
  );
  // Mode dispersé : l'équipe a visité 5, puis 1, puis 3 — pas dans l'ordre.
  for (const [route, ilYA] of [[routes[5], 40], [routes[1], 30], [routes[3], 20]]) {
    await rows(
      `update public.team_routes set status='done', validated_at = now() - ($2 || ' minutes')::interval
        where id = $1`, [route.id, String(ilYA)]
    );
  }

  const r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  const equipeRang = r.teams.find((t) => t.id === equipe.team_id);
  assert.ok(equipeRang.fastest_step_ms > 0,
    `une étape ne dure jamais un temps négatif (reçu ${equipeRang.fastest_step_ms})`);
  assert.equal(Math.round(equipeRang.fastest_step_ms / 60000), 10,
    "la plus rapide a duré dix minutes");
});

// --- Le repère envoyé au client est lui aussi purgé de la pause ------------

test("le repère d'étape envoyé au téléphone tient compte de la pause", async () => {
  const { rows, as, game, arrive } = await journee();
  const equipe = await arrive("Les Tortues", "Simon");
  await rows(`update public.teams set started_at = now() - interval '20 minutes' where id = $1`,
    [equipe.team_id]);
  await rows(
    `insert into public.events (game_id, type, created_at)
     values ($1,'game_paused', now() - interval '15 minutes'),
            ($1,'game_resumed', now() - interval '3 minutes')`, [game.id]
  );

  await as(equipe.uid);
  const etat = (await rows(`select public.get_play_state() as r`))[0].r;
  const depuisMin = (Date.now() - new Date(etat.current.started_at).getTime()) / 60000;
  // Vingt minutes d'horloge, douze de pause : l'étape n'a duré que huit
  // minutes, et c'est ce que le téléphone doit décompter.
  assert.ok(Math.abs(depuisMin - 8) < 1,
    `le repère doit valoir huit minutes de jeu réel (reçu ${depuisMin.toFixed(1)})`);
});
