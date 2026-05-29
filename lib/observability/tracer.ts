/**
 * Helper de tracing (PRD §M0, F-M0-3 / §M8).
 *
 * O SDK OTEL é registrado em `instrumentation.ts` (no-op em dev, console em
 * staging, OTLP em prod). Aqui só obtemos um tracer e abrimos spans. Quando
 * nenhum provider está registrado (dev/test), `trace.getTracer` devolve um
 * tracer no-op — custo ~zero, sem dependência de collector.
 */

import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

const tracer = trace.getTracer('plina');

/**
 * Executa `fn` dentro de um span. Marca status OK/ERROR e registra exceção.
 * `fn` recebe o span pra anexar atributos de resultado (ex.: http.status_code).
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
