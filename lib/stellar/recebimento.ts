/**
 * Quanto TESOURO a Etherfuse entregou PARA UMA ORDEM, lido na chain. Nunca o saldo da carteira, que mistura ordens.
 * Desenho: passagens/2026-11-16-estela-desenho-tesouro-recebido-menor.md. Decisão do Atlas (16/11): primeiro o fix do
 * A3 — o swap só sai depois que o TESOURO da PRÓPRIA ordem aparece na rede (o swap 979b476c gastou TESOURO de outra
 * compra 15 s antes da entrega 5b13c3cf).
 *
 * A Etherfuse entrega de dois jeitos:
 *  - claimable balance (`stellarClaimableBalanceId` da ordem): aberto → CB_PENDENTE (falta o claim); resgatado → o
 *    efeito `claimable_balance_claimed` do claim da ordem (`claimTxHash`) dá o valor;
 *  - mint/transfer direto do contrato do TESOURO (`stellarTxHash` da ordem): as `asset_balance_changes` da operação
 *    para o investidor, no ativo esperado (código E emissor).
 * Só leitura. 404 nunca prova entrega: vira NAO_CHEGOU (tx) ou INDETERMINADO (CB sumido sem claim conferível).
 * Outros erros do Horizon propagam (a rota responde 503).
 */
import { Asset } from '@stellar/stellar-sdk';
import { horizon } from './account';

export type Recebimento =
  | { status: 'RECEBIDO'; valor: string; via: 'CLAIM' | 'ENTREGA_DIRETA'; ref: string }
  | { status: 'CB_PENDENTE'; valor: string; ref: string }
  | { status: 'NAO_CHEGOU' }
  | { status: 'NAO_CONFERE'; motivo: string }
  | { status: 'INDETERMINADO'; motivo: string };

export interface OrdemRecebimento {
  investorPubkey: string;
  /** TESOURO esperado (código e emissor). */
  ativo: Asset;
  stellarClaimableBalanceId?: string | null;
  stellarTxHash?: string | null;
  claimTxHash?: string | null;
}

const STROOPS = BigInt(10_000_000);

function paraStroops(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d+(\.\d{1,7})?$/.test(v)) return null;
  const [i, f = ''] = v.split('.');
  return BigInt(i) * STROOPS + BigInt(f.padEnd(7, '0'));
}

function deStroops(s: bigint): string {
  return `${s / STROOPS}.${(s % STROOPS).toString().padStart(7, '0')}`;
}

function is404(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 404 || (err as { name?: string })?.name === 'NotFoundError';
}

const HASH_TX = /^[0-9a-f]{64}$/;

function ativoCanonico(a: Asset): string {
  return `${a.getCode()}:${a.getIssuer()}`;
}

async function porEntregaDireta(o: OrdemRecebimento, hash: string): Promise<Recebimento> {
  let records: Array<Record<string, unknown>>;
  try {
    ({ records } = (await horizon.operations().forTransaction(hash).limit(50).call()) as unknown as {
      records: Array<Record<string, unknown>>;
    });
  } catch (err) {
    if (is404(err)) return { status: 'NAO_CHEGOU' };
    throw err;
  }
  let total = BigInt(0);
  for (const op of records) {
    if (op.transaction_successful !== true) continue;
    const mudancas = (op.asset_balance_changes ?? []) as Array<Record<string, unknown>>;
    for (const m of mudancas) {
      if (m.type !== 'mint' && m.type !== 'transfer') continue;
      if (m.to !== o.investorPubkey) continue;
      if (m.asset_code !== o.ativo.getCode() || m.asset_issuer !== o.ativo.getIssuer()) continue;
      const s = paraStroops(m.amount);
      if (s !== null) total += s;
    }
  }
  if (total === BigInt(0)) {
    return { status: 'NAO_CONFERE', motivo: 'a transação da ordem não entrega TESOURO a esta carteira' };
  }
  return { status: 'RECEBIDO', valor: deStroops(total), via: 'ENTREGA_DIRETA', ref: hash };
}

async function porClaimableBalance(o: OrdemRecebimento, balanceId: string): Promise<Recebimento> {
  try {
    const cb = (await horizon.claimableBalances().claimableBalance(balanceId).call()) as unknown as {
      asset: string;
      amount: string;
      claimants: Array<{ destination: string }>;
    };
    if (cb.asset !== ativoCanonico(o.ativo)) return { status: 'NAO_CONFERE', motivo: 'o saldo da ordem é de outro ativo' };
    if (!cb.claimants.some((c) => c.destination === o.investorPubkey)) {
      return { status: 'NAO_CONFERE', motivo: 'a carteira não pode receber o saldo da ordem' };
    }
    return { status: 'CB_PENDENTE', valor: cb.amount, ref: balanceId };
  } catch (err) {
    if (!is404(err)) throw err;
  }
  // CB sumiu: só vale com o claim DA ORDEM conferido pelos efeitos.
  if (!o.claimTxHash) return { status: 'INDETERMINADO', motivo: 'o saldo da ordem não existe mais e não há claim registrado' };
  if (!HASH_TX.test(o.claimTxHash)) return { status: 'INDETERMINADO', motivo: 'hash do claim malformado' };
  let records: Array<Record<string, unknown>>;
  try {
    ({ records } = (await horizon.effects().forTransaction(o.claimTxHash).limit(50).call()) as unknown as {
      records: Array<Record<string, unknown>>;
    });
  } catch (err) {
    if (is404(err)) return { status: 'INDETERMINADO', motivo: 'o claim registrado não aparece na rede' };
    throw err;
  }
  const e = records.find(
    (r) =>
      r.type === 'claimable_balance_claimed' &&
      r.account === o.investorPubkey &&
      r.balance_id === balanceId &&
      r.asset === ativoCanonico(o.ativo),
  );
  const valor = e ? paraStroops(e.amount) : null;
  if (valor === null) return { status: 'INDETERMINADO', motivo: 'o claim registrado não resgata o saldo desta ordem' };
  return { status: 'RECEBIDO', valor: deStroops(valor), via: 'CLAIM', ref: o.claimTxHash };
}

/** TESOURO entregue para a ordem. Ver o cabeçalho do módulo para os estados. */
export async function tesouroRecebidoDaOrdem(o: OrdemRecebimento): Promise<Recebimento> {
  if (o.stellarClaimableBalanceId) return porClaimableBalance(o, o.stellarClaimableBalanceId);
  if (o.stellarTxHash) {
    // Gate da Vera: hash malformado vira estado, sem ir ao Horizon (que responderia 400 e a função lançaria).
    if (!HASH_TX.test(o.stellarTxHash)) return { status: 'NAO_CONFERE', motivo: 'hash de entrega malformado' };
    return porEntregaDireta(o, o.stellarTxHash);
  }
  return { status: 'NAO_CHEGOU' };
}
