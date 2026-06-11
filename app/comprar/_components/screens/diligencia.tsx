import type { CotaResumo, DiligenciaData } from '../../_types';
import { BRL, TIPO_LABEL } from '../../_lib/glossary';

const ACAO_LABEL: Record<string, string> = {
  COTA_VALIDADA: 'Validação legal registrada',
  COTA_INCORPORADA: 'Cota incorporada ao pool',
  TOKEN_EMITIDO: 'PLINA-RF emitido',
};

function shortHash(h: string | null): string {
  if (!h) return '—';
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

function Check() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary-deep text-white text-[11px]"
    >
      ✓
    </span>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border border-light-hairline p-3 font-text text-sm text-base/85">
      <Check />
      <span>{children}</span>
    </div>
  );
}

export function DiligenciaScreen({
  selectedCota,
  data,
  loading,
  onContinue,
}: {
  selectedCota: CotaResumo | null;
  data: DiligenciaData | null;
  loading: boolean;
  onContinue: () => void;
}) {
  const tipo = selectedCota ? TIPO_LABEL[selectedCota.tipoBem] ?? selectedCota.tipoBem : '';
  const valor = selectedCota ? BRL.format(selectedCota.valorCarta) : '';

  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        02 // Due diligence
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Transparência total da cota.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        {tipo} · {valor} · verificação jurídica e prova on-chain.
      </p>

      {loading ? (
        <p className="mt-8 font-details text-[10px] tracking-[0.2em] uppercase text-base/55 animate-pulse">
          Carregando due diligence…
        </p>
      ) : !data ? (
        <p className="mt-8 font-text text-sm text-base/70">
          Não foi possível carregar a due diligence desta cota.
        </p>
      ) : (
        <>
          {/* Jurídico */}
          <div className="mt-8">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-3">
              Jurídico
            </p>
            <div className="space-y-3">
              <Item>Contemplação confirmada — laudo de validação legal arquivado.</Item>
              <Item>Adimplência verificada — parcelas em dia até a originação.</Item>
              <Item>Titularidade validada — CPF do cedente conferido na administradora.</Item>
              <Item>
                Cessão registrada — hash on-chain:{' '}
                <span className="font-mono text-xs">{shortHash(data.cota.hashCessao)}</span>
              </Item>
            </div>
          </div>

          {/* On-chain */}
          <div className="mt-8 border-y border-light-hairline py-6">
            <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-4">
              On-chain
            </p>
            <div className="grid grid-cols-1 gap-px bg-base/10">
              <Row k="Hash do laudo" v={shortHash(data.cota.hashValidacao)} />
              <Row k="Tx de validação" v={shortHash(data.cota.validacaoTxHash)} />
              <Row k="Tx de emissão" v={shortHash(data.cota.emissaoTxHash)} />
              <Row k="PLINA-RF emitido" v={data.cota.tokensEmitidos.toString()} />
            </div>
            {data.eventos.length > 0 && (
              <ul className="mt-4 space-y-2">
                {data.eventos.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-[11px] text-base/65">
                    <span className="text-primary-deep">✓</span>
                    {ACAO_LABEL[e.acao] ?? e.acao} · {shortHash(e.stellarTxHash)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <button
        onClick={onContinue}
        disabled={loading || !data}
        className="mt-10 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-50"
      >
        Avançar para proposta →
      </button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
      <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/65 sm:min-w-[160px]">
        {k}
      </span>
      <span className="font-mono text-xs text-base break-all">{v}</span>
    </div>
  );
}
