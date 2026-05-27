'use client';

import type { BankRegistered, PixKeyType } from '../../_types';
import { TestnetBanner } from '../shell/testnet-banner';
import { DataRow } from '../shared/data-row';

export function BankingScreen({
  bankInfo,
  pixKey,
  setPixKey,
  pixKeyType,
  setPixKeyType,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  cpf,
  setCpf,
  loading,
  onSubmit,
  onSkip,
}: {
  bankInfo: BankRegistered | null;
  pixKey: string;
  setPixKey: (s: string) => void;
  pixKeyType: PixKeyType;
  setPixKeyType: (s: PixKeyType) => void;
  firstName: string;
  setFirstName: (s: string) => void;
  lastName: string;
  setLastName: (s: string) => void;
  cpf: string;
  setCpf: (s: string) => void;
  loading: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const filled =
    pixKey.length > 0 &&
    cpf.length >= 11 &&
    firstName.length > 0 &&
    lastName.length > 0;
  return (
    <div>
      <TestnetBanner />
      <p className="font-details text-[10px] tracking-[0.3em] uppercase text-primary-deep">
        02b // Conta PIX · destinatário do payout
      </p>
      <h1 className="font-title text-3xl md:text-4xl font-semibold mt-3 tracking-tight leading-tight text-base">
        Registre sua conta PIX na anchor.
      </h1>
      <p className="font-text text-base mt-4 text-base/80 leading-relaxed max-w-prose">
        A Etherfuse exige uma conta PIX ativa pra cada investidor antes de
        criar order de pagamento. Registro programático (PLINA-MOD-006). O
        CPF tem que bater com o KYC aprovado no passo anterior.
      </p>

      {bankInfo && (
        <div className="mt-8 border-y border-light-hairline">
          <dl className="grid grid-cols-1 gap-px bg-base/10">
            <DataRow
              k="Bank account"
              v={
                <span className="font-mono text-[11px] text-base/75">
                  {bankInfo.bankAccountId}
                </span>
              }
            />
            <DataRow
              k="Status"
              v={
                <span className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
                  ● {bankInfo.status}
                  {bankInfo.idempotent && ' · idempotent'}
                </span>
              }
            />
          </dl>
          <div className="mt-8">
            <button
              onClick={onSkip}
              className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors"
            >
              Continuar para cotação
            </button>
          </div>
        </div>
      )}

      {!bankInfo && (
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Tipo de chave
            </span>
            <select
              value={pixKeyType}
              onChange={(e) => setPixKeyType(e.target.value as PixKeyType)}
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-sm text-base focus:outline-none focus:border-base"
            >
              <option value="cpf">CPF</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
              <option value="evp">Aleatória (EVP)</option>
              <option value="cnpj">CNPJ</option>
            </select>
          </label>
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Chave PIX
            </span>
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              placeholder="ex: 52998224725"
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-sm text-base focus:outline-none focus:border-base"
            />
          </label>
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              CPF (11 dígitos)
            </span>
            <input
              type="text"
              value={cpf}
              onChange={(e) => setCpf(e.target.value.replace(/\D/g, ''))}
              maxLength={11}
              placeholder="52998224725"
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-sm text-base focus:outline-none focus:border-base"
            />
          </label>
          <label className="block">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Nome
            </span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="João"
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-sm text-base focus:outline-none focus:border-base"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
              Sobrenome
            </span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Silva"
              className="mt-3 w-full bg-transparent border-b border-base/30 pb-3 font-mono text-sm text-base focus:outline-none focus:border-base"
            />
          </label>

          <div className="md:col-span-2 mt-6">
            <button
              onClick={onSubmit}
              disabled={!filled || loading}
              className="bg-base text-white font-details text-xs tracking-[0.2em] uppercase px-8 py-4 rounded-full hover:bg-primary-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
            >
              {loading && (
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden />
              )}
              {loading ? 'Registrando…' : 'Registrar conta PIX'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
