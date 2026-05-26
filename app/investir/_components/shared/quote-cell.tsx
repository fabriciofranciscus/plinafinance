export function QuoteCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-6">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65">
        {label}
      </p>
      <p
        className={`font-mono text-xl mt-3 ${accent ? 'text-primary-deep font-medium' : 'text-base'}`}
      >
        {value}
      </p>
    </div>
  );
}
