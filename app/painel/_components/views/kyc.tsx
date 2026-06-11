'use client';

/**
 * KYC & Compliance — esteira de verificação. O passo 1 (identidade/KYC) reflete
 * o status real do investidor (usePessoa); os demais descrevem os controles
 * institucionais do issuer (AUTH flags, clawback, enquadramento) — texto fixo,
 * sem fabricar status "verde" que não exista. Badges regulatórios são estáticos.
 */

import { ViewHead } from './cotas';

interface KycProps {
  kycAprovado: boolean;
  kycStatus: string | null;
}

export default function Kyc({ kycAprovado, kycStatus }: KycProps) {
  const kycLabel = kycAprovado
    ? 'Verificado'
    : (kycStatus ?? 'Pendente').replace(/_/g, ' ').toLowerCase();

  const steps = [
    {
      n: '01',
      title: 'Identidade institucional',
      desc: 'Razão social, CNPJ, beneficial owners e estrutura societária atestados em diligência via Etherfuse.',
      id: 'SEP-12 · KYC_FULL',
      status: kycLabel,
      done: kycAprovado,
    },
    {
      n: '02',
      title: 'Triagem AML e sanções',
      desc: 'Verificação PEP e listas OFAC/ONU conduzida pela anchor regulada.',
      id: 'AML_SCREEN',
      status: kycAprovado ? 'Aprovado' : 'Aguardando',
      done: kycAprovado,
    },
    {
      n: '03',
      title: 'Autorização on-chain',
      desc: 'Conta Stellar autorizada pelo emissor para deter o ativo PLINA-RF (AUTH_REQUIRED).',
      id: 'AUTH_REQUIRED',
      status: 'Controle do issuer',
      done: false,
    },
    {
      n: '04',
      title: 'Clawback nativo',
      desc: 'Proteção institucional habilitada na trustline; permite reversão sob ordem regulatória.',
      id: 'AUTH_CLAWBACK_ENABLED',
      status: 'Habilitado',
      done: true,
    },
    {
      n: '05',
      title: 'Investidor qualificado',
      desc: 'Acreditação sob CVM Resolução 30, confirmada documentalmente.',
      id: 'CVM_RES_30',
      status: kycAprovado ? 'Confirmado' : 'Pendente',
      done: kycAprovado,
    },
  ];

  const badges = [
    { label: 'Enquadramento', value: 'CVM 175' },
    { label: 'Lei de Consórcios', value: '11.795 / 2008' },
    { label: 'Anchor regulada', value: 'SEP-24 · SEP-38' },
    { label: 'Custódia', value: 'Privy · MPC' },
  ];

  return (
    <div>
      <ViewHead
        eyebrow="Compliance é o produto"
        title="KYC & Compliance"
        lede="Cada etapa de verificação é atestada por prestador registrado e refletida on-chain. Clawback e flags de autorização são diferenciais institucionais, não disclaimer."
      />

      <div className="border-t border-light-hairline mb-9">
        {steps.map((s) => (
          <div
            key={s.n}
            className="relative grid grid-cols-[48px_1fr_auto] items-center gap-5 py-6 pl-5 border-b border-light-hairline hover:bg-white transition-colors"
          >
            <span
              className={`absolute left-0 top-0 bottom-0 w-[2px] ${
                s.done ? 'bg-primary' : 'bg-base/15'
              }`}
            />
            <span className="font-mono text-2xl text-base/25">{s.n}</span>
            <div>
              <div className="font-title text-lg font-semibold text-base tracking-tight">
                {s.title}
              </div>
              <div className="font-text text-[13px] text-base/60 mt-1.5 max-w-[66ch] leading-relaxed">
                {s.desc}
              </div>
              <div className="font-mono text-[11px] text-primary-deep mt-2">
                {s.id}
              </div>
            </div>
            <div className="flex items-center gap-2 justify-self-end">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  s.done ? 'bg-primary-deep' : 'bg-base/30'
                }`}
              />
              <span className="font-details text-[10px] font-bold tracking-[0.16em] uppercase text-base whitespace-nowrap capitalize">
                {s.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-base/15 border border-light-hairline">
        {badges.map((b) => (
          <div key={b.label} className="bg-base px-5 py-5">
            <div className="font-details text-[9px] font-bold tracking-[0.2em] uppercase text-secondaryLight/60">
              {b.label}
            </div>
            <div className="font-mono text-sm text-white mt-3">{b.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
