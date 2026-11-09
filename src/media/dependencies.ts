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

/** Probes each executable once per process and caches the result. */
export class Dependencies {
  private ffmpeg: Promise<DependencyStatus> | undefined;
  private ffprobe: Promise<DependencyStatus> | undefined;
  private ytDlp: Promise<DependencyStatus> | undefined;

  constructor(private readonly config: RuntimeConfig) {}

  ffmpegStatus(): Promise<DependencyStatus> {
    this.ffmpeg ??= probe(this.config.ffmpegPath, ["-version"], /ffmpeg version (\S+)/);
    return this.ffmpeg;
  }

  ffprobeStatus(): Promise<DependencyStatus> {
    this.ffprobe ??= probe(this.config.ffprobePath, ["-version"], /ffprobe version (\S+)/);
    return this.ffprobe;
  }

  ytDlpStatus(): Promise<DependencyStatus> {
    this.ytDlp ??= probe(this.config.ytDlpPath, ["--version"], /^(\S+)/);
    return this.ytDlp;
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
