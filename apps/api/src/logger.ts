type LogLevel = "debug" | "info" | "warn" | "error";

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minimum: LogLevel) {
  function write(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
    if (priority[level] < priority[minimum]) return;
    const safe = Object.fromEntries(Object.entries(context).filter(([key]) => !/password|token|secret|cookie/i.test(key)));
    const output = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe });
    if (level === "error") console.error(output); else console.log(output);
  }
  return {
    debug: (event: string, context?: Record<string, unknown>) => write("debug", event, context),
    info: (event: string, context?: Record<string, unknown>) => write("info", event, context),
    warn: (event: string, context?: Record<string, unknown>) => write("warn", event, context),
    error: (event: string, context?: Record<string, unknown>) => write("error", event, context)
  };
}
