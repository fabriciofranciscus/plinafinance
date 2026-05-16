/**
 * /politica-clawback — política pública linkada no stellar.toml.
 *
 * Whitepaper §6.5: clawback é diferencial institucional. 4 hipóteses
 * exclusivas. Enum no Prisma + service + audit log fazem essa política
 * cumprida em compile + runtime.
 *
 * Voz: institucional, factual, sem exclamação. Tom prospecto regulatório.
 */

export const metadata = {
  title: 'Política de Clawback · Plina',
  description:
    'Política pública e auditável de clawback do token PLINA-RF: quatro hipóteses exclusivas — decisão judicial, sanção regulatória, fraude documental, erro operacional.',
};

const HIPOTESES = [
  {
    enum: 'DECISAO_JUDICIAL',
    titulo: 'Decisão judicial',
    descricao:
      'Decisão judicial transitada em julgado ou liminar específica que determine a reversão de saldos sob endereço do investidor. Plina executa o clawback dentro do prazo definido pela decisão e registra on-chain o hash do documento + URL de referência pública.',
  },
  {
    enum: 'SANCAO_REGULATORIA',
    titulo: 'Sanção regulatória sobre contraparte',
    descricao:
      'Inclusão do investidor em listas restritivas (OFAC, COAF, listas internas das jurisdições aplicáveis) ou bloqueio determinado por autoridade regulatória competente. Plina reverte o saldo enquanto a sanção estiver vigente.',
  },
  {
    enum: 'FRAUDE_DOCUMENTAL',
    titulo: 'Fraude documental comprovada na cessão original',
    descricao:
      'Comprovação de fraude na cessão do direito creditório que originou a cota incorporada ao pool (ex.: contemplação inexistente, titularidade contestada, documento falso). Clawback proporcional ao impacto sobre o NAV.',
  },
  {
    enum: 'ERRO_OPERACIONAL',
    titulo: 'Erro operacional',
    descricao:
      'Erro material em operação da Plina (emissão duplicada, montante incorreto, destinatário equivocado), corrigível dentro de janela máxima documentada. Acionamento requer aprovação do administrador fiduciário do FIDC.',
  },
];

export default function PoliticaClawbackPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 md:py-24 font-text text-base text-base">
      <header className="mb-12 border-b border-light-hairline pb-8">
        <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/70">
          Política pública · vinculante · auditável
        </p>
        <h1 className="font-title mt-3 text-4xl md:text-5xl font-semibold tracking-tight">
          Política de Clawback PLINA-RF
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-base/80">
          O token PLINA-RF é emitido por issuer Stellar configurado com{' '}
          <span className="font-mono text-sm">AUTH_REQUIRED</span>,{' '}
          <span className="font-mono text-sm">AUTH_REVOCABLE</span> e{' '}
          <span className="font-mono text-sm">AUTH_CLAWBACK_ENABLED</span>.
          Clawback é instrumento institucional regulado, restrito às quatro
          hipóteses listadas abaixo. Nenhuma outra hipótese justifica o
          acionamento.
        </p>
      </header>

      <section>
        <h2 className="font-title text-2xl font-semibold mb-6 tracking-tight">
          Hipóteses exclusivas
        </h2>
        <ol className="space-y-8">
          {HIPOTESES.map((h, idx) => (
            <li key={h.enum} className="border-l-2 border-primary pl-6">
              <p className="font-details text-[10px] tracking-[0.2em] uppercase text-base/60 mb-1">
                Hipótese {idx + 1} · <span className="font-mono">{h.enum}</span>
              </p>
              <h3 className="font-title text-xl font-semibold mb-2">
                {h.titulo}
              </h3>
              <p className="leading-relaxed text-base/85">{h.descricao}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="font-title text-2xl font-semibold mb-6 tracking-tight">
          Procedimento de acionamento
        </h2>
        <ol className="space-y-4 list-decimal list-inside leading-relaxed text-base/85">
          <li>
            Operador da Plina identifica fato gerador e classifica numa das
            quatro hipóteses.
          </li>
          <li>
            Registro prévio em log de auditoria interno com motivo, fundamento
            jurídico, hash do documento de suporte e operador responsável.
          </li>
          <li>
            Execução on-chain via operação <span className="font-mono">clawback</span>{' '}
            do issuer Stellar. Cada acionamento gera transação pública verificável
            no Stellar Expert, contendo memo com referência ao fundamento.
          </li>
          <li>
            Notificação ao investidor afetado pelos canais cadastrados em até{' '}
            48h, com cópia ao administrador fiduciário do FIDC.
          </li>
          <li>
            Inclusão em relatório trimestral de auditoria publicado pelo gestor
            do FIDC.
          </li>
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="font-title text-2xl font-semibold mb-6 tracking-tight">
          Garantias institucionais
        </h2>
        <ul className="space-y-3 list-disc list-inside leading-relaxed text-base/85">
          <li>
            Acionamento fora das quatro hipóteses configura ato ilícito
            sujeito à responsabilização civil e regulatória.
          </li>
          <li>
            Plina não detém custódia das cotas do FIDC — apenas opera o
            issuer Stellar sob política pública e supervisão do administrador
            fiduciário registrado na CVM.
          </li>
          <li>
            Auditoria big four trimestral revisa todos os clawbacks executados
            no período, com publicação dos achados.
          </li>
        </ul>
      </section>

      <p className="mt-16 pt-8 border-t border-light-hairline text-xs text-base/60">
        Versão 0.1 · POC testnet. Versão final entra em vigor com a
        constituição do FIDC sob CVM 175 (Fase 1 do roadmap). Atualizações
        registradas com versionamento aqui e linkadas no{' '}
        <span className="font-mono">stellar.toml</span>.
      </p>
    </div>
  );
}
