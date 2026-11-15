/**
 * Causa de um erro para LOG, sem dado pessoal (Argus L3–L7). A MENSAGEM do erro nunca entra: erro do Prisma cita os valores dos
 * argumentos (e-mail, CPF, nome), o do nodemailer cita o destinatário, o do anchor ecoa o corpo enviado. Só o que identifica a
 * classe do problema: nome da classe, `code` (Prisma P2xxx, AnchorError, nodemailer EENVELOPE…), status HTTP do upstream, o
 * `responseCode` do SMTP e os frames da pilha (arquivo:linha, sem a linha da mensagem) para localizar o ponto no código.
 */
export interface CausaSegura {
  name: string;
  code?: string;
  status?: number;
  responseCode?: number;
  frames?: string[];
}

export function causaSegura(err: unknown): CausaSegura {
  if (!err || typeof err !== 'object') return { name: 'erro' };
  const e = err as {
    name?: unknown; code?: unknown; statusCode?: unknown; status?: unknown; responseCode?: unknown; stack?: unknown;
  };
  const status = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : undefined;
  // A pilha começa com "Nome: mensagem" (a mensagem pode ter várias linhas): só as linhas "at …" entram.
  const frames =
    typeof e.stack === 'string'
      ? e.stack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at ')).slice(0, 4)
      : [];
  return {
    name: typeof e.name === 'string' ? e.name : 'erro',
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof e.responseCode === 'number' ? { responseCode: e.responseCode } : {}),
    ...(frames.length ? { frames } : {}),
  };
}
