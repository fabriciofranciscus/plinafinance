import Link from 'next/link';

/**
 * 404 própria em PT (U2 A-18, Vera). Renderiza dentro do layout raiz (cabeçalho e rodapé do app).
 * Texto validado por Consuelo/Norma; sem termo interno, sem prazo.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 md:py-24">
      <h1 className="font-title text-3xl md:text-4xl font-semibold tracking-tight text-base">Página não encontrada</h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        O endereço que você abriu não existe ou foi movido.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
