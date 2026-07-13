import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { createForestShowcaseHtml } from "./forest-showcase.js";

const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..");

function safeSlug(value) {
  return String(value || "world-editor-session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "world-editor-session";
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value || ""));
  if (!match) throw new Error(`Invalid viewport "${value}". Expected WIDTHxHEIGHT.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function mimeType(path) {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function createStaticServer(directory) {
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const path = resolve(directory, relative);
    if (!path.startsWith(resolve(directory)) || !existsSync(path)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeType(path), "Cache-Control": "no-store" });
    response.end(readFileSync(path));
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolveServer({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

function stageWeb(profile, directory) {
  mkdirSync(join(directory, "vendor"), { recursive: true });
  writeFileSync(join(directory, "index.html"), createForestShowcaseHtml(profile));
  for (const name of ["three.module.js", "three.core.js"]) {
    copyFileSync(join(rootDir, "node_modules", "three", "build", name), join(directory, "vendor", name));
  }
}

async function setRange(page, name, value) {
  await page.locator(`[data-editor="${name}"]`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function movePointer(page, locator, duration = 360) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot move pointer to a hidden editor control.");
  await page.evaluate(({ x, y }) => {
    const pointer = document.querySelector(".capture-pointer");
    pointer.style.left = x + "px";
    pointer.style.top = y + "px";
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(duration);
  return box;
}

async function clickHuman(page, locator) {
  await movePointer(page, locator);
  await locator.evaluate((element) => {
    const pointer = document.querySelector(".capture-pointer");
    pointer.dataset.pressed = "true";
    window.setTimeout(() => { pointer.dataset.pressed = "false"; }, 140);
    element.click();
  });
  await page.waitForTimeout(240);
}

async function selectHuman(page, locator, optionIndex) {
  await movePointer(page, locator);
  await locator.evaluate((element, index) => {
    const pointer = document.querySelector(".capture-pointer");
    pointer.dataset.pressed = "true";
    element.selectedIndex = index;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => { pointer.dataset.pressed = "false"; }, 140);
  }, optionIndex);
  await page.waitForTimeout(260);
}

async function typeHuman(page, locator, value) {
  await movePointer(page, locator);
  await locator.evaluate(async (element, nextValue) => {
    const pointer = document.querySelector(".capture-pointer");
    pointer.dataset.pressed = "true";
    element.focus();
    element.value = "";
    for (const character of String(nextValue)) {
      element.value += character;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 18));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    pointer.dataset.pressed = "false";
  }, value);
  await page.waitForTimeout(180);
}

async function dragRangeHuman(page, name, value, duration = 620) {
  const locator = page.locator(`[data-editor="${name}"]`);
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(async (element, payload) => {
    const min = Number(element.min);
    const max = Number(element.max);
    const start = Number(element.value);
    const target = Number(payload.value);
    const pointer = document.querySelector(".capture-pointer");
    const box = element.getBoundingClientRect();
    const startedAt = performance.now();
    const ratio = (input) => Math.max(0, Math.min(1, (input - min) / (max - min)));
    pointer.style.transition = "width .12s ease, height .12s ease, background .12s ease";
    pointer.dataset.pressed = "true";
    await new Promise((resolve) => {
      function frame(now) {
        const progress = Math.min(1, (now - startedAt) / payload.duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (target - start) * eased;
        element.value = String(current);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        pointer.style.left = box.left + ratio(current) * box.width + "px";
        pointer.style.top = box.top + box.height / 2 + "px";
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    pointer.dataset.pressed = "false";
    pointer.style.transition = "";
  }, { duration, value });
  await page.waitForTimeout(150);
}

export async function runWorldEditorSessionAction({
  captureStyle = "human",
  duration = 305,
  fps = 24,
  outputPath = null,
  profilePath,
  runId = null,
  viewport = "1920x1080",
}) {
  if (!profilePath) throw new Error("--profile is required for scene.editor-session.");
  const profileFile = resolve(profilePath);
  const profile = JSON.parse(readFileSync(profileFile, "utf8"));
  if (profile.schemaVersion !== "nexus.forest-showcase.v1") {
    throw new Error("scene.editor-session requires a nexus.forest-showcase.v1 profile.");
  }
  if (!profile.defaultWorldStructure || !profile.worldStructures?.[profile.defaultWorldStructure]) {
    throw new Error("scene.editor-session requires a valid defaultWorldStructure and worldStructures matrix.");
  }
  if (duration < 180 || duration > 600) throw new Error("Editor session duration must be between 180 and 600 seconds.");
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) throw new Error("Editor session FPS must be an integer between 12 and 60.");
  if (!['human', 'direct'].includes(captureStyle)) throw new Error('Editor session capture style must be "human" or "direct".');
  const humanCapture = captureStyle === "human";
  const size = parseViewport(viewport);
  const id = safeSlug(runId || `world-editor-${Date.now()}`);
  const runDir = join(rootDir, ".nexus-simulator", "editor-sessions", id);
  const webDir = join(runDir, "web");
  const videoDir = join(runDir, "video-source");
  mkdirSync(videoDir, { recursive: true });
  stageWeb(profile, webDir);

  const { server, url } = await createStaticServer(webDir);
  const browser = await chromium.launch(humanCapture
    ? { channel: "chrome", headless: false, args: ["--use-angle=metal", "--disable-background-timer-throttling"] }
    : { headless: true });
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size },
    viewport: size,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const video = page.video();
  const events = [];
  const startedAt = Date.now();
  const event = (type, detail = {}) => {
    const entry = { atSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)), type, ...detail };
    events.push(entry);
    console.log(JSON.stringify(entry));
  };
  const pause = (milliseconds) => page.waitForTimeout(milliseconds);

  let finalState = null;
  let startScreenshot = null;
  let finalScreenshot = null;
  try {
    await page.goto(url + `?editor=1&human=${humanCapture ? "1" : "0"}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    startScreenshot = join(runDir, "editor-start.png");
    await page.screenshot({ path: startScreenshot });
    event("session-start", { duration, viewport });
    if (humanCapture) {
      await page.evaluate(({ x, y }) => {
        const pointer = document.querySelector(".capture-pointer");
        pointer.style.left = x + "px";
        pointer.style.top = y + "px";
      }, { x: size.width * 0.34, y: size.height * 0.54 });
    }
    await pause(2500);

    const worldTypes = Object.keys(profile.worldTypes || {});
    const worldStructures = Object.keys(profile.worldStructures || {});
    const introMs = 2500;
    const outroMs = 12000;
    const beatMs = Math.floor((duration * 1000 - introMs - outroMs) / profile.steps.length);
    let selectedWorldType = profile.defaultWorldType;
    let selectedWorldStructure = profile.defaultWorldStructure;
    for (let index = 0; index < profile.steps.length; index += 1) {
      const beatStartedAt = Date.now();
      const step = profile.steps[index];
      if (index > 0) {
        if (humanCapture) await selectHuman(page, page.locator('[data-editor="object"]'), index);
        else await page.locator('[data-editor="object"]').selectOption(String(index));
      }
      event("object-selected", { id: step.id, index });
      await pause(320);

      if (index % 4 === 0 && worldTypes.length) {
        const worldType = worldTypes[(index / 4) % worldTypes.length | 0];
        if (worldType !== selectedWorldType) {
          const optionIndex = worldTypes.indexOf(worldType);
          if (humanCapture) await selectHuman(page, page.locator('[data-editor="world-type"]'), optionIndex);
          else await page.locator('[data-editor="world-type"]').selectOption(worldType);
          selectedWorldType = worldType;
          event("world-type-changed", { worldType });
          await pause(260);
        }
      }
      if (index % 2 === 0 && worldStructures.length) {
        const worldStructure = worldStructures[Math.floor(index / 2) % worldStructures.length];
        if (worldStructure !== selectedWorldStructure) {
          const optionIndex = worldStructures.indexOf(worldStructure);
          if (humanCapture) await selectHuman(page, page.locator('[data-editor="world-structure"]'), optionIndex);
          else await page.locator('[data-editor="world-structure"]').selectOption(worldStructure);
          selectedWorldStructure = worldStructure;
          event("world-structure-changed", { worldStructure });
          await pause(260);
        }
      }

      const seed = profile.seed + ":editor-take-" + String(index + 1).padStart(2, "0") + ":" + step.id;
      if (humanCapture) await typeHuman(page, page.locator('[data-editor="seed"]'), seed);
      else {
        await page.locator('[data-editor="seed"]').fill(seed);
        await page.locator('[data-editor="seed"]').press("Tab");
      }
      event("variant-regenerated", { id: step.id, seed });
      await pause(420);

      const scale = Number((0.82 + (index % 5) * 0.11).toFixed(2));
      const rotation = -70 + (index * 29) % 140;
      const roughness = Number((0.24 + (index % 6) * 0.1).toFixed(2));
      const detail = 58 + (index * 7) % 42;
      if (humanCapture) {
        await dragRangeHuman(page, "detail", 20, 420);
        await dragRangeHuman(page, "scale", 0.5, 420);
        await dragRangeHuman(page, "scale", scale, 760);
        await dragRangeHuman(page, "rotation", rotation, 620);
        await dragRangeHuman(page, "roughness", roughness, 520);
        await dragRangeHuman(page, "detail", detail, 920);
      } else {
        await setRange(page, "scale", scale);
        await setRange(page, "rotation", rotation);
        await setRange(page, "roughness", roughness);
        await setRange(page, "detail", detail);
      }
      event("procedural-controls-edited", { detail, id: step.id, rotation, roughness, scale });
      await pause(420);

      for (const mode of ["turntable", "wireframe", "collision"]) {
        if (humanCapture) await clickHuman(page, page.locator(`[data-preview="${mode}"]`));
        else await page.locator(`[data-preview="${mode}"]`).click();
        event("preview-mode", { id: step.id, mode });
        await pause(440);
      }

      if (index % 5 === 2) {
        if (humanCapture) await dragRangeHuman(page, "scale", 1.7, 650);
        else await setRange(page, "scale", 1.7);
        if (humanCapture) await clickHuman(page, page.locator('[data-action="validate"]'));
        else await page.locator('[data-action="validate"]').click();
        event("validation-failed", { id: step.id, reason: "scale-budget" });
        await pause(620);
        if (humanCapture) await dragRangeHuman(page, "scale", scale, 650);
        else await setRange(page, "scale", scale);
        event("validation-corrected", { id: step.id, scale });
        await pause(420);
      }

      if (humanCapture) await clickHuman(page, page.locator('[data-action="validate"]'));
      else await page.locator('[data-action="validate"]').click();
      const validation = await page.evaluate(() => window.__WORLD_HARNESS_EDITOR__.getState());
      if (validation.override.validation !== "passed") {
        throw new Error(`Validation did not pass for ${step.id}: ${validation.override.validation}`);
      }
      event("validation-passed", { id: step.id, status: validation.override.validation });
      await pause(620);
      if (humanCapture) await clickHuman(page, page.locator('[data-action="add"]'));
      else await page.locator('[data-action="add"]').click();
      event("world-commit", { id: step.id });
      await pause(760);

      const remaining = beatMs - (Date.now() - beatStartedAt);
      if (remaining > 0) await pause(remaining);
    }

    finalState = await page.evaluate(() => window.__WORLD_HARNESS_EDITOR__.getState());
    finalScreenshot = join(runDir, "editor-final.png");
    await page.screenshot({ path: finalScreenshot });
    event("session-complete", { committed: finalState.editor.added.length });
    const remaining = duration * 1000 - (Date.now() - startedAt);
    if (remaining > 0) await pause(remaining);
    await pause(8000);
    event("capture-complete", { committed: finalState.editor.added.length, finalHoldSeconds: 8 });
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await new Promise((resolveServer) => server.close(resolveServer));
  }

  const sourceVideo = await video.path();
  const rawVideoPath = join(runDir, id + "-source.webm");
  copyFileSync(sourceVideo, rawVideoPath);
  const requestedOutput = outputPath ? resolve(outputPath) : join(runDir, id + ".mp4");
  mkdirSync(dirname(requestedOutput), { recursive: true });
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-i", rawVideoPath,
    "-vf", `fps=${fps}`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-an", requestedOutput,
  ], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr}`);

  const committed = finalState?.editor?.added?.length || 0;
  const actualDurationSeconds = events.at(-1)?.atSeconds || duration;
  const status = consoleErrors.length === 0 && committed === profile.steps.length ? "passed" : "failed";
  const report = {
    status,
    summary: status === "passed"
      ? `Recorded ${actualDurationSeconds} seconds of real procedural editing across ${committed} validated world commits.`
      : "The editor session completed without proving every object commit or without a clean console.",
    runId: id,
    profilePath: profileFile,
    durationSeconds: actualDurationSeconds,
    requestedDurationSeconds: duration,
    fps,
    captureMode: "realtime-browser",
    captureStyle,
    simulationTimeSource: "performance-now",
    viewport: size,
    objectCount: profile.steps.length,
    committed,
    worldTypes: Object.keys(profile.worldTypes || {}),
    worldStructures: Object.keys(profile.worldStructures || {}),
    consoleErrors,
    events,
    artifacts: [startScreenshot, finalScreenshot, rawVideoPath, requestedOutput],
    videoPath: requestedOutput,
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, JSON.stringify({ ...report, reportPath }, null, 2) + "\n");
  return { ...report, reportPath };
}
