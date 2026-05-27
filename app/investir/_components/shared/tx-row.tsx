import { explorerTx } from '../../_lib/format';

export function TxRow({ label, hash, idx }: { label: string; hash: string; idx: number }) {
  return (
    <li className="relative bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 group hover:bg-lightBg/30 transition-colors">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[2px] bg-primary scale-y-100 origin-top"
      />
      <span className="font-mono text-[11px] text-primary-deep sm:min-w-[24px]">
        {String(idx).padStart(2, '0')}
      </span>
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base sm:min-w-[100px]">
        {label}
      </span>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[11px] text-base/85 hover:text-primary-deep transition-colors break-all flex-1"
      >
        {hash}
      </a>
    </li>
  );
}
