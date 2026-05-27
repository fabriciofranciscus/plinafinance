import type { ReactNode } from 'react';

export function DataRow({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 sm:min-w-[180px]">
        {k}
      </span>
      <span className={`${mono ? 'font-mono text-xs' : 'text-sm'} text-base break-all`}>{v}</span>
    </div>
  );
}
