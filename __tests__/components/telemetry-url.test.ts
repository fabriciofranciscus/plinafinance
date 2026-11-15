import { describe, expect, it } from 'vitest';
import { mascararIdDeAcompanhamento, sanitizeTelemetryEvent, stripUrlQueryAndHash } from '@/components/telemetry-url';

describe('telemetria: URL sem query nem hash', () => {
  it('exemplo do Atlas: query com e-mail e hash saem', () => {
    expect(stripUrlQueryAndHash('https://plina.finance/?email=a@b.c#x')).toBe('https://plina.finance/');
  });

  it('só query, só hash, nenhum dos dois, caminho relativo', () => {
    expect(stripUrlQueryAndHash('https://plina.finance/pool?x=1')).toBe('https://plina.finance/pool');
    expect(stripUrlQueryAndHash('https://plina.finance/pool#nav')).toBe('https://plina.finance/pool');
    expect(stripUrlQueryAndHash('https://plina.finance/pool')).toBe('https://plina.finance/pool');
    expect(stripUrlQueryAndHash('/investir?nome=Maria&email=a@b.c')).toBe('/investir');
  });

  it('hash antes da query (hash contendo "?") também sai inteiro', () => {
    expect(stripUrlQueryAndHash('https://plina.finance/#a?b=c@d.e')).toBe('https://plina.finance/');
  });

  it('beforeSend do Analytics (pageview e event): troca só a url', () => {
    const view = { type: 'pageview' as const, url: 'https://plina.finance/?email=a@b.c#x' };
    expect(sanitizeTelemetryEvent(view)).toEqual({ type: 'pageview', url: 'https://plina.finance/' });
    const evento = { type: 'event' as const, url: 'https://plina.finance/vender?lead=9' };
    expect(sanitizeTelemetryEvent(evento)).toEqual({ type: 'event', url: 'https://plina.finance/vender' });
  });

  it('beforeSend do Speed Insights: url e route', () => {
    const vital = {
      type: 'vital' as const,
      url: 'https://plina.finance/?email=a@b.c#x',
      route: '/?email=a@b.c',
    };
    expect(sanitizeTelemetryEvent(vital)).toEqual({ type: 'vital', url: 'https://plina.finance/', route: '/' });
    expect(sanitizeTelemetryEvent({ type: 'vital' as const, url: 'https://plina.finance/?q=1' })).toEqual({
      type: 'vital',
      url: 'https://plina.finance/',
    });
  });

  it('não altera o objeto original', () => {
    const original = { type: 'pageview' as const, url: 'https://plina.finance/?email=a@b.c' };
    sanitizeTelemetryEvent(original);
    expect(original.url).toBe('https://plina.finance/?email=a@b.c');
  });
});

describe('telemetria: o id do lead não vai ao Analytics (item 19)', () => {
  it('/vender/acompanhar/<id> vira /vender/acompanhar/[id], com ou sem query/hash e em url e route', () => {
    expect(mascararIdDeAcompanhamento('https://plina.finance/vender/acompanhar/cmabc123xyz')).toBe('https://plina.finance/vender/acompanhar/[id]');
    const ev = { type: 'pageview' as const, url: 'https://plina.finance/vender/acompanhar/cmabc123xyz?aviso=reaproveitada#x', route: '/vender/acompanhar/cmabc123xyz' };
    expect(sanitizeTelemetryEvent(ev)).toEqual({ type: 'pageview', url: 'https://plina.finance/vender/acompanhar/[id]', route: '/vender/acompanhar/[id]' });
  });
  it('não mexe em outras rotas', () => {
    expect(mascararIdDeAcompanhamento('https://plina.finance/vender/minhas')).toBe('https://plina.finance/vender/minhas');
    expect(mascararIdDeAcompanhamento('https://plina.finance/vender')).toBe('https://plina.finance/vender');
  });
});
