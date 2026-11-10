import type { InteresseId, LandingV2 } from '@/lib/i18n/types';
import { Icon } from './icons';
import { Lines } from './Lines';

function Chrome({ numero, rotulo }: { numero: string; rotulo: string }) {
  return (
    <div className="story-chrome" data-r="rule">
      <p className="eyebrow label">{numero}</p>
      <span className="chapter-marker" aria-hidden="true">
        {rotulo}
      </span>
    </div>
  );
}

/** 01 O ativo */
export function AssetSection({ dict }: { dict: LandingV2 }) {
  const a = dict.ativo;
  return (
    <section className="story-section asset-section chapter" id="mercado" aria-labelledby="market-title">
      <div className="wrap">
        <Chrome numero={a.numero} rotulo={a.rotulo} />
        <div className="asset-layout">
          <div className="asset-copy section-copy">
            <h2 id="market-title" data-r="lines">
              <Lines lines={a.titulo} />
            </h2>
            <p data-r="rise">{a.texto}</p>
            <a className="section-link" href="#operacao" data-r="rise">
              {a.link} <Icon name="arrow-up-right" />
            </a>
          </div>
          <div className="asset-document" role="group" aria-label={dict.a11y.resumoAtivo} data-r="sheet">
            <div className="document-top">
              <span>{a.card.rotulo}</span>
              <span>{a.card.pais}</span>
            </div>
            <strong className="doc-title">
              {a.card.titulo.map((linha, i) => (
                <span key={linha}>
                  {i > 0 ? <br /> : null}
                  {linha}
                </span>
              ))}
              <span className="dot">.</span>
            </strong>
            <p>{a.card.descricao}</p>
            <div className="document-bottom">
              <span>{a.card.origemRotulo}</span>
              <span>{a.card.origemValor}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 02 O percurso */
export function ProcessSection({ dict }: { dict: LandingV2 }) {
  const p = dict.percurso;
  const passos = [p.passo1, p.passo2, p.passo3];
  return (
    <section className="story-section process-section chapter dark" id="operacao" aria-labelledby="operation-title">
      <div className="wrap">
        <Chrome numero={p.numero} rotulo={p.rotulo} />
        <div className="process-intro">
          <h2 id="operation-title" data-r="lines">
            <Lines lines={p.titulo} />
          </h2>
          <p className="intro-copy" data-r="rise">
            {p.intro}
          </p>
        </div>
        <p className="process-note" data-r="rise">
          {p.notaEtapas}
        </p>
        <ol className="process-list">
          {passos.map((passo, i) => (
            <li key={passo.titulo} data-r="rule">
              <span className="process-index">{String(i + 1).padStart(2, '0')}</span>
              <h3>{passo.titulo}</h3>
              <p>{passo.texto}</p>
            </li>
          ))}
        </ol>
        <p className="process-caveat" data-r="rise">
          {p.ressalva}
        </p>
      </div>
    </section>
  );
}

/** 03 Estágio */
export function StageSection({ dict }: { dict: LandingV2 }) {
  const s = dict.estagio;
  const itens = [s.demonstrado, s.desenvolvimento, s.futuro];
  return (
    <section className="story-section status-section chapter grey" id="transparencia" aria-labelledby="trust-title">
      <div className="wrap">
        <Chrome numero={s.numero} rotulo={s.rotulo} />
        <div className="status-intro section-copy">
          <h2 id="trust-title" data-r="lines">
            <Lines lines={s.titulo} />
          </h2>
          <p data-r="rise">{s.intro}</p>
        </div>
        <div className="status-grid" data-r="line">
          {itens.map((item) => (
            <article className="status-item" key={item.rotulo} data-r="rise">
              <span className="status-number">{item.rotulo}</span>
              <h3>{item.titulo}</h3>
              <p>{item.texto}</p>
            </article>
          ))}
        </div>
        <p className="status-footnote" data-r="rise">
          {s.nota}
        </p>
      </div>
    </section>
  );
}

/** 04 Para quem: cada linha pré-seleciona o interesse do formulário. */
export function AudienceSection({ dict }: { dict: LandingV2 }) {
  const q = dict.paraQuem;
  const linhas: Array<{ item: { titulo: string; texto: string }; interesse: InteresseId }> = [
    { item: q.instituicoes, interesse: 'tese' },
    { item: q.titular, interesse: 'cota' },
    { item: q.compradores, interesse: 'parceria' },
  ];
  return (
    <section className="story-section paths-section chapter" id="para-quem" aria-labelledby="audience-title">
      <div className="wrap">
        <Chrome numero={q.numero} rotulo={q.rotulo} />
        <div className="paths-intro">
          <h2 id="audience-title" data-r="lines">
            <Lines lines={q.titulo} />
          </h2>
          <p data-r="rise">{q.intro}</p>
        </div>
        <div className="path-list" data-r="line">
          {linhas.map(({ item, interesse }, i) => (
            <a className="path-row" key={interesse} href="#contato" data-interest={interesse} data-r="rise">
              <span className="path-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="path-main">
                <strong>{item.titulo}</strong>
                <span>{item.texto}</span>
              </span>
              <Icon name="arrow-up-right" className="path-arrow" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
