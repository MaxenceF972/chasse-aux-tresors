"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "gold" | "crimson" | "parchment" | "leaf" | "ghost" | "outline" | "outline-crimson";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  gold: "bg-gold text-ink border-ink hover:bg-gold-light",
  crimson: "bg-crimson text-parchment border-ink hover:bg-crimson-dark",
  parchment: "bg-parchment text-ink border-ink hover:bg-parchment-dark",
  leaf: "bg-leaf text-parchment border-ink hover:bg-leaf-light",
  /* Secondaire sur fond sombre : contour parchemin bien visible */
  ghost: "bg-parchment/10 text-parchment border-parchment/70 hover:bg-parchment/20",
  /* Secondaire sur fond parchemin : carte blanche cerclée d'encre */
  outline: "bg-white/50 text-ink border-ink hover:bg-white/70",
  /* Secondaire « risqué » (passer l'étape…) : même base, texte rouge */
  "outline-crimson": "bg-white/50 text-crimson border-ink hover:bg-white/70",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-12 px-5 text-base",
  lg: "h-14 px-6 text-lg",
  xl: "h-16 px-8 text-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "gold", size = "md", full, className = "", children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={[
        "font-display tracking-wide rounded-2xl border-[3px]",
        "shadow-[0_5px_0_0_#111111] active:translate-y-[4px] active:shadow-[0_1px_0_0_#111111]",
        "transition-[transform,box-shadow,background-color] duration-100 select-none",
        "disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2",
        variants[variant],
        sizes[size],
        full ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
