/**
 * E3-4b — conciliação no gate do snapshot.
 *
 * Por asset code: Σ dos saldos em trustlines AUTORIZADAS, lidas conta a conta
 * em `/accounts?asset=`, tem de bater EXATO com o `circulante` de
 * `supply.ts` (que vem do agregado `/assets` menos a tesouraria). São duas
 * fontes independentes do mesmo ledger: se divergirem, o denominador do NAV
 * não é confiável e o snapshot não publica.
 *
 * Distributor fora da soma (tesouraria, já descontada do circulante). Saldo
 * desautorizado, só-obrigações ou em trânsito (claimable, LP, contrato) entra
 * no circulante mas não na soma: trava o gate, e `motivos` diz por quê.
 *
 * Contrato: contratos/2026-11-11-e3-4b-conciliacao.md.
 */
import { Asset } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import { horizon } from './account';
import { assetCodeForClasse } from './classes';
import { SupplyConfigError, fetchSupplyOnChain, type SupplyOnChain } from './supply';

const ZERO = new Prisma.Decimal(0);
const PAGINA = 200;
const MAX_PAGINAS = 50;

export interface ConciliacaoAsset {
  code: string;
  issuer: string;
  somaTrustlinesAutorizadas: Prisma.Decimal;
  contasAutorizadas: number;
  circulante: Prisma.Decimal;
  /** soma − circulante. */
  diferenca: Prisma.Decimal;
  confere: boolean;
  motivos: string[];
  lidoEm: Date;
}

export type ConciliacaoErrorCode = 'CONCILIACAO_DIVERGENTE' | 'CONCILIACAO_HISTORICO_EXCEDE_LIMITE';

const MENSAGENS: Record<ConciliacaoErrorCode, string> = {
  CONCILIACAO_DIVERGENTE:
    'Snapshot recusado: soma das trustlines autorizadas diverge do circulante.',
  CONCILIACAO_HISTORICO_EXCEDE_LIMITE:
    'Snapshot recusado: contas demais para conciliar com segurança.',
};

export class ConciliacaoError extends Error {
  readonly code: ConciliacaoErrorCode;
  readonly detalhes?: ConciliacaoAsset[];

  constructor(code: ConciliacaoErrorCode, detalhes?: ConciliacaoAsset[]) {
    super(MENSAGENS[code]);
    this.name = 'ConciliacaoError';
    this.code = code;
    this.detalhes = detalhes;
  }
}

type LinhaConta = {
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  is_authorized?: boolean;
};
type ContaRec = { account_id?: string; id?: string; balances: LinhaConta[] };
type Pagina = { records: ContaRec[]; next(): Promise<Pagina> };

function chaves(): { issuerPubkey: string; distributorPubkey: string } {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) throw new SupplyConfigError('SUPPLY_CONFIG_MISSING');
  return { issuerPubkey, distributorPubkey };
}

/** Soma independente: trustlines autorizadas, conta a conta, sem o distributor. */
async function somarTrustlinesAutorizadas(
  code: string,
  issuerPubkey: string,
  distributorPubkey: string,
): Promise<{ soma: Prisma.Decimal; contas: number }> {
  let soma = ZERO;
  let contas = 0;
  let pagina = (await horizon
    .accounts()
    .forAsset(new Asset(code, issuerPubkey))
    .limit(PAGINA)
    .call()) as unknown as Pagina;
  for (let n = 1; pagina.records.length > 0; n++) {
    if (n > MAX_PAGINAS) throw new ConciliacaoError('CONCILIACAO_HISTORICO_EXCEDE_LIMITE');
    for (const conta of pagina.records) {
      const id = conta.account_id ?? conta.id;
      if (id === distributorPubkey) continue;
      const linha = conta.balances.find(
        (b) => b.asset_code === code && b.asset_issuer === issuerPubkey,
      );
      if (linha?.is_authorized === true) {
        soma = soma.plus(new Prisma.Decimal(linha.balance));
        contas += 1;
      }
    }
    pagina = await pagina.next();
  }
  return { soma, contas };
}

function motivosDe(supply: SupplyOnChain, diferenca: Prisma.Decimal): string[] {
  const m: string[] = [];
  if (supply.naoAutorizado.gt(0)) m.push('saldo_nao_autorizado');
  if (supply.autorizadoParaObrigacoes.gt(0)) m.push('so_obrigacoes');
  if (supply.emTransito.gt(0)) m.push('em_transito');
  if (!diferenca.isZero() && m.length === 0) m.push('soma_diverge');
  return m;
}

/** Concilia um asset da Plina (code fora da Plina → SupplyConfigError). */
export async function conciliarAsset(code: string): Promise<ConciliacaoAsset> {
  const codes = [assetCodeForClasse('SENIOR'), assetCodeForClasse('SUBORDINADA')];
  if (!codes.includes(code)) throw new SupplyConfigError('SUPPLY_ASSET_UNKNOWN');
  const { issuerPubkey, distributorPubkey } = chaves();

  const [supply, { soma, contas }] = await Promise.all([
    fetchSupplyOnChain({ issuerPubkey, distributorPubkey, code }),
    somarTrustlinesAutorizadas(code, issuerPubkey, distributorPubkey),
  ]);
  const diferenca = soma.minus(supply.circulante);
  return {
    code,
    issuer: issuerPubkey,
    somaTrustlinesAutorizadas: soma,
    contasAutorizadas: contas,
    circulante: supply.circulante,
    diferenca,
    confere: diferenca.isZero(),
    motivos: motivosDe(supply, diferenca),
    lidoEm: new Date(),
  };
}

export async function conciliarClasses(): Promise<{
  senior: ConciliacaoAsset;
  subordinada: ConciliacaoAsset;
}> {
  const [senior, subordinada] = await Promise.all([
    conciliarAsset(assetCodeForClasse('SENIOR')),
    conciliarAsset(assetCodeForClasse('SUBORDINADA')),
  ]);
  return { senior, subordinada };
}

/** Gate do snapshot: lança se qualquer classe não confere. */
export async function exigirConciliacao(): Promise<{
  senior: ConciliacaoAsset;
  subordinada: ConciliacaoAsset;
}> {
  const r = await conciliarClasses();
  const falhas = [r.senior, r.subordinada].filter((c) => !c.confere);
  if (falhas.length > 0) throw new ConciliacaoError('CONCILIACAO_DIVERGENTE', falhas);
  return r;
}
