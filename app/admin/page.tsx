/**
 * /admin — painel da operação Plina.
 *
 * Auth guard via cookie (lib/auth/admin). Se não autenticado, renderiza
 * LoginForm. Se autenticado, renderiza dashboard com:
 *   - Snapshot ParametrosPool
 *   - Form incorporar cota nova (emite on-chain)
 *   - Lista de cotas + status
 *   - Lista de investidores + clawback form
 *   - Audit log recente
 *
 * Tudo Server Component. Forms ficam em Client Components separados
 * (useActionState).
 */

import { db } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { accountExplorerUrl, assetExplorerUrl, txExplorerUrl } from '@/lib/stellar/config';
import {
  caixaRealizado,
  concentracaoPorAdministradora,
  contarCotasAtivas,
  navDaCota,
  navPorToken,
  navTotalDoPool,
  spreadRealizadoAcumulado,
  tokensEmitidosVivos,
} from '@/lib/services/pool';
import { lerSupplyParaPainel } from '@/lib/services/painel-supply';
import {
  NAV_MOTIVO_OPERADOR,
  NavIndisponivelError,
  lerSupplyDoNav,
  type NavIndisponivelMotivo,
} from '@/lib/services/nav-supply';
import { caixaParaNav } from '@/lib/services/razao-fundo';
import { LoginForm } from './login-form';
import { IncorporarCotaForm } from './incorporar-cota-form';
import { InvestidoresPainel } from './investidores-painel';
import { PaineisAdmin } from './paineis';
import { Concentracao } from './concentracao';
import { ValidacaoForm } from './validacao-form';
import { rotuloTipoBem } from '@/lib/admin/tipo-bem';
import { VendedorPipeline } from './vendedor-pipeline';
import { CompradorPipeline } from './comprador-pipeline';

export const dynamic = 'force-dynamic';
// incorporarCotaAction (usada nesta página) pode segurar uma $transaction de até
// 120 s (E1-4, M3 do Argus). Server Actions herdam o limite da PÁGINA
// (Next: route segment config `maxDuration`); 150 s dá folga sobre os 120 s.
// Exceção só de testnet: antes do M6 o Bento refaz a transação curta, sem rede.
export const maxDuration = 150;

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}
/** NAV por token fica perto de R$ 1: com zero casas, 0,1524 virava "R$ 0" (mesmo formato de /pool). */
function brlPorToken(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}
function tokenFmt(value: number | string | { toString(): string }): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Number(value.toString()),
  );
}

const STATUS_COTA_LABEL: Record<string, string> = {
  DISPONIVEL: 'Disponível',
  RESERVADA: 'Reservada',
  REALIZADA: 'Realizada',
  REVERTIDA: 'Revertida',
};

/** Anuência da administradora: o evento mais recente (eventos vêm do mais novo ao mais antigo) com status válido. */
function anuenciaDe(eventos: Array<{ acao: string; payloadJson: unknown }>): string | null {
  const e = eventos.find((x) => x.acao === 'ANUENCIA_REGISTRADA');
  const st = (e?.payloadJson as { status?: string } | null | undefined)?.status;
  return st === 'CONFIRMADA' || st === 'DECLARADA_PENDENTE' ? st : null;
}

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    return <LoginForm />;
  }

  const [
    parametros,
    cotas,
    investidores,
    leadsVendedor,
    leadsComprador,
    eventos,
    realizacoes,
  ] = await Promise.all([
    db.parametrosPool.findUnique({ where: { id: 'singleton' } }),
    db.cota.findMany({ orderBy: { criadaEm: 'asc' } }),
    db.investidor.findMany({ orderBy: { criadoEm: 'asc' } }),
    db.leadVendedor.findMany({
      orderBy: { criadoEm: 'desc' },
      include: {
        ofertas: {
          orderBy: { versao: 'desc' },
          take: 1,
          include: {
            cessao: {
              include: {
                pagamento: true,
                cota: true,
                // etapas do pipeline: laudo = COTA_VALIDADA; anuência = ANUENCIA_REGISTRADA (o último vence)
                eventos: {
                  where: { acao: { in: ['COTA_VALIDADA', 'ANUENCIA_REGISTRADA'] } },
                  select: { acao: true, payloadHash: true, payloadJson: true, criadoEm: true },
                  orderBy: { criadoEm: 'desc' },
                },
              },
            },
          },
        },
      },
    }),
    db.leadComprador.findMany({
      orderBy: { criadoEm: 'desc' },
      include: {
        reservas: {
          orderBy: { criadaEm: 'desc' },
          include: { cota: true },
        },
      },
    }),
    db.eventoAudit.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 20,
      include: { cota: true, investidor: true },
    }),
    db.realizacaoCaminho.findMany({
      select: { valorRealizado: true, spread: true },
    }),
  ]);

  // Situação do Pix de cada cessão do funil (a tabela não tem relação direta na Cessao).
  const cessaoIds = leadsVendedor.flatMap((l) => l.ofertas.map((o) => o.cessao?.id).filter((x): x is string => !!x));
  const pixPorCessao = new Map(
    (cessaoIds.length
      ? await db.transferenciaPix.findMany({ where: { cessaoId: { in: cessaoIds } }, select: { cessaoId: true, status: true } })
      : []
    ).map((t) => [t.cessaoId, t.status as string]),
  );

  // O NAV do operador é o MESMO da página pública: mesma leitura do ledger (`lerSupplyDoNav`: trava
  // D3, gates de emissão/swap em voo e de supply sem lastro) e o caixa do razão do fundo. Quando o NAV
  // fecha, o operador vê o motivo; o público vê só "—".
  const caixaNav = await caixaParaNav();
  const navTotal = navTotalDoPool(cotas, caixaNav);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const caixa = caixaRealizado(caixaNav);
  // NAV/token: a mesma leitura com gates do /pool. Quando fecha, o operador vê o motivo no banner.
  let supplyNav: Awaited<ReturnType<typeof lerSupplyDoNav>>['senior'] | null = null;
  let navMotivo: NavIndisponivelMotivo | null = null;
  try {
    supplyNav = (await lerSupplyDoNav()).senior;
  } catch (err) {
    navMotivo = err instanceof NavIndisponivelError ? err.motivo : 'LEDGER_LEITURA_FALHOU';
  }
  const navUnit = supplyNav ? navPorToken(cotas, caixaNav, supplyNav) : null;
  const navUnitLabel = navUnit === null ? 'Indisponível' : brlPorToken(navUnit);
  // Supply circulante: leitura bruta do ledger, sem os gates do NAV, para o operador ver a divergência
  // justamente quando o NAV fecha (ex.: SUPPLY_SEM_LASTRO). M17: a falha vai ao log e a tela explica o "—".
  const { supply, indisponivel: supplyIndisponivel } = await lerSupplyParaPainel();
  const spreadAcumulado = spreadRealizadoAcumulado(realizacoes);
  const concentracao = concentracaoPorAdministradora(cotas);

  // Nomes de navegação: os atuais (a troca por "Resumo"/"Auditoria" da spec depende de revisão editorial).
  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'vendedores', label: `Solicitações (${leadsVendedor.length})` },
    { id: 'compradores', label: `Compradores (${leadsComprador.length})` },
    { id: 'cotas', label: `Cotas (${cotas.length})` },
    { id: 'investidores', label: `Investidores (${investidores.length})` },
    { id: 'audit', label: 'Audit log' },
    { id: 'incorporar', label: 'Avulsas' },
  ];
  const rotuloDe = (id: string) => sections.find((x) => x.id === id)?.label ?? id;

  return (
    <div className="plina-product mx-auto max-w-[var(--workspace-max)] px-[var(--spacing-gutter-ui)] py-8 md:py-12">
      <header id="overview" className="mb-8 flex items-start justify-between scroll-mt-24">
        <div>
          <p className="font-details text-label-ui text-base/70">
            Operação · acesso restrito · {parametros?.network ?? 'sem pool'}
          </p>
          <h1 className="font-title text-page-title mt-2">
            Painel Plina
          </h1>
        </div>
      </header>

      <PaineisAdmin
        paineis={[
          {
            id: 'vendedores',
            rotulo: rotuloDe('vendedores'),
            conteudo: (
              <>
      <section id="vendedores" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-section-title mb-2">
          Solicitações de venda ({leadsVendedor.length})
        </h2>
        <p className="font-text text-sm text-base/70 mb-6 max-w-2xl">
          Leads capturados via <code className="font-mono text-xs">/vender</code>.
          Cada estágio gera prova on-chain via Memo.hash. Status do lead
          transita conforme operador avança o pipeline.
        </p>
        <VendedorPipeline
          redePublica={process.env.STELLAR_NETWORK === 'PUBLIC'}
          leads={leadsVendedor.map((l) => ({
            id: l.id,
            nome: l.nome,
            email: l.email,
            status: l.status,
            criadoEm: l.criadoEm,
            ofertas: l.ofertas.map((o) => ({
              id: o.id,
              versao: o.versao,
              tipoBem: o.tipoBem,
              valorCarta: o.valorCarta.toString(),
              valorLiquidoVendedor: o.valorLiquidoVendedor.toString(),
              desagioAquisicao: o.desagioAquisicao.toString(),
              administradora: o.administradora,
              status: o.status,
              validade: o.validade,
              criadaEm: o.criadaEm,
              cessao: o.cessao
                ? {
                    id: o.cessao.id,
                    status: o.cessao.status,
                    onChainTxHash: o.cessao.onChainTxHash,
                    pagamento: o.cessao.pagamento
                      ? {
                          id: o.cessao.pagamento.id,
                          status: o.cessao.pagamento.status,
                          onChainTxHash: o.cessao.pagamento.onChainTxHash,
                        }
                      : null,
                    cota: o.cessao.cota ? { id: o.cessao.cota.id } : null,
                    // datas reais das etapas (nunca inventadas; null quando o servidor não as tem)
                    criadaEm: o.cessao.criadaEm,
                    envioEm: o.cessao.docusignEnvioIniciadoEm,
                    assinadaEm: o.cessao.assinadaEm,
                    laudoEm: o.cessao.eventos.find((e) => e.acao === 'COTA_VALIDADA')?.criadoEm ?? null,
                    anuenciaEm: o.cessao.eventos.find((e) => e.acao === 'ANUENCIA_REGISTRADA')?.criadoEm ?? null,
                    pagamentoEm: o.cessao.pagamento?.atualizadoEm ?? null,
                    cotaEm: o.cessao.cota?.criadaEm ?? null,
                    laudoRegistrado: o.cessao.eventos.some((e) => e.acao === 'COTA_VALIDADA'),
                    laudoHash: o.cessao.eventos.find((e) => e.acao === 'COTA_VALIDADA')?.payloadHash ?? null,
                    anuenciaStatus: anuenciaDe(o.cessao.eventos),
                    titularSituacao: o.cessao.titularSituacao,
                    pixStatus: pixPorCessao.get(o.cessao.id) ?? null,
                  }
                : null,
            })),
          }))}
        />
      </section>

              </>
            ),
          },
          {
            id: 'compradores',
            rotulo: rotuloDe('compradores'),
            conteudo: (
              <>
      <section id="compradores" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-section-title mb-2">
          Funil comprador-usuário ({leadsComprador.length})
        </h2>
        <p className="font-text text-sm text-base/70 mb-6 max-w-2xl">
          Leads de <code className="font-mono text-xs">/comprar/lead</code> e{' '}
          <code className="font-mono text-xs">/comprar/reservar</code>. Reservas
          ativas travam a cota por 72h. Caminho A executa close-out: Cota →
          REALIZADA, NAV/token sobe pra holders.
        </p>
        <CompradorPipeline
          leads={leadsComprador.map((l) => ({
            id: l.id,
            nome: l.nome,
            email: l.email,
            tipo: l.tipo,
            intencaoBem: l.intencaoBem,
            status: l.status,
            criadoEm: l.criadoEm,
            reservas: l.reservas.map((r) => ({
              id: r.id,
              status: r.status,
              expiraEm: r.expiraEm,
              onChainTxHash: r.onChainTxHash,
              cota: {
                id: r.cota.id,
                tipoBem: r.cota.tipoBem,
                valorCarta: r.cota.valorCarta.toString(),
                desagioRevenda: r.cota.desagioRevenda?.toString() ?? null,
                status: r.cota.status,
              },
            })),
          }))}
          redePublica={process.env.STELLAR_NETWORK === 'PUBLIC'}
        />
      </section>

              </>
            ),
          },
          {
            id: 'cotas',
            rotulo: rotuloDe('cotas'),
            conteudo: (
              <>
      <section id="cotas" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-section-title mb-4">
          Cotas ({cotas.length})
        </h2>
        <div className="rounded-panel border border-light-hairline overflow-x-auto">
          <table className="w-full font-text text-sm">
            <thead className="bg-base text-lightBg">
              <tr>
                <Th>Tipo</Th>
                <Th>Administradora</Th>
                <Th>Valor</Th>
                <Th>Deságio aq.</Th>
                <Th>NAV</Th>
                <Th>Tokens</Th>
                <Th>Status</Th>
                <Th>Emissão</Th>
                <Th>Validação legal</Th>
              </tr>
            </thead>
            <tbody>
              {cotas.map((c) => {
                const nav = navDaCota({
                  valorCarta: c.valorCarta,
                  desagioAquisicao: c.desagioAquisicao,
                });
                return (
                  <tr key={c.id} className="border-t border-light-hairline">
                    <Td>{c.tipoBem}</Td>
                    <Td>{c.administradora}</Td>
                    <Td mono>{brl(Number(c.valorCarta))}</Td>
                    <Td mono>
                      {(Number(c.desagioAquisicao) * 100).toFixed(2)}%
                    </Td>
                    <Td mono>{brl(nav)}</Td>
                    <Td mono>{tokenFmt(c.tokensEmitidos)}</Td>
                    <Td>
                      <span className="font-mono text-xs">
                        {STATUS_COTA_LABEL[c.status] ?? c.status}
                      </span>
                    </Td>
                    <Td>
                      {c.emissaoTxHash ? (
                        <a
                          href={txExplorerUrl(c.emissaoTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs underline"
                        >
                          {c.emissaoTxHash.slice(0, 8)}…
                        </a>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      {c.validacaoTxHash ? (
                        <a
                          href={txExplorerUrl(c.validacaoTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs underline text-signal-700"
                          title={c.hashValidacao ?? ''}
                        >
                          ✓ {c.validacaoTxHash.slice(0, 8)}…
                        </a>
                      ) : (
                        <ValidacaoForm
                          cotaId={c.id}
                          hasValidacao={!!c.validacaoTxHash}
                          descricaoCota={`${rotuloTipoBem(c.tipoBem)} · ${c.administradora} · ${brl(Number(c.valorCarta))}`}
                          redePublica={process.env.STELLAR_NETWORK === 'PUBLIC'}
                        />
                      )}
                    </Td>
                  </tr>
                );
              })}
              {cotas.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-base/70">
                    Nenhuma cota no pool.
                    <span className="block mt-1 text-base/70">Cotas entram pela etapa 10 de uma solicitação.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Concentracao
          itens={concentracao.map((c) => ({
            administradora: c.administradora,
            valor: brl(c.nav),
            participacao: `${c.pct.toFixed(1)}%`,
            alerta: c.alerta,
          }))}
        />
      </section>

              </>
            ),
          },
          {
            id: 'investidores',
            rotulo: rotuloDe('investidores'),
            conteudo: (
              <>
      <section id="investidores" className="mb-16 scroll-mt-32">
        <h2 className="font-title text-section-title mb-4">
          Investidores ({investidores.length})
        </h2>
        {investidores.length === 0 ? (
          <p className="font-text text-sm text-base/70">
            Nenhum investidor ainda.
            <span className="block mt-1">Quem concluir o cadastro em Investir aparece aqui.</span>
          </p>
        ) : (
          <InvestidoresPainel
            investidores={investidores.map((inv) => ({
              id: inv.id,
              email: inv.email,
              publicKey: inv.publicKey,
              explorerUrl: accountExplorerUrl(inv.publicKey),
              saldoEsperado: tokenFmt(inv.saldoEsperado),
              status: String(inv.status),
            }))}
          />
        )}
      </section>

              </>
            ),
          },
          {
            id: 'overview',
            rotulo: rotuloDe('overview'),
            conteudo: (
              <>
                <h2 className="font-title text-section-title mb-4">{rotuloDe('overview')}</h2>
      {parametros && (
        <>
          <section className="mb-2 grid grid-cols-1 md:grid-cols-4 gap-px bg-base/15 border border-light-hairline rounded-panel overflow-hidden">
            <Metric label="NAV total (ativo + caixa)" value={brl(navTotal)} />
            <Metric
              label={`${parametros.assetCode} vivos`}
              value={tokenFmt(tokensVivos)}
            />
            <Metric label="Cotas ativas" value={String(contarCotasAtivas(cotas))} />
            <Metric
              label="Investidores"
              value={String(investidores.length)}
            />
          </section>
          {navMotivo && (
            <div role="status" className="mb-2 rounded-panel border border-light-hairline bg-sheet-white px-5 py-4">
              <p className="font-details text-label-ui text-base/70">
                NAV por token indisponível · {navMotivo}
              </p>
              <p className="font-text text-body-ui text-base/80 mt-1">{NAV_MOTIVO_OPERADOR[navMotivo]}</p>
            </div>
          )}
          <section className="mb-12 grid grid-cols-1 md:grid-cols-4 gap-px bg-base/15 border border-light-hairline rounded-panel overflow-hidden">
            <Metric label="NAV / token" value={navUnitLabel} nota={supplyIndisponivel ? NOTA_SUPPLY_INDISPONIVEL : undefined} />
            <Metric
              label="Supply circulante (ledger)"
              value={supply ? tokenFmt(Number(supply.circulante)) : '—'}
              nota={supplyIndisponivel ? NOTA_SUPPLY_INDISPONIVEL : undefined}
            />
            <Metric label="Caixa realizado" value={brl(caixa)} />
            <Metric
              label="Diferença realizada acumulada"
              value={brl(spreadAcumulado)}
            />
          </section>
        </>
      )}

      {/* Issuer / Distributor */}
      {parametros && (
        <section className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-6 font-text text-xs">
          <KvPubkey
            label="Issuer"
            pubkey={parametros.issuerPubkey}
            extraLink={{
              label: 'Asset Stellar Expert →',
              url: assetExplorerUrl(parametros.issuerPubkey),
            }}
          />
          <KvPubkey label="Distributor" pubkey={parametros.distributorPubkey} />
        </section>
      )}

              </>
            ),
          },
          {
            id: 'audit',
            rotulo: rotuloDe('audit'),
            conteudo: (
              <>
      <section id="audit" className="scroll-mt-32">
        <h2 className="font-title text-section-title mb-4">
          Audit log (últimos 20)
        </h2>
        <div className="rounded-panel border border-light-hairline overflow-x-auto">
          <table className="w-full font-text text-sm">
            <thead className="bg-base text-lightBg">
              <tr>
                <Th>Quando</Th>
                <Th>Ação</Th>
                <Th>Operador</Th>
                <Th>Cota</Th>
                <Th>Investidor</Th>
                <Th>Motivo</Th>
                <Th>Tx</Th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.id} className="border-t border-light-hairline">
                  <Td mono>
                    {new Date(e.criadoEm).toLocaleString('pt-BR', {
                      hour12: false,
                    })}
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">
                      {e.acao}
                    </span>
                  </Td>
                  <Td>{e.operador ?? '—'}</Td>
                  <Td mono>{e.cotaId?.slice(0, 8) ?? '—'}</Td>
                  <Td>{e.investidor?.email ?? '—'}</Td>
                  <Td>{e.motivoClawback ?? '—'}</Td>
                  <Td>
                    {e.stellarTxHash ? (
                      <a
                        href={txExplorerUrl(e.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs underline"
                      >
                        {e.stellarTxHash.slice(0, 8)}…
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
              {eventos.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-base/70">
                    Nenhum evento registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

              </>
            ),
          },
          {
            id: 'incorporar',
            rotulo: rotuloDe('incorporar'),
            conteudo: (
              <>
      <details id="incorporar" className="mt-16 scroll-mt-32 rounded-panel border border-light-hairline p-4 md:p-6">
        <summary className="min-h-[44px] flex items-center cursor-pointer font-title text-section-title">
          Operações avulsas
        </summary>
        <p className="font-text text-sm text-base/70 mt-2 mb-6 max-w-2xl">
          Uso excepcional. O caminho normal é pela solicitação, na seção de vendedores.
        </p>
        <h3 className="font-details text-label-ui text-base mb-2">Incorporar nova cota</h3>
        <p className="font-text text-sm text-base/70 mb-6 max-w-2xl">
          Emite PLINA-RF on-chain (issuer → distributor) e persiste a cota no pool. Operação real na testnet — irreversível.
        </p>
        <IncorporarCotaForm redePublica={process.env.STELLAR_NETWORK === 'PUBLIC'} />
      </details>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

/** M17: por que o NAV/token e o supply aparecem como "—" quando a leitura do ledger falha (texto de diagnóstico do operador). */
const NOTA_SUPPLY_INDISPONIVEL = 'Não foi possível ler o supply na rede agora. Atualize a página; se continuar, avise o time técnico.';

function Metric({ label, value, nota }: { label: string; value: string; nota?: string }) {
  return (
    <div className="bg-lightBg px-5 py-6">
      <p className="font-details text-label-ui text-base/70">
        {label}
      </p>
      <p className="font-mono text-value-primary mt-2">{value}</p>
      {nota && (
        <p role="status" className="font-details text-label-ui text-base/70 mt-2">
          {nota}
        </p>
      )}
    </div>
  );
}

function KvPubkey({
  label,
  pubkey,
  extraLink,
}: {
  label: string;
  pubkey: string;
  extraLink?: { label: string; url: string };
}) {
  return (
    <div>
      <p className="font-details text-label-ui text-base/70 mb-1">
        {label}
      </p>
      <a
        href={accountExplorerUrl(pubkey)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs break-all underline decoration-base/30 hover:decoration-primary"
      >
        {pubkey}
      </a>
      {extraLink && (
        <p className="mt-1">
          <a
            href={extraLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
          >
            {extraLink.label}
          </a>
        </p>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-details text-label-ui">
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
    <td className={`px-3 py-2 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
  );
}
