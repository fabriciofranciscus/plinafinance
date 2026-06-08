'use client';

/**
 * AcompanharView — view interativa do acompanhamento do cedente.
 *
 * O Server Component pai (`/vender/acompanhar/[leadId]`) busca o lead e passa
 * tudo já serializado (sem Decimal/Date/SDK). Aqui ficam a navegação de preview
 * (stepper clicável + Voltar/Avançar, igual ao mockup) e a única ação real do
 * cedente: aceitar a oferta (`POST /api/vender/aceitar-oferta`). Os demais passos
 * são dirigidos pela mesa, então aparecem como status/preview.
 *
 * `view` é o passo em foco (0..5); o progresso real é `etapaAtual`. O stepper
 * recebe `current={view}` e `completedUpTo={etapaAtual}`.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import StepperVender from '@/components/vender/StepperVender';
import { ETAPAS_VENDER } from '@/lib/vender/etapas';

interface TxLink {
  hashShort: string;
  url: string;
}

export interface AcompanharData {
  leadId: string;
  cedenteNome: string | null;
  status: string;
  etapaAtual: number;
  contextoDescricao: string;
  ofertaId: string | null;
  oferta: {
    valorCarta: number;
    desagioPct: string;
    valorLiquido: number;
    prazoRestanteMeses: number | null;
    validade: string;
  } | null;
  cessaoId: string | null;
  consentTx: TxLink | null;
  cessaoTx: TxLink | null;
  pixTx: TxLink | null;
  temCota: boolean;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

const ULTIMO = ETAPAS_VENDER.length - 1; // 5

// Descrições por etapa (índice) para o modo preview. Quando o passo em foco é o
// real (view === etapaAtual), usamos o texto preciso do status (contextoDescricao).
const DESCRICAO_ETAPA = [
  'Verificação AML/KYC concluída — feita uma única vez, vale para venda e investimento.',
  'Sua cota foi enviada e entrou na fila da nossa mesa.',
  'Nossa mesa valida a titularidade e a situação da cota junto à administradora.',
  'Oferta firme calculada sobre prazo, administradora e curva de yield do pool.',
  'Cessão de direitos creditórios assinada e registrada on-chain.',
  'Pix do valor líquido executado em até 48h após a assinatura.',
] as const;

export default function AcompanharView({ data }: { data: AcompanharData }) {
  const router = useRouter();
  const inicial = Math.min(Math.max(data.etapaAtual, 0), ULTIMO);
  const [view, setView] = useState(inicial);
  const [aceitando, setAceitando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehAtual = view === data.etapaAtual;
  const descricao = ehAtual
    ? data.contextoDescricao
    : DESCRICAO_ETAPA[view] ?? '';

  async function aceitar() {
    if (!data.ofertaId) return;
    setAceitando(true);
    setErro(null);
    try {
      const res = await fetch('/api/vender/aceitar-oferta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ofertaId: data.ofertaId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setAceitando(false);
    }
  }

  return (
    <>
      <StepperVender
        current={view}
        completedUpTo={data.etapaAtual}
        onStepClick={setView}
        isStepEnabled={() => true}
      />

      <section className="mt-10 border border-light-hairline bg-white p-6 md:p-7">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">
          {ehAtual ? 'Etapa atual' : 'Pré-visualização'}
        </p>
        <h2 className="font-title text-xl font-semibold tracking-tight mt-2">
          {ETAPAS_VENDER[view]}
        </h2>
        <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">
          {descricao}
        </p>

        {view === 2 && <PainelValidacao consentTx={data.consentTx} />}
        {view === 3 && (
          <PainelOferta
            oferta={data.oferta}
            podeAceitar={data.status === 'OFERTA_ENVIADA' && !!data.ofertaId}
            aceitando={aceitando}
            erro={erro}
            onAceitar={aceitar}
          />
        )}
        {view === 4 && (
          <PainelCessao
            cedenteNome={data.cedenteNome}
            cessaoId={data.cessaoId}
            cessaoTx={data.cessaoTx}
          />
        )}
        {view === 5 && (
          <PainelPix
            valorLiquido={data.oferta?.valorLiquido ?? null}
            pixTx={data.pixTx}
            cessaoId={data.cessaoId}
            temCota={data.temCota}
          />
        )}
      </section>

      {/* Navegação de preview — percorre as 6 etapas como no mockup. */}
      <div className="mt-8 flex items-center justify-between border-t border-light-hairline pt-6">
        <button
          type="button"
          onClick={() => setView((v) => Math.max(0, v - 1))}
          disabled={view === 0}
          className="font-details text-[11px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Voltar
        </button>
        <button
          type="button"
          onClick={() => setView((v) => Math.min(ULTIMO, v + 1))}
          disabled={view === ULTIMO}
          className="font-details text-[11px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Avançar →
        </button>
      </div>
    </>
  );
}

// ─── Painel: Validação jurídica ──────────────────────────────────────────────

function PainelValidacao({ consentTx }: { consentTx: TxLink | null }) {
  return (
    <div className="mt-6 border-t border-light-hairline pt-6">
      <p className="font-text text-sm text-base/70">
        Duas camadas — caminho preferencial e fallback.
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-4 border border-primary/30 bg-primary/5 p-4">
          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-base shrink-0">
            ✓
          </span>
          <div>
            <p className="font-text text-sm font-semibold text-base">
              Integração B2B com administradora via API
            </p>
            <p className="font-mono text-xs text-base/60 mt-0.5">
              Caminho preferencial · SLA contratual
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 border border-light-hairline p-4">
          <span className="mt-0.5 h-5 w-5 rounded-full border border-base/30 shrink-0" />
          <div>
            <p className="font-text text-sm font-semibold text-base">
              Cartório digital com e-CPF
            </p>
            <p className="font-mono text-xs text-base/60 mt-0.5">
              Fallback · Taxa de anuência 1–3% embutida no deságio
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border border-primary/30 bg-document-grey/40 p-4">
        <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
        <span className="flex-1 font-text text-sm text-base/70 min-w-[12rem]">
          Hash do consentimento registrado on-chain na Stellar
        </span>
        {consentTx ? (
          <a
            href={consentTx.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs underline text-primary-deep hover:text-primary"
          >
            {consentTx.hashShort}… → Stellar Expert
          </a>
        ) : (
          <span className="font-mono text-xs text-base/50">pendente</span>
        )}
      </div>
    </div>
  );
}

// ─── Painel: Oferta de preço ─────────────────────────────────────────────────

function PainelOferta({
  oferta,
  podeAceitar,
  aceitando,
  erro,
  onAceitar,
}: {
  oferta: AcompanharData['oferta'];
  podeAceitar: boolean;
  aceitando: boolean;
  erro: string | null;
  onAceitar: () => void;
}) {
  // Sem oferta real ainda → mostra um exemplo ilustrativo (como no mockup), em
  // vez de uma tela "aguardando" vazia. Botão de aceite fica desabilitado.
  const ilustrativo = !oferta;
  const v = oferta ?? {
    valorCarta: 120000,
    desagioPct: '18.5',
    valorLiquido: 97800,
    prazoRestanteMeses: null as number | null,
    validade: null as string | null,
  };
  const desagio = v.desagioPct.replace('.', ',');

  return (
    <div className="mt-6 border-t border-light-hairline pt-6">
      {ilustrativo && (
        <p className="font-mono text-[11px] text-base/55 mb-4">
          Exemplo ilustrativo — sua oferta firme aparece aqui quando a mesa
          concluir a validação.
        </p>
      )}

      <div className="border border-primary/30">
        <OfertaLinha label="Valor de face da cota" value={BRL.format(v.valorCarta)} />
        <OfertaLinha label="Deságio aplicado" value={`− ${desagio}%`} accent />
        <OfertaLinha
          label="Valor líquido a receber"
          value={BRL.format(v.valorLiquido)}
          destaque
        />
        {v.prazoRestanteMeses != null && (
          <OfertaLinha
            label="Prazo restante da cota"
            value={`${v.prazoRestanteMeses} meses`}
          />
        )}
        <OfertaLinha label="Prazo de pagamento" value="≤ 48 horas via Pix" />
        <OfertaLinha
          label="Método"
          value="Anchor BR · SEP-24 / BaaS Celcoin"
          mono
        />
        {v.validade && (
          <OfertaLinha label="Validade da oferta" value={v.validade} mono />
        )}
      </div>

      {ilustrativo ? (
        <button
          type="button"
          disabled
          className="mt-6 bg-base/40 text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 cursor-not-allowed"
        >
          Aceitar oferta →
        </button>
      ) : podeAceitar ? (
        <button
          type="button"
          onClick={onAceitar}
          disabled={aceitando}
          className="mt-6 bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {aceitando ? 'Enviando…' : 'Aceitar oferta →'}
        </button>
      ) : null}
      {erro && <p className="font-text text-sm text-red-700 mt-4">{erro}</p>}

      <p className="font-text text-xs text-base/55 mt-4 leading-relaxed">
        Deságio calculado sobre prazo, administradora e curva de yield do pool
        PLINA-RF.
      </p>
    </div>
  );
}

function OfertaLinha({
  label,
  value,
  accent = false,
  destaque = false,
  mono = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  destaque?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-light-hairline last:border-b-0">
      <span className="font-text text-sm text-base/70">{label}</span>
      <span
        className={[
          'shrink-0 text-right',
          destaque
            ? 'font-title text-2xl font-bold text-primary-deep'
            : accent
              ? 'font-mono text-base font-semibold text-primary-deep'
              : mono
                ? 'font-mono text-sm text-base'
                : 'font-text text-base font-semibold text-base',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Painel: Cessão digital ──────────────────────────────────────────────────

function PainelCessao({
  cedenteNome,
  cessaoId,
  cessaoTx,
}: {
  cedenteNome: string | null;
  cessaoId: string | null;
  cessaoTx: TxLink | null;
}) {
  return (
    <div className="mt-6 border-t border-light-hairline pt-6">
      <p className="font-text text-sm text-base/70">
        Validade jurídica plena · hash do contrato registrado on-chain.
      </p>

      <div className="mt-4 border border-light-hairline bg-document-grey/30 p-6">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/55">
          Documento
        </p>
        <p className="font-text text-lg font-semibold text-base mt-2">
          Termo de Cessão de Direitos Creditórios
        </p>
        <div className="mt-4 space-y-1 font-mono text-xs text-base/70">
          <div>Cedente: {cedenteNome ?? '—'}</div>
          <div>Cessionária: Plina Securitizadora S.A.</div>
          <div>Objeto: Direito creditório da cota cedida</div>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          disabled
          className="bg-base/40 text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 cursor-not-allowed"
        >
          Assinar com e-CPF via DocuSign
        </button>
        <span className="ml-3 font-mono text-[11px] text-base/50">em breve</span>
      </div>

      {(cessaoTx || cessaoId) && (
        <div className="mt-4 space-y-2">
          {cessaoTx && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-text text-sm text-base/70">
                Cessão on-chain
              </span>
              <a
                href={cessaoTx.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs underline text-primary-deep hover:text-primary"
              >
                {cessaoTx.hashShort}… → Stellar Expert
              </a>
            </div>
          )}
          {cessaoId && (
            <a
              href={`/cessao/${cessaoId}/comprovante`}
              className="inline-block font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
            >
              Ver comprovante →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Painel: Pix recebido ────────────────────────────────────────────────────

function PainelPix({
  valorLiquido,
  pixTx,
  cessaoId,
  temCota,
}: {
  valorLiquido: number | null;
  pixTx: TxLink | null;
  cessaoId: string | null;
  temCota: boolean;
}) {
  // Sem Pix on-chain ainda → estado ilustrativo (como no mockup).
  const ilustrativo = !pixTx;
  const valor = valorLiquido ?? 97800;

  return (
    <div className="mt-6 border-t border-light-hairline pt-6">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary text-base">
          <span className="text-3xl">✓</span>
        </div>
        <h3 className="font-title text-3xl font-semibold tracking-tight mt-6">
          {BRL.format(valor)} enviados via Pix
        </h3>
        <p className="font-mono text-sm text-base/60 mt-2">
          Pix enviado para sua chave cadastrada
        </p>
        <p className="font-text text-sm text-base/70 mt-4 max-w-md mx-auto leading-relaxed">
          Direito creditório incorporado ao pool FIDC · PLINA-RF emitido
          proporcionalmente na Stellar.
        </p>

        {/* Cota → Pool FIDC → PLINA-RF mintado · Stellar */}
        <div className="mx-auto mt-8 flex max-w-2xl items-center justify-between gap-3 border border-light-hairline bg-document-grey/40 p-5 font-mono text-xs">
          <span className="flex-1 border border-light-hairline bg-white px-3 py-3 text-center text-base/80">
            Cota
          </span>
          <span className="text-primary-deep">→</span>
          <span className="flex-1 border border-light-hairline bg-white px-3 py-3 text-center text-base/80">
            Pool FIDC
          </span>
          <span className="text-primary-deep">→</span>
          <span className="flex-1 border border-primary/40 bg-primary/10 px-3 py-3 text-center text-primary-deep">
            PLINA-RF mintado · Stellar
          </span>
        </div>

        {ilustrativo && (
          <p className="font-mono text-[11px] text-base/55 mt-4">
            Exemplo ilustrativo — confirmado quando a mesa executar o Pix.
          </p>
        )}
      </div>

      {(pixTx || cessaoId) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 border-t border-light-hairline pt-6">
          {pixTx && (
            <a
              href={pixTx.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs underline text-primary-deep hover:text-primary"
            >
              Pix on-chain: {pixTx.hashShort}… → Stellar Expert
            </a>
          )}
          {cessaoId && (
            <a
              href={`/cessao/${cessaoId}/comprovante`}
              className="font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
            >
              Ver comprovante →
            </a>
          )}
        </div>
      )}

      {temCota && (
        <p className="font-text text-sm text-base/70 mt-6 text-center leading-relaxed">
          Sua cota foi incorporada ao pool tokenizado público. Composição em{' '}
          <a href="/pool" className="underline">
            /pool
          </a>
          .
        </p>
      )}
    </div>
  );
}
