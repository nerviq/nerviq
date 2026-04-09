/**
 * Observability technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  hasFrontendSignals,
  hasProjectFile,
  readProjectFiles,
  isFlutterProject,
  isSwiftProject,
  isKotlinProject,
} = require('./shared');

module.exports = {
  otelConfigured: {
      id: 130001,
      name: 'OpenTelemetry SDK configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        return /opentelemetry|@opentelemetry\/sdk|otel/i.test(deps) ||
          ctx.files.some(f => /otel.*config|opentelemetry.*config/i.test(f));
      },
      impact: 'high',
      category: 'observability',
      fix: 'Add OpenTelemetry SDK to your project for unified traces, metrics, and logs collection.',
    },

  prometheusMetrics: {
      id: 130002,
      name: 'Prometheus metrics configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        if (/prom-client|prometheus_client|prometheus\/client_golang|prometheus/i.test(deps)) return true;
        const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java)$/i);
        return /\/metrics\b/.test(code);
      },
      impact: 'high',
      category: 'observability',
      fix: 'Add a Prometheus client library and expose a /metrics endpoint for monitoring.',
    },

  structuredLogging: {
      id: 130003,
      name: 'Structured logging library',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        return /winston|pino|bunyan|structlog|python-json-logger|slog|log\/slog|tracing|tracing-subscriber|logback|log4j/i.test(deps);
      },
      impact: 'high',
      category: 'observability',
      fix: 'Use a structured logging library (winston, pino, structlog, slog, tracing) for machine-readable logs.',
    },

  distributedTracing: {
      id: 130004,
      name: 'Distributed tracing configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        if (/jaeger|zipkin|opentelemetry-api|@opentelemetry\/api|dd-trace|datadog-apm/i.test(deps)) return true;
        return ctx.files.some(f => /jaeger|zipkin|tracing.*config/i.test(f));
      },
      impact: 'high',
      category: 'observability',
      fix: 'Add a distributed tracing library (Jaeger, Zipkin, OpenTelemetry) for cross-service request tracking.',
    },

  healthEndpoint: {
      id: 130005,
      name: 'Health check endpoint',
      check: (ctx) => {
        const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
        return /['"\/]health[z]?['"]\s*[,):]|\/health[z]?\b|healthCheck|health_check|livenessProbe|readinessProbe/i.test(code + configs);
      },
      impact: 'high',
      category: 'observability',
      fix: 'Add a /health or /healthz endpoint for load balancer and orchestrator health checks.',
    },

  alertingConfigured: {
      id: 130006,
      name: 'Alerting system configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const deps = [pkg, readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i)].join('\n');
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
        return /alertmanager|pagerduty|opsgenie|victorops|alert.*rule/i.test(deps + configs) ||
          ctx.files.some(f => /alert.*rule|alertmanager/i.test(f));
      },
      impact: 'medium',
      category: 'observability',
      fix: 'Configure alerting (Alertmanager, PagerDuty, OpsGenie) to get notified of production issues.',
    },

  dashboardDefined: {
      id: 130007,
      name: 'Monitoring dashboard defined',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        return ctx.files.some(f => /grafana\/.*\.json|\.dashboard\.json/i.test(f)) ||
          /grafana|@grafana/i.test(pkg) ||
          hasProjectFile(ctx, /grafana/i);
      },
      impact: 'medium',
      category: 'observability',
      fix: 'Add Grafana dashboard JSON files or configure dashboard-as-code for production monitoring.',
    },

  logAggregation: {
      id: 130008,
      name: 'Log aggregation configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
        const all = [pkg, req, configs].join('\n');
        return /elasticsearch|elastic\.co|logstash|kibana|loki|grafana-loki|cloudwatch.*log|datadog|fluentd|fluent-bit|filebeat/i.test(all);
      },
      impact: 'medium',
      category: 'observability',
      fix: 'Configure log aggregation (ELK, Loki, CloudWatch, Datadog) for centralized log analysis.',
    },

  errorTrackingService: {
      id: 130031,
      name: 'Error tracking service configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        return /@sentry\/|sentry-sdk|sentry_sdk|bugsnag|rollbar|datadog.*apm|dd-trace|getsentry/i.test(deps);
      },
      impact: 'high',
      category: 'error-tracking',
      fix: 'Add an error tracking service (Sentry, Bugsnag, Rollbar, Datadog APM) to catch production errors.',
    },

  errorBoundaries: {
      id: 130032,
      name: 'Error boundaries in frontend',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|js|ts)$/i);
        if (!components) return null;
        return /ErrorBoundary|errorHandler|onErrorCaptured|componentDidCatch|getDerivedStateFromError|error\.vue|_error\.(jsx|tsx|js|ts)/i.test(components);
      },
      impact: 'high',
      category: 'error-tracking',
      fix: 'Add error boundaries (React ErrorBoundary, Vue errorHandler) to gracefully handle frontend errors.',
    },

  unhandledRejection: {
      id: 130033,
      name: 'Unhandled rejection/exception handler',
      check: (ctx) => {
        const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs)$/i);
        return /unhandledRejection|uncaughtException|sys\.excepthook|recover\(\)|panic.*handler|set_hook.*panic/i.test(code);
      },
      impact: 'high',
      category: 'error-tracking',
      fix: 'Add handlers for unhandledRejection and uncaughtException to prevent silent failures.',
    },

  errorReporting: {
      id: 130034,
      name: 'Error notification/reporting pattern',
      check: (ctx) => {
        const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
        return /error.*webhook|error.*slack|error.*notify|alert.*error|captureException|captureMessage|notify.*error/i.test(code);
      },
      impact: 'medium',
      category: 'error-tracking',
      fix: 'Add error reporting patterns (webhook, Slack alerts, Sentry capture) to get notified of failures.',
    },

  errorBudgetSlo: {
      id: 130035,
      name: 'SLO/SLA or error budget defined',
      check: (ctx) => {
        const docs = readProjectFiles(ctx, /\.(md|txt|rst|ya?ml|json|toml)$/i);
        return /\bslo\b|\bsla\b|error.budget|service.level|uptime.*target|availability.*target/i.test(docs);
      },
      impact: 'medium',
      category: 'error-tracking',
      fix: 'Define SLOs, SLAs, or error budgets in your docs to set clear reliability targets.',
    },

  crashReporting: {
      id: 130036,
      name: 'Crash reporting for mobile',
      check: (ctx) => {
        const hasMobile = isFlutterProject(ctx) || isSwiftProject(ctx) || isKotlinProject(ctx) ||
          /react-native|expo/i.test(ctx.fileContent('package.json') || '');
        if (!hasMobile) return null;
        const deps = [
          ctx.fileContent('package.json') || '',
          ctx.fileContent('pubspec.yaml') || '',
          ctx.fileContent('Podfile') || '',
          readProjectFiles(ctx, /(^|\/)build\.gradle(\.kts)?$/i),
        ].join('\n');
        return /crashlytics|sentry.*native|@sentry\/react-native|bugsnag.*react-native|firebase.*crash/i.test(deps);
      },
      impact: 'high',
      category: 'error-tracking',
      fix: 'Add crash reporting (Crashlytics, Sentry Native) to track mobile app crashes in production.',
    },
};
