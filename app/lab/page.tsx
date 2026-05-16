'use client';

/**
 * /lab — sandbox manual pra validar Privy + Stellar Tier 2.
 *
 * Wallet Stellar é resolvida pelo BACKEND via `/api/lab/ensure-wallet`:
 * idempotente (não cria duplicata), persiste no Privy server-side. Evita
 * o bug histórico "uma wallet por login" que acumula até bater limite de
 * 100/user.
 *
 * Após ensure-wallet retornar address, frontend usa `useSignRawHash` de
 * `@privy-io/react-auth/extended-chains` pra assinar o hash da tx.
 */

import { usePrivy, useLogin, useLogout } from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { useEffect, useState } from 'react';

export default function LabPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { signRawHash } = useSignRawHash();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const append = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toISOString().slice(11, 19)}] ${line}`]);

  // Server resolve idempotente a wallet Stellar do user (cria se preciso).
  useEffect(() => {
    if (!ready || !authenticated) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch('/api/lab/ensure-wallet', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { address?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.address) {
          setWalletError(data.error ?? 'falha ao obter wallet');
          append(`✗ ensure-wallet: ${data.error ?? 'sem address'}`);
          return;
        }
        setStellarAddress(data.address);
        append(`✓ wallet Stellar: ${data.address}`);
      } catch (err) {
        if (!cancelled) {
          setWalletError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken]);

  async function testTrustline() {
    if (!stellarAddress) return;
    setBusy(true);
    try {
      append('1/3 — pedindo XDR de trustline ao backend (auto-fund se preciso)');
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
      const { xdr, hashHex, funded } = (await buildRes.json()) as {
        xdr: string;
        hashHex: string;
        funded?: boolean;
      };
      if (funded) append('     · conta fundada via friendbot');
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
        Sandbox manual: login Privy → wallet Stellar embedded → assina trustline
        PLINARF via rawSign → submete via Horizon.
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
              <span style={{ color: 'red' }}>{walletError}</span>
            ) : (
              <span style={{ color: '#888' }}>resolvendo…</span>
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
