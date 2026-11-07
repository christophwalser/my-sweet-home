// Video along the camera path of the home, like Sweet Home 3D's "Create video":
// the viewer moves from key point to key point at constant speed, each frame is
// rendered like a photo (draft or path traced) and encoded with WebCodecs into an MP4.

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import * as THREE from "three";
import { applyPose, type CameraPose } from "./camera";
import {
  createPathTracer,
  offscreenRenderer,
  type PhotoSource,
  pathTracingScene,
  photoCamera,
  renderDraft,
} from "./photo";

export type CameraPoint = CameraPose;
export type VideoQuality = "draft" | "good" | "best";

/** Path tracing samples per pixel and frame of each quality. */
export const VIDEO_SAMPLES: Record<Exclude<VideoQuality, "draft">, number> = {
  good: 32,
  best: 128,
};

/** Turning speed of the viewer in rad/s (same as `TURN_SPEED` in msh-core). */
const TURN_SPEED = Math.PI / 4;

/** Camera path and video settings as returned by the `camera_path_get` command. */
export type CameraPathInfo = {
  points: { x: number; y: number; z: number; yaw: number; pitch: number; field_of_view: number }[];
  video: {
    width: number;
    height: number;
    aspect_ratio: "4:3" | "16:9" | "24:10";
    frame_rate: number;
    speed: number;
    frames: number;
    duration_seconds: number;
  };
  stored_points_of_view: { name: string | null; x: number; y: number }[];
};

/** Key point of `camera_path_get` (degrees) as camera point (radians). */
export function fromDegrees(p: CameraPathInfo["points"][number]): CameraPoint {
  const rad = THREE.MathUtils.degToRad;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: rad(p.yaw),
    pitch: rad(p.pitch),
    fov: rad(p.field_of_view),
  };
}

/** Video encoders need even sizes. */
export function even(v: number): number {
  return Math.max(16, Math.round(v / 2) * 2);
}

/** Shortest signed angle from `a` to `b`. */
function angleDelta(a: number, b: number): number {
  const d = (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d;
}

/**
 * Camera of every frame: each segment lasts as long as the slower of moving at
 * `speed` (m/s) and turning at {@link TURN_SPEED} (same timing as msh-core's `frame_count`).
 */
export function videoFrames(
  points: CameraPoint[],
  speed: number,
  frameRate: number,
): CameraPoint[] {
  if (points.length === 0) return [];
  const frames: CameraPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const yaw = angleDelta(a.yaw, b.yaw);
    const pitch = b.pitch - a.pitch;
    const seconds = Math.max(
      distance / (speed * 100),
      Math.max(Math.abs(yaw), Math.abs(pitch)) / TURN_SPEED,
    );
    const n = Math.max(1, Math.round(seconds * frameRate));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      frames.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: a.yaw + yaw * t,
        pitch: a.pitch + pitch * t,
        fov: a.fov + (b.fov - a.fov) * t,
      });
    }
  }
  return frames;
}

export interface VideoOptions {
  points: CameraPoint[];
  width: number;
  height: number;
  frameRate: number;
  /** Speed of the viewer in m/s */
  speed: number;
  quality: VideoQuality;
  /** Called after each encoded frame */
  onProgress?: (frame: number, frames: number) => void;
}

export interface Video {
  /** MP4 file */
  data: Uint8Array;
  frames: number;
  /** Codec string of the video track, e.g. "avc1.640033" */
  codec: string;
}

export interface VideoJob {
  /** Canvas the frames are rendered on (shown as preview while it renders) */
  canvas: HTMLCanvasElement;
  done: Promise<Video>;
  /** Stops rendering; `done` rejects */
  cancel: () => void;
}

/** Codecs tried in this order: H.264 (plays everywhere), then VP9 and AV1 in MP4. */
const CODECS: { codec: string; muxer: "avc" | "vp9" | "av1" }[] = [
  { codec: "avc1.640033", muxer: "avc" },
  { codec: "avc1.4d0033", muxer: "avc" },
  { codec: "avc1.42003e", muxer: "avc" },
  { codec: "vp09.00.51.08", muxer: "vp9" },
  { codec: "av01.0.12M.08", muxer: "av1" },
];

async function encoderConfig(
  width: number,
  height: number,
  frameRate: number,
): Promise<{ config: VideoEncoderConfig; muxer: "avc" | "vp9" | "av1" }> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("video encoding (WebCodecs) is not available in this WebView");
  }
  // About 0.15 bits per pixel: good quality for rendered images
  const bitrate = Math.round(Math.min(40e6, Math.max(1e6, width * height * frameRate * 0.15)));
  for (const c of CODECS) {
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      bitrate,
      framerate: frameRate,
      ...(c.muxer === "avc" ? { avc: { format: "avc" as const } } : {}),
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { config, muxer: c.muxer };
    } catch {
      // Unknown codec string: try the next one
    }
  }
  throw new Error(`no video encoder supports ${width} x ${height}`);
}

export function renderVideo(src: PhotoSource, opts: VideoOptions): VideoJob {
  const width = even(opts.width);
  const height = even(opts.height);
  const renderer = offscreenRenderer(width, height);
  const canvas = renderer.domElement;
  const camera = photoCamera(src, width, height);
  const frames = videoFrames(opts.points, opts.speed, opts.frameRate);

  let stopped = false;
  const cleanups: (() => void)[] = [() => renderer.dispose()];
  const cleanup = () => {
    for (const c of cleanups.splice(0)) c();
  };
  const checkStopped = () => {
    if (stopped) throw new Error("cancelled");
  };
  /** Gives the window time to repaint and handle input between GPU passes. */
  const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

  const run = async (): Promise<Video> => {
    if (frames.length < 2) throw new Error("the camera path needs at least two key points");
    const { config, muxer: muxerCodec } = await encoderConfig(width, height, opts.frameRate);
    checkStopped();
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: muxerCodec, width, height, frameRate: opts.frameRate },
      fastStart: "in-memory",
    });
    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encodeError = e instanceof Error ? e : new Error(String(e));
      },
    });
    cleanups.unshift(() => {
      if (encoder.state !== "closed") encoder.close();
    });
    encoder.configure(config);

    // Path tracing: one scene and BVH for all frames, only the camera moves
    let tracer: ReturnType<typeof createPathTracer> | null = null;
    let samples = 0;
    if (opts.quality !== "draft") {
      samples = VIDEO_SAMPLES[opts.quality];
      const { scene, dispose } = pathTracingScene(src, camera);
      cleanups.push(dispose);
      tracer = createPathTracer(renderer, width, height, opts.quality === "best" ? 5 : 3);
      const t = tracer;
      cleanups.unshift(() => t.dispose());
      applyPose(camera, frames[0]);
      await yieldToUi();
      checkStopped();
      tracer.setScene(scene, camera);
    }

    const frameDuration = 1e6 / opts.frameRate;
    for (let i = 0; i < frames.length; i++) {
      checkStopped();
      if (encodeError) throw encodeError;
      applyPose(camera, frames[i]);
      if (tracer) {
        tracer.updateCamera();
        while (tracer.samples < samples) {
          tracer.renderSample();
          await yieldToUi();
          checkStopped();
        }
      } else {
        renderDraft(src, renderer, camera);
      }
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration),
      });
      // A key frame every 2 seconds, so players can seek
      encoder.encode(frame, { keyFrame: i % Math.max(1, opts.frameRate * 2) === 0 });
      frame.close();
      opts.onProgress?.(i + 1, frames.length);
      // Do not queue more frames than the encoder can take
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      if (!tracer) await yieldToUi();
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return {
      data: new Uint8Array(muxer.target.buffer),
      frames: frames.length,
      codec: config.codec,
    };
  };

  const done = run().then(
    (video) => {
      cleanup();
      return video;
    },
    (e: unknown) => {
      cleanup();
      throw stopped ? new Error("cancelled") : e instanceof Error ? e : new Error(String(e));
    },
  );

  return {
    canvas,
    done,
    cancel: () => {
      stopped = true;
    },
  };
}
