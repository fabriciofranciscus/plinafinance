import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  getAnchorWebhookSecret,
  getStellarPlinaPositionPublic,
} from '@/lib/env/ops';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getStellarPlinaPositionPublic', () => {
  it('devolve uma chave pública Stellar válida', () => {
    const publicKey = Keypair.random().publicKey();
    vi.stubEnv('STELLAR_PLINA_POSITION_PUBLIC', publicKey);

    expect(getStellarPlinaPositionPublic()).toBe(publicKey);
  });

  it.each([undefined, '', 'nao-e-chave-stellar'])(
    'falha fechado com mensagem fixa para %s',
    (value) => {
      if (value === undefined) {
        vi.stubEnv('STELLAR_PLINA_POSITION_PUBLIC', undefined);
      } else {
        vi.stubEnv('STELLAR_PLINA_POSITION_PUBLIC', value);
      }

      expect(getStellarPlinaPositionPublic).toThrow(
        'Configuração da posição da Plina indisponível.',
      );
    },
  );
});

describe('getAnchorWebhookSecret', () => {
  it('devolve o segredo configurado sem transformá-lo', () => {
    vi.stubEnv('ANCHOR_WEBHOOK_SECRET', ' segredo-testnet ');

    expect(getAnchorWebhookSecret()).toBe(' segredo-testnet ');
  });

  it.each([undefined, '', '   '])(
    'falha fechado com mensagem fixa para segredo ausente/vazio',
    (value) => {
      if (value === undefined) {
        vi.stubEnv('ANCHOR_WEBHOOK_SECRET', undefined);
      } else {
        vi.stubEnv('ANCHOR_WEBHOOK_SECRET', value);
      }

      expect(getAnchorWebhookSecret).toThrow(
        'Configuração do webhook indisponível.',
      );
    },
  );
});
