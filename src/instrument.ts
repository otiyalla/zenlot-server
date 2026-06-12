/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
const Sentry = require('@sentry/nestjs');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = (process.env.NODE_ENV || '').toLowerCase();
const isProd = env === 'production' || env === 'prod';

const tracesSampleRate = parseNumber(
  process.env.SENTRY_TRACES_SAMPLE_RATE,
  isProd ? 0.1 : 1,
);
const profilesSampleRate = parseNumber(
  process.env.SENTRY_PROFILE_SAMPLE_RATE,
  isProd ? 0 : 0.5,
);
const sendDefaultPii = parseBoolean(process.env.SENTRY_PII, !isProd);

// Ensure to call this before requiring any other modules!
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    // Add our Profiling integration
    Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    nodeProfilingIntegration(),
  ],

  // Add Tracing by setting tracesSampleRate
  // We recommend adjusting this value in production
  tracesSampleRate,

  // Set sampling rate for profiling
  // This is relative to tracesSampleRate
  profilesSampleRate,
  sendDefaultPii,
  enableLogs: true,
});
