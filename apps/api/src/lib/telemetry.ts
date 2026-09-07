import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { tracing } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export function initTelemetry(): void {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'loopnest-api',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
  });

  const exporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({ url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` })
    : new tracing.ConsoleSpanExporter();

  sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
