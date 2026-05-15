'use client';

/**
 * /lab — sandbox manual pra validar Privy + Stellar Tier 2.
 *
 * Smoke equivalente do Privy: não dá pra automatizar via CLI porque OAuth/email
 * exigem interação humana. Aqui o "smoke" é abrir essa página, clicar Entrar,
 * conferir que o Stellar address aparece + assinar uma trustline de teste.
 *
 * Esperado:
 *   1. Login Privy (modal) → user autenticado.
 *   2. `useWallets` retorna wallet com `chainType: 'stellar'` (G...).
 *   3. Botão "Estabelecer trustline PLINARF" chama `/api/lab/build-trustline`,
 *      assina hash via `useSignRawHash`, submete via `/api/lab/submit-tx`.
 *   4. Link pra Stellar Expert da tx aparece — verificar manualmente que a
 *      trustline foi criada na conta da wallet Privy.
 *
 * Se isso funcionar, o pattern Yalla está vivo no Plina e qualquer outra tx
 * (swap TESOURO→PLINARF) é só mais um endpoint /build + /submit.
 */

import { usePrivy, useLogin, useLogout, useWallets } from '@privy-io/react-auth';
import { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { useState } from 'react';

export default function LabPage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { wallets } = useWallets();
  const { signRawHash } = useSignRawHash();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const stellarWallet = wallets.find(
    (w) =>
      (w as { chainType?: string }).chainType === 'stellar' ||
      w.address.startsWith('G'),
  );

  const append = (line: string) =>
    setLog((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);

  async function testTrustline() {
    if (!stellarWallet) return;
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
        body: JSON.stringify({ pubkey: stellarWallet.address }),
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
        address: stellarWallet.address,
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
          investorPubkey: stellarWallet.address,
          signatureHex: signature,
        }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.text();
        throw new Error(`submit falhou: ${err}`);
      }
      const { hash } = (await submitRes.json()) as { hash: string };
      append(
        `     ✓ tx hash=${hash}\n     stellar.expert: https://stellar.expert/explorer/testnet/tx/${hash}`,
      );
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
        Valida o pattern Yalla: backend monta XDR, Privy assina hash via rawSign
        Ed25519, backend submete via Horizon.
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
            {stellarWallet ? (
              <a
                href={`https://stellar.expert/explorer/testnet/account/${stellarWallet.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {stellarWallet.address}
              </a>
            ) : (
              <span style={{ color: 'red' }}>
                ⚠ nenhuma wallet Stellar — habilite Stellar embedded em
                dashboard.privy.io
              </span>
            )}
          </p>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={testTrustline}
              disabled={busy || !stellarWallet}
              style={{
                padding: '8px 16px',
                background: '#132728',
                color: 'white',
                border: 0,
                cursor: busy ? 'wait' : 'pointer',
                opacity: stellarWallet ? 1 : 0.5,
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
          }}
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}
