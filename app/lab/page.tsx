'use client';

/**
 * /lab — sandbox manual pra validar Privy + Stellar Tier 2.
 *
 * Stellar é "Tier 2" na Privy: não tem toggle no dashboard.privy.io —
 * wallet é criada programaticamente via useCreateWallet de
 * `@privy-io/react-auth/extended-chains` com chainType: 'stellar'.
 * Pattern Yalla `apps/web/src/hooks/use-auth.ts`.
 *
 * Esperado:
 *   1. Login Privy → user autenticado.
 *   2. Auto-create wallet Stellar (com proteções contra duplicação).
 *   3. user.linkedAccounts ganha entry com address.startsWith('G').
 *   4. Botão "Estabelecer trustline PLINARF" assina via useSignRawHash,
 *      submete via Horizon. Trustline AUTHORIZED no Stellar Expert.
 *
 * Proteções contra spam de wallet creation (Privy limita 100/user — bug
 * histórico do Yalla):
 *   - Espera ready+authenticated+user populados.
 *   - 1.5s settle window antes de assumir "sem wallet".
 *   - localStorage flag por privy_id pra impedir re-attempt automático.
 *   - 15s watchdog com retry manual.
 */

import { usePrivy, useLogin, useLogout } from '@privy-io/react-auth';
import {
  useCreateWallet,
  useSignRawHash,
} from '@privy-io/react-auth/extended-chains';
import { useCallback, useEffect, useRef, useState } from 'react';

const WALLET_CREATION_TIMEOUT_MS = 15_000;
const SETTLE_WINDOW_MS = 1500;

export default function LabPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [walletError, setWalletError] = useState<string | null>(null);
  const creating = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stellar address: ed25519 public key, Strkey encoding, prefixo 'G'.
  const stellarAddress =
    (user?.linkedAccounts ?? [])
      .filter((a): a is typeof a & { address: string } => 'address' in a)
      .find((a) => a.address.startsWith('G'))?.address ?? null;

  const append = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toISOString().slice(11, 19)}] ${line}`]);

  const attemptCreate = useCallback(() => {
    if (creating.current) return;
    setWalletError(null);
    creating.current = true;
    append('criando wallet Stellar (useCreateWallet chainType=stellar)...');

    timeoutRef.current = setTimeout(() => {
      creating.current = false;
      setWalletError(
        'Criação demorou >15s. Clica retry — MPC pode ter travado.',
      );
    }, WALLET_CREATION_TIMEOUT_MS);

    createWallet({ chainType: 'stellar' })
      .then(() => {
        append('     ✓ wallet criada');
      })
      .catch((err: unknown) => {
        append(`     ✗ falha: ${err instanceof Error ? err.message : String(err)}`);
        setWalletError(
          err instanceof Error ? err.message : 'Erro desconhecido na criação.',
        );
      })
      .finally(() => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        creating.current = false;
      });
  }, [createWallet]);

  // Auto-create no primeiro login só. localStorage por privy_id evita
  // re-criação em re-render. Settle window dá tempo do Privy popular
  // linkedAccounts antes de assumir vazio.
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (stellarAddress) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setWalletError(null);
      return;
    }
    const attemptedKey = `plina:wallet-attempted:${user.id}`;
    let alreadyAttempted = false;
    try {
      alreadyAttempted = window.localStorage.getItem(attemptedKey) === '1';
    } catch {
      // localStorage indisponível — segue com settle window.
    }
    if (alreadyAttempted) return;

    const settleId = setTimeout(() => {
      try {
        window.localStorage.setItem(attemptedKey, '1');
      } catch {
        // sem persistência: creating.current ainda evita re-fire na sessão.
      }
      attemptCreate();
    }, SETTLE_WINDOW_MS);

    return () => clearTimeout(settleId);
  }, [ready, authenticated, user, stellarAddress, attemptCreate]);

  // Cleanup watchdog on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function testTrustline() {
    if (!stellarAddress) return;
    setBusy(true);
    try {
      append('1/3 — pedindo XDR de trustline ao backend');
      const token = await getAccessToken();
      const buildRes = await fetch('/api/lab/build-trustline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pubkey: stellarAddress }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.text();
        throw new Error(`build falhou: ${err}`);
      }
      const { xdr, hashHex } = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
      };
      append(`     ✓ XDR recebido, hash=${hashHex.slice(0, 18)}...`);

      append('2/3 — Privy rawSign do hash (Ed25519)');
      const { signature } = await signRawHash({
        address: stellarAddress,
        chainType: 'stellar',
        hash: hashHex as `0x${string}`,
      });
      append(`     ✓ signature=${signature.slice(0, 18)}...`);

      append('3/3 — submetendo via Horizon');
      const submitRes = await fetch('/api/lab/submit-tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          xdr,
          investorPubkey: stellarAddress,
          signatureHex: signature,
        }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.text();
        throw new Error(`submit falhou: ${err}`);
      }
      const { hash } = (await submitRes.json()) as { hash: string };
      append(`     ✓ tx hash=${hash}`);
      append(`     → https://stellar.expert/explorer/testnet/tx/${hash}`);
    } catch (err) {
      append(`✗ ERRO: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <div style={{ padding: 24 }}>Carregando Privy…</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 900 }}>
      <h1 style={{ marginBottom: 8 }}>/lab — Privy + Stellar Tier 2 smoke</h1>
      <p style={{ marginBottom: 16, color: '#666' }}>
        Padrão Yalla: useCreateWallet({"{ chainType: 'stellar' }"}), useSignRawHash,
        backend monta XDR + submete.
      </p>

      <hr style={{ margin: '16px 0' }} />

      {!authenticated ? (
        <button
          onClick={() => login()}
          style={{
            padding: '8px 16px',
            background: '#0EA7C7',
            color: 'white',
            border: 0,
            cursor: 'pointer',
          }}
        >
          Entrar
        </button>
      ) : (
        <>
          <p>
            <strong>Privy user id:</strong> {user?.id}
          </p>
          <p>
            <strong>Stellar address:</strong>{' '}
            {stellarAddress ? (
              <a
                href={`https://stellar.expert/explorer/testnet/account/${stellarAddress}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {stellarAddress}
              </a>
            ) : walletError ? (
              <>
                <span style={{ color: 'red' }}>{walletError}</span>{' '}
                <button onClick={attemptCreate} style={{ marginLeft: 8 }}>
                  Retry
                </button>
              </>
            ) : (
              <span style={{ color: '#888' }}>aguardando criação…</span>
            )}
          </p>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={testTrustline}
              disabled={busy || !stellarAddress}
              style={{
                padding: '8px 16px',
                background: '#132728',
                color: 'white',
                border: 0,
                cursor: busy ? 'wait' : 'pointer',
                opacity: stellarAddress ? 1 : 0.5,
              }}
            >
              {busy ? 'Aguardando…' : 'Estabelecer trustline PLINARF'}
            </button>
            <button
              onClick={() => logout()}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              Sair
            </button>
          </div>
        </>
      )}

      {log.length > 0 && (
        <pre
          style={{
            marginTop: 24,
            padding: 16,
            background: '#f4f4f4',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: 12,
          }}
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
