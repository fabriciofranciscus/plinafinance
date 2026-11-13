'use client';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { sanitizeTelemetryEvent } from './telemetry-url';

/**
 * Analytics + Speed Insights com `beforeSend` que tira query e hash da URL.
 * Client Component porque uma função não atravessa de Server para Client
 * Component (o layout é servidor).
 */
export function Telemetry() {
  return (
    <>
      <Analytics beforeSend={sanitizeTelemetryEvent} />
      <SpeedInsights beforeSend={sanitizeTelemetryEvent} />
    </>
  );
}
