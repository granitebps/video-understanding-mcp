import type { PartFormat } from "../config/env.js";

/** Whether a request shape has a documented field for a frame-sampling rate. */
export const SUPPORTS_FPS: Record<PartFormat, boolean> = {
  video_url: true,
  image_url: false,
  file: true,
  input_file: false,
};

export function buildMediaPart(
  format: PartFormat,
  dataUrl: string,
  fps: number | undefined,
): Record<string, unknown> {
  const withFps = fps !== undefined && SUPPORTS_FPS[format];
  switch (format) {
    case "video_url":
      return { type: "video_url", video_url: { url: dataUrl, ...(withFps ? { fps } : {}) } };
    case "image_url":
      return { type: "image_url", image_url: { url: dataUrl } };
    case "file":
      return {
        type: "file",
        file: {
          file_data: dataUrl,
          format: "video/mp4",
          ...(withFps ? { video_metadata: { fps } } : {}),
        },
      };
    case "input_file":
      return {
        type: "input_file",
        filename: "video.mp4",
        mime_type: "video/mp4",
        file_data: dataUrl,
      };
  }
}
