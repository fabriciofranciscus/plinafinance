'use client';

/**
 * Revisão antes de executar uma ação irreversível do /admin. Mesmo padrão do fluxo de clawback (spec da Íris,
 * `admin-clawback/SPEC.md`): o primeiro clique NUNCA executa; abre a Revisão com o resumo do alvo, a consequência e um
 * atesto. Só o botão de confirmar da Revisão envia, e só com o atesto marcado. "Voltar" fecha sem efeito.
 *
 * Dois usos:
 *   - `AcaoComRevisao`: ação de um botão (funil de vendedores, cancelar reserva).
 *   - `useRevisaoDeFormulario`: ação de um formulário (Caminho A, incorporação avulsa, validação legal). Enter no
 *     formulário abre a Revisão em vez de enviar; se os campos mudarem depois de revisados, a confirmação volta para a
 *     Revisão com os valores novos, em vez de enviar o que o operador não viu.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

export interface LinhaRevisao {
  rotulo: string;
  valor: ReactNode;
}

export interface ConteudoRevisao {
  /** Título da Revisão, ex.: "Revisar antes de pagar". */
  titulo: string;
  /** Quem/o quê é afetado. Valores com significado em fonte mono ficam a cargo de quem chama. */
  linhas: LinhaRevisao[];
  /** O que acontece ao confirmar, em uma ou duas frases. */
  consequencia: string;
  /** Texto do atesto que habilita a confirmação. */
  atesto: string;
  /** Verbo do botão de confirmar, específico ("Pagar cedente", não "OK"). */
  confirmar: string;
}

export const ROTULO = 'font-details text-label-ui text-base/70';
const PRIMARIO =
  'inline-flex min-h-[44px] items-center rounded-full bg-base px-6 font-details text-label-ui text-lightBg transition-colors duration-[var(--duration-fast)] ease-terminal hover:bg-signal-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-700';
const SECUNDARIO =
  'inline-flex min-h-[44px] items-center rounded-full border border-base/40 px-6 font-details text-label-ui text-base transition-colors duration-[var(--duration-fast)] ease-terminal hover:border-base focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-700';

/** Nome da rede para o texto da Revisão: nunca fixo, sempre o da configuração. */
export function nomeDaRede(redePublica: boolean): string {
  return redePublica ? 'Stellar (rede principal)' : 'Stellar (rede de testes)';
}

/** Painel da Revisão. Recebe o foco ao abrir (no título), para leitor de tela e teclado começarem do resumo. */
export function PainelRevisao({
  conteudo,
  aviso,
  onConfirmar,
  onVoltar,
}: {
  conteudo: ConteudoRevisao;
  /** Mensagem acima do resumo, ex.: "Os dados mudaram desde a revisão." */
  aviso?: string | null;
  onConfirmar: () => void;
  onVoltar: () => void;
}) {
  const id = useId();
  const titulo = useRef<HTMLHeadingElement>(null);
  const [atesto, setAtesto] = useState(false);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  return (
    <div data-testid="revisao-acao" role="group" aria-labelledby={`${id}-titulo`} className="mt-3 space-y-4 rounded-panel border border-light-hairline bg-sheet-white p-4">
      <h4 id={`${id}-titulo`} ref={titulo} tabIndex={-1} className="scroll-mt-40 font-title text-section-title focus:outline-none">
        {conteudo.titulo}
      </h4>
      {aviso && (
        <p role="status" className="font-text text-body-ui text-base">
          {aviso}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-[minmax(0,12rem)_1fr]">
        {conteudo.linhas.map((l) => (
          <div key={l.rotulo} className="contents">
            <dt className={ROTULO}>{l.rotulo}</dt>
            <dd className="min-w-0 break-words font-text text-body-ui text-base">{l.valor}</dd>
          </div>
        ))}
      </dl>
      <p data-testid="revisao-consequencia" className="font-text text-body-ui text-base">
        {conteudo.consequencia}
      </p>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 font-text text-body-ui text-base">
        <input
          type="checkbox"
          checked={atesto}
          onChange={(e) => setAtesto(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal-700)]"
        />
        <span>{conteudo.atesto}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onConfirmar} disabled={!atesto} className={PRIMARIO}>
          {conteudo.confirmar}
        </button>
        <button type="button" onClick={onVoltar} className={SECUNDARIO}>
          Voltar
        </button>
      </div>
    </div>
  );
}

/**
 * Botão de uma ação irreversível. Fechado, mostra o botão de sempre (mesma classe, mesmo rótulo); o clique abre a
 * Revisão. Confirmar chama `onExecutar` e fecha a Revisão; Voltar fecha e devolve o foco ao botão.
 */
export function AcaoComRevisao({
  rotulo,
  className,
  desabilitado = false,
  describedBy,
  revisao,
  onExecutar,
}: {
  rotulo: ReactNode;
  className: string;
  desabilitado?: boolean;
  describedBy?: string;
  revisao: ConteudoRevisao;
  onExecutar: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const voltou = useRef(false);

  useEffect(() => {
    if (!aberta && voltou.current) {
      voltou.current = false;
      botao.current?.focus();
    }
  }, [aberta]);

  if (aberta) {
    return (
      <PainelRevisao
        conteudo={revisao}
        onConfirmar={() => {
          setAberta(false);
          onExecutar();
        }}
        onVoltar={() => {
          voltou.current = true;
          setAberta(false);
        }}
      />
    );
  }
  return (
    <button
      ref={botao}
      type="button"
      disabled={desabilitado}
      aria-describedby={describedBy}
      onClick={() => setAberta(true)}
      className={className}
    >
      {rotulo}
    </button>
  );
}

function serializar(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()).map(([k, v]) => [k, typeof v === 'string' ? v : v.name]));
}

/**
 * Revisão para uma ação de formulário. Devolve `formProps` (ref + onSubmit) para o `<form>` e `painel`, que é `null`
 * fora da Revisão. O submit (botão ou Enter) só abre a Revisão; a confirmação reenvia o MESMO formulário, que então
 * segue para a `action`/`onSubmit` original.
 *
 * `montar` recebe o FormData revisado e devolve o conteúdo da Revisão, para o resumo mostrar o que vai ser enviado.
 */
export function useRevisaoDeFormulario(montar: (dados: FormData) => ConteudoRevisao): {
  formProps: { ref: React.RefObject<HTMLFormElement | null>; onSubmit: (e: FormEvent<HTMLFormElement>) => void };
  revisando: boolean;
  painel: ReactNode;
} {
  const ref = useRef<HTMLFormElement | null>(null);
  const confirmado = useRef(false);
  const [revisao, setRevisao] = useState<{ chave: string; conteudo: ConteudoRevisao; aviso: string | null } | null>(null);

  const abrir = (aviso: string | null) => {
    const form = ref.current;
    if (!form || !form.reportValidity()) return;
    setRevisao({ chave: serializar(form), conteudo: montar(new FormData(form)), aviso });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (confirmado.current) {
      // Envio confirmado: deixa seguir para a action/onSubmit original.
      confirmado.current = false;
      return;
    }
    e.preventDefault();
    abrir(null);
  };

  const painel = revisao && (
    <PainelRevisao
      // Remonta ao reabrir com dados novos: o atesto volta a desmarcado.
      key={revisao.chave}
      conteudo={revisao.conteudo}
      aviso={revisao.aviso}
      onVoltar={() => setRevisao(null)}
      onConfirmar={() => {
        const form = ref.current;
        if (!form) return;
        if (serializar(form) !== revisao.chave) {
          abrir('Os dados mudaram desde a revisão. Confira de novo antes de confirmar.');
          return;
        }
        setRevisao(null);
        confirmado.current = true;
        form.requestSubmit();
      }}
    />
  );

  return { formProps: { ref, onSubmit }, revisando: revisao !== null, painel };
}
