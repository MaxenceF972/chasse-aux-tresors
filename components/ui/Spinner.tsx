export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="text-5xl animate-spin [animation-duration:2.5s]" aria-hidden>
        🧭
      </div>
      {label && <p className="font-display text-lg opacity-80">{label}</p>}
    </div>
  );
}
