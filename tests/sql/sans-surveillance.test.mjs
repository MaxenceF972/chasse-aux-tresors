/**
 * Mode sans surveillance — personne ne regarde le tableau de bord.
 *
 * Tout ce qui attendait une décision humaine doit se débloquer seul : la photo
 * ne retient plus l'équipe, l'énigme bonus se juge sur-le-champ.
 *
 * La fermeture du soir, elle, est un réglage À PART (`auto_close`) et éteinte
 * par défaut : une chasse tourne jusqu'à ce qu'on la coupe. Les scénarios
 * ci-dessous vérifient les deux sens — qu'elle ferme quand on le demande, et
 * surtout qu'elle ne ferme JAMAIS quand on ne l'a pas demandé.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/**
 * Une partie en mode sans surveillance, avec une équipe partie.
 *
 * `heure` vaut 0 par défaut — MINUIT : la partie ne ferme qu'au changement de
 * jour, si bien que l'inscription et le départ du scénario passent à toute
 * heure. Avec 19 h, ils seraient refusés chaque fois que la suite tourne le
 * soir : passé l'heure, plus personne ne part (voir auto_close_due).
 */
async function journee({ surveille = false, heure = 0, fermetureAuto = true } = {}) {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const reglages = surveille
    ? { continuous: true }
    : {
        continuous: true,
        unattended: true,
        timezone: "America/Martinique",
        ...(fermetureAuto ? { auto_close: true, close_hour: heure } : {}),
      };
  const [game] = await rows(`select * from public.org_create_game($1, $2::jsonb)`, [
    "Journée du 19 août",
    JSON.stringify(reglages),
  ]);

  /**
   * Ajoute une étape. `depart` la marque comme épreuve de départ : sans ça,
   * start_team répartit l'équipe au hasard dans le pool et l'étape testée
   * n'est pas forcément celle en cours — le scénario deviendrait capricieux.
   */
  const step = async (type, titre, contenu = {}, { depart = false } = {}) =>
    (await rows(
      `insert into public.steps (game_id, type, title, content, order_hint, is_start)
       values ($1, $2, $3, $4::jsonb, $5, $6) returning id`,
      [game.id, type, titre, JSON.stringify(contenu), depart ? 0 : 1, depart]
    ))[0].id;

  const visiteur = await newUser();
  const ctx = { rows, as, org, visiteur, game, step, equipe: null };
  return ctx;
}

/**
 * Ouvre la journée puis lance l'équipe. Séparé de la mise en place : le
 * parcours ne naît qu'au départ, donc les étapes doivent exister avant.
 */
async function lancer(ctx) {
  await ctx.as(ctx.org);
  await ctx.rows(`select public.start_game($1)`, [ctx.game.id]);
  await ctx.as(ctx.visiteur);
  ctx.equipe = (await ctx.rows(`select public.create_team($1,$2,$3) as r`, [
    ctx.game.code, "Les Corsaires", "Aline",
  ]))[0].r;
  await ctx.rows(`select public.start_team()`);
}

test("la photo bloquante ne bloque plus", async () => {
  const ctx = await journee();
  const stepId = await ctx.step("photo", "Le coffre", { photo_mode: "gate" }, { depart: true });
  await ctx.step("text", "Le phare");
  await lancer(ctx);

  const res = (await ctx.rows(`select public.submit_photo($1,$2) as r`, [
    stepId, "https://exemple.test/photo.jpg",
  ]))[0].r;
  assert.equal(res.ok, true);
  assert.equal(res.pending, undefined, "l'équipe ne reste pas en attente de jugement");
  assert.equal(res.correct, true);

  // La photo part quand même en revue : elle sera regardée plus tard.
  const [sub] = await ctx.rows(
    `select status from public.submissions where step_id = $1`, [stepId]
  );
  assert.equal(sub.status, "pending");
});

test("sous surveillance, la photo bloquante bloque toujours", async () => {
  const ctx = await journee({ surveille: true });
  const stepId = await ctx.step("photo", "Le coffre", { photo_mode: "gate" }, { depart: true });
  await ctx.step("text", "Le phare");
  await lancer(ctx);

  const res = (await ctx.rows(`select public.submit_photo($1,$2) as r`, [
    stepId, "https://exemple.test/photo.jpg",
  ]))[0].r;
  assert.equal(res.pending, true);
});

test("l'énigme bonus juste est récompensée sur-le-champ", async () => {
  const ctx = await journee();
  const stepId = await ctx.step(
    "text", "Le nom du bateau", { text_mode: "bonus", bonus_sec: 120 }, { depart: true }
  );
  await ctx.step("text", "Le phare");
  await ctx.rows(
    `insert into public.step_secrets (step_id, answers) values ($1, $2)`,
    [stepId, ["la belle aline"]]
  );
  await lancer(ctx);

  await ctx.rows(`select public.submit_bonus_answer($1,$2)`, [stepId, "La Belle  ALINE !"]);

  const [sub] = await ctx.rows(`select status from public.submissions where step_id = $1`, [stepId]);
  assert.equal(sub.status, "approved", "la normalisation reconnaît la réponse");
  const [t] = await ctx.rows(`select penalty_seconds from public.teams where id = $1`, [ctx.equipe.team_id]);
  assert.equal(Number(t.penalty_seconds), -120, "120 s rendues");
});

test("l'énigme bonus fausse ne coûte rien", async () => {
  const ctx = await journee();
  const stepId = await ctx.step("text", "Le nom du bateau", { text_mode: "bonus" }, { depart: true });
  await ctx.step("text", "Le phare");
  await ctx.rows(`insert into public.step_secrets (step_id, answers) values ($1, $2)`,
    [stepId, ["la belle aline"]]);
  await lancer(ctx);

  await ctx.rows(`select public.submit_bonus_answer($1,$2)`, [stepId, "au hasard"]);
  const [sub] = await ctx.rows(`select status from public.submissions where step_id = $1`, [stepId]);
  assert.equal(sub.status, "rejected");
  const [t] = await ctx.rows(`select penalty_seconds from public.teams where id = $1`, [ctx.equipe.team_id]);
  assert.equal(Number(t.penalty_seconds), 0, "un bonus manqué n'est pas un péage");
});

test("sans réponse attendue, la question ouverte est accordée", async () => {
  const ctx = await journee();
  const stepId = await ctx.step("text", "Racontez votre visite", { text_mode: "bonus" }, { depart: true });
  await ctx.step("text", "Le phare");
  await lancer(ctx);

  await ctx.rows(`select public.submit_bonus_answer($1,$2)`, [stepId, "c'était très bien"]);
  const [sub] = await ctx.rows(`select status from public.submissions where step_id = $1`, [stepId]);
  assert.equal(sub.status, "approved", "le jeu ne peut pas juger : il accorde");
});

/**
 * Un fuseau où il est en ce moment entre 1 h et 22 h, et l'heure qu'il y est.
 *
 * Les scénarios de fermeture raisonnent sur « avant » et « après » l'heure,
 * le JOUR MÊME : il leur faut une heure locale qui ait un avant et un après
 * dans la journée. Deux fuseaux distants de treize heures en garantissent un,
 * quelle que soit l'heure à laquelle la suite tourne.
 */
async function heureLocale(rows) {
  const [r] = await rows(
    `select tz, extract(hour from now() at time zone tz)::int as h
     from unnest(array['America/Martinique', 'Asia/Tokyo']) as tz
     where extract(hour from now() at time zone tz) between 1 and 22
     limit 1`
  );
  return r;
}

/** Règle la fermeture d'une partie ouverte à l'instant. */
async function fermerA(ctx, reglages) {
  await ctx.as(ctx.org);
  await ctx.rows(
    `update public.games set settings = settings || $2::jsonb, started_at = now() where id = $1`,
    [ctx.game.id, JSON.stringify(reglages)]
  );
}

test("fermeture demandée : la partie se ferme d'elle-même passé l'heure", async () => {
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  // L'heure de fermeture est celle qu'il est : elle vient de passer.
  const { tz, h } = await heureLocale(ctx.rows);
  await fermerA(ctx, { close_hour: h, timezone: tz });

  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 1);

  const [g] = await ctx.rows(`select status, finished_at from public.games where id = $1`, [ctx.game.id]);
  assert.equal(g.status, "finished");
  assert.ok(g.finished_at != null);
});

test("avant l'heure, elle reste ouverte", async () => {
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  const { tz, h } = await heureLocale(ctx.rows);
  await fermerA(ctx, { close_hour: h + 1, timezone: tz });

  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 0);
  const [g] = await ctx.rows(`select status from public.games where id = $1`, [ctx.game.id]);
  assert.equal(g.status, "running");
});

test("fermeture à 0 h : c'est minuit, la partie reste ouverte toute la journée", async () => {
  // Lu « heure >= 0 », 0 h fermait la partie dès son ouverture. Et c'est la
  // valeur que prend un champ d'heure vidé par mégarde.
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await fermerA(ctx, { close_hour: 0 });

  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 0, "ouverte aujourd'hui : rien à fermer avant minuit");
});

test("un fuseau inconnu ne fait pas échouer le passage du soir", async () => {
  // L'appel échouait en entier : aucune partie n'était plus fermée, nulle part.
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);
  await ctx.rows(
    `update public.games set settings = settings || '{"timezone":"Mars/Olympus_Mons"}'::jsonb,
                             started_at = now() - interval '2 days' where id = $1`,
    [ctx.game.id]
  );
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 1, "le fuseau par défaut prend le relais");
});

test("une heure de fermeture non entière ne fait pas échouer le passage", async () => {
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);
  await ctx.rows(
    `update public.games set settings = settings || '{"close_hour":19.5}'::jsonb,
                             started_at = now() - interval '2 days' where id = $1`,
    [ctx.game.id]
  );
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 1);
});

test("passé l'heure, plus d'inscription ni de départ — même avant le passage du soir", async () => {
  // Le passage qui ferme n'a lieu qu'une fois par jour. Sans ce refus, une
  // partie qui devait fermer à 21 h accueillait encore, le lendemain matin,
  // les visiteurs du jour suivant.
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  const nouveau = async () => (await ctx.rows(`insert into auth.users default values returning id`))[0].id;

  // Une équipe inscrite la veille, jamais partie.
  const veille = await nouveau();
  await ctx.as(veille);
  await ctx.rows(`select public.create_team($1,'Les Tortues','Simon')`, [ctx.game.code]);

  // La partie a ouvert avant-hier : l'heure est passée, dans tous les fuseaux.
  await ctx.as(ctx.org);
  await ctx.rows(`update public.games set started_at = now() - interval '2 days' where id = $1`, [
    ctx.game.id,
  ]);

  await ctx.as(await nouveau());
  await assert.rejects(
    () => ctx.rows(`select public.create_team($1,'Les Requins','Noé')`, [ctx.game.code]),
    /PARTIE_TERMINEE/,
    "le visiteur du jour ne rejoint pas la partie de la veille"
  );
  await ctx.as(veille);
  await assert.rejects(() => ctx.rows(`select public.start_team()`), /PARTIE_TERMINEE/);

  // L'équipe déjà en route, elle, n'est pas inquiétée.
  await ctx.as(ctx.visiteur);
  const res = (await ctx.rows(`select public.start_team() as r`))[0].r;
  assert.equal(res.already, true);
});

test("fermeture demandée : une nuit de cron sautée se rattrape", async () => {
  const ctx = await journee();
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);
  await ctx.rows(
    `update public.games set settings = settings || '{"close_hour":23}'::jsonb,
                             started_at = now() - interval '2 days' where id = $1`, [ctx.game.id]
  );
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 1, "le jour d'ouverture est passé");
});

test("SANS fermeture demandée, la chasse tourne indéfiniment", async () => {
  // Le cœur de la décision : une chasse dure jusqu'à ce qu'on la coupe. Ni
  // l'heure, ni le nombre de jours écoulés ne doivent y changer quoi que ce
  // soit — c'est exactement ce que faisait l'ancienne règle « ouverte un jour
  // antérieur », qui aurait tué une partie laissée courir un mois.
  const ctx = await journee({ fermetureAuto: false });
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);
  await ctx.rows(
    `update public.games set started_at = now() - interval '40 days' where id = $1`,
    [ctx.game.id]
  );
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 0, "quarante jours plus tard, elle court toujours");
  const [g] = await ctx.rows(`select status from public.games where id = $1`, [ctx.game.id]);
  assert.equal(g.status, "running");

  // Et on s'y inscrit toujours : le refus « passé l'heure » ne vaut que pour
  // une partie qui a demandé sa fermeture.
  const [{ id }] = await ctx.rows(`insert into auth.users default values returning id`);
  await ctx.as(id);
  const equipe = (await ctx.rows(`select public.create_team($1,'Les Requins','Noé') as r`, [
    ctx.game.code,
  ]))[0].r;
  assert.ok(equipe.team_id);
});

test("une partie surveillée n'est jamais fermée automatiquement", async () => {
  const ctx = await journee({ surveille: true });
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);
  await ctx.rows(`update public.games set started_at = now() - interval '5 days' where id = $1`,
    [ctx.game.id]);
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  assert.equal(res.closed.length, 0, "sans le mode, la fermeture reste à la main de l'organisateur");
});

test("les photos du classement sont celles de MON équipe, et de personne d'autre", async () => {
  const ctx = await journee({ fermetureAuto: false });
  const etape = await ctx.step("photo", "Devant l'fontaine", {}, { depart: true });
  await lancer(ctx);

  // Une seconde équipe, qui photographie la même étape.
  const autre = await (async () => {
    const uid = await ctx.rows(`select gen_random_uuid() as id`).then((r) => r[0].id);
    await ctx.rows(`insert into auth.users (id) values ($1)`, [uid]);
    await ctx.as(uid);
    await ctx.rows(`select public.create_team($1,'Les Requins','Aline') as r`, [ctx.game.code]);
    await ctx.rows(`select public.start_team() as r`);
    await ctx.rows(`select public.submit_photo($1,'https://exemple.test/aline.webp') as r`, [etape]);
    return uid;
  })();

  await ctx.as(ctx.visiteur);
  await ctx.rows(`select public.submit_photo($1,'https://exemple.test/moi.webp') as r`, [etape]);

  const mien = (await ctx.rows(`select public.get_ranking($1) as r`, [ctx.game.code]))[0].r;
  assert.deepEqual(
    mien.team_photos.map((p) => p.url),
    ["https://exemple.test/moi.webp"],
    "je vois la mienne, pas celle de l'autre équipe"
  );
  assert.equal(mien.team_photos[0].step_title, "Devant l'fontaine");

  await ctx.as(autre);
  const sien = (await ctx.rows(`select public.get_ranking($1) as r`, [ctx.game.code]))[0].r;
  assert.deepEqual(sien.team_photos.map((p) => p.url), ["https://exemple.test/aline.webp"]);

  // L'organisateur et la page publique ne sont dans aucune équipe : rien.
  await ctx.as(ctx.org);
  const orga = (await ctx.rows(`select public.get_ranking($1) as r`, [ctx.game.code]))[0].r;
  assert.deepEqual(orga.team_photos, [], "le classement public ne montre les photos de personne");
});

test("une photo refusée disparaît des souvenirs de l'équipe", async () => {
  const ctx = await journee({ fermetureAuto: false });
  const etape = await ctx.step("photo", "Devant l'fontaine", {}, { depart: true });
  await lancer(ctx);
  await ctx.as(ctx.visiteur);
  await ctx.rows(`select public.submit_photo($1,'https://exemple.test/moi.webp') as r`, [etape]);

  const avant = (await ctx.rows(`select public.get_ranking($1) as r`, [ctx.game.code]))[0].r;
  assert.equal(avant.team_photos.length, 1);

  await ctx.as(ctx.org);
  const [sub] = await ctx.rows(`select id from public.submissions where game_id = $1`, [ctx.game.id]);
  await ctx.rows(`select public.org_review_photo($1, false) as r`, [sub.id]);

  await ctx.as(ctx.visiteur);
  const apres = (await ctx.rows(`select public.get_ranking($1) as r`, [ctx.game.code]))[0].r;
  assert.deepEqual(apres.team_photos, [], "refuser doit la faire disparaître de leur écran");
});

test("les médias d'une étape arrivent bien au joueur qui est dessus", async () => {
  // Vérifie le CHEMIN complet des photos d'illustration posées par
  // l'organisateur : elles ne transitent que par get_play_state, et seulement
  // pour l'étape en cours — c'est voulu, une étape à venir ne se dévoile pas.
  const ctx = await journee({ fermetureAuto: false });
  const vue = await ctx.step("text", "Le point de départ", {}, { depart: true });
  const cachee = await ctx.step("text", "Le ponton");
  await ctx.rows(
    `update public.steps set media_urls = array['https://exemple.test/phare.webp']
     where id = $1`, [vue]
  );
  await ctx.rows(
    `update public.steps set media_urls = array['https://exemple.test/ponton.webp']
     where id = $1`, [cachee]
  );
  await lancer(ctx);

  await ctx.as(ctx.visiteur);
  const etat = (await ctx.rows(`select public.get_play_state() as r`))[0].r;
  assert.equal(etat.current.step.title, "Le point de départ");
  assert.deepEqual(
    etat.current.step.media_urls,
    ["https://exemple.test/phare.webp"],
    "la photo de l'étape en cours doit arriver au joueur"
  );
  assert.ok(
    !JSON.stringify(etat).includes("ponton.webp"),
    "celle d'une étape à venir ne doit PAS fuiter"
  );
});
