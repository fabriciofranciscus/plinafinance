import type { CotaResumo, ReservaData } from '../../_types';
import { BRL, TIPO_LABEL, valorRevenda } from '../../_lib/glossary';

const ROTULO = 'font-details text-[10px] tracking-[0.2em] uppercase text-base/70';

/**
 * Faixa de contexto persistente (AP-5 /comprar, C1/C2): a cota escolhida, os valores e, depois de reservar, a validade
 * real da reserva (`expiraEm`, sem contagem regressiva nem estado "expirada" calculado no cliente). Só rótulos que já
 * existem na Proposta. Nenhum valor novo: `valorRevenda` é o mesmo cálculo de sempre.
 */
export function FaixaContexto({
  cota,
  reserva,
  soCota = false,
  semValorAPagar = false,
}: {
  cota: CotaResumo | null;
  reserva: ReservaData | null;
  /** Proposta: a tabela já traz os valores. */
  soCota?: boolean;
  /** Confirmação pendente: "Valor a pagar" fica só na frase (`valorRealizado`). */
  semValorAPagar?: boolean;
}) {
  if (!cota) return null;

  const tipo = TIPO_LABEL[cota.tipoBem] ?? cota.tipoBem;
  const linhas: { k: string; v: string; mono?: boolean; forte?: boolean }[] = [
    { k: 'Cota', v: `${tipo}${cota.localizacaoAprox ? ` · ${cota.localizacaoAprox}` : ''}` },
  ];
  if (!soCota) {
    linhas.push({ k: 'Valor de face', v: BRL.format(cota.valorCarta), mono: true });
    if (!semValorAPagar) {
      linhas.push({ k: 'Valor a pagar', v: BRL.format(valorRevenda(cota.valorCarta, cota.desagioRevenda)), mono: true, forte: true });
    }
    if (reserva) {
      linhas.push({ k: 'Validade da reserva', v: new Date(reserva.expiraEm).toLocaleString('pt-BR', { hour12: false }), mono: true });
    }
  }

  return (
    <dl
      data-testid="faixa-contexto"
      className="mt-6 grid grid-cols-1 gap-4 border-y border-light-hairline py-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      {linhas.map((l) => (
        <div key={l.k} className="min-w-0">
          <dt className={ROTULO}>{l.k}</dt>
          <dd
            className={`mt-1 break-words ${l.mono ? 'font-mono' : 'font-text'} ${
              l.forte ? 'text-base font-bold text-base' : 'text-sm text-base'
            }`}
          >
            {l.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
