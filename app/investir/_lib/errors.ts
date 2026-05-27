import type { FlowError } from '../_types';

export function newTicketId(): string {
  return `INC-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export function humanizeError(raw: string): { message: string; technical: string } {
  const t = raw.toLowerCase();
  if (t.includes('etherfuse') && t.includes('limit')) {
    return {
      message: 'Limite do sandbox Etherfuse atingido. Em produção, o tíquete é definido pelo seu compromisso institucional.',
      technical: raw,
    };
  }
  if (t.includes('etherfuse')) {
    return { message: 'Falha na consulta à anchor Etherfuse. Tente novamente em alguns segundos.', technical: raw };
  }
  if (t.includes('token privy') || t.includes('jws') || t.includes('sessão privy')) {
    return { message: 'Sessão expirou. Faça login novamente para continuar.', technical: raw };
  }
  if (t.includes('horizon') || t.includes('stellar')) {
    return { message: 'Falha de comunicação com a rede Stellar. A operação não foi consumada.', technical: raw };
  }
  if (t.includes('pubkey') || t.includes('public key')) {
    return { message: 'Endereço Stellar inválido. Recarregue a página para regenerar a wallet.', technical: raw };
  }
  return { message: 'Operação não concluída. Reporte o incidente abaixo se persistir.', technical: raw };
}

export function asFlowError(err: unknown): FlowError {
  const raw = err instanceof Error ? err.message : String(err);
  const { message, technical } = humanizeError(raw);
  return { message, technical, ticketId: newTicketId() };
}
