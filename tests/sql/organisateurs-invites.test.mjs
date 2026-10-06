/**
 * Les organisateurs invités — LECTURE SEULE.
 *
 * La demande du client était nette : des gens du personnel qui voient les
 * statistiques, les étoiles, les photos et les participants. Rien de plus.
 *
 * « Rien de plus » est la partie difficile, et c'est celle que ce fichier
 * garde. Cacher les boutons ne suffit pas : ce qui compte est ce que le
 * SERVEUR refuse. Une partie garde donc UN propriétaire, et les onze fonctions
 * d'écriture continuent toutes de comparer à `created_by` — seules les
 * politiques de SELECT se sont ouvertes.
 *
 * Les lectures sont vérifiées SOUS LA RLS (`sousRls`), sans quoi elles
 * passeraient toutes en superutilisateur et ne prouveraient rien.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";

const PATRON = { uid: null, email: "patron@toyah-games.app" };
const INVITE = { uid: null, email: "Stagiaire@Toyah-Games.app" }; // casse mélangée exprès
const ETRANGER = { uid: null, email: "voisin@ailleurs.fr" };

/** Une partie, un invité, une équipe en course avec son contact et sa note. */
async function journee({ inviter = true } = {}) {
  const { rows, as, sousRls, newUser } = await freshDb();
  const patron = { ...PATRON, uid: await newUser() };
  const invite = { ...INVITE, uid: await newUser() };
  const etranger = { ...ETRANGER, uid: await newUser() };
  const visiteur = await newUser(); // session anonyme : aucune adresse

  await as(patron);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, [
    "Journée du 18 septembre",
  ]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint) values ($1,'text',$2,0)`,
    [game.id, "Le phare"]
  );
  await rows(
    `insert into public.step_secrets (step_id, answers) select id, '{phare}' from public.steps where game_id = $1`,
    [game.id]
  );
  if (inviter) {
    await rows(`select public.org_add_staff($1,$2)`, [game.id, invite.email]);
  }

  await as(visiteur);
  const equipe = (await rows(`select public.create_team($1,$2,$3,'{}',$4) as r`, [
    game.code, "Les Corsaires", "Aline", "aline@exemple.fr",
  ]))[0].r;

  await as(patron);
  await rows(`select public.start_game($1)`, [game.id]);

  await as(visiteur);
  await rows(`select public.rate_experience(4)`);

  return { rows, as, sousRls, patron, invite, etranger, visiteur, game, equipe };
}

// ── CE QU'UN INVITÉ VOIT ─────────────────────────────────────────────────

test("l'invité voit la partie — donc elle apparaît dans son tableau de bord", async () => {
  const { rows, sousRls, invite } = await journee();
  const parties = await sousRls(invite, () => rows(`select id, name from public.games`));
  assert.equal(parties.length, 1, "sans ça, l'invité se connecte sur un écran vide");
});

test("l'adresse est comparée SANS tenir compte de la casse", async () => {
  // Invité en « Stagiaire@Toyah-Games.app », il se connectera peut-être en minuscules.
  // Une correspondance sensible à la casse donnerait un accès qui marche un
  // jour sur deux, selon ce que la personne a tapé à l'inscription.
  const { rows, sousRls, invite } = await journee();
  const enBas = { uid: invite.uid, email: invite.email.toLowerCase() };
  const enHaut = { uid: invite.uid, email: invite.email.toUpperCase() };
  for (const variante of [enBas, enHaut]) {
    assert.equal(
      (await sousRls(variante, () => rows(`select id from public.games`))).length, 1,
      `${variante.email} devrait ouvrir la partie`
    );
  }
});

test("l'invité voit les équipes, les participants et leurs coordonnées", async () => {
  const { rows, sousRls, invite } = await journee();
  await sousRls(invite, async () => {
    assert.equal((await rows(`select * from public.teams`)).length, 1, "équipes");
    assert.equal((await rows(`select * from public.players`)).length, 1, "participants");
    assert.equal((await rows(`select * from public.team_contacts`)).length, 1, "coordonnées");
  });
});

test("l'invité voit les étoiles", async () => {
  const { rows, sousRls, invite, game } = await journee();
  const [{ r }] = await sousRls(invite, () =>
    rows(`select public.get_ratings($1) as r`, [game.id])
  );
  assert.equal(r.count, 1);
  assert.equal(Number(r.average), 4);
});

test("l'invité voit la progression, le journal et les photos", async () => {
  const { rows, sousRls, invite } = await journee();
  await sousRls(invite, async () => {
    assert.ok((await rows(`select * from public.team_routes`)).length > 0, "progression");
    assert.ok((await rows(`select * from public.events`)).length > 0, "journal");
    // Table vide ici, mais la lecture ne doit pas être refusée.
    await rows(`select * from public.submissions`);
    assert.ok((await rows(`select * from public.steps`)).length > 0, "étapes");
  });
});

// ── CE QU'UN INVITÉ NE VOIT PAS ──────────────────────────────────────────

test("L'INVITÉ NE VOIT PAS LES SECRETS DES ÉPREUVES", async () => {
  // Réponses, identifiants de balise, coordonnées : ça ne sert à aucune
  // statistique, et ça permettrait de souffler les solutions.
  const { rows, sousRls, invite, patron } = await journee();
  assert.equal(
    (await sousRls(invite, () => rows(`select * from public.step_secrets`))).length, 0
  );
  // Témoin : le propriétaire, lui, les voit — le test ne passe pas « parce que
  // la table est vide ».
  assert.equal(
    (await sousRls(patron, () => rows(`select * from public.step_secrets`))).length, 1
  );
});

test("l'invité ne voit pas la liste des autres invités", async () => {
  const { rows, sousRls, invite } = await journee();
  assert.equal((await sousRls(invite, () => rows(`select * from public.game_staff`))).length, 0);
});

// ── CE QU'UN INVITÉ NE PEUT PAS FAIRE ────────────────────────────────────

test("L'INVITÉ NE PEUT RIEN ÉCRIRE — le serveur refuse, pas l'interface", async () => {
  const { rows, as, invite, game, equipe } = await journee();
  await as(invite);
  const interdits = [
    [`select public.org_set_status($1,'paused')`, [game.id]],
    [`select public.org_force_validate($1,$2)`, [equipe.team_id,
      (await rows(`select id from public.steps limit 1`))[0].id]],
    [`select public.org_rename_team($1,'Pirates')`, [equipe.team_id]],
    [`select public.org_delete_team($1)`, [equipe.team_id]],
    [`select public.org_send_hint($1,'coucou')`, [equipe.team_id]],
    [`select public.org_broadcast($1,'info','coucou')`, [game.id]],
    [`select public.org_award_bonus($1,100,0,'triche')`, [equipe.team_id]],
    [`select public.org_neutralize_step($1,$2)`, [game.id,
      (await rows(`select id from public.steps limit 1`))[0].id]],
    [`select public.org_delete_step($1)`, [
      (await rows(`select id from public.steps limit 1`))[0].id]],
    [`select public.org_duplicate_game($1)`, [game.id]],
  ];
  for (const [sql, params] of interdits) {
    await assert.rejects(
      () => rows(sql, params),
      /INTERDIT|NON_AUTORISE/,
      `${sql.slice(14, 45)} aurait dû être refusé`
    );
  }
});

test("l'invité ne peut pas inviter quelqu'un d'autre, ni se retirer lui-même", async () => {
  // Sinon l'invitation se propage toute seule et le propriétaire perd la main
  // sur qui voit les coordonnées de ses visiteurs.
  const { rows, as, invite, etranger, game } = await journee();
  await as(invite);
  await assert.rejects(
    () => rows(`select public.org_add_staff($1,$2)`, [game.id, etranger.email]),
    /INTERDIT/
  );
  await assert.rejects(
    () => rows(`select public.org_remove_staff($1,$2)`, [game.id, invite.email]),
    /INTERDIT/
  );
});

test("l'invité ne peut pas écrire en direct dans les tables", async () => {
  // Les politiques d'écriture sont restées sur `is_game_owner` : c'est la
  // ligne de partage de toute cette fonctionnalité.
  //
  // ATTENTION À LA FORME DE CE TEST. Une politique RLS ne LÈVE PAS d'erreur
  // sur un UPDATE : elle filtre les lignes, et une mise à jour qui n'en
  // trouve aucune réussit tranquillement en n'en touchant zéro. Attendre une
  // exception, c'était écrire un test qui échoue alors que la protection
  // marche. On vérifie donc l'EFFET : la valeur n'a pas bougé.
  // Un INSERT, lui, se heurte au `with check` et lève bien.
  const { rows, as, sousRls, patron, invite, equipe } = await journee();

  await sousRls(invite, async () => {
    await rows(`update public.teams set name = 'Pirates' where id = $1`, [equipe.team_id]);
    await assert.rejects(
      () => rows(`insert into public.steps (game_id, type, title)
                  select game_id, 'text', 'x' from public.teams limit 1`),
      /policy|denied|permission/i,
      "un invité a pu ajouter une étape"
    );
  });

  await as(patron);
  assert.equal(
    (await rows(`select name from public.teams where id = $1`, [equipe.team_id]))[0].name,
    "Les Corsaires",
    "l'invité a renommé une équipe"
  );
  assert.equal(
    (await rows(`select count(*)::int as n from public.steps`))[0].n, 1,
    "une étape a été ajoutée par un invité"
  );
});

// ── QUI N'EST PAS INVITÉ ─────────────────────────────────────────────────

test("une adresse inconnue ne voit rien", async () => {
  const { rows, sousRls, etranger } = await journee();
  await sousRls(etranger, async () => {
    assert.equal((await rows(`select * from public.games`)).length, 0);
    assert.equal((await rows(`select * from public.team_contacts`)).length, 0);
  });
});

test("UN JOUEUR N'EST JAMAIS DU PERSONNEL", async () => {
  // Les visiteurs jouent en session anonyme : aucune adresse dans le jeton.
  // Si `is_game_staff` répondait vrai sur une chaîne vide, toute une journée de
  // visiteurs lirait les coordonnées des autres.
  const { rows, sousRls, visiteur } = await journee();
  assert.equal(
    (await sousRls(visiteur, () => rows(`select * from public.team_contacts`))).length, 0,
    "un visiteur sans adresse a été pris pour du personnel"
  );
});

test("sans invitation, même une adresse valide ne voit rien", async () => {
  const { rows, sousRls, invite } = await journee({ inviter: false });
  assert.equal((await sousRls(invite, () => rows(`select * from public.games`))).length, 0);
});

test("retirer un invité lui coupe l'accès", async () => {
  const { rows, as, sousRls, patron, invite, game } = await journee();
  assert.equal((await sousRls(invite, () => rows(`select * from public.games`))).length, 1);

  await as(patron);
  await rows(`select public.org_remove_staff($1,$2)`, [game.id, invite.email]);

  assert.equal(
    (await sousRls(invite, () => rows(`select * from public.games`))).length, 0,
    "l'accès doit tomber — il n'y a pas de jeton à révoquer, la ligne fait foi"
  );
});

// ── LA GESTION, CÔTÉ PROPRIÉTAIRE ────────────────────────────────────────

test("le propriétaire gère la liste, et l'adresse est rangée en minuscules", async () => {
  const { rows, as, patron, game } = await journee();
  await as(patron);
  const liste = await rows(`select email from public.game_staff where game_id = $1`, [game.id]);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].email, INVITE.email.toLowerCase());
});

test("inviter deux fois la même adresse ne la double pas", async () => {
  const { rows, as, patron, invite, game } = await journee();
  await as(patron);
  await rows(`select public.org_add_staff($1,$2)`, [game.id, invite.email.toUpperCase()]);
  assert.equal(
    (await rows(`select * from public.game_staff where game_id = $1`, [game.id])).length, 1
  );
});

test("une adresse mal formée est refusée", async () => {
  const { rows, as, patron, game } = await journee();
  await as(patron);
  for (const mauvaise of ["", "  ", "pasunmail", "a@b", "a b@c.fr"]) {
    await assert.rejects(
      () => rows(`select public.org_add_staff($1,$2)`, [game.id, mauvaise]),
      /EMAIL_INVALIDE/,
      `« ${mauvaise} » aurait dû être refusée`
    );
  }
});

test("les invités partent avec la partie", async () => {
  const { rows, as, patron, game } = await journee();
  await as(patron);
  await rows(`delete from public.games where id = $1`, [game.id]);
  assert.equal((await rows(`select * from public.game_staff`)).length, 0);
});
