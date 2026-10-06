/**
 * Le contact du gagnant, et la note de la visite.
 *
 * Deux ajouts qui touchent à des données personnelles, donc deux promesses à
 * tenir et à prouver :
 *
 *  1. un contact laissé à l'inscription n'est lisible QUE par l'organisateur.
 *     La tentation était d'en faire une colonne de `teams` — et `teams_select`
 *     laisse tout joueur d'une partie lire toutes les équipes de cette partie.
 *     L'adresse d'une équipe aurait été à la portée de n'importe quel visiteur
 *     du jour. D'où une table séparée, et d'où ce test : il échouerait à la
 *     seconde où quelqu'un déplacerait le champ.
 *  2. le champ est FACULTATIF, et se vide.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

/**
 * Une partie, deux visiteurs inscrits, l'un avec contact et l'autre sans.
 *
 * La partie n'est PAS ouverte : `start_game` démarre les équipes déjà
 * inscrites, et une équipe partie n'est plus reprise — le chemin de reprise de
 * `create_team`, que deux scénarios ci-dessous exercent, deviendrait
 * inatteignable. Rien ici n'exige une partie ouverte.
 */
async function journee() {
  const { rows, as, sousRls, newUser } = await freshDb();
  const org = await newUser();
  const avecContact = await newUser();
  const sansContact = await newUser();
  const curieux = await newUser();

  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, [
    "Journée du 18 septembre",
  ]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,0)`,
    [game.id, "Le phare"]
  );

  await as(avecContact);
  const equipeA = (await rows(`select public.create_team($1,$2,$3,'{}',$4) as r`, [
    game.code, "Les Corsaires", "Aline", "aline@exemple.fr",
  ]))[0].r;

  await as(sansContact);
  const equipeB = (await rows(`select public.create_team($1,$2,$3) as r`, [
    game.code, "Les Flibustiers", "Simon",
  ]))[0].r;

  return { rows, as, sousRls, org, avecContact, sansContact, curieux, game, equipeA, equipeB };
}

// ── Le contact ───────────────────────────────────────────────────────────

test("le contact laissé à l'inscription est bien enregistré", async () => {
  const { rows, as, org, equipeA } = await journee();
  await as(org);
  const lignes = await rows(`select * from public.team_contacts where team_id = $1`, [
    equipeA.team_id,
  ]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].contact, "aline@exemple.fr");
});

test("sans contact, aucune ligne n'est créée", async () => {
  const { rows, as, org, equipeB } = await journee();
  await as(org);
  const lignes = await rows(`select * from public.team_contacts where team_id = $1`, [
    equipeB.team_id,
  ]);
  assert.equal(lignes.length, 0, "un champ vide ne doit pas laisser de ligne vide");
});

test("UN JOUEUR NE LIT JAMAIS LE CONTACT D'UNE AUTRE ÉQUIPE", async () => {
  // La promesse faite au visiteur. Si ce test tombe, c'est que le contact est
  // reparti dans une table que les joueurs peuvent lire.
  const { rows, sousRls, sansContact, curieux, org } = await journee();
  const lit = (qui) => sousRls(qui, () => rows(`select * from public.team_contacts`));

  // `sousRls` et non `as` : `as` ne change que ce que rend auth.uid(), les
  // requêtes restant en superutilisateur, qui CONTOURNE la RLS. Un test écrit
  // avec `as` passerait quoi qu'il arrive et ne prouverait rien.

  // Un joueur de la MÊME partie : le cas dangereux, celui qu'une colonne de
  // `teams` aurait ouvert.
  assert.equal((await lit(sansContact)).length, 0,
    "un joueur de la partie voit un contact qui ne le regarde pas");

  // Un visiteur qui n'est inscrit nulle part.
  assert.equal((await lit(curieux)).length, 0);

  // Témoin : la ligne existe bel et bien. Sans lui, le test passerait aussi
  // sur une table vide.
  assert.equal((await lit(org)).length, 1);
});

test("le propriétaire de la partie voit les contacts, et lui seul", async () => {
  const { rows, sousRls, org, avecContact } = await journee();
  const lit = (qui) => sousRls(qui, () => rows(`select * from public.team_contacts`));
  assert.equal((await lit(org)).length, 1);
  // Le capitaine lui-même ne relit pas sa ligne : il n'en a pas besoin, et
  // moins de monde y accède, mieux c'est.
  assert.equal((await lit(avecContact)).length, 0);
});

test("PERSONNE NE RÉÉCRIT LE CONTACT D'UNE ÉQUIPE EN APPELANT poser_contact", async () => {
  // La fonction n'a aucun contrôle : elle n'est faite que pour create_team.
  // Ouverte, elle laissait n'importe quel visiteur remplacer — ou effacer —
  // le contact du gagnant, avec des identifiants publics (get_ranking).
  const { rows, sousRls, curieux, avecContact, org, game, equipeA } = await journee();
  for (const qui of [curieux, avecContact]) {
    await assert.rejects(
      () =>
        sousRls(qui, () =>
          rows(`select public.poser_contact($1,$2,'pirate@exemple.fr')`, [game.id, equipeA.team_id])
        ),
      /permission denied/
    );
  }
  await sousRls(org, async () => {
    const [ligne] = await rows(`select contact from public.team_contacts where team_id = $1`, [
      equipeA.team_id,
    ]);
    assert.equal(ligne.contact, "aline@exemple.fr", "le contact d'origine est intact");
  });
});

test("create_team, appelée par un vrai visiteur, enregistre toujours son contact", async () => {
  // Le témoin du verrou ci-dessus : sous le rôle `authenticated` (celui d'un
  // navigateur), create_team passe par poser_contact avec SES droits à elle.
  const { rows, sousRls, curieux, org, game } = await journee();
  const equipe = await sousRls(curieux, async () =>
    (await rows(`select public.create_team($1,$2,$3,'{}',$4) as r`, [
      game.code, "Les Requins", "Noé", "noe@exemple.fr",
    ]))[0].r
  );
  await sousRls(org, async () => {
    const [ligne] = await rows(`select contact from public.team_contacts where team_id = $1`, [
      equipe.team_id,
    ]);
    assert.equal(ligne?.contact, "noe@exemple.fr");
  });
});

test("un contact vidé efface la ligne", async () => {
  const { rows, as, avecContact, org, game } = await journee();
  // Le visiteur se ravise : il repasse par le formulaire sans rien mettre.
  // L'équipe n'est pas partie et il y est seul, donc elle est REPRISE — c'est
  // le chemin où un oubli aurait laissé l'ancien contact en base.
  await as(avecContact);
  await rows(`select public.create_team($1,$2,$3,'{}',$4) as r`, [
    game.code, "Les Corsaires", "Aline", "",
  ]);
  await as(org);
  assert.equal((await rows(`select * from public.team_contacts`)).length, 0);
});

test("le contact suit la REPRISE d'équipe autant que la création", async () => {
  // create_team a deux sorties. Un contact posé sur une seule se perdrait une
  // fois sur deux, sans que rien ne le signale.
  const { rows, as, sansContact, org, game, equipeB } = await journee();
  await as(sansContact);
  const repris = (await rows(`select public.create_team($1,$2,$3,'{}',$4) as r`, [
    game.code, "Les Flibustiers", "Simon", "0696010203",
  ]))[0].r;
  assert.equal(repris.reused, true, "l'équipe devait être reprise, pas recréée");
  assert.equal(repris.team_id, equipeB.team_id);

  await as(org);
  // Cadré sur CETTE équipe : l'autre a déjà son contact depuis la mise en
  // place, et compter toute la table ferait dire au test autre chose que ce
  // qu'il vérifie.
  const lignes = await rows(`select contact from public.team_contacts where team_id = $1`, [
    equipeB.team_id,
  ]);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].contact, "0696010203");
});

test("le contact disparaît avec l'équipe", async () => {
  const { rows, as, org, equipeA } = await journee();
  await as(org);
  await rows(`select public.org_delete_team($1)`, [equipeA.team_id]);
  assert.equal((await rows(`select * from public.team_contacts`)).length, 0,
    "la cascade doit emporter la donnée personnelle avec l'équipe");
});

// ── La note ──────────────────────────────────────────────────────────────

test("la note se pose, et se repose", async () => {
  const { rows, as, avecContact, org } = await journee();
  await as(avecContact);
  await rows(`select public.rate_experience(3)`);
  await as(org);
  assert.equal((await rows(`select rating from public.players where rating is not null`))[0].rating, 3);

  // Changement d'avis : la seconde note remplace la première.
  await as(avecContact);
  await rows(`select public.rate_experience(5)`);
  await as(org);
  const notes = await rows(`select rating from public.players where rating is not null`);
  assert.equal(notes.length, 1, "on ne doit pas empiler deux notes pour un joueur");
  assert.equal(notes[0].rating, 5);
});

test("une note hors de 1..5 est refusée", async () => {
  const { rows, as, avecContact } = await journee();
  await as(avecContact);
  for (const mauvaise of [0, 6, -1]) {
    await assert.rejects(
      () => rows(`select public.rate_experience($1)`, [mauvaise]),
      /NOTE_INVALIDE/,
      `${mauvaise} aurait dû être refusée`
    );
  }
});

test("qui n'est pas inscrit ne note pas", async () => {
  const { rows, as, curieux } = await journee();
  await as(curieux);
  await assert.rejects(() => rows(`select public.rate_experience(5)`), /NON_INSCRIT/);
});

test("get_ratings rend la moyenne ET le détail — la moyenne seule ment", async () => {
  const { rows, as, avecContact, sansContact, org, game } = await journee();
  await as(avecContact);
  await rows(`select public.rate_experience(1)`);
  await as(sansContact);
  await rows(`select public.rate_experience(5)`);

  await as(org);
  const [{ r }] = await rows(`select public.get_ratings($1) as r`, [game.id]);
  assert.equal(r.count, 2);
  assert.equal(Number(r.average), 3, "1 et 5 font 3 de moyenne");
  assert.deepEqual(r.distribution, { 1: 1, 5: 1 },
    "et c'est le détail qui montre que personne n'a mis 3");
});

test("get_ratings ne répond qu'au propriétaire de la partie", async () => {
  const { rows, as, curieux, avecContact, game } = await journee();
  for (const intrus of [curieux, avecContact]) {
    await as(intrus);
    await assert.rejects(
      () => rows(`select public.get_ratings($1)`, [game.id]),
      /NON_AUTORISE/
    );
  }
});

test("sans aucune note, get_ratings rend zéro et non une erreur", async () => {
  const { rows, as, org, game } = await journee();
  await as(org);
  const [{ r }] = await rows(`select public.get_ratings($1) as r`, [game.id]);
  assert.equal(r.count, 0);
  assert.equal(r.average, null);
  assert.deepEqual(r.distribution, {});
});
