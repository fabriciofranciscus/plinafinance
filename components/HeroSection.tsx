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
            fontSize: 'clamp(3rem, 9vw, 7rem)',
            lineHeight: 0.95,
            letterSpacing: '-0.04em',
          }}
        >
          Cotas de consórcio
          <br />
          contempladas, agora
          <br />
          com liquidez global.
        </h1>
        <p className="font-details text-[10px] sm:text-xs md:text-sm text-white/70 uppercase tracking-[0.18em] sm:tracking-[0.25em] md:tracking-[0.3em] mt-10 max-w-3xl">
          Cotas de FIDC tokenizadas · Regulação CVM 175 · Investidores Qualificados
        </p>
      </div>

    </header>
  );
}
