// Applique supabase/setup.sql sur la base distante.
// Usage : définir DATABASE_URL dans .env.local puis `npm run db:apply`.
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

// Mini-chargeur .env.local (pas de dépendance dotenv)
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL manquant. Ajoute dans .env.local :\n" +
      "DATABASE_URL=postgresql://postgres.kfuqteblifzrxodpioex:[MOT_DE_PASSE_DB]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
  );
  process.exit(1);
}

const sql = readFileSync("supabase/setup.sql", "utf8");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("✅ Schéma TOYAH GAMES appliqué avec succès.");
} catch (err) {
  console.error("❌ Erreur SQL :", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
