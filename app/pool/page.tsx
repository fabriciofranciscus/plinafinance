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
import { NavIndisponivelError, lerSupplyDoNav } from '@/lib/services/nav-supply';
import { caixaParaNav } from '@/lib/services/razao-fundo';
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
  // P7 (Consuelo): o enum é a idade do estoque (schema), não o estado da cota.
  VERDE: '0–45 dias em estoque',
  AMARELO: '46–75 dias',
  VERMELHO: '76–90 dias',
  BAIXA: 'Mais de 90 dias',
};

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Valor POR TOKEN: precisa de casas decimais. O `brl` acima arredonda para inteiro, e um valor
 * de 0,1524 aparecia como "R$ 0" (bug de exibição em produção, 13/11). 4 casas, sem truncar.
 */
function brlPorToken(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function tokenFmt(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default async function PoolPage() {
  const [parametros, cotas, realizacoes, caixaNav] = await Promise.all([
    db.parametrosPool.findUnique({ where: { id: 'singleton' } }),
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      orderBy: { criadaEm: 'asc' },
    }),
    db.realizacaoCaminho.findMany({
      select: { valorRealizado: true, spread: true },
    }),
    // E2-5: o caixa do NAV vem do razão do fundo, como na API /api/pool/summary.
    caixaParaNav(),
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

  const navTotal = navTotalDoPool(cotas, caixaNav);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const caixa = caixaRealizado(caixaNav);

  // O denominador do NAV vem do ledger, pela MESMA leitura da API /api/pool/summary
  // (`lerSupplyDoNav`: cache, trava D3 e gates de emissão/swap/resgate em voo). Com
  // algo em voo ou o Horizon fora, a página pública não mostra um NAV distorcido:
  // mostra "—" e "Valor por token em conferência" (Consuelo, M1).
  let supply: Awaited<ReturnType<typeof lerSupplyDoNav>>['senior'] | null = null;
  try {
    supply = (await lerSupplyDoNav()).senior;
  } catch (err) {
    if (!(err instanceof NavIndisponivelError)) console.error('[pool] leitura do supply falhou');
  }
  const navUnit = supply ? navPorToken(cotas, caixaNav, supply) : null;
  const navUnitLabel = navUnit === null ? '—' : brlPorToken(navUnit);
  // M2: o NAV divide por circulante + tesouraria; o rótulo diz o mesmo número.
  const denominadorLabel = supply
    ? `${tokenFmt(Number(supply.circulante) + Number(supply.tesouraria))} tokens emitidos no ledger`
    : 'Valor por token em conferência';
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
            Cotas contempladas de consórcio de demonstração, registradas em
            rede de testes; nenhuma é uma aquisição real. O valor de cada token
            é o valor do pool dividido pelos tokens emitidos. As emissões podem
            ser conferidas no Stellar Expert; o valor do pool é calculado pela
            Plina.
          </p>
          <p className="font-text max-w-3xl text-sm text-base/70 leading-relaxed mt-3">
            Esta página mostra dados da rede de testes e os registros da Plina; não é
            oferta nem solicitação de investimento, nem promessa de
            retorno ou de liquidez.
          </p>
          <a
            href="/investir"
            className="self-start whitespace-nowrap bg-base text-lightBg font-details text-[10px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
          >
            Ver simulação em testnet →
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
          sublabel={`NAV por token · ${navUnitLabel}`}
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
              sublabel="Valor recebido pelo pool na revenda ou no recebimento do crédito das cotas"
            />
            <Metric
              label="Diferença realizada acumulada"
              value={brl(spreadAcumulado)}
              sublabel="Diferença entre o valor recebido e o custo de aquisição das cotas já realizadas (dados de teste)"
            />
            <Metric
              label="NAV por token"
              value={navUnitLabel}
              sublabel={navUnit === null ? denominadorLabel : `Valor do pool ÷ ${denominadorLabel}`}
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
                <Th>Custo de aquisição</Th>
                <Th>PLINA-RF emitido</Th>
                <Th>Local aprox.</Th>
                <Th>Prazo restante (meses)</Th>
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
          fora da rede, sob guarda da Plina. Na rede expomos apenas o valor por
          token, o hash de emissão e endereços públicos. Política de
          privacidade conforme LGPD.
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
            Conta operacional da Plina. Recebe as emissões do issuer e as
            entrega aos participantes autorizados, hoje só em rede de testes.
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
