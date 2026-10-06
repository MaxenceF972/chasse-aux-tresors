/**
 * Jeu continu : la partie ouvre le matin SANS équipe, et chaque visiteur se
 * lance en arrivant. Le parcours naît à ce moment-là, pas au départ groupé.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, minutes } from "./harness.mjs";

/** Une journée ouverte : 6 énigmes au pool, 1 épreuve de départ, 1 finale. */
async function journeeOuverte() {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,'{"continuous":true}'::jsonb)`, [
    "Journée du 19 août",
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

  /** Un visiteur arrive : il crée son équipe puis se lance. Rend la main à
   *  l'organisateur, pour que le scénario puisse enchaîner ses propres appels. */
  const arrive = async (nom, pseudo, { lance = true } = {}) => {
    const uid = await newUser();
    await as(uid);
    const team = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, nom, pseudo]))[0].r;
    if (lance) await rows(`select public.start_team() as r`);
    await as(org);
    return { uid, ...team };
  };

  return { rows, as, org, game, arrive };
}

test("la partie du jour s'ouvre sans aucune équipe", async () => {
  const { rows, game } = await journeeOuverte();
  const [g] = await rows(`select status, started_at, route_perm from public.games where id = $1`, [game.id]);
  assert.equal(g.status, "running");
  assert.ok(g.started_at != null);
  assert.ok(g.route_perm?.length === 6, "l'ordre de visite des blocs est figé pour la journée");
});

test("un visiteur qui arrive en cours de journée obtient son parcours et son chrono", async () => {
  const { rows, arrive } = await journeeOuverte();
  const equipe = await arrive("Les Corsaires", "Aline");
  const routes = await rows(
    `select tr.position, tr.status, s.title, s.is_start, s.is_final
     from public.team_routes tr join public.steps s on s.id = tr.step_id
     where tr.team_id = $1 order by tr.position`, [equipe.team_id]
  );
  assert.equal(routes.length, 8, "épreuve de départ + 6 énigmes + finale");
  assert.equal(routes[0].is_start, true, "l'épreuve de départ ouvre le parcours");
  assert.equal(routes[0].status, "current");
  assert.equal(routes.at(-1).is_final, true, "la finale ferme le parcours");
  assert.equal(routes.filter((r) => r.status === "current").length, 1);

  const [t] = await rows(`select started_at from public.teams where id = $1`, [equipe.team_id]);
  assert.ok(t.started_at != null, "le chrono de l'équipe part à son lancement");
});

test("créer son équipe ne la lance pas : le chrono attend le départ", async () => {
  const { rows, arrive } = await journeeOuverte();
  const equipe = await arrive("Les Tortues", "Simon", { lance: false });
  const [t] = await rows(`select started_at from public.teams where id = $1`, [equipe.team_id]);
  assert.equal(t.started_at, null);
  const n = Number((await rows(
    `select count(*) as n from public.team_routes where team_id = $1`, [equipe.team_id]
  ))[0].n);
  assert.equal(n, 0, "aucun parcours tant que l'équipe n'est pas partie");
});

test("start_team est idempotent : deux appuis ne relancent pas le chrono", async () => {
  const { rows, as, arrive } = await journeeOuverte();
  const equipe = await arrive("Les Requins", "Aline");
  const [avant] = await rows(`select started_at from public.teams where id = $1`, [equipe.team_id]);
  await as(equipe.uid);
  const r = (await rows(`select public.start_team() as r`))[0].r;
  assert.equal(r.already, true);
  const [apres] = await rows(`select started_at from public.teams where id = $1`, [equipe.team_id]);
  assert.deepEqual(apres.started_at, avant.started_at);
});

test("six arrivées successives attaquent le pool par six énigmes distinctes", async () => {
  // Cas piège : la partie ouvre sur une épreuve de départ commune. Tant que
  // personne n'a atteint le pool, aucun bloc n'est « occupé » — c'est le point
  // d'attaque de chaque équipe qui doit les répartir.
  const { rows, arrive } = await journeeOuverte();
  const attaques = [];
  for (const [i, nom] of ["Les Corsaires", "Les Flibustiers", "Les Tortues", "Les Requins", "Les Sirènes", "Les Mouettes"].entries()) {
    const e = await arrive(nom, `Visiteur ${i + 1}`);
    const [premier] = await rows(
      `select s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
       where tr.team_id = $1 and not s.is_start and not s.is_final
       order by tr.position limit 1`, [e.team_id]
    );
    attaques.push(premier.title);
  }
  assert.equal(new Set(attaques).size, 6, `six points d'attaque distincts, obtenu : ${attaques.join(", ")}`);
});

test("deux visiteurs qui se suivent ne sont pas envoyés sur la même énigme", async () => {
  const { rows, arrive } = await journeeOuverte();
  // Chacun valide son épreuve de départ : les voilà sur le pool, là où les
  // parcours divergent.
  const premiere = async (teamId) => {
    const [r] = await rows(
      `select step_id from public.team_routes where team_id = $1 and status = 'current'`, [teamId]
    );
    return r.step_id;
  };
  const equipes = [];
  for (const [nom, pseudo] of [["Les Corsaires", "Aline"], ["Les Flibustiers", "Simon"], ["Les Tortues", "Marie"]]) {
    const e = await arrive(nom, pseudo);
    // L'épreuve de départ est commune : on la valide pour atteindre le pool.
    await rows(`select public.org_force_validate($1,$2)`, [e.team_id, await premiere(e.team_id)]);
    equipes.push(e);
  }
  const courantes = [];
  for (const e of equipes) courantes.push(await premiere(e.team_id));
  assert.equal(new Set(courantes).size, 3, "trois équipes, trois énigmes distinctes");
});

test("l'ordre de visite du pool est le même pour l'équipe du matin et celle du soir", async () => {
  const { rows, game, arrive } = await journeeOuverte();
  const matin = await arrive("Les Corsaires", "Aline");
  const soir = await arrive("Les Moussaillons", "Simon");
  const parcours = async (id) =>
    (await rows(
      `select s.title from public.team_routes tr join public.steps s on s.id = tr.step_id
       where tr.team_id = $1 and not s.is_start and not s.is_final order by tr.position`, [id]
    )).map((r) => r.title);

  // « Énigme 3 » est le 3e bloc du pool : on raisonne en index de bloc.
  const blocs = (titres) => titres.map((t) => Number(t.replace("Énigme ", "")) - 1);
  const [a, b] = [blocs(await parcours(matin.team_id)), blocs(await parcours(soir.team_id))];

  // L'invariant de l'anti-peloton : les deux équipes suivent le MÊME ordre de
  // visite (route_perm), à un décalage constant près. C'est ce décalage, et lui
  // seul, qui les sépare — d'où l'importance de ne pas re-tirer l'ordre à
  // chaque arrivée.
  const decalage = ((b[0] - a[0]) % 6 + 6) % 6;
  assert.notEqual(decalage, 0, "les deux ne commencent pas au même endroit");
  assert.ok(
    a.every((bloc, i) => b[i] === (bloc + decalage) % 6),
    `même ordre de visite à ${decalage} près (matin ${a.join(",")} / soir ${b.join(",")})`
  );
  const [g] = await rows(`select route_perm from public.games where id = $1`, [game.id]);
  assert.equal(g.route_perm.length, 6, "l'ordre tiré le matin n'a pas été re-tiré");
});

test("le classement du jour mêle arrivées et équipes encore en course", async () => {
  const { rows, game, arrive } = await journeeOuverte();
  const matin = await arrive("Les Corsaires", "Aline");
  const midi = await arrive("Les Flibustiers", "Simon");
  await rows(`update public.teams set started_at = now() - interval '3 hours' where id = $1`, [matin.team_id]);
  await rows(`update public.teams set started_at = now() - interval '20 minutes' where id = $1`, [midi.team_id]);

  // « Les Flibustiers » boucle son parcours en 20 minutes.
  const routes = await rows(
    `select step_id from public.team_routes where team_id = $1 order by position`, [midi.team_id]
  );
  for (const r of routes) await rows(`select public.org_force_validate($1,$2)`, [midi.team_id, r.step_id]);

  const ranking = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  assert.equal(ranking.teams[0].name, "Les Flibustiers");
  assert.equal(minutes(ranking.teams[0].time_ms), 20);
  assert.equal(minutes(ranking.teams[1].elapsed_ms), 180, "l'équipe du matin court toujours");
});

test("une partie pas encore ouverte refuse le départ d'une équipe", async () => {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,'{"continuous":true}'::jsonb)`, ["Demain"]);
  await rows(`insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Le phare',0)`, [game.id]);
  const visiteur = await newUser();
  await as(visiteur);
  await rows(`select public.create_team($1,$2,$3) as r`, [game.code, "Les Corsaires", "Aline"]);
  await assert.rejects(
    () => rows(`select public.start_team()`),
    /PARTIE_PAS_OUVERTE/,
    "le code du jour de demain ne fait pas partir aujourd'hui"
  );
});

test("une partie fermée refuse une nouvelle équipe", async () => {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1,'{"continuous":true}'::jsonb)`, ["Hier"]);
  await rows(`insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Le phare',0)`, [game.id]);
  await rows(`select public.start_game($1)`, [game.id]);
  await rows(`select public.org_set_status($1,'finished')`, [game.id]);
  const visiteur = await newUser();
  await as(visiteur);
  await assert.rejects(
    () => rows(`select public.create_team($1,$2,$3)`, [game.code, "Les Corsaires", "Aline"]),
    /PARTIE_TERMINEE/
  );
});

/**
 * Le visiteur qui rappuie. `create_team` fabriquait une équipe neuve à chaque
 * appel et y déplaçait le joueur : les précédentes restaient au classement,
 * vides. Constaté sur le terrain — treize équipes « Max » pour une personne.
 */
test("deux appels de create_team par le même visiteur ne font qu'une équipe", async () => {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  const visiteur = await newUser();

  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, ["Journée"]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Le phare',0)`,
    [game.id]
  );

  await as(visiteur);
  const a = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, "Max", "Max"]))[0].r;
  const b = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, "Max", "Max"]))[0].r;

  assert.equal(a.team_id, b.team_id, "la même équipe est reprise");
  assert.equal(b.reused, true);
  const n = Number(
    (await rows(`select count(*) as n from public.teams where game_id = $1`, [game.id]))[0].n
  );
  assert.equal(n, 1, "aucune équipe fantôme");
});

test("une équipe déjà partie n'est jamais reprise : on en crée bien une nouvelle", async () => {
  const { rows, as, newUser } = await freshDb();
  const org = await newUser();
  const visiteur = await newUser();

  await as(org);
  const [game] = await rows(`select * from public.org_create_game($1, '{"continuous":true}'::jsonb)`, ["Journée"]);
  await rows(
    `insert into public.steps (game_id, type, title, order_hint) values ($1,'text','Le phare',0)`,
    [game.id]
  );
  await rows(`select public.start_game($1)`, [game.id]);

  await as(visiteur);
  const a = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, "Max", "Max"]))[0].r;
  await rows(`select public.start_team()`);
  const b = (await rows(`select public.create_team($1,$2,$3) as r`, [game.code, "Aline", "Max"]))[0].r;

  assert.notEqual(a.team_id, b.team_id);
});

test("au classement, une équipe inscrite mais pas encore partie n'a pas de temps", async () => {
  // La journée est ouverte depuis le matin. Retomber sur l'ouverture de la
  // partie donnait à l'équipe qui attend au lobby des heures de course — et
  // parfois une place sur le podium.
  const { rows, game, arrive } = await journeeOuverte();
  await rows(`update public.games set started_at = now() - interval '5 hours' where id = $1`, [game.id]);
  const partie = await arrive("Les Corsaires", "Aline");
  const attend = await arrive("Les Tortues", "Simon", { lance: false });

  const r = (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r;
  const ligne = (id) => r.teams.find((t) => t.id === id);
  assert.equal(ligne(attend.team_id).elapsed_ms, null, "pas partie : pas de temps");
  assert.ok(ligne(partie.team_id).elapsed_ms < 60000, "son chrono part de SON départ");
  assert.equal(r.teams.at(-1).id, attend.team_id, "en fin de liste, après celles qui courent");
});

test("get_ranking dit au joueur quelle est son équipe — et à lui seul", async () => {
  // L'écran de fin oublie la session locale dès que la partie est close : il
  // reconnaît l'équipe du joueur par là, pour garder sa note et ses photos.
  const { rows, as, org, game, arrive } = await journeeOuverte();
  const equipe = await arrive("Les Corsaires", "Aline");
  await as(equipe.uid);
  assert.equal((await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r.my_team_id, equipe.team_id);
  await as(org);
  assert.equal(
    (await rows(`select public.get_ranking($1) as r`, [game.code]))[0].r.my_team_id,
    null,
    "l'organisateur n'a pas d'équipe"
  );
});
