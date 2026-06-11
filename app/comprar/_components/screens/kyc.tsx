'use client';

import { useEffect, useState } from 'react';
import type { PessoaState } from '@/components/PessoaProvider';

const fieldCls =
  'w-full px-4 py-3 border border-light-hairline font-text text-sm text-base bg-lightBg/30 focus:outline-none focus-visible:border-primary-deep focus-visible:ring-2 focus-visible:ring-primary-deep/20 transition-colors';
const labelCls =
  'font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-1.5 block';

export function KycScreen({
  pessoa,
  loading,
  onSubmit,
}: {
  pessoa: PessoaState;
  loading: boolean;
  onSubmit: (input: { nome?: string; cpf?: string }) => void;
}) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (pessoa.nome) setNome((v) => v || pessoa.nome!);
  }, [pessoa.nome]);

  const canSubmit = nome.trim().length > 1 && cpf.replace(/\D/g, '').length >= 11 && consent;

  return (
    <div>
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        04 // Cessão digital · KYC
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Verificação de identidade.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        KYC obrigatório antes da assinatura da cessão. Verificação AML conforme
        CVM 175. Seus dados pessoais ficam off-chain.
      </p>

      <div className="mt-8 space-y-4 max-w-md">
        <div>
          <label htmlFor="kyc-nome" className={labelCls}>
            Nome completo
          </label>
          <input
            id="kyc-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={200}
            disabled={loading}
            className={fieldCls}
          />
        </div>
        <div>
          <label htmlFor="kyc-cpf" className={labelCls}>
            CPF
          </label>
          <input
            id="kyc-cpf"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            inputMode="numeric"
            maxLength={14}
            placeholder="000.000.000-00"
            disabled={loading}
            className={`${fieldCls} font-mono`}
          />
        </div>
      </div>

      <div className="mt-5 max-w-md border border-dashed border-light-hairline p-4 font-text text-sm text-base/70">
        ⬆ Upload de documento + selfie ·{' '}
        <span className="font-mono text-xs text-base/55">
          auto-aprovado no ambiente de testes
        </span>
      </div>

      <label className="mt-6 flex items-start gap-3 font-text text-sm text-base/85 max-w-md cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-primary-deep)]"
        />
        Autorizo o tratamento dos meus dados para verificação KYC/AML (LGPD).
      </label>

      <button
        onClick={() => onSubmit({ nome: nome.trim(), cpf })}
        disabled={!canSubmit || loading}
        className="mt-8 bg-base text-white px-8 py-4 font-details text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Verificando…' : 'Verificar identidade →'}
      </button>
    </div>
  );
}
