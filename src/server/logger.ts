const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'debug', 'trace']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseExplicitBooleanEnv(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

/**
 * Returns true when container/service DEBUG logging is enabled via:
 * - SCRAPER_DEBUG=true|1|yes|on  (primary Helm/Docker env var)
 * - RGT_DEBUG=true|1|yes|on
 * - DEBUG_LOGGING=true|1|yes|on
 * - LOG_LEVEL=debug|trace
 * - DEBUG=true|1|yes|on (strict boolean check so tooling vars like DEBUG=vite:* do not accidentally trigger app debug floods)
 */
export function isDebugLoggingEnabled(): boolean {
  const scraperDebug = parseExplicitBooleanEnv(process.env.SCRAPER_DEBUG);
  if (scraperDebug !== null) return scraperDebug;

  const rgtDebug = parseExplicitBooleanEnv(process.env.RGT_DEBUG);
  if (rgtDebug !== null) return rgtDebug;

  const debugLogging = parseExplicitBooleanEnv(process.env.DEBUG_LOGGING);
  if (debugLogging !== null) return debugLogging;

  const logLevel = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (logLevel === 'debug' || logLevel === 'trace') return true;
  if (logLevel && ['info', 'warn', 'error', 'silent'].includes(logLevel)) return false;

  const genericDebug = parseExplicitBooleanEnv(process.env.DEBUG);
  if (genericDebug !== null) return genericDebug;

  return false;
}

export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export function formatServerLogLine(
  subsystem: string,
  level: ServerLogLevel,
  message: string,
  detail?: string | null,
): string {
  const ts = new Date().toISOString();
  const tag = subsystem.toUpperCase();
  const lvl = level.toUpperCase();
  return detail ? `[${ts}] [${tag}] [${lvl}] ${message} · ${detail}` : `[${ts}] [${tag}] [${lvl}] ${message}`;
}

export function logServer(
  subsystem: string,
  level: ServerLogLevel,
  message: string,
  detail?: string | null,
): void {
  if (level === 'debug' && !isDebugLoggingEnabled()) {
    return;
  }
  const line = formatServerLogLine(subsystem, level, message, detail);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (level === 'debug') {
    console.debug(line);
  } else {
    console.log(line);
  }
}

export function formatErrorDetails(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const anyErr = err as {
    name?: string;
    message?: string;
    code?: string | number;
    errno?: number;
    syscall?: string;
    path?: string;
    cause?: {
      name?: string;
      message?: string;
      code?: string | number;
      errno?: number;
      syscall?: string;
      path?: string;
    };
  };
  const parts: string[] = [];
  const name = anyErr.name ? `${anyErr.name}: ` : '';
  parts.push(`${name}${anyErr.message || String(err)}`);
  if (anyErr.code !== undefined) parts.push(`code=${anyErr.code}`);
  if (anyErr.errno !== undefined) parts.push(`errno=${anyErr.errno}`);
  if (anyErr.syscall) parts.push(`syscall=${anyErr.syscall}`);
  if (anyErr.path) parts.push(`path=${anyErr.path}`);
  if (anyErr.cause) {
    const causeParts: string[] = [];
    if (anyErr.cause.code !== undefined) causeParts.push(`code=${anyErr.cause.code}`);
    if (anyErr.cause.message) causeParts.push(anyErr.cause.message);
    if (anyErr.cause.path) causeParts.push(`path=${anyErr.cause.path}`);
    if (causeParts.length > 0) parts.push(`cause=[${causeParts.join(', ')}]`);
  }
  return parts.join(' ');
}
