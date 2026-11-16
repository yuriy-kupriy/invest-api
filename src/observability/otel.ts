import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

/**
 * HW #29. Imported as the FIRST line of main.ts: instrumentations patch http,
 * express and pg on require, so anything loaded before this stays invisible.
 * The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT itself; the W3C traceparent
 * propagator is the SDK default, so an incoming traceparent is continued.
 * No `@/` aliases here — this runs before register-aliases.
 */
export const otelSdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'invest-api',
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new PgInstrumentation()],
});

otelSdk.start();
