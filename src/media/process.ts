import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 64 * 1024;

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  /** Capture stdout up to this many bytes; stderr is always capped at 64 KB. */
  maxStdoutBytes?: number;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class SpawnFailedError extends Error {
  readonly errno: string | undefined;

  constructor(command: string, cause: NodeJS.ErrnoException) {
    super(`Could not start ${command}: ${cause.code ?? cause.message}`, { cause });
    this.name = "SpawnFailedError";
    this.errno = cause.code;
  }
}

function appendCapped(current: string, chunk: Buffer, limit: number): string {
  if (current.length >= limit) return current;
  return (current + chunk.toString("utf8")).slice(0, limit);
}

export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("Operation aborted", { cause: reason });
}

/** Runs an executable without a shell; aborting or timing out kills it. */
export function runProcess(
  command: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortReason(options.signal));
      return;
    }

    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutLimit = options.maxStdoutBytes ?? MAX_CAPTURE_BYTES;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const onAbort = () => kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      action();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk, stdoutLimit);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, MAX_CAPTURE_BYTES);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(() => reject(new SpawnFailedError(command, error)));
    });
    child.once("close", (exitCode) => {
      finish(() => {
        if (options.signal?.aborted) reject(abortReason(options.signal));
        else resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  });
}
