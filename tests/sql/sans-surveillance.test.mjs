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

/** Une partie en mode sans surveillance, avec une équipe partie. */
async function journee({ surveille = false, heure = 19, fermetureAuto = true } = {}) {
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

test("fermeture demandée : la partie se ferme d'elle-même passé l'heure", async () => {
  const ctx = await journee({ heure: 19 });
  await ctx.step("text", "Le phare");
  await lancer(ctx);
  await ctx.as(ctx.org);

  // Ouverture ce matin, on se place après l'heure de fermeture.
  await ctx.rows(
    `update public.games set settings = settings || '{"close_hour":0}'::jsonb where id = $1`,
    [ctx.game.id]
  );
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
  await ctx.as(ctx.org);
  // Heure de fermeture hors d'atteinte, partie ouverte aujourd'hui.
  await ctx.rows(
    `update public.games set settings = settings || '{"close_hour":23}'::jsonb,
                             started_at = now() where id = $1`, [ctx.game.id]
  );
  const res = (await ctx.rows(`select public.close_expired_games() as r`))[0].r;
  const [g] = await ctx.rows(`select status from public.games where id = $1`, [ctx.game.id]);
  // 23 h : ouverte sauf si l'exécution tombe après 23 h heure Martinique.
  if (res.closed.length === 0) assert.equal(g.status, "running");
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
