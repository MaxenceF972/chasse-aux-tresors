"use client";

import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";

const base =
  "w-full rounded-xl border-[3px] border-ink bg-white text-ink font-bold " +
  "placeholder:text-ink/35 px-4 outline-none focus:ring-4 focus:ring-gold/60 " +
  "disabled:opacity-50 transition-shadow";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${base} h-13 text-lg ${className}`} {...props} />;
  }
);

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
