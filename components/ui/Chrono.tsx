"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/game/format";

interface ChronoProps {
  startedAt: string | null;
  finishedAt?: string | null;
  penaltySeconds?: number;
  className?: string;
}

export default function Chrono({
  startedAt,
  finishedAt,
  penaltySeconds = 0,
  className = "",
}: ChronoProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt, finishedAt]);

  if (!startedAt) return <span className={className}>--:--</span>;

  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(startedAt).getTime()) + penaltySeconds * 1000;

  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {formatDuration(ms)}
    </span>
  );
}
