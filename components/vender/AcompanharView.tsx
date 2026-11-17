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

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import StepperVender from '@/components/vender/StepperVender';
import { ETAPAS_VENDER } from '@/lib/vender/etapas';
import { useAppPrivy } from '@/lib/hooks/privy';
import { withTimeout } from '@/lib/http/client';

export interface TxLink {
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
  /** DS5: o termo foi enviado por DocuSign (cessão `ENVIADA_DOCUSIGN`) e falta a assinatura do cedente. */
  aguardandoAssinatura?: boolean;
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
  'Proposta calculada sobre o prazo, a administradora e a curva de precificação da Plina (simulação em rede de testes).',
  'Cessão da cota assinada. A transferência depende da anuência da administradora; o hash do documento fica registrado em rede de testes.',
  'Pix do valor líquido, previsto após a assinatura (simulado em rede de testes; sem prazo definido).',
] as const;

export default function AcompanharView({ data, onAtualizar }: { data: AcompanharData; onAtualizar?: () => void }) {
  const router = useRouter();
  const inicial = Math.min(Math.max(data.etapaAtual, 0), ULTIMO);
  const [view, setView] = useState(inicial);
  const [aceitando, setAceitando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { getAccessToken } = useAppPrivy();
  const raiz = useRef<HTMLDivElement>(null);
  // Só leva o foco ao título depois de uma navegação explícita (stepper, Voltar, Avançar), nunca na carga nem numa atualização.
  const focarTitulo = useRef(false);

  function irPara(proximo: number) {
    focarTitulo.current = true;
    setView(proximo);
  }

  // etapaAtual pode ser ULTIMO + 1 (fluxo concluído): a última etapa é então a atual, não uma pré-visualização.
  const ehAtual = view === Math.min(data.etapaAtual, ULTIMO);
  // DS5: entre o aceite e a assinatura a etapa 4 mostra o estado real, em vez
  // do texto genérico de cessão.
  const aguardando = !!data.aguardandoAssinatura && view === 4 && ehAtual;
  // Contexto REAL (AP-5): a etapa em que a solicitação está de fato, sempre visível acima do stepper.
  const real = Math.min(Math.max(data.etapaAtual, 0), ULTIMO);
  const aguardandoReal = !!data.aguardandoAssinatura && real === 4;
  const descricaoReal = aguardandoReal ? TEXTO_AGUARDANDO_ASSINATURA : data.contextoDescricao;
  // Pré-visualização: descrição da etapa consultada (só quando não é a real).
  const descricaoConsultada = DESCRICAO_ETAPA[view] ?? '';

  useEffect(() => {
    if (!focarTitulo.current) return;
    focarTitulo.current = false;
    const titulo = raiz.current?.querySelector<HTMLElement>(ehAtual ? '[data-testid="contexto-real"] h2' : '[data-testid="painel-consultado"] h2');
    titulo?.focus();
  }, [view, ehAtual]);

  async function aceitar() {
    if (!data.ofertaId) return;
    setAceitando(true);
    setErro(null);
    try {
      // A rota é withPessoaAuth: sem o token do Privy responde 401 "token Privy ausente".
      // getAccessToken() pode nunca resolver (mesma classe de bug do /vender): timeout de 8 s.
      const token = await withTimeout(
        getAccessToken(),
        8000,
        'Sessão demorou pra responder. Tente novamente.',
      );
      const res = await withTimeout(
        fetch('/api/vender/aceitar-oferta', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ofertaId: data.ofertaId }),
        }),
        10000,
        'A requisição demorou demais. Tente novamente.',
      );
      if (!res.ok) throw new Error((await res.json()).error ?? 'erro');
      // Os dados vêm de um fetch do cliente (AcompanharPrivado): recarrega por ele; o refresh cobre quem monta a view direto.
      onAtualizar?.();
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setAceitando(false);
    }
  }

  return (
    <div ref={raiz}>
      {/* Contexto real, persistente: não some quando a pessoa consulta outra etapa. */}
      <section data-testid="contexto-real" aria-labelledby="etapa-real-titulo" className="mb-8 border border-light-hairline bg-white p-6 md:p-7">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">Etapa atual</p>
        <h2 id="etapa-real-titulo" tabIndex={-1} className="font-title text-xl font-semibold tracking-tight mt-2 scroll-mt-24">
          {ETAPAS_VENDER[real]}
        </h2>
        {descricaoReal ? <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">{descricaoReal}</p> : null}
      </section>

      <StepperVender
        current={view}
        // Pix enviado e cota ainda não incorporada: a última etapa não é ✓ (Íris R-3, coerente com A-26).
        completedUpTo={data.temCota ? data.etapaAtual : Math.min(data.etapaAtual, ULTIMO)}
        onStepClick={irPara}
        isStepEnabled={() => true}
      />

      {/* Etapa consultada. Na etapa real o título e a descrição já estão na faixa de cima: aqui só o conteúdo. */}
      {(!ehAtual || view >= 2) && (
        <section data-testid="painel-consultado" className="mt-10 border border-light-hairline bg-white p-6 md:p-7">
          {!ehAtual && (
            <>
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-primary-deep">Pré-visualização</p>
              <h2 tabIndex={-1} className="font-title text-xl font-semibold tracking-tight mt-2 scroll-mt-24">
                {ETAPAS_VENDER[view]}
              </h2>
              <p className="font-text text-sm text-base/70 mt-2 leading-relaxed">{descricaoConsultada}</p>
            </>
          )}

          {view === 2 && <PainelValidacao consentTx={data.consentTx} semTopo={ehAtual} />}
          {view === 3 && (
            <PainelOferta
              oferta={data.oferta}
              podeAceitar={data.status === 'OFERTA_ENVIADA' && !!data.ofertaId}
              aceitando={aceitando}
              erro={erro}
              onAceitar={aceitar}
              semTopo={ehAtual}
            />
          )}
          {view === 4 && (
            <PainelCessao
              cedenteNome={data.cedenteNome}
              cessaoId={data.cessaoId}
              cessaoTx={data.cessaoTx}
              aguardandoAssinatura={aguardando}
              assinada={data.etapaAtual > 4}
              semTopo={ehAtual}
            />
          )}
          {view === 5 && (
            <PainelPix
              valorLiquido={data.oferta?.valorLiquido ?? null}
              pixTx={data.pixTx}
              cessaoId={data.cessaoId}
              temCota={data.temCota}
              semTopo={ehAtual}
            />
          )}
        </section>
      )}

      {/* Navegação de preview — percorre as 6 etapas como no mockup. */}
      <div className="mt-8 flex items-center justify-between border-t border-light-hairline pt-6">
        <button
          type="button"
          onClick={() => irPara(Math.max(0, view - 1))}
          disabled={view === 0}
          className="inline-flex min-h-[44px] items-center font-details text-[11px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Voltar
        </button>
        {view === ULTIMO ? (
          // "Concluído" era um botão de estado que afirmava o que ainda pode não ter acontecido: agora é só navegação.
          <a
            href={data.temCota ? '/pool' : '/vender/minhas'}
            className="inline-flex min-h-[44px] items-center bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors"
          >
            {data.temCota ? 'Ver o pool →' : 'Ver minhas solicitações →'}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => irPara(Math.min(ULTIMO, view + 1))}
            className="inline-flex min-h-[44px] items-center font-details text-[11px] tracking-[0.2em] uppercase text-base/60 hover:text-base transition-colors"
          >
            Avançar →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Painel: Validação jurídica ──────────────────────────────────────────────

const TOPO = 'mt-6 border-t border-light-hairline pt-6';

/** Disclosure do exemplo ilustrativo: o resumo é o aviso aprovado; o conteúdo de exemplo só existe aberto. */
function ExemploIlustrativo({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-4 border border-light-hairline">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-4 font-mono text-[11px] text-base/70">
        Exemplo ilustrativo (simulação em rede de testes).
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function PainelValidacao({ consentTx, semTopo = false }: { consentTx: TxLink | null; semTopo?: boolean }) {
  return (
    <div className={semTopo ? '' : TOPO}>
      {/* Texto único da etapa (Consuelo, fechamento 15/11): antes havia "integração B2B via API/SLA", "cartório com e-CPF" e
          "taxa de anuência 1–3%", nada disso existe ou está decidido. */}
      <p data-testid="texto-validacao" className="font-text text-sm text-base/70">
        Nossa mesa está conferindo a titularidade e a situação da sua cota junto à administradora.
      </p>

      {/* Só afirma o registro quando há link para conferir (Consuelo, ✓ do hotfix): sem consentTx a tela não o comprova. */}
      {consentTx ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border border-primary/30 bg-document-grey/40 p-4">
          <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
          <span className="flex-1 font-text text-sm text-base/70 min-w-[12rem]">
            Hash do consentimento registrado on-chain na Stellar
          </span>
          <a
            href={consentTx.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center font-mono text-xs underline text-primary-deep hover:text-primary"
          >
            {consentTx.hashShort}… → Stellar Expert
          </a>
        </div>
      ) : (
        <p data-testid="consentimento-indisponivel" className="mt-4 font-text text-sm text-base/70">
          Hash do consentimento: registro indisponível para este cadastro.
        </p>
      )}
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
  semTopo = false,
}: {
  oferta: AcompanharData['oferta'];
  podeAceitar: boolean;
  aceitando: boolean;
  erro: string | null;
  onAceitar: () => void;
  semTopo?: boolean;
}) {
  const topo = semTopo ? '' : TOPO;

  // Sem proposta real: o estado verdadeiro vem primeiro e o exemplo (valores e botão desabilitado) fica recolhido (AP-5).
  if (!oferta) {
    return (
      <div className={topo}>
        {/* N1 (Norma, 16/11): o estado real, sem promessa de chegada. */}
        <p role="status" className="font-text text-sm text-base/80">
          Ainda não há proposta para esta solicitação.
        </p>
        <ExemploIlustrativo>
          <div className="mt-2 border border-primary/30">
            <OfertaLinhas v={EXEMPLO_OFERTA} />
          </div>
          <p className="font-text text-xs text-base/70 mt-4 leading-relaxed">{RESSALVA_OFERTA}</p>
          <button
            type="button"
            disabled
            className="mt-4 min-h-[44px] bg-base/40 text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 cursor-not-allowed"
          >
            Aceitar proposta →
          </button>
        </ExemploIlustrativo>
      </div>
    );
  }

  // Proposta real: valores → validade → ressalva → aceite → erro. Data e ressalva ANTES do botão, nunca num tooltip.
  return (
    <div className={topo}>
      <div className="border border-primary/30">
        <OfertaLinhas v={oferta} />
      </div>
      <p className="font-text text-xs text-base/70 mt-4 leading-relaxed">{RESSALVA_OFERTA}</p>
      {podeAceitar && (
        <button
          type="button"
          onClick={onAceitar}
          disabled={aceitando}
          className="mt-6 min-h-[44px] bg-base text-lightBg font-details text-[11px] tracking-[0.2em] uppercase px-6 py-3 hover:bg-primary-deep transition-colors disabled:opacity-50"
        >
          {aceitando ? 'Enviando…' : 'Aceitar proposta →'}
        </button>
      )}
      {erro && <p className="font-text text-sm text-red-700 mt-4">{erro}</p>}
    </div>
  );
}

const RESSALVA_OFERTA = 'Deságio simulado a partir do prazo, da administradora e da curva de precificação da Plina; nenhum valor é proposta firme.';

/** Valores do exemplo ilustrativo; só aparecem dentro do disclosure, nunca como resumo real. */
const EXEMPLO_OFERTA = { valorCarta: 120000, desagioPct: '18.5', valorLiquido: 97800, prazoRestanteMeses: null as number | null, validade: null as string | null };

function OfertaLinhas({ v }: { v: { valorCarta: number; desagioPct: string; valorLiquido: number; prazoRestanteMeses: number | null; validade: string | null } }) {
  return (
    <>
      <OfertaLinha label="Valor de face da cota" value={BRL.format(v.valorCarta)} />
      <OfertaLinha label="Deságio aplicado" value={`− ${v.desagioPct.replace('.', ',')}%`} accent />
      <OfertaLinha label="Valor líquido a receber" value={BRL.format(v.valorLiquido)} destaque />
      {v.prazoRestanteMeses != null && <OfertaLinha label="Prazo restante da cota" value={`${v.prazoRestanteMeses} meses`} />}
      <OfertaLinha label="Pagamento" value="Pix (simulado em rede de testes)" />
      {v.validade && <OfertaLinha label="Validade da proposta" value={v.validade} mono />}
    </>
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
    <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 px-5 py-4 border-b border-light-hairline last:border-b-0">
      <span className="font-text text-sm text-base/70">{label}</span>
      <span
        className={[
          'min-w-0 break-words text-left sm:text-right',
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

const TEXTO_AGUARDANDO_ASSINATURA =
  'O termo de cessão foi enviado para a sua assinatura. Assim que você assinar, o status avança.';

function PainelCessao({
  cedenteNome,
  cessaoId,
  cessaoTx,
  aguardandoAssinatura = false,
  assinada = false,
  semTopo = false,
}: {
  cedenteNome: string | null;
  cessaoId: string | null;
  cessaoTx: TxLink | null;
  aguardandoAssinatura?: boolean;
  /** Cessão já assinada (etapa atual além da cessão): não repetir o aviso de "link de e-mail". */
  assinada?: boolean;
  semTopo?: boolean;
}) {
  return (
    <div className={semTopo ? '' : TOPO}>
      <p className="font-text text-sm text-base/70">
        Hash do documento registrado em rede de testes. A validade da cessão depende da anuência da administradora e dos
        instrumentos jurídicos.
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
          <div>Cessionária: Plina Finance (projeto em fase de testes, empresa em constituição)</div>
          <div>Objeto: Direito creditório da cota cedida</div>
        </div>
      </div>

      {aguardandoAssinatura ? (
        <p
          role="status"
          data-testid="aguardando-assinatura"
          className="mt-4 border-l-4 border-l-base border border-light-hairline p-4 font-text text-sm text-base/80"
        >
          <span className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70 block mb-1">
            Aguardando assinatura
          </span>
          Enviado por DocuSign. Nenhum pagamento é feito antes da sua assinatura.
        </p>
      ) : assinada ? null : (
        <p data-testid="assinatura-por-email" className="mt-4 font-text text-sm text-base/80">
          A assinatura eletrônica é feita pelo link de e-mail que a equipe envia nesta etapa. Verifique a caixa de spam. Enquanto isso, nada
          precisa ser feito aqui.
        </p>
      )}

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
                className="inline-flex min-h-[44px] items-center font-mono text-xs underline text-primary-deep hover:text-primary"
              >
                {cessaoTx.hashShort}… → Stellar Expert
              </a>
            </div>
          )}
          {cessaoId && (
            <a
              href={`/cessao/${cessaoId}/comprovante`}
              className="inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
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
  semTopo = false,
}: {
  valorLiquido: number | null;
  pixTx: TxLink | null;
  cessaoId: string | null;
  temCota: boolean;
  semTopo?: boolean;
}) {
  // Sem Pix on-chain ainda → o resultado é só um exemplo (como no mockup): vive inteiro, com o check decorativo e os
  // valores, dentro do disclosure; nenhum check de sucesso fica fora dele.
  const ilustrativo = !pixTx;
  const valor = valorLiquido ?? 97800;

  const resultado = (
    <div className="text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary text-base">
        <span className="text-3xl">✓</span>
      </div>
      <h3 className="font-title text-3xl font-semibold tracking-tight mt-6">{BRL.format(valor)} (Pix simulado)</h3>
      <p className="font-mono text-sm text-base/70 mt-2">Simulação em rede de testes: nenhum dinheiro real foi enviado.</p>
      <p
        data-testid={temCota ? 'cota-incorporada' : 'cota-nao-incorporada'}
        className="font-text text-sm text-base/70 mt-4 max-w-md mx-auto leading-relaxed"
      >
        {temCota
          ? 'Cota incorporada ao pool de demonstração · tokens de demonstração emitidos na Stellar testnet.'
          : 'Pagamento simulado registrado. A incorporação da cota ao pool de demonstração ainda não aconteceu.'}
      </p>

      {/* Cota → Pool → token de demonstração · Stellar testnet (só depois da incorporação) */}
      {temCota && (
        // Íris: no celular os três blocos empilham (setas para baixo) e o texto pode quebrar; de sm em diante, a linha de antes.
        <div
          data-testid="diagrama-cota-pool-token"
          className="mx-auto mt-8 flex min-w-0 max-w-2xl flex-col items-stretch gap-2 border border-light-hairline bg-document-grey/40 p-5 font-mono text-xs sm:flex-row sm:items-center"
        >
          <span className="min-w-0 break-words border border-light-hairline bg-white px-3 py-3 text-center text-base/80 sm:flex-1">Cota</span>
          <span aria-hidden="true" className="text-center text-primary-deep">
            <span className="sm:hidden">↓</span>
            <span className="hidden sm:inline">→</span>
          </span>
          <span className="min-w-0 break-words border border-light-hairline bg-white px-3 py-3 text-center text-base/80 sm:flex-1">Pool</span>
          <span aria-hidden="true" className="text-center text-primary-deep">
            <span className="sm:hidden">↓</span>
            <span className="hidden sm:inline">→</span>
          </span>
          <span className="min-w-0 break-words border border-primary/40 bg-primary/10 px-3 py-3 text-center text-primary-deep sm:flex-1">
            Token de demonstração · Stellar testnet
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className={semTopo ? '' : TOPO}>
      {ilustrativo ? <ExemploIlustrativo>{resultado}</ExemploIlustrativo> : resultado}

      {(pixTx || cessaoId) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 border-t border-light-hairline pt-6">
          {pixTx && (
            <a
              href={pixTx.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center font-mono text-xs underline text-primary-deep hover:text-primary"
            >
              Pix on-chain: {pixTx.hashShort}… → Stellar Expert
            </a>
          )}
          {cessaoId && (
            <a
              href={`/cessao/${cessaoId}/comprovante`}
              className="inline-flex min-h-[44px] items-center font-details text-[10px] tracking-[0.2em] uppercase underline text-primary-deep hover:text-primary"
            >
              Ver comprovante →
            </a>
          )}
        </div>
      )}

      {temCota && (
        <p className="font-text text-sm text-base/70 mt-6 text-center leading-relaxed">
          Sua cota foi incorporada ao pool de demonstração. Composição em{' '}
          <a href="/pool" className="underline">
            /pool
          </a>
          .
        </p>
      )}
    </div>
  );
}
