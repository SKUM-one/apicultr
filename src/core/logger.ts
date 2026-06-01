export type LogLevel = "quiet" | "normal" | "verbose";

export interface Logger {
  level: LogLevel;
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  print: (msg: string) => void;
  json: (obj: unknown) => void;
}

export function createLogger(level: LogLevel = "normal"): Logger {
  const writeErr = (msg: string) => {
    process.stderr.write(`${msg}\n`);
  };
  const writeOut = (msg: string) => {
    process.stdout.write(`${msg}\n`);
  };

  return {
    level,
    debug: (msg) => {
      if (level === "verbose") writeErr(`debug: ${msg}`);
    },
    info: (msg) => {
      if (level !== "quiet") writeErr(msg);
    },
    warn: (msg) => {
      writeErr(`warn: ${msg}`);
    },
    error: (msg) => {
      writeErr(`error: ${msg}`);
    },
    print: writeOut,
    json: (obj) => {
      writeOut(JSON.stringify(obj, null, 2));
    },
  };
}
