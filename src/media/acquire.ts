import type { Agent } from "undici";

import type { RuntimeConfig } from "../config/env.js";
import { VideoError } from "../errors/video-error.js";
import type { Dependencies } from "./dependencies.js";
import { fetchSource } from "./download.js";
import { isLocalSource, resolveLocalFile } from "./local-file.js";
import { ytDlpDownload, ytDlpDuration } from "./ytdlp.js";

export interface AcquiredSource {
  path: string;
  kind: "local" | "direct" | "page";
  /** Host of the source URL, for logs; null for local files. */
  host: string | null;
}

export interface AcquireOptions {
  source: string;
  headers: Record<string, string> | undefined;
  config: RuntimeConfig;
  dependencies: Dependencies;
  agent: Agent;
  workDir: string;
  signal: AbortSignal;
  /** Called with a page video's duration before it is downloaded; throws to stop. */
  checkDuration: (seconds: number) => void;
}

function parseUrl(source: string): URL {
  try {
    return new URL(source);
  } catch {
    throw new VideoError({
      code: "INVALID_INPUT",
      safeMessage: "source must be an http(s) URL or an absolute local path",
    });
  }
}

export async function acquireSource(options: AcquireOptions): Promise<AcquiredSource> {
  const { source, config } = options;
  if (isLocalSource(source)) {
    return { path: await resolveLocalFile(source, config.allowedDirs), kind: "local", host: null };
  }

  const url = parseUrl(source);
  const fetched = await fetchSource(url.href, {
    agent: options.agent,
    allowPrivateNetwork: config.allowPrivateNetwork,
    headers: options.headers,
    maxBytes: config.maxDownloadBytes,
    workDir: options.workDir,
    signal: options.signal,
  });
  if (fetched.kind === "media") return { path: fetched.path, kind: "direct", host: url.host };

  await options.dependencies.requireYtDlp();
  const duration = await ytDlpDuration(config, fetched.url.href, options.signal);
  if (duration !== null) options.checkDuration(duration);
  const path = await ytDlpDownload(config, fetched.url.href, options.workDir, options.signal);
  return { path, kind: "page", host: url.host };
}
