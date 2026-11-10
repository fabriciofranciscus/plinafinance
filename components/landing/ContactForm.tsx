'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { InteresseId, LandingV2 } from '@/lib/i18n/types';
import { Icon } from './icons';
import { useMotion } from './LandingRoot';

type Dict = LandingV2['contato'];
type Draft = { text: string; href: string };

/** Troca `{chave}` numa passada só: o valor inserido nunca é reinterpretado. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/**
 * Formulário em modo `mailto` (SPEC §6): nada vai ao servidor. Monta o
 * rascunho, mostra para revisão e abre o aplicativo de e-mail do visitante.
 * O LD4c troca isto por `submitContato`.
 */
export function ContactForm({ dict }: { dict: Dict }) {
  const f = dict.form;
  const { paused } = useMotion();
  const formRef = useRef<HTMLFormElement | null>(null);
  const draftRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState('');
  // Antes da hidratação o formulário não pode ser enviado: sem JavaScript o navegador
  // faria GET e deixaria nome, e-mail e mensagem na URL (logs, histórico, analytics).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // Linhas de "Para quem" e botões do hero pré-selecionam o interesse.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const link = (event.target as Element).closest<HTMLElement>('[data-interest]');
      const select = formRef.current?.elements.namedItem('interesse');
      if (link && select instanceof HTMLSelectElement) select.value = link.dataset.interest ?? '';
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!draft || !draftRef.current) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || paused;
    draftRef.current.focus({ preventScroll: true });
    draftRef.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    // só quando o rascunho aparece (não a cada troca de pausa)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const el = form.elements;
    const nameInput = el.namedItem('nome') as HTMLInputElement;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setCustomValidity(f.nomeErro);
      nameInput.reportValidity();
      return;
    }
    const email = (el.namedItem('email') as HTMLInputElement).value.trim();
    const select = el.namedItem('interesse') as HTMLSelectElement;
    const interesse = f.opcoes[select.value as InteresseId] ?? select.value;
    const organizacao = (el.namedItem('organizacao') as HTMLInputElement).value.trim();
    const mensagem = (el.namedItem('mensagem') as HTMLTextAreaElement).value.trim();
    const text = fill(dict.mailto.corpo, {
      nome: name,
      email,
      interesse,
      organizacao: organizacao ? fill(dict.mailto.linhaOrganizacao, { organizacao }) : '',
      mensagem: mensagem || dict.mailto.mensagemPadrao,
    });
    const subject = fill(dict.mailto.assunto, { interesse });
    setDraft({
      text,
      href: `mailto:${dict.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
    });
    setStatus('');
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setStatus(dict.rascunho.copiado);
    } catch {
      const selection = getSelection();
      if (selection && preRef.current) {
        const range = document.createRange();
        range.selectNodeContents(preRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setStatus(dict.rascunho.selecionado);
    }
  }

  return (
    <form
      ref={formRef}
      className="contact-form"
      id="contact-form"
      method="post"
      aria-label={f.titulo}
      data-r="rise"
      onSubmit={onSubmit}
      onInput={(e) => {
        if ((e.target as HTMLInputElement).name === 'nome') (e.target as HTMLInputElement).setCustomValidity('');
        setDraft(null);
        setStatus('');
      }}
    >
      <div className="field">
        <label htmlFor="nome">{f.nome}</label>
        <input id="nome" name="nome" autoComplete="name" required maxLength={100} placeholder={f.nomePlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="email">{f.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder={f.emailPlaceholder}
        />
      </div>
      <div className="field full">
        <label htmlFor="interesse">{f.interesse}</label>
        <div className="select-wrap">
          <select id="interesse" name="interesse" required defaultValue="">
            <option value="">{f.interesseSelecione}</option>
            {(Object.keys(f.opcoes) as InteresseId[]).map((id) => (
              <option key={id} value={id}>
                {f.opcoes[id]}
              </option>
            ))}
          </select>
          <Icon name="arrow-down" />
        </div>
      </div>
      <div className="field full">
        <label htmlFor="organizacao">{f.organizacao}</label>
        <input
          id="organizacao"
          name="organizacao"
          autoComplete="organization"
          maxLength={120}
          placeholder={f.organizacaoPlaceholder}
        />
      </div>
      <div className="field full">
        <label htmlFor="mensagem">{f.mensagem}</label>
        <textarea id="mensagem" name="mensagem" maxLength={1500} placeholder={f.mensagemPlaceholder} />
      </div>
      <div className="form-bottom">
        <button className="btn-form" type="submit" disabled={!ready}>
          {f.preparar} <Icon name="arrow-up-right" />
        </button>
        <p>{f.avisoMailto}</p>
      </div>
      <div className="draft" ref={draftRef} hidden={!draft} tabIndex={-1}>
        <h3>{dict.rascunho.titulo}</h3>
        <p>{dict.rascunho.texto}</p>
        <pre ref={preRef}>{draft?.text}</pre>
        <div className="draft-actions">
          <a className="btn-form" href={draft?.href ?? `mailto:${dict.email}`}>
            {dict.rascunho.abrir} <Icon name="arrow-up-right" />
          </a>
          <button className="btn-form quiet" type="button" onClick={copy}>
            {dict.rascunho.copiar}
          </button>
        </div>
        <p className="status" role="status">
          {status}
        </p>
      </div>
    </form>
  );
}
