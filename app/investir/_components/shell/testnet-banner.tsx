export function TestnetBanner() {
  return (
    <div
      role="note"
      className="mb-8 bg-lightBg border-y border-base/15 px-5 py-3 flex items-center gap-3"
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-primary-deep flex-shrink-0"
        aria-hidden
      />
      <p className="font-details text-[10px] tracking-[0.25em] uppercase text-base">
        Stellar testnet · não é mainnet · sem valor financeiro real
      </p>
    </div>
  );
}
