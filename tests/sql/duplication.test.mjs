/**
 * Dupliquer une partie.
 *
 * Le client duplique sa chasse et rapporte que « tout ce qui est GPS/boussole
 * ne marche plus ». Ces scénarios vérifient CE QUI TRAVERSE la copie, champ
 * par champ, parce que la panne serait silencieuse : une étape sans
 * coordonnées reste une étape valide, et l'écran de jeu se contente de ne plus
 * afficher de cadran.
 *
 * Ce qui doit survivre, et pourquoi :
 *  - `step_secrets.gps_lat/lng/radius` — sans elles, aucune cible à viser ;
 *  - `steps.content.gps_guidance` — c'est lui qui décide boussole, chaud/froid
 *    ou rien, et `get_play_state` ne révèle la cible QUE pour la boussole ;
 *  - `content.gps_hide_distance`, `rdv`, les indices et leurs points GPS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/** Une chasse avec les trois modes de guidage et un indice « lieu ». */
async function chasseComplete() {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);

  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, [
    "Journée d'origine",
  ]);

  const etapes = [
    // [titre, type, content]
    ["Balise du phare", "gps", { gps_guidance: "compass", gps_hide_distance: true }],
    ["Le thermomètre", "gps", { gps_guidance: "hotcold", gps_hotcold_thresholds: [80, 40, 20, 10, 5, 2] }],
    ["Lieu secret", "gps", { gps_guidance: "none" }],
    ["Énigme avec point", "text", { gps_guidance: "compass", body: "Où suis-je ?" }],
    ["Rendez-vous", "nfc", { gps_guidance: "map", rdv: { lat: 14.61, lng: -60.9 } }],
  ];

  for (const [i, [titre, type, content]] of etapes.entries()) {
    const [s] = await rows(
      `insert into public.steps (game_id, type, title, content, order_hint)
       values ($1, $2::public.step_type, $3, $4::jsonb, $5) returning id`,
      [game.id, type, titre, JSON.stringify(content), i]
    );
    await rows(
      `insert into public.step_secrets
         (step_id, answers, nfc_tag_id, manual_code, hints, gps_lat, gps_lng, gps_radius_m)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        s.id, ["phare"], `tag-${i}`, `CODE${i}`,
        JSON.stringify([{ text: "Regardez le fût", kind: "gps", gps: { lat: 14.612, lng: -60.901 } }]),
        14.6139 + i / 1000, -60.9042 - i / 1000, 12 + i,
      ]
    );
  }

  return { rows, as, org, game, nb: etapes.length };
}

test("LES COORDONNÉES GPS SURVIVENT À LA DUPLICATION", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);

  const origine = await rows(
    `select s.title, sec.gps_lat, sec.gps_lng, sec.gps_radius_m
       from public.steps s join public.step_secrets sec on sec.step_id = s.id
      where s.game_id = $1 order by s.order_hint`,
    [game.id]
  );
  const copiees = await rows(
    `select s.title, sec.gps_lat, sec.gps_lng, sec.gps_radius_m
       from public.steps s join public.step_secrets sec on sec.step_id = s.id
      where s.game_id = $1 order by s.order_hint`,
    [copie.id]
  );

  assert.equal(copiees.length, origine.length, "la copie n'a pas le même nombre d'étapes");
  for (const [i, o] of origine.entries()) {
    assert.deepEqual(copiees[i], o, `« ${o.title} » a perdu ses coordonnées`);
  }
});

test("le MODE de guidage survit — c'est lui qui allume la boussole", async () => {
  // `get_play_state` ne révèle la cible que si `gps_guidance` vaut 'compass'.
  // Perdre ce champ, c'est une étape qui garde ses coordonnées et n'affiche
  // plus rien : exactement « la boussole ne marche plus ».
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);

  const modes = async (id) =>
    (await rows(
      `select title, content->>'gps_guidance' as mode,
              content->>'gps_hide_distance' as sans_distance,
              content->'rdv' as rdv
         from public.steps where game_id = $1 order by order_hint`,
      [id]
    ));
  assert.deepEqual(await modes(copie.id), await modes(game.id));
});

test("les indices et leurs points GPS survivent", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);
  const indices = async (id) =>
    (await rows(
      `select sec.hints from public.steps s
         join public.step_secrets sec on sec.step_id = s.id
        where s.game_id = $1 order by s.order_hint`,
      [id]
    ));
  assert.deepEqual(await indices(copie.id), await indices(game.id));
});

test("les balises gardent leur identifiant : les puces déjà collées restent bonnes", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);
  const balises = async (id) =>
    (await rows(
      `select sec.nfc_tag_id, sec.manual_code, sec.answers from public.steps s
         join public.step_secrets sec on sec.step_id = s.id
        where s.game_id = $1 order by s.order_hint`,
      [id]
    ));
  assert.deepEqual(await balises(copie.id), await balises(game.id));
});

test("la copie est une partie NEUVE : code propre, en lobby, sans équipe", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);
  assert.notEqual(copie.code, game.code, "deux parties ne peuvent pas partager un code");
  assert.equal(copie.status, "lobby");
  assert.equal(copie.started_at, null);
  assert.equal((await rows(`select 1 from public.teams where game_id = $1`, [copie.id])).length, 0);
  // Le tirage anti-peloton NE se copie PAS : la copie refait le sien au départ.
  assert.equal(copie.route_perm, null);
});

test("une partie GPS dupliquée se joue vraiment : la cible remonte au téléphone", async () => {
  // Le test de bout en bout. Les champs peuvent tous être là et l'étape rester
  // muette si `get_play_state` ne la sert pas — c'est ce que voit le visiteur.
  //
  // Décor DÉDIÉ, à une seule étape en mode boussole. Avec les cinq épreuves du
  // décor commun, le parcours en tire une au hasard — et trois d'entre elles
  // ne sont PAS en boussole : `gps_target` y vaut null à juste titre. Le test
  // passait ou échouait selon le tirage.
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, [
    "Une seule balise",
  ]);
  const [etape] = await rows(
    `insert into public.steps (game_id, type, title, content, order_hint)
     values ($1,'gps','Balise du phare','{"gps_guidance":"compass"}'::jsonb,0) returning id`,
    [game.id]
  );
  await rows(
    `insert into public.step_secrets (step_id, gps_lat, gps_lng, gps_radius_m)
     values ($1, 14.6139, -60.9042, 15)`,
    [etape.id]
  );
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);

  const visiteur = await (async () => {
    const [u] = await rows(`insert into auth.users default values returning id`);
    return u.id;
  })();
  await as(visiteur);
  await rows(`select public.create_team($1,$2,$3) as r`, [copie.code, "Les Corsaires", "Aline"]);
  await as(org);
  await rows(`select public.start_game($1)`, [copie.id]);
  await as(visiteur);
  await rows(`select public.start_team()`);

  const [{ etat }] = await rows(`select public.get_play_state() as etat`);
  const cible = etat.current?.step?.gps_target;
  assert.ok(cible, "l'étape en cours de la copie ne fournit aucune cible à la boussole");
  assert.ok(Number.isFinite(cible.lat) && Number.isFinite(cible.lng));
  assert.ok(cible.radius > 0);
});

/**
 * LA REQUÊTE DE RÉPARATION, vérifiée ici avant d'être donnée au client.
 *
 * Elle sert si une copie s'est retrouvée sans coordonnées — faite avec une
 * version plus ancienne de `org_duplicate_game`, ou vidée à la main. Elle
 * recopie les points depuis la partie d'origine en appariant les étapes par
 * TITRE et RANG : ce sont les deux seules choses que la duplication conserve
 * à l'identique, l'identifiant étant neuf.
 *
 * Elle ne touche QUE les étapes dont la copie n'a pas de point : une étape
 * déjà corrigée à la main dans la copie n'est pas écrasée par l'ancienne
 * valeur.
 */
const REPARATION = `
update public.step_secrets sec
set gps_lat      = o.gps_lat,
    gps_lng      = o.gps_lng,
    gps_radius_m = o.gps_radius_m
from public.steps sc
join public.games gc on gc.id = sc.game_id
join lateral (
  select so_sec.gps_lat, so_sec.gps_lng, so_sec.gps_radius_m
  from public.steps so
  join public.games go on go.id = so.game_id
  join public.step_secrets so_sec on so_sec.step_id = so.id
  where go.code = $1
    and so.title = sc.title
    and so.order_hint = sc.order_hint
    and so_sec.gps_lat is not null
  limit 1
) o on true
where sec.step_id = sc.id
  and gc.code = $2
  and sec.gps_lat is null
`;

test("la requête de réparation rend ses coordonnées à une copie abîmée", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);

  // On simule le dégât : la copie perd tous ses points.
  await rows(
    `update public.step_secrets set gps_lat = null, gps_lng = null, gps_radius_m = null
      where step_id in (select id from public.steps where game_id = $1)`,
    [copie.id]
  );
  const points = async (id) =>
    rows(`select s.title, sec.gps_lat, sec.gps_lng, sec.gps_radius_m
            from public.steps s join public.step_secrets sec on sec.step_id = s.id
           where s.game_id = $1 order by s.order_hint`, [id]);
  assert.ok((await points(copie.id)).every((r) => r.gps_lat === null), "le dégât n'a pas pris");

  await rows(REPARATION, [game.code, copie.code]);
  assert.deepEqual(await points(copie.id), await points(game.id));
});

test("la réparation n'écrase pas un point déjà corrigé à la main", async () => {
  const { rows, game } = await chasseComplete();
  const [copie] = await rows(`select * from public.org_duplicate_game($1)`, [game.id]);

  // Une étape a perdu son point, une autre a été recorrigée avec une valeur
  // DIFFÉRENTE de l'originale : la réparation ne doit toucher que la première.
  const etapes = await rows(
    `select id from public.steps where game_id = $1 order by order_hint`, [copie.id]
  );
  await rows(`update public.step_secrets set gps_lat = null, gps_lng = null where step_id = $1`,
    [etapes[0].id]);
  await rows(`update public.step_secrets set gps_lat = 1.5, gps_lng = 2.5 where step_id = $1`,
    [etapes[1].id]);

  await rows(REPARATION, [game.code, copie.code]);

  const apres = await rows(
    `select sec.gps_lat, sec.gps_lng from public.steps s
       join public.step_secrets sec on sec.step_id = s.id
      where s.game_id = $1 order by s.order_hint`, [copie.id]
  );
  assert.equal(Number(apres[0].gps_lat).toFixed(4), "14.6139", "l'étape vide n'a pas été réparée");
  assert.equal(Number(apres[1].gps_lat), 1.5, "une correction manuelle a été écrasée");
});
