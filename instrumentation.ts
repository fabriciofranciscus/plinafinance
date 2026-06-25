/**
 * Next.js 16 instrumentation hook — OpenTelemetry setup (PRD §M0 F-M0-3, §M8 F-M8-1).
 *
 * Em dev/test: no-op (não polui logs, não exige OTEL collector).
 * Em staging: exporter `console` pra inspeção local de spans.
 * Em prod: exporter configurável via env (`OTEL_EXPORTER_OTLP_ENDPOINT`,
 *   credenciais via Datadog/Tempo/etc).
 *
 * Spans esperados (a instrumentar progressivamente):
 *  - `lib/stellar/transactions.ts` — build/sign/submit
 *  - `lib/anchors/etherfuse/*` — SEP-12/24/38 calls
 *  - `lib/integrations/{docusign,psp,fireblocks}/*` — quando existir
 */

export async function register() {
  // Fail-fast em cutover mal configurado: aborta o boot (em vez de cair
  // silenciosamente no mock free-mint) se STELLAR_NETWORK/ETHERFUSE_ENV forem
  // inconsistentes. Roda antes do early-return de OTEL pra valer em todo boot.
  const { assertEtherfuseEnvConsistency } = await import('@/lib/env/etherfuse');
  assertEtherfuseEnvConsistency();

  const env = process.env.NODE_ENV;
  const otelMode = process.env.OTEL_MODE;

  if (env !== 'production' && otelMode !== 'console') {
    return;
  }

  // Lazy import pra evitar custo em dev.
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { ConsoleSpanExporter } = await import(
      '@opentelemetry/sdk-trace-base'
    );

    const sdk = new NodeSDK({
      traceExporter: new ConsoleSpanExporter(),
      serviceName: 'plina',
    });
    sdk.start();
  } catch (err) {
    console.warn('[instrumentation] OTEL setup skipped:', (err as Error).message);
  }
}
