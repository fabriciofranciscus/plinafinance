'use client';

import { useCallback, useState } from 'react';
import { attachInvestorSignature } from '@/app/investir/_lib/signed-xdr';
import {
  buildResgate,
  submitResgate,
  ResgateError,
  type ResgateBuild,
  type ResgateErroTipo,
} from '../_lib/resgate-api';

export type ResgatePasso = 'idle' | 'building' | 'ready' | 'signing' | 'submitting' | 'done';

export interface UseResgateArgs {
  stellarAddress: string | null;
  signRawHash: (args: {
    address: string;
    chainType: 'stellar';
    hash: `0x${string}`;
  }) => Promise<{ signature: string }>;
  getAccessToken: () => Promise<string | null>;
  /** Depois de confirmar: atualizar saldos e eventos. */
  onDone?: () => void;
}

/**
 * Fluxo do resgate: build (já devolve a cotação) -> assinatura do investidor ->
 * submit `{ quoteId, signedXdr }`. NAV_MUDOU, COTACAO_EXPIRADA e CONFLICT pedem
 * nova cotação (refaz o build); SWAP_EM_CONFERENCIA e LEDGER_UNAVAILABLE /
 * CLASSE_INDISPONIVEL são bloqueios até o servidor liberar.
 */
export function useResgate({ stellarAddress, signRawHash, getAccessToken, onDone }: UseResgateArgs) {
  const [amount, setAmountState] = useState('');
  const [passo, setPasso] = useState<ResgatePasso>('idle');
  const [build, setBuild] = useState<ResgateBuild | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // número do pedido (quoteId) do último build: sobrevive à limpeza da cotação para o texto do erro
  const [ultimoPedido, setUltimoPedido] = useState<string | null>(null);
  const [erro, setErro] = useState<{
    tipo: ResgateErroTipo;
    codigo: string | null;
    /** Onde o erro veio: ao cotar (build) ou ao enviar (submit). */
    fase: 'build' | 'submit';
  } | null>(null);

  const falhar = useCallback((e: unknown, voltarPara: ResgatePasso, fase: 'build' | 'submit') => {
    const r = e instanceof ResgateError ? e : new ResgateError('generico', null);
    setErro({ tipo: r.tipo, codigo: r.codigo, fase });
    // quote velho não pode ser assinado de novo: exige nova cotação
    const pedeNovaCotacao = r.tipo === 'nav_mudou' || r.tipo === 'cotacao_expirada' || r.tipo === 'conflito' || r.tipo === 'sem_liquidez' ||
      r.tipo === 'preco_fora_da_faixa' || r.tipo === 'acima_do_teto';
    setPasso(pedeNovaCotacao ? 'idle' : voltarPara);
    if (pedeNovaCotacao) setBuild(null);
  }, []);

  const setAmount = useCallback((v: string) => {
    setAmountState(v);
    setBuild(null);
    setErro(null);
    setPasso('idle');
  }, []);

  const gerarCotacao = useCallback(async () => {
    if (!amount) return;
    setErro(null);
    setPasso('building');
    try {
      const b = await buildResgate(amount, getAccessToken);
      setUltimoPedido(b.quoteId);
      setBuild(b);
      setPasso('ready');
    } catch (e) {
      falhar(e, 'idle', 'build');
    }
  }, [amount, getAccessToken, falhar]);

  const confirmar = useCallback(async () => {
    if (!build || !stellarAddress) return;
    setErro(null);
    setPasso('signing');
    try {
      const { signature } = await signRawHash({
        address: stellarAddress,
        chainType: 'stellar',
        hash: build.hashHex as `0x${string}`,
      });
      const signedXdr = attachInvestorSignature(build.xdr, stellarAddress, signature);
      setPasso('submitting');
      const r = await submitResgate({ quoteId: build.quoteId, signedXdr }, getAccessToken);
      setTxHash(r.txHash);
      setPasso('done');
      onDone?.();
    } catch (e) {
      falhar(e, 'ready', 'submit');
    }
  }, [build, stellarAddress, signRawHash, getAccessToken, onDone, falhar]);

  const limparErro = useCallback(() => setErro(null), []);

  const reset = useCallback(() => {
    setAmountState('');
    setBuild(null);
    setTxHash(null);
    setErro(null);
    setPasso('idle');
  }, []);

  return { amount, setAmount, passo, build, txHash, erro, gerarCotacao, confirmar, reset, limparErro, ultimoPedido };
}
