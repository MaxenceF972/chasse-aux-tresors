/**
 * File de validations hors-ligne (IndexedDB).
 * Chaque tentative porte un idem_key : validate_step() est idempotente côté
 * serveur, un rejeu multiple est donc sans danger.
 */
import { rpc, isNetworkError } from "@/lib/supabase/client";
import type { ValidateKind, ValidateResult } from "@/lib/types";

export interface QueuedValidation {
  idem_key: string;
  step_id: string;
  kind: ValidateKind;
  payload: Record<string, unknown>;
  queued_at: number;
  /** validate_tag = scan d'URL de balise (l'étape est résolue côté serveur) */
  fn?: "validate_step" | "validate_tag";
}

const DB_NAME = "toyah-games";
const STORE = "validation-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "idem_key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function enqueueValidation(v: QueuedValidation): Promise<void> {
  await tx("readwrite", (s) => s.put(v));
}

export async function listQueued(): Promise<QueuedValidation[]> {
  return tx("readonly", (s) => s.getAll() as IDBRequest<QueuedValidation[]>);
}

export async function removeQueued(idemKey: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(idemKey));
}

/**
 * Rejoue la file. Retourne le nombre de validations effectivement traitées
 * par le serveur (correctes ou non). S'arrête au premier échec réseau.
 */
export async function flushQueue(): Promise<number> {
  const queued = (await listQueued()).sort((a, b) => a.queued_at - b.queued_at);
  let processed = 0;
  for (const v of queued) {
    try {
      if (v.fn === "validate_tag") {
        await rpc<ValidateResult>("validate_tag", {
          p_idem_key: v.idem_key,
          p_tag: String(v.payload.tag ?? ""),
        });
      } else {
        await rpc<ValidateResult>("validate_step", {
          p_idem_key: v.idem_key,
          p_step_id: v.step_id,
          p_kind: v.kind,
          p_payload: v.payload,
        });
      }
      await removeQueued(v.idem_key);
      processed++;
    } catch (err) {
      if (isNetworkError(err)) break; // toujours offline → on réessaiera
      await removeQueued(v.idem_key); // refus serveur → inutile de rejouer
    }
  }
  return processed;
}
