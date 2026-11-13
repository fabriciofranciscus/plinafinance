import type { Metadata } from 'next';
import '@/components/landing/landing.css';
import { LangSwitch } from '@/components/landing/LangSwitch';
import { getDictionary } from '@/lib/i18n/get-locale';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getDictionary();
  return { title: dict.privacidade.title, description: dict.privacidade.metaDescription };
}

/**
 * /privacidade (LV9): versão base da Norma (13/11/2026), provisória até a /lgpd completa (LD4a).
 * Só texto: sem formulário, sem mailto automático, sem recurso externo; estrutura e tipografia
 * da landing. O texto vem por chave do dicionário (PT/EN), sem chaves abertas.
 */
export default async function PrivacidadePage() {
  const { locale, dict } = await getDictionary();
  const p = dict.privacidade;
  const t = dict.landingV2;
  const secoes: Array<{ id: string; titulo: string; textos: string[] }> = [
    { id: 'quem', titulo: p.quem.titulo, textos: [p.quem.texto] },
    { id: 'medicao', titulo: p.medicao.titulo, textos: [p.medicao.texto, p.medicao.base] },
    { id: 'idioma', titulo: p.idioma.titulo, textos: [p.idioma.texto] },
    { id: 'contato', titulo: p.contato.titulo, textos: [p.contato.texto] },
    { id: 'app', titulo: p.app.titulo, textos: [p.app.texto, p.naoUsamos] },
    { id: 'internacional', titulo: p.internacional.titulo, textos: [p.internacional.texto] },
    { id: 'direitos', titulo: p.direitos.titulo, textos: [p.direitos.texto] },
  ];
  return (
    <div className="ld" style={{ minHeight: '100vh' }}>
      <a className="skip" href="#conteudo">
        {t.a11y.pular}
      </a>
      <header className="wrap topbar">
        <a className="brand" href="/" aria-label={t.a11y.voltarInicio}>
          Plina<span>.</span>
        </a>
        <LangSwitch locale={locale} label={t.a11y.idioma} />
      </header>
      <main id="conteudo" className="wrap" style={{ paddingBottom: 96, maxWidth: 860 }}>
        <p className="label" style={{ color: 'var(--sig7)', marginTop: 24 }}>
          {p.versao}
        </p>
        <h1 style={{ marginTop: 16 }}>{p.title}</h1>
        <p className="intro-copy" style={{ marginTop: 24 }}>
          {p.estagio}
        </p>
        {secoes.map((s) => (
          <section key={s.id} aria-labelledby={`h-${s.id}`} style={{ marginTop: 48 }}>
            <h2 id={`h-${s.id}`} style={{ fontSize: 'clamp(24px, 3vw, 32px)' }}>
              {s.titulo}
            </h2>
            {s.textos.map((x) => (
              <p key={x} className="intro-copy" style={{ marginTop: 16 }}>
                {x}
              </p>
            ))}
          </section>
        ))}
        <p className="intro-copy" style={{ marginTop: 56, fontSize: 14 }}>
          {p.mudancas}
        </p>
      </main>
    </div>
  );
}
