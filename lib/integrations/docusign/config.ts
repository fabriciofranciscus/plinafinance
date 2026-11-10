/**
 * Configuração do cliente DocuSign, lida só do ambiente (nomes das variáveis,
 * nunca valores, aparecem em erros).
 *
 * - DOCUSIGN_INTEGRATION_KEY  client_id (GUID)
 * - DOCUSIGN_USER_ID          sub do JWT (GUID)
 * - DOCUSIGN_ACCOUNT_ID       GUID da conta
 * - DOCUSIGN_BASE_URI         ex.: https://demo.docusign.net (API em ${BASE}/restapi/v2.1)
 * - DOCUSIGN_PRIVATE_KEY      corpo base64 da chave RSA, uma linha, sem BEGIN/END
 * - DOCUSIGN_OAUTH_BASE       opcional só no sandbox (default account-d.docusign.com)
 */

import { createPrivateKey, type KeyObject } from 'node:crypto';
import { DocusignError } from './errors';

export type EnvDocusign = Record<string, string | undefined>;

export interface ConfigDocusign {
  integrationKey: string;
  userId: string;
  accountId: string;
  /** Sem barra final. */
  baseUri: string;
  /** Host do OAuth, sem esquema. */
  oauthBase: string;
  chavePrivada: KeyObject;
}

const SANDBOX_API_HOST = 'demo.docusign.net';
const SANDBOX_OAUTH_HOST = 'account-d.docusign.com';

function ler(env: EnvDocusign, nome: string): string | undefined {
  const v = env[nome]?.trim();
  return v ? v : undefined;
}

/** Monta a chave RSA a partir do corpo base64 (PKCS#1, com fallback PKCS#8). */
export function montarChavePrivada(valor: string): KeyObject {
  try {
    if (valor.includes('BEGIN')) {
      return createPrivateKey({ key: valor.replace(/\\n/g, '\n'), format: 'pem' });
    }
    const der = Buffer.from(valor.replace(/\s+/g, ''), 'base64');
    try {
      return createPrivateKey({ key: der, format: 'der', type: 'pkcs1' });
    } catch {
      return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    }
  } catch {
    throw new DocusignError(
      'CHAVE_PRIVADA_INVALIDA',
      'DocuSign: DOCUSIGN_PRIVATE_KEY não é uma chave RSA válida (esperado o corpo base64 em uma linha, sem cabeçalho BEGIN/END).',
    );
  }
}

export function carregarConfigDocusign(env: EnvDocusign = process.env): ConfigDocusign {
  const obrigatorias = [
    'DOCUSIGN_INTEGRATION_KEY',
    'DOCUSIGN_USER_ID',
    'DOCUSIGN_ACCOUNT_ID',
    'DOCUSIGN_BASE_URI',
    'DOCUSIGN_PRIVATE_KEY',
  ];
  const faltando = obrigatorias.filter((n) => !ler(env, n));
  if (faltando.length > 0) {
    throw new DocusignError(
      'CONFIG_INVALIDA',
      `DocuSign: variáveis de ambiente ausentes: ${faltando.join(', ')}.`,
    );
  }

  let url: URL;
  try {
    url = new URL(ler(env, 'DOCUSIGN_BASE_URI')!);
  } catch {
    throw new DocusignError('CONFIG_INVALIDA', 'DocuSign: DOCUSIGN_BASE_URI não é uma URL válida.');
  }
  if (url.protocol !== 'https:') {
    throw new DocusignError('CONFIG_INVALIDA', 'DocuSign: DOCUSIGN_BASE_URI deve usar https.');
  }

  let oauthBase = ler(env, 'DOCUSIGN_OAUTH_BASE');
  if (!oauthBase) {
    // Falha fechado: o default só vale para o sandbox. Outro host exige a variável explícita.
    if (url.hostname !== SANDBOX_API_HOST) {
      throw new DocusignError(
        'CONFIG_INVALIDA',
        'DocuSign: DOCUSIGN_OAUTH_BASE é obrigatória quando DOCUSIGN_BASE_URI não é o sandbox (demo.docusign.net).',
      );
    }
    oauthBase = SANDBOX_OAUTH_HOST;
  }
  oauthBase = oauthBase.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  return {
    integrationKey: ler(env, 'DOCUSIGN_INTEGRATION_KEY')!,
    userId: ler(env, 'DOCUSIGN_USER_ID')!,
    accountId: ler(env, 'DOCUSIGN_ACCOUNT_ID')!,
    baseUri: url.origin,
    oauthBase,
    chavePrivada: montarChavePrivada(ler(env, 'DOCUSIGN_PRIVATE_KEY')!),
  };
}
