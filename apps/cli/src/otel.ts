import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter as HTTPExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as ProtoBufExporter } from '@opentelemetry/exporter-trace-otlp-proto';

// Setting it to false will log the telemetry data to broswer console
const collectorType: 'external' | 'console' = 'console';
const serviceName = 'arvo-node';

const jaegerExporter = new HTTPExporter({
  url: 'http://localhost:6001/jaeger/v1/traces',
});

const arizePhoenixExporter = new ProtoBufExporter({
  url: 'http://localhost:6001/arize/v1/traces',
});

export const telemetrySdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  }),
  spanProcessors:
    collectorType !== 'console'
      ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
      : [new SimpleSpanProcessor(jaegerExporter), new SimpleSpanProcessor(arizePhoenixExporter)],
});

// Call this function in your application 'index.ts'
export const telemetrySdkStart = () => {
  telemetrySdk.start();
};

export const telemetrySdkStop = async () => {
  await telemetrySdk.shutdown();
};
