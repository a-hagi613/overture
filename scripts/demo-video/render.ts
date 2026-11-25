import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = "scripts/demo-video/remotion/index.ts";
const PUBLIC_DIR = "scripts/demo-video/assets";
const OUTPUT_DIR = "public/videos";

const REQUIRED_CAPTURE_FILES = [
  "metrics.json",
  "home-desktop.png",
  "home-mobile.png",
  "tracker-before-desktop.png",
  "tracker-drag-backdrop-desktop.png",
  "tracker-over-desktop.png",
  "tracker-after-desktop.png",
  "tracker-overlay-desktop.png",
  "tracker-before-mobile.png",
  "tracker-drag-backdrop-mobile.png",
  "tracker-over-mobile.png",
  "tracker-after-mobile.png",
  "tracker-overlay-mobile.png",
  "resume-empty-desktop.png",
  "resume-scan-0-desktop.png",
  "resume-scan-1-desktop.png",
  "resume-scan-2-desktop.png",
  "resume-scan-3-desktop.png",
  "resume-done-desktop.png",
  "resume-empty-mobile.png",
  "resume-scan-0-mobile.png",
  "resume-scan-1-mobile.png",
  "resume-scan-2-mobile.png",
  "resume-scan-3-mobile.png",
  "resume-done-mobile.png",
  "inbox-before-desktop.png",
  "inbox-after-desktop.png",
  "inbox-before-mobile.png",
  "inbox-after-mobile.png",
] as const;

interface VideoSpec {
  composition: "workspace-desktop" | "workspace-mobile";
  height: number;
  name: "desktop" | "mobile";
  width: number;
}

const VIDEOS: readonly VideoSpec[] = [
  { composition: "workspace-desktop", height: 800, name: "desktop", width: 1280 },
  { composition: "workspace-mobile", height: 1280, name: "mobile", width: 720 },
];

function run(command: string, args: readonly string[]) {
  const result = spawnSync(command, [...args], { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
}

function remotionArgs(extra: readonly string[]) {
  const args = ["x", "remotion", ...extra, "--public-dir", PUBLIC_DIR, "--log", "info"];
  const browser = Bun.env.REMOTION_BROWSER_EXECUTABLE;

  if (browser !== undefined && browser !== "") {
    args.push("--browser-executable", browser);
  }

  return args;
}

function renderVideo(spec: VideoSpec, scratch: string) {
  const raw = join(scratch, `${spec.name}-raw.mp4`);
  const output = join(OUTPUT_DIR, `workspace-demo-${spec.name}.mp4`);

  process.stdout.write(`rendering ${spec.composition}\n`);
  run(
    "bun",
    remotionArgs([
      "render",
      ENTRY,
      spec.composition,
      raw,
      "--codec",
      "h264",
      "--crf",
      "23",
      "--pixel-format",
      "yuv420p",
      "--concurrency",
      "2",
      "--overwrite",
    ]),
  );

  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    raw,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-movflags",
    "+faststart",
    output,
  ]);

  const bytes = statSync(output).size;

  process.stdout.write(
    `wrote ${output} (${String(spec.width)}x${String(spec.height)}, ${(bytes / 1024 / 1024).toFixed(2)} MB)\n`,
  );

  if (bytes > 4 * 1024 * 1024) {
    throw new Error(`${output} is over the 4 MB landing budget`);
  }
}

function renderPoster(spec: VideoSpec) {
  const output = join(OUTPUT_DIR, `workspace-demo-${spec.name}-poster.png`);

  run(
    "bun",
    remotionArgs([
      "still",
      ENTRY,
      spec.composition,
      output,
      "--frame",
      "0",
      "--overwrite",
      "--image-format",
      "png",
    ]),
  );
  process.stdout.write(`wrote ${output}\n`);
}

function main() {
  for (const file of REQUIRED_CAPTURE_FILES) {
    if (!existsSync(join(PUBLIC_DIR, "captures", file))) {
      throw new Error(`missing ${file}; run bun run scripts/demo-video/capture.ts first`);
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), "overture-demo-render-"));

  for (const spec of VIDEOS) {
    renderPoster(spec);
    renderVideo(spec, scratch);
  }
}

main();
