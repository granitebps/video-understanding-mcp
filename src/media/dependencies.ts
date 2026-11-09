import type { RuntimeConfig } from "../config/env.js";
import { VideoError } from "../errors/video-error.js";
import { runProcess } from "./process.js";

export interface DependencyStatus {
  available: boolean;
  version: string | null;
}

export interface DependencyReport {
  ffmpeg: DependencyStatus;
  ffprobe: DependencyStatus;
  ytDlp: DependencyStatus;
}

const INSTALL_HINTS = {
  ffmpeg:
    "Install ffmpeg (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg; Windows: winget install ffmpeg) or set VIDEO_FFMPEG_PATH and VIDEO_FFPROBE_PATH",
  ytDlp:
    "Install yt-dlp (macOS: brew install yt-dlp; others: pipx install yt-dlp) or set VIDEO_YTDLP_PATH",
} as const;

async function probe(command: string, args: string[], pattern: RegExp): Promise<DependencyStatus> {
  try {
    const result = await runProcess(command, args, { timeoutMs: 10_000 });
    if (result.exitCode !== 0) return { available: false, version: null };
    const match = pattern.exec(result.stdout);
    return {
      available: true,
      version: match?.[1] ?? (result.stdout.trim().split("\n")[0] || null),
    };
  } catch {
    return { available: false, version: null };
  }
}

/** Caches a successful probe for the process; a missing tool is probed again on the next call. */
export class Dependencies {
  private readonly found = new Map<string, Promise<DependencyStatus>>();

  constructor(private readonly config: RuntimeConfig) {}

  ffmpegStatus(): Promise<DependencyStatus> {
    return this.status("ffmpeg", this.config.ffmpegPath, ["-version"], /ffmpeg version (\S+)/);
  }

  ffprobeStatus(): Promise<DependencyStatus> {
    return this.status("ffprobe", this.config.ffprobePath, ["-version"], /ffprobe version (\S+)/);
  }

  ytDlpStatus(): Promise<DependencyStatus> {
    return this.status("ytDlp", this.config.ytDlpPath, ["--version"], /^(\S+)/);
  }

  private status(
    key: string,
    command: string,
    args: string[],
    pattern: RegExp,
  ): Promise<DependencyStatus> {
    const cached = this.found.get(key);
    if (cached) return cached;
    const pending = probe(command, args, pattern).then((status) => {
      if (!status.available) this.found.delete(key);
      return status;
    });
    this.found.set(key, pending);
    return pending;
  }

  async report(): Promise<DependencyReport> {
    const [ffmpeg, ffprobe, ytDlp] = await Promise.all([
      this.ffmpegStatus(),
      this.ffprobeStatus(),
      this.ytDlpStatus(),
    ]);
    return { ffmpeg, ffprobe, ytDlp };
  }

  async requireFfmpeg(): Promise<void> {
    const [ffmpeg, ffprobe] = await Promise.all([this.ffmpegStatus(), this.ffprobeStatus()]);
    if (ffmpeg.available && ffprobe.available) return;
    const missing = [!ffmpeg.available && "ffmpeg", !ffprobe.available && "ffprobe"]
      .filter(Boolean)
      .join(" and ");
    throw new VideoError({
      code: "DEPENDENCY_MISSING",
      safeMessage: `${missing} is not available. ${INSTALL_HINTS.ffmpeg}`,
    });
  }

  async requireYtDlp(): Promise<void> {
    if ((await this.ytDlpStatus()).available) return;
    throw new VideoError({
      code: "DEPENDENCY_MISSING",
      safeMessage: `yt-dlp is not available, so page URLs cannot be resolved. ${INSTALL_HINTS.ytDlp}, or pass a direct media URL instead.`,
    });
  }
}
