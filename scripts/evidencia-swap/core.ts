/**
 * E2 — núcleo puro do verificador `pnpm evidencia:swap <txHash>` (aceite 2.2/2.3 do SOW).
 *
 * Uma tx de swap da Plina é UM envelope bem-sucedido com exatamente DUAS operações de payment, de um único
 * investidor, nas duas direções possíveis:
 *   ENTRADA: ativo-ponte (TESOURO) investidor → distributor  +  PLINA-RF issuer → investidor (emissão, N1)
 *   SAÍDA:   PLINA-RF investidor → issuer (queima, E2-4)     +  ativo-ponte distributor → investidor
 * Qualquer outro desenho (PLINA-RF saindo do distributor, devolução ao distributor em vez de queima, 1 ou 3 pernas,
 * outro ativo) não é o swap do E2. Só leitura; sem PII (só contas públicas, valores e hashes).
 */

export interface OpLida {
  type: string;
  /** `CODE:ISSUER` (ativos de crédito); 'native' para XLM. */
  asset: string;
  from: string;
  to: string;
  amount: string;
  /** Conta-fonte da operação (a da tx quando a op não declara). */
  source: string;
}

export interface TxSwapLida {
  sucesso: boolean;
  ops: OpLida[];
}

export interface ContextoSwap {
  issuer: string;
  distributor: string;
  /** Código do ativo-ponte (padrão TESOURO). O emissor dele não é fixado: vem da própria tx e é mostrado. */
  bridgeCode: string;
}

export type ResultadoSwap =
  | {
      confere: true;
      tipo: 'ENTRADA' | 'SAIDA';
      investidor: string;
      classe: 'PLINARF' | 'PLINARFB';
      plinarf: string;
      tesouro: string;
      ativoPonte: string;
    }
  | { confere: false; motivo: string };

const CLASSES = ['PLINARF', 'PLINARFB'] as const;

export function classificarSwap(tx: TxSwapLida, c: ContextoSwap): ResultadoSwap {
  if (!tx.sucesso) return { confere: false, motivo: 'TX_FALHOU: a tx existe mas não foi bem-sucedida' };
  if (tx.ops.length !== 2 || tx.ops.some((o) => o.type !== 'payment')) {
    return { confere: false, motivo: `PERNAS: esperado 2 payments num envelope, veio ${tx.ops.map((o) => o.type).join(', ') || 'nada'}` };
  }
  const [a, b] = tx.ops;
  const plinarfDe = (o: OpLida) => {
    const [code, iss] = o.asset.split(':');
    return (CLASSES as readonly string[]).includes(code) && iss === c.issuer ? (code as 'PLINARF' | 'PLINARFB') : null;
  };
  const ehPonte = (o: OpLida) => o.asset.split(':')[0] === c.bridgeCode && o.asset !== 'native';
  const pli = [a, b].find((o) => plinarfDe(o));
  const pon = [a, b].find((o) => ehPonte(o));
  if (!pli || !pon || pli === pon) {
    return { confere: false, motivo: `NAO_E_SWAP_E2: as pernas não são PLINA-RF do emissor ${c.issuer.slice(0, 8)}… + ${c.bridgeCode}` };
  }
  const classe = plinarfDe(pli)!;
  // ENTRADA: ponte inv→dist e PLINA-RF issuer→inv (emissão)
  if (pon.to === c.distributor && pli.from === c.issuer && pli.source === c.issuer && pon.from === pli.to) {
    return { confere: true, tipo: 'ENTRADA', investidor: pli.to, classe, plinarf: pli.amount, tesouro: pon.amount, ativoPonte: pon.asset };
  }
  // SAÍDA: PLINA-RF inv→issuer (queima) e ponte dist→inv
  if (pli.to === c.issuer && pon.from === c.distributor && pon.source === c.distributor && pli.from === pon.to) {
    return { confere: true, tipo: 'SAIDA', investidor: pli.from, classe, plinarf: pli.amount, tesouro: pon.amount, ativoPonte: pon.asset };
  }
  return {
    confere: false,
    motivo: 'NAO_E_SWAP_E2: direções não batem (entrada = emissão pelo issuer; saída = queima no issuer e ponte do distributor; mesmo investidor)',
  };
}
