/** Abonnement aux notifications push (Web Push, côté joueur). */
import { rpc } from "@/lib/supabase/client";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/**
 * Demande la permission, s'abonne et enregistre l'abonnement côté serveur
 * (lié à l'équipe pour le ciblage des messages de l'organisateur).
 */
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Notifications non supportées ici." };
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return { ok: false, error: "Push non configuré." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Permission refusée — active les notifications dans les réglages." };
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { ok: false, error: "Notifications indisponibles ici (service worker inactif)." };
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid).buffer as ArrayBuffer,
    }));

  await rpc("save_push_subscription", { p_subscription: sub.toJSON() });
  return { ok: true };
}
