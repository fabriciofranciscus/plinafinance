/**
 * Título em linhas (SPEC §3/§5): cada linha é um bloco com máscara; o espaço
 * entre os blocos fica no HTML para o nome acessível não colar as palavras.
 */
export function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <span key={line}>
          {i > 0 ? ' ' : null}
          <span className="ln">
            <span>{line}</span>
          </span>
        </span>
      ))}
    </>
  );
}
