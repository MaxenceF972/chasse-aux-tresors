"use client";

import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, useState } from "react";

const base =
  "w-full rounded-xl border-[3px] border-ink bg-white text-ink font-bold " +
  "placeholder:text-ink/35 px-4 outline-none focus:ring-4 focus:ring-gold/60 " +
  "disabled:opacity-50 transition-shadow";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${base} h-13 text-lg ${className}`} {...props} />;
  }
);

/**
 * Champ de mot de passe, avec l'œil qui le dévoile.
 *
 * Sans lui, on tape à l'aveugle sur un clavier de téléphone qui corrige et
 * capitalise tout seul : la seule façon de savoir qu'on s'est trompé est de se
 * voir refuser la connexion, sans savoir si c'est le mot de passe ou l'adresse.
 * C'est là que les gens abandonnent.
 *
 * L'œil est un BOUTON, pas une case : il ne fait pas partie du formulaire, il
 * ne s'envoie pas, et `tabIndex={-1}` le sort du parcours au clavier — on passe
 * du mot de passe au bouton de connexion, pas par un interrupteur d'affichage.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordInput({ className = "", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={`${base} h-13 text-lg pr-14 ${className}`}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        className="absolute inset-y-0 right-0 w-13 flex items-center justify-center text-ink/50 hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="2.8" />
          {!visible && <path d="M4 20 20 4" />}
        </svg>
      </button>
    </div>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`${base} py-3 text-base ${className}`} {...props} />;
});

export function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block font-display text-sm uppercase tracking-wider mb-1.5 ${className}`}>
      {children}
    </label>
  );
}
