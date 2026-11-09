import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { VideoError } from "../errors/video-error.js";

function notAllowed(message: string): VideoError {
  return new VideoError({ code: "SOURCE_NOT_ALLOWED", safeMessage: message });
}

function inside(root: string, candidate: string): boolean {
  const caseInsensitive = process.platform === "win32";
  const base = caseInsensitive ? root.toLowerCase() : root;
  const target = caseInsensitive ? candidate.toLowerCase() : candidate;
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True when the source string names a local file rather than a URL. */
export function isLocalSource(source: string): boolean {
  return source.startsWith("file://") || isAbsolute(source);
}

/**
 * Resolves a local path or file:// URL, following symlinks, and accepts it only inside an
 * allowed directory. Allowed directories are already real paths.
 */
export async function resolveLocalFile(
  source: string,
  allowedDirs: readonly string[],
): Promise<string> {
  if (allowedDirs.length === 0) {
    throw notAllowed(
      "Local files are disabled. The operator can enable them by setting VIDEO_ALLOWED_DIRS to one or more directories.",
    );
  }

  const path = source.startsWith("file://") ? fileURLToPath(source) : source;
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw notAllowed("The local file does not exist or is not inside an allowed directory");
  }

  if (!allowedDirs.some((root) => inside(root, real))) {
    throw notAllowed("The local file is not inside an allowed directory (VIDEO_ALLOWED_DIRS)");
  }
  if (!(await stat(real)).isFile()) throw notAllowed("The local path is not a regular file");
  return real;
}
