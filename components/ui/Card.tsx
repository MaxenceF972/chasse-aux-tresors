import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  texture?: boolean;
  dark?: boolean;
}

export default function Card({
  texture = true,
  dark = false,
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={[
        "rounded-2xl border-[3px] border-ink shadow-[6px_6px_0_0_#111111]",
        dark ? "bg-ink-soft text-parchment" : texture ? "parchment-texture text-ink" : "bg-parchment text-ink",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
