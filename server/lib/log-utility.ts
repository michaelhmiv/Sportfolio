/**
 * Logging Utility
 *
 * Provides configurable logging levels to reduce disk I/O from verbose logging.
 * By default, INFO level is used in production, DEBUG in development.
 *
 * Levels:
 * - DEBUG: Detailed info for debugging (quiet in production)
 * - INFO: General operational info (default in production)
 * - WARN: Warning messages
 * - ERROR: Error messages only
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  QUIET = 'quiet',
}

let currentLogLevel = process.env.NODE_ENV === 'production'
  ? LogLevel.INFO
  : LogLevel.DEBUG;

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  if (currentLogLevel === LogLevel.QUIET) return false;
  const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
  const currentIndex = levels.indexOf(currentLogLevel);
  const targetIndex = levels.indexOf(level);
  return targetIndex <= currentIndex;
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.DEBUG)) {
    console.debug(`[DEBUG] ${message}`, ...args);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.INFO)) {
    console.log(`[INFO] ${message}`, ...args);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.WARN)) {
    console.warn(`[WARN] ${message}`, ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.ERROR)) {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

/**
 * Throttled logger - only logs once per interval
 */
export function createThrottledLogger(level: LogLevel = LogLevel.INFO) {
  let lastLogTime = 0;
  const interval = level === LogLevel.DEBUG
    ? 10000  // 10 seconds
    : level === LogLevel.INFO
      ? 60000 // 1 minute
      : 0;    // No throttling for WARN/ERROR

  return (message: string, ...args: unknown[]): void => {
    const now = Date.now();
    if (interval === 0 || now - lastLogTime > interval) {
      if (level === LogLevel.DEBUG) {
        debug(message, ...args);
      } else if (level === LogLevel.INFO) {
        info(message, ...args);
      } else if (level === LogLevel.WARN) {
        warn(message, ...args);
      } else {
        error(message, ...args);
      }
      lastLogTime = now;
    }
  };
}
