/**
 * Parágrafo em blocos de frases (LM-2). No desktop cada bloco é inline e o texto
 * flui como antes; no celular (.sent vira bloco) as frases ganham respiro.
 * Nenhuma palavra muda: se a contagem de frases não bater com `groups`, devolve
 * o texto inteiro, sem dividir.
 */
export function Sentences({ text, groups }: { text: string; groups: readonly number[] }) {
  const sentences = text.match(/[^.?!]+[.?!]+\s*/g);
  const total = groups.reduce((a, b) => a + b, 0);
  if (!sentences || sentences.join('') !== text || sentences.length !== total) return <>{text}</>;
  let at = 0;
  return (
    <>
      {groups.map((n, i) => {
        const chunk = sentences.slice(at, at + n).join('');
        at += n;
        return (
          <span className="sent" key={i}>
            {chunk}
          </span>
        );
      })}
    </>
  );
}
