import Link from 'next/link';

/** /comprar/reservar sem `cotaId` (U2 A-26, Vera): estado vazio em PT, com h1 e caminho para escolher uma cota. */
export function SemCotaEscolhida() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight text-base">Escolha uma cota primeiro</h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        Você chegou aqui sem escolher uma cota. Veja as cotas listadas e selecione uma para continuar.
      </p>
      <Link
        href="/cotas"
        className="mt-8 inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
      >
        Ver cotas
      </Link>
    </div>
  );
}
