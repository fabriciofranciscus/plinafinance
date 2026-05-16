/**
 * /pool — composição pública do pool PLINA-RF.
 *
 * Transparência é o produto (PRODUCT.md, princípio 3: auditabilidade > marketing).
 * Mostra cotas no pool, NAV total, tokens emitidos. Cada item link pro
 * Stellar Expert.
 *
 * Server Component. PII off-chain (administradora **não** é exposta
 * publicamente — fica só no painel da operação). Voz institucional, tom
 * editorial, números em mono.
 */

import { db } from '@/lib/db';
import {
  caixaRealizado,
  navDaCota,
  navPorToken,
  navTotalDoPool,
  spreadRealizadoAcumulado,
  tokensEmitidosVivos,
} from '@/lib/services/pool';
import { accountExplorerUrl, assetExplorerUrl } from '@/lib/stellar/config';

// SSR sempre — dados de pool mudam quando admin incorpora cota.
export const dynamic = 'force-dynamic';

const TIPO_BEM_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviço',
};

const STATUS_ESTOQUE_LABEL: Record<string, string> = {
  VERDE: 'Ativa',
  AMARELO: 'Em revisão',
  VERMELHO: 'Em liquidação',
  BAIXA: 'Baixada',
};

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function tokenFmt(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default async function PoolPage() {
  const [parametros, cotas, realizacoes] = await Promise.all([
    db.parametrosPool.findUnique({ where: { id: 'singleton' } }),
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      orderBy: { criadaEm: 'asc' },
    }),
    db.realizacaoCaminho.findMany({
      select: { valorRealizado: true, spread: true },
    }),
  ]);

  if (!parametros) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-24">
        <p className="font-mono text-sm">
          Pool não inicializado. Rodar <code>npm run prisma:seed</code>.
        </p>
      </div>
    );
  }

  const navTotal = navTotalDoPool(cotas, realizacoes);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const navUnit = navPorToken(cotas, realizacoes);
  const caixa = caixaRealizado(realizacoes);
  const spreadAcumulado = spreadRealizadoAcumulado(realizacoes);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <header className="mb-12 border-b border-light-hairline pb-8">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Pool · PLINA-RF · {parametros.network}
        </p>
        <h1 className="font-title mt-3 text-4xl md:text-5xl font-semibold tracking-tight">
          Composição pública do pool
        </h1>
        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="font-text max-w-3xl text-lg text-base/80 leading-relaxed">
            Direito creditório de cotas de consórcio contempladas adquiridas
            com capital próprio. Cada token PLINA-RF representa R$ 1,00 de NAV
            ajustado pela curva de realização. Auditável em tempo real via
            Stellar Expert.
          </p>
          <a
            href="/investir"
            className="self-start whitespace-nowrap bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
          >
            Acesso institucional →
          </a>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15 mb-12 border border-light-hairline">
        <Metric
          label="NAV total"
          value={brl(navTotal)}
          sublabel={`${cotas.length} cota${cotas.length === 1 ? '' : 's'} ativa${
            cotas.length === 1 ? '' : 's'
          } no pool`}
        />
        <Metric
          label={`${parametros.assetCode} emitido`}
          value={tokenFmt(tokensVivos)}
          sublabel={`NAV por token · ${brl(navUnit)}`}
        />
        <Metric
          label="Rede"
          value={parametros.network}
          sublabel={
            <a
              href={assetExplorerUrl(parametros.issuerPubkey)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-base/30 underline-offset-4 hover:decoration-primary"
            >
              Ver asset no Stellar Expert →
            </a>
          }
        />
      </section>

      {spreadAcumulado > 0 && (
        <section className="mb-12 border-y border-light-hairline">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-base/15">
            <Metric
              label="Caixa realizado"
              value={brl(caixa)}
              sublabel="BRL retornado ao fundo via realização de cotas (Caminho A/B/C)"
            />
            <Metric
              label="Yield realizado acumulado"
              value={brl(spreadAcumulado)}
              sublabel="Spread capturado em realizações já executadas"
            />
            <Metric
              label="NAV por token"
              value={brl(navUnit)}
              sublabel="Inclui caixa realizado — > R$ 1,00 sinaliza yield acumulado"
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="font-title text-2xl font-semibold mb-6 tracking-tight">
          Cotas no pool
        </h2>
        <div className="border border-light-hairline">
          <table className="w-full font-text text-sm">
            <thead className="bg-base text-lightBg">
              <tr>
                <Th>Tipo de bem</Th>
                <Th>Valor da carta</Th>
                <Th>Deságio aquisição</Th>
                <Th>NAV</Th>
                <Th>PLINA-RF emitido</Th>
                <Th>Local aprox.</Th>
                <Th>Prazo</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {cotas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-base/60">
                    Nenhuma cota incorporada ainda.
                  </td>
                </tr>
              ) : (
                cotas.map((c) => {
                  const nav = navDaCota({
                    valorCarta: c.valorCarta,
                    desagioAquisicao: c.desagioAquisicao,
                  });
                  return (
                    <tr
                      key={c.id}
                      className="border-t border-light-hairline hover:bg-primary/5 transition-colors"
                    >
                      <Td>{TIPO_BEM_LABEL[c.tipoBem] ?? c.tipoBem}</Td>
                      <Td mono>{brl(Number(c.valorCarta))}</Td>
                      <Td mono>{pct(Number(c.desagioAquisicao))}</Td>
                      <Td mono>{brl(nav)}</Td>
                      <Td mono>{tokenFmt(Number(c.tokensEmitidos))}</Td>
                      <Td>{c.localizacaoAprox ?? '—'}</Td>
                      <Td mono>
                        {c.prazoRestanteMeses ? `${c.prazoRestanteMeses}m` : '—'}
                      </Td>
                      <Td>
                        <span className="font-details text-[10px] tracking-[0.15em] uppercase">
                          {STATUS_ESTOQUE_LABEL[c.statusEstoque] ?? c.statusEstoque}
                        </span>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="font-text text-xs text-base/60 mt-4">
          Administradoras e identificadores específicos das cotas ficam
          off-chain, sob custódia do gestor do FIDC. On-chain expomos apenas
          NAV, hash de emissão e endereços públicos. Política de privacidade
          off-chain conforme LGPD.
        </p>
      </section>

      <section className="mt-16 border-t border-light-hairline pt-8 grid grid-cols-1 md:grid-cols-2 gap-8 font-text text-sm">
        <div>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-2">
            Issuer
          </p>
          <a
            href={accountExplorerUrl(parametros.issuerPubkey)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs break-all underline decoration-base/30 underline-offset-4 hover:decoration-primary"
          >
            {parametros.issuerPubkey}
          </a>
          <p className="text-xs text-base/60 mt-2">
            Configurado com <span className="font-mono">AUTH_REQUIRED</span>,{' '}
            <span className="font-mono">AUTH_REVOCABLE</span> e{' '}
            <span className="font-mono">AUTH_CLAWBACK_ENABLED</span>. Política
            pública de clawback em{' '}
            <a href="/politica-clawback" className="underline">
              /politica-clawback
            </a>
            .
          </p>
        </div>
        <div>
          <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-2">
            Distributor
          </p>
          <a
            href={accountExplorerUrl(parametros.distributorPubkey)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs break-all underline decoration-base/30 underline-offset-4 hover:decoration-primary"
          >
            {parametros.distributorPubkey}
          </a>
          <p className="text-xs text-base/60 mt-2">
            Conta operacional da Plina. Recebe emissões do issuer e distribui
            para investidores qualificados após onboarding institucional.
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: React.ReactNode;
}) {
  return (
    <div className="bg-lightBg px-6 py-8">
      <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
        {label}
      </p>
      <p className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight">
        {value}
      </p>
      {sublabel && (
        <p className="font-text text-xs text-base/60 mt-2">{sublabel}</p>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left font-details text-[10px] tracking-[0.15em] uppercase font-semibold">
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 ${mono ? 'font-mono text-xs' : 'font-text'} text-base`}
    >
      {children}
    </td>
  );
}
