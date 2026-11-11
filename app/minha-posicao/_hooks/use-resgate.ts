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
 * submit `{ quoteId, signedXdr }`. NAV_MUDOU e COTACAO_EXPIRADA pedem nova
 * cotação (refaz o build); SWAP_EM_CONFERENCIA bloqueia até o servidor liberar.
 */
export function useResgate({ stellarAddress, signRawHash, getAccessToken, onDone }: UseResgateArgs) {
  const [amount, setAmountState] = useState('');
  const [passo, setPasso] = useState<ResgatePasso>('idle');
  const [build, setBuild] = useState<ResgateBuild | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [erro, setErro] = useState<{ tipo: ResgateErroTipo; codigo: string | null } | null>(null);

  const falhar = useCallback((e: unknown, voltarPara: ResgatePasso) => {
    const r = e instanceof ResgateError ? e : new ResgateError('generico', null);
    setErro({ tipo: r.tipo, codigo: r.codigo });
    // quote velho não pode ser assinado de novo: exige nova cotação
    setPasso(r.tipo === 'nav_mudou' || r.tipo === 'cotacao_expirada' ? 'idle' : voltarPara);
    if (r.tipo === 'nav_mudou' || r.tipo === 'cotacao_expirada') setBuild(null);
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
      setBuild(await buildResgate(amount, getAccessToken));
      setPasso('ready');
    } catch (e) {
      falhar(e, 'idle');
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
      falhar(e, 'ready');
    }
  }, [build, stellarAddress, signRawHash, getAccessToken, onDone, falhar]);

  const reset = useCallback(() => {
    setAmountState('');
    setBuild(null);
    setTxHash(null);
    setErro(null);
    setPasso('idle');
  }, []);

  return { amount, setAmount, passo, build, txHash, erro, gerarCotacao, confirmar, reset };
}
