"use client";

import { motion } from "framer-motion";

interface ProgressPathProps {
  total: number;
  done: number;
  color?: string;
}

/**
 * La progression de l'équipe dessinée comme un chemin en pointillés
 * sur la carte, qui mène au "X" rouge du trésor.
 */
export default function ProgressPath({ total, done, color = "#F5A623" }: ProgressPathProps) {
  const n = Math.max(2, total);
  const W = 100 * (n - 1);
  const H = 88;
  const pad = 26;

  const pts = Array.from({ length: n }, (_, i) => ({
    x: pad + (i * (W - pad * 2)) / (n - 1),
    y: H / 2 + Math.sin(i * 1.35) * 18,
  }));

  const segments = pts.slice(0, -1).map((p, i) => ({ a: p, b: pts[i + 1] }));

  return (
    <div className="w-full overflow-x-auto no-scrollbar" dir="ltr">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-16 min-w-full"
        style={{ width: n > 8 ? `${n * 44}px` : "100%" }}
        aria-label={`Progression : ${done} sur ${total}`}
      >
        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.a.x}
            y1={s.a.y}
            x2={s.b.x}
            y2={s.b.y}
            stroke={i < done ? color : "#11111155"}
            strokeWidth={4}
            strokeDasharray="7 8"
            strokeLinecap="round"
          />
        ))}
        {pts.map((p, i) => {
          const isLast = i === n - 1;
          const isDone = i < done;
          const isCurrent = i === done && !isLast;

          if (isLast) {
            // Le X du trésor
            const s = done >= total ? 13 : 10;
            return (
              <g key={i}>
                {done >= total - 1 && (
                  <circle cx={p.x} cy={p.y} r={16} fill="#C0392B22">
                    <animate attributeName="r" values="12;19;12" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <line x1={p.x - s} y1={p.y - s} x2={p.x + s} y2={p.y + s} stroke="#C0392B" strokeWidth={7} strokeLinecap="round" />
                <line x1={p.x - s} y1={p.y + s} x2={p.x + s} y2={p.y - s} stroke="#C0392B" strokeWidth={7} strokeLinecap="round" />
                <line x1={p.x - s} y1={p.y - s} x2={p.x + s} y2={p.y + s} stroke="#11111133" strokeWidth={9} strokeLinecap="round" opacity={0.25} />
              </g>
            );
          }

          return (
            <g key={i}>
              {isCurrent && (
                <circle cx={p.x} cy={p.y} r={10} fill="none" stroke={color} strokeWidth={3}>
                  <animate attributeName="r" values="8;15" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isDone || isCurrent ? 9 : 6}
                fill={isDone ? color : isCurrent ? "#ffffff" : "#1111112e"}
                stroke="#111111"
                strokeWidth={isDone || isCurrent ? 3 : 2}
              />
              {isDone && (
                <motion.path
                  d={`M ${p.x - 4} ${p.y} l 3 3.5 l 5.5 -7`}
                  fill="none"
                  stroke="#111111"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
