import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Le garde-fou de configuration Supabase. On recharge le module à chaque cas :
 * sb() mémorise son client, et l'environnement est lu au premier appel.
 */
async function sbAvec(url?: string, key?: string) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
  const mod = await import(`@/lib/supabase/client?cas=${Math.random()}`);
  return mod.sb as () => unknown;
}

test("variable absente : le message nomme laquelle", async () => {
  const sb = await sbAvec(undefined, "eyJcle");
  assert.throws(sb, /CONFIG_SUPABASE_MANQUANTE.*NEXT_PUBLIC_SUPABASE_URL/s);
});

test("URL amputée de son premier caractère : la valeur fautive est montrée", async () => {
  // Le cas réellement rencontré en production : « h » avalé au collage.
  const sb = await sbAvec("ttps://abcdefghijklmnopqrst.supabase.co", "eyJcle");
  assert.throws(sb, /ttps:\/\/abcdefghijklmnopqrst/);
  assert.throws(sb, /CONFIG_SUPABASE_MANQUANTE/);
});

test("valeurs douteuses rejetées", async () => {
  for (const url of ["abcdefghijklmnopqrst", "abcdefghijklmnopqrst.supabase.co", "  ", "postgres://x"]) {
    const sb = await sbAvec(url, "eyJcle");
    assert.throws(sb, /CONFIG_SUPABASE_MANQUANTE/, `« ${url} » aurait dû être refusée`);
  }
});

test("URL correcte : aucun refus", async () => {
  const sb = await sbAvec("https://abcdefghijklmnopqrst.supabase.co", "eyJcle");
  assert.doesNotThrow(sb);
});
