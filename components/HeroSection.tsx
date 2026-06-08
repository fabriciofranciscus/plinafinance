export default function HeroSection() {
  return (
    <header
      className="relative w-full h-[100vh] min-h-[600px] flex items-center overflow-hidden"
      style={{
        backgroundColor: '#132728',
        backgroundImage: "url('/hero-fractal.svg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Conteúdo principal */}
      <div className="max-w-[1400px] mx-auto w-full px-6 relative z-10 animate-hero-text text-left">
        <h1
          className="font-title font-medium text-white drop-shadow-2xl"
          style={{
            fontSize: 'clamp(2.25rem, 6vw, 5rem)',
            lineHeight: 0.95,
            letterSpacing: '-0.04em',
          }}
        >
          Liquidez para o cotista.
          <br />
          Desconto para o comprador.
          <br />
          <span style={{ color: 'var(--color-auditable-cyan)' }}>
            Yield institucional
          </span>{' '}
          para o mundo.
        </h1>
        <p className="font-details text-base sm:text-lg leading-relaxed text-white/70 mt-10 whitespace-normal lg:whitespace-nowrap">
          Pool tokenizado de cotas de consórcio contempladas, estruturado como
          FIDC sob CVM 175 e emitido na Stellar como{' '}
          <span className="font-mono text-white">PLINA-RF</span>.
        </p>
      </div>

    </header>
  );
}
