"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { sb } from "@/lib/supabase/client";

/**
 * Garde d'authentification des pages organisateur : exige un compte
 * email (non anonyme), sinon redirige vers /org/login.
 */
export function useOrgAuth() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    sb()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const u = data.session?.user ?? null;
        if (!u || u.is_anonymous) {
          router.replace("/org/login");
        } else {
          setUser(u);
        }
        setLoading(false);
      });

    const { data: sub } = sb().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const u = session?.user ?? null;
      if (!u || u.is_anonymous) {
        router.replace("/org/login");
      } else {
        setUser(u);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return { user, loading };
}
