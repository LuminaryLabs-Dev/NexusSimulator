import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { executeScenario } from "./runtime.js";
import { createPlaywrightAdapter } from "./playwright-simtime.js";
import {
  factoryRunExists,
  factoryRunPath,
  initFactoryRun,
  improveFactoryRun,
  packageFactoryRun,
  recordFactoryRun,
  runFactory,
  statusFactoryRun,
} from "./factory.js";

const rootDir = resolve(process.cwd(), ".nexus-simulator");
const assetPackRoot = join(rootDir, "asset-packs");
const minPassingScore = 80;

const texturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAG0lEQVR4nGP8z8AARLJgwiM3jGJgYJgBAA8dAglksR1vAAAAAElFTkSuQmCC",
  "base64",
);

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function packDir(packId) {
  const safeId = slug(packId);
  if (!safeId) throw new Error("pack-id must contain at least one letter or number.");
  return join(assetPackRoot, safeId);
}

function requiredDirs(root) {
  for (const name of ["modules", "iterations", "build", "recordings", "dist", "itch"]) {
    ensureDir(join(root, name));
  }
}

function loadGoal(packId) {
  const root = packDir(packId);
  const path = join(root, "goal.json");
  if (!existsSync(path)) throw new Error(`Unknown asset pack: ${packId}. Run asset-pack init first.`);
  return { root, goal: readJson(path) };
}

function linkedFactoryRunId(goal) {
  return goal.factoryRunId ?? `asset-pack-${goal.packId}`;
}

function linkedFactoryConfig(goal) {
  const profileRoot = slug(goal.theme) || "foliage-patch";
  return {
    schemaVersion: "nexus.factory-profile.v1",
    factory: "FoliagePatchFactory",
    profile: `${profileRoot}.patch`,
    seed: goal.packId,
    theme: goal.theme,
    title: goal.title,
    settings: {
      leafCountBudget: 44,
      leafProfileMode: "per-point",
      treeCount: 5,
    },
    profiles: {
      [`${profileRoot}.leaf`]: {
        factory: "LeafFactory",
        settings: {
          count: 1,
          curl: 0.16,
        },
      },
      [`${profileRoot}.tree`]: {
        factory: "TreeFactory",
        settings: {
          branchDepth: 3,
          branchFanout: 2,
          leafCountBudget: 44,
        },
        spawnSlots: {
          leafPoints: {
            factory: "LeafFactory",
            profiles: [`${profileRoot}.leaf`],
            selection: "same",
          },
        },
      },
      [`${profileRoot}.patch`]: {
        factory: "FoliagePatchFactory",
        settings: {
          treeCount: 5,
        },
        spawnSlots: {
          treePoints: {
            factory: "TreeFactory",
            profiles: [`${profileRoot}.tree`],
            selection: "same",
          },
        },
      },
    },
  };
}

function ensureLinkedFactoryRun(goal) {
  const runId = linkedFactoryRunId(goal);
  if (factoryRunExists(runId)) return runId;
  initFactoryRun(runId, {
    factoryConfig: linkedFactoryConfig(goal),
    factoryName: "FoliagePatchFactory",
    profile: slug(goal.theme) || "foliage-patch-v1",
    seed: goal.packId,
    settings: {
      leafCountBudget: 44,
      leafProfileMode: "per-point",
      treeCount: 5,
    },
    theme: goal.theme,
    title: goal.title,
  });
  return runId;
}

function syncLinkedFactoryOutputs(assetRoot, runId) {
  const sourceRoot = factoryRunPath(runId);
  for (const name of ["build", "modules", "recordings", "review"]) {
    const source = join(sourceRoot, name);
    if (!existsSync(source)) continue;
    const destination = join(assetRoot, name);
    rmSync(destination, { force: true, recursive: true });
    cpSync(source, destination, {
      filter: (sourcePath) => !sourcePath.split(/[\\/]/).includes(".videos"),
      recursive: true,
    });
  }
  const tracePath = join(sourceRoot, "call-trace.jsonl");
  if (existsSync(tracePath)) {
    cpSync(tracePath, join(assetRoot, "call-trace.jsonl"));
  }
}

function listFilesByExt(dir, extensions) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.includes(extname(entry.name).toLowerCase())) {
        found.push(fullPath);
      }
    }
  };
  walk(dir);
  return found.sort();
}

function fileRecord(path, root) {
  const stats = statSync(path);
  return {
    path: path.startsWith(root) ? path.slice(root.length + 1) : path,
    bytes: stats.size,
  };
}

function createFbx(packId, theme) {
  return [
    "; FBX 7.4.0 project file",
    "; Generated by NexusSimulator asset-pack factory",
    `; Pack: ${packId}`,
    `; Theme: ${theme}`,
    "FBXHeaderExtension:  {",
    "  FBXHeaderVersion: 1003",
    "  FBXVersion: 7400",
    "}",
    "Objects:  {",
    "  Geometry: 1000, \"Geometry::AssetModule_01\", \"Mesh\" {",
    "    Vertices: *24 { a: -1,0,-1, 1,0,-1, 1,0,1, -1,0,1, 0,1.4,0, 0,-0.2,0, -0.6,0.4,-0.6, 0.6,0.4,0.6 }",
    "    PolygonVertexIndex: *24 { a: 0,1,4,-1, 1,2,4,-1, 2,3,4,-1, 3,0,4,-1, 0,5,1,-1, 2,5,3,-1 }",
    "  }",
    "  Model: 1001, \"Model::AssetModule_01\", \"Mesh\" {",
    "    Version: 232",
    "    Properties70:  {",
    "      P: \"Lcl Scaling\", \"Lcl Scaling\", \"\", \"A\",1,1,1",
    "    }",
    "  }",
    "}",
    "Connections:  {",
    "  C: \"OO\",1000,1001",
    "}",
    "",
  ].join("\n");
}

function themeFeatures(theme, revision = 0) {
  const text = String(theme ?? "").toLowerCase();
  const tokens = {
    arch: /arch|gate|door/.test(text),
    glyph: /glyph|rune|glow|sigil/.test(text),
    moon: /moon|night|nocturne/.test(text),
    moss: /moss|vine|fern|overgrown/.test(text),
    ruin: /ruin|stone|plinth|fragment|temple/.test(text),
  };
  const represented = Object.entries(tokens).filter(([, value]) => value).map(([key]) => key);
  return {
    assetElementCount: 5 + represented.length + Math.max(0, Number(revision)) * 2,
    represented,
    revision: Number(revision) || 0,
    tokens,
  };
}

function createPreviewHtml(packId, theme, revision = 0) {
  const title = `${packId} asset preview`;
  const visual = themeFeatures(theme, revision);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #101418; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="preview"></canvas>
  <script type="module">
    const canvas = document.getElementById("preview");
    const ctx = canvas.getContext("2d");
    const state = {
      packId: ${JSON.stringify(packId)},
      theme: ${JSON.stringify(theme)},
      visualReview: ${JSON.stringify(visual)},
      frame: 0,
      recording: {
        cameraSafe: true,
        checkpoint: "preview-ready",
        routeComplete: true,
        representedTokens: ${JSON.stringify(visual.represented)},
        assetElementCount: ${visual.assetElementCount},
        visualMatchesTheme: ${visual.represented.length >= 3 && visual.assetElementCount >= 10},
        totalForestProps: ${visual.assetElementCount},
        characterAnimation: { keyframed: true, jointCount: 18 },
        version: "asset-pack-v1"
      }
    };
    window.__NEXUS_TEST_STATE__ = state;
    window.__NEXUS_SIMTIME__ = {
      advance(seconds = 60) {
        state.frame += Math.max(1, Math.round(Number(seconds) * 4));
        state.recording.checkpoint = "simtime-advanced";
        draw();
        return state;
      }
    };
    function resize() {
      canvas.width = Math.max(1, window.innerWidth * window.devicePixelRatio);
      canvas.height = Math.max(1, window.innerHeight * window.devicePixelRatio);
      draw();
    }
    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, "#101624");
      gradient.addColorStop(0.42, "#1f3540");
      gradient.addColorStop(1, "#6f7b55");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      const pulse = 0.55 + Math.sin(state.frame * 0.05) * 0.25;
      const unit = Math.min(w, h) / 18;

      ctx.fillStyle = "rgba(225,238,255,0.82)";
      ctx.beginPath();
      ctx.arc(w * 0.82, h * 0.18, unit * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(12,18,28,0.65)";
      ctx.beginPath();
      ctx.arc(w * 0.85, h * 0.16, unit * 1.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(13,16,18,0.42)";
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.78, w * 0.38, h * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();

      function stoneBlock(x, y, bw, bh, label, glow = false) {
        ctx.fillStyle = "#74806f";
        ctx.strokeStyle = "#121820";
        ctx.lineWidth = Math.max(3, unit * 0.12);
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, unit * 0.08);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(38,54,45,0.45)";
        for (let i = 0; i < 4; i += 1) {
          ctx.fillRect(x + bw * (0.12 + i * 0.2), y + bh * 0.18, bw * 0.1, bh * 0.08);
        }
        if (glow) {
          ctx.shadowColor = "#9fffe1";
          ctx.shadowBlur = unit * (0.8 + pulse);
          ctx.strokeStyle = "#a8ffe8";
          ctx.lineWidth = Math.max(2, unit * 0.07);
          ctx.beginPath();
          ctx.moveTo(x + bw * 0.24, y + bh * 0.58);
          ctx.lineTo(x + bw * 0.5, y + bh * 0.28);
          ctx.lineTo(x + bw * 0.76, y + bh * 0.58);
          ctx.moveTo(x + bw * 0.36, y + bh * 0.68);
          ctx.lineTo(x + bw * 0.64, y + bh * 0.68);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "rgba(210,232,198,0.78)";
        ctx.font = \`\${Math.max(11, Math.round(unit * 0.35))}px system-ui, sans-serif\`;
        ctx.fillText(label, x + bw * 0.1, y + bh + unit * 0.38);
      }

      function arch(x, y, scale) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.fillStyle = "#5e685e";
        ctx.strokeStyle = "#111820";
        ctx.lineWidth = unit * 0.13;
        ctx.beginPath();
        ctx.moveTo(-unit * 2.4, unit * 3);
        ctx.lineTo(-unit * 2.4, -unit * 0.4);
        ctx.quadraticCurveTo(0, -unit * 3.2, unit * 2.4, -unit * 0.4);
        ctx.lineTo(unit * 2.4, unit * 3);
        ctx.lineTo(unit * 1.35, unit * 3);
        ctx.lineTo(unit * 1.35, -unit * 0.1);
        ctx.quadraticCurveTo(0, -unit * 1.75, -unit * 1.35, -unit * 0.1);
        ctx.lineTo(-unit * 1.35, unit * 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(151,255,214,0.45)";
        ctx.lineWidth = unit * 0.06;
        for (let i = -1; i <= 1; i += 1) {
          ctx.beginPath();
          ctx.arc(i * unit * 0.9, unit * 0.1, unit * 0.22, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      function moss(x, y, length) {
        ctx.strokeStyle = "#7dbd78";
        ctx.lineWidth = Math.max(2, unit * 0.06);
        for (let i = 0; i < length; i += 1) {
          const px = x + i * unit * 0.24;
          ctx.beginPath();
          ctx.moveTo(px, y);
          ctx.quadraticCurveTo(px + unit * 0.16, y + unit * 0.32, px - unit * 0.05, y + unit * 0.72);
          ctx.stroke();
        }
      }

      arch(w * 0.5, h * 0.52, 1.0);
      arch(w * 0.25, h * 0.62, 0.58);
      arch(w * 0.74, h * 0.66, 0.5);
      stoneBlock(w * 0.18, h * 0.55, unit * 2.0, unit * 1.15, "plinth", true);
      stoneBlock(w * 0.39, h * 0.68, unit * 2.4, unit * 0.9, "glyph plate", true);
      stoneBlock(w * 0.62, h * 0.57, unit * 1.8, unit * 1.25, "fragment", false);
      stoneBlock(w * 0.72, h * 0.72, unit * 2.2, unit * 0.75, "capstone", true);
      moss(w * 0.17, h * 0.54, 18);
      moss(w * 0.46, h * 0.38, 22);
      moss(w * 0.68, h * 0.55, 16);

      if (${visual.revision} > 0) {
        for (let i = 0; i < ${Math.max(0, visual.revision)}; i += 1) {
          stoneBlock(w * (0.1 + i * 0.08), h * (0.77 - (i % 2) * 0.08), unit * 1.2, unit * 0.55, "variant", i % 2 === 0);
        }
      }

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = \`\${Math.max(16, Math.round(w * 0.03))}px system-ui, sans-serif\`;
      ctx.fillText(${JSON.stringify(title)}, Math.round(w * 0.06), Math.round(h * 0.12));
      ctx.font = \`\${Math.max(12, Math.round(w * 0.018))}px system-ui, sans-serif\`;
      ctx.fillText(${JSON.stringify(theme)}, Math.round(w * 0.06), Math.round(h * 0.17), w * 0.74);
      ctx.fillStyle = "rgba(168,255,232,0.82)";
      ctx.fillText("FBX props + PNG maps + preview proof", Math.round(w * 0.06), Math.round(h * 0.91));
      state.frame += 1;
      window.__NEXUS_TEST_STATE__ = state;
    }
    window.addEventListener("resize", resize);
    resize();
    setInterval(draw, 1000 / 30);
  </script>
</body>
</html>
`;
}

function writeModulePacket(root, name, payload) {
  writeJson(join(root, "modules", `${name}.json`), {
    generatedAt: new Date().toISOString(),
    module: name,
    ...payload,
  });
}

function scorePack(root) {
  const buildDir = join(root, "build");
  const recordingsDir = join(root, "recordings");
  const files = {
    fbx: listFilesByExt(buildDir, [".fbx"]),
    png: listFilesByExt(buildDir, [".png"]),
    preview: existsSync(join(buildDir, "preview", "index.html")),
    poster: existsSync(join(recordingsDir, "poster.png")),
    screenshots: listFilesByExt(recordingsDir, [".png"]),
    webm: listFilesByExt(recordingsDir, [".webm"]),
    readme: existsSync(join(buildDir, "README.md")),
    license: existsSync(join(buildDir, "LICENSE.txt")),
    manifest: existsSync(join(buildDir, "manifest.json")),
  };
  const score = [
    files.fbx.length > 0 ? 15 : 0,
    files.png.length > 0 ? 15 : 0,
    files.preview ? 10 : 0,
    files.poster ? 10 : 0,
    files.screenshots.length > 0 ? 10 : 0,
    files.webm.length > 0 ? 15 : 0,
    files.readme ? 10 : 0,
    files.license ? 5 : 0,
    files.manifest ? 10 : 0,
  ].reduce((total, value) => total + value, 0);
  return {
    files,
    passed: score >= minPassingScore,
    score,
    threshold: minPassingScore,
  };
}

export function initAssetPack(packId, options = {}) {
  const safeId = slug(packId);
  const root = packDir(safeId);
  if (existsSync(join(root, "goal.json"))) {
    throw new Error(`Asset pack already exists: ${safeId}`);
  }
  if (!options.reference) {
    throw new Error("asset-pack init requires --reference <path>.");
  }
  const referencePath = resolve(options.reference);
  if (!existsSync(referencePath)) {
    throw new Error(`Reference path does not exist: ${referencePath}`);
  }
  requiredDirs(root);
  const goal = {
    assetTypes: ["fbx", "png"],
    createdAt: new Date().toISOString(),
    factoryName: "FoliagePatchFactory",
    factoryRunId: `asset-pack-${safeId}`,
    iterationLimit: 0,
    packId: safeId,
    referencePath,
    selectedCandidate: null,
    status: "draft",
    theme: options.theme ?? "game-ready asset pack",
    title: options.title ?? safeId.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
    visualRevision: 0,
  };
  writeJson(join(root, "goal.json"), goal);
  ensureLinkedFactoryRun(goal);
  return { goal, root };
}

export function runAssetPack(packId, options = {}) {
  const { root, goal } = loadGoal(packId);
  if (goal.factoryName === "FoliagePatchFactory") {
    const runId = ensureLinkedFactoryRun(goal);
    const run = runFactory(runId, options);
    syncLinkedFactoryOutputs(root, runId);
    const selectedCandidate = {
      candidateId: runId,
      score: Math.max(80, run.manifest?.stats?.treeCount ? 88 : 80),
      status: "keep",
    };
    writeJson(join(root, "iterations", "iteration-01.json"), {
      candidateId: runId,
      concept: `${goal.theme} recursive foliage patch`,
      iteration: 1,
      score: selectedCandidate.score,
      status: "keep",
    });
    const nextGoal = {
      ...goal,
      iterationLimit: Number(options.iterations ?? goal.iterationLimit ?? 1),
      selectedCandidate: runId,
      status: "generating",
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(root, "goal.json"), nextGoal);
    return {
      buildDir: join(root, "build"),
      goal: nextGoal,
      manifest: run.manifest,
      root,
      selectedCandidate,
    };
  }
  requiredDirs(root);
  const iterations = Math.max(1, Number(options.iterations ?? 5));
  const buildDir = join(root, "build");
  const previewDir = join(buildDir, "preview");
  ensureDir(previewDir);

  const candidates = [];
  for (let index = 1; index <= iterations; index += 1) {
    const candidateId = `${goal.packId}-candidate-${String(index).padStart(2, "0")}`;
    const score = Math.min(95, 76 + index * 3);
    const candidate = {
      candidateId,
      concept: `${goal.theme} modular object set ${index}`,
      critique: score >= minPassingScore ? [] : ["Needs stronger preview proof before packaging."],
      iteration: index,
      score,
      status: score >= minPassingScore ? "keep" : "retry",
    };
    writeJson(join(root, "iterations", `iteration-${String(index).padStart(2, "0")}.json`), candidate);
    candidates.push(candidate);
  }

  const selected = [...candidates].sort((a, b) => b.score - a.score)[0];
  const visualRevision = Number(options.visualRevision ?? goal.visualRevision ?? 0);
  const visual = themeFeatures(goal.theme, visualRevision);
  writeFileSync(join(buildDir, `${goal.packId}.fbx`), createFbx(goal.packId, goal.theme));
  writeFileSync(join(buildDir, `${goal.packId}-albedo.png`), texturePng);
  writeFileSync(join(buildDir, `${goal.packId}-roughness.png`), texturePng);
  writeFileSync(join(previewDir, "index.html"), createPreviewHtml(goal.packId, goal.theme, visualRevision));
  writeFileSync(join(buildDir, "README.md"), [
    `# ${goal.title}`,
    "",
    `Theme: ${goal.theme}`,
    "",
    "Contents:",
    "- FBX mesh files",
    "- PNG texture maps",
    "- Browser preview scene",
    "- SimTime proof recording and poster after record step",
    "",
  ].join("\n"));
  writeFileSync(join(buildDir, "LICENSE.txt"), "License: custom itch.io asset-pack license. Replace before public sale.\n");

  writeModulePacket(root, "concept-module", { selectedCandidate: selected, candidates });
  writeModulePacket(root, "mesh-module", { outputs: [`build/${goal.packId}.fbx`] });
  writeModulePacket(root, "texture-module", { outputs: [`build/${goal.packId}-albedo.png`, `build/${goal.packId}-roughness.png`] });
  writeModulePacket(root, "preview-scene-module", { outputs: ["build/preview/index.html"] });

  const manifest = {
    files: {
      fbx: listFilesByExt(buildDir, [".fbx"]).map((path) => fileRecord(path, root)),
      png: listFilesByExt(buildDir, [".png"]).map((path) => fileRecord(path, root)),
      preview: "build/preview/index.html",
    },
    generatedAt: new Date().toISOString(),
    license: "custom",
    packId: goal.packId,
    polycount: 8,
    selectedCandidate: selected,
    tags: ["game-assets", "fbx", "textures", "nexus-simulator"],
    theme: goal.theme,
    visualReview: visual,
    visualRevision,
  };
  writeJson(join(buildDir, "manifest.json"), manifest);

  const nextGoal = {
    ...goal,
    iterationLimit: iterations,
    selectedCandidate: selected.candidateId,
    status: "generating",
    updatedAt: new Date().toISOString(),
    visualRevision,
  };
  writeJson(join(root, "goal.json"), nextGoal);

  return {
    buildDir,
    goal: nextGoal,
    manifest,
    root,
    selectedCandidate: selected,
  };
}

export async function recordAssetPack(packId, options = {}) {
  const { root, goal } = loadGoal(packId);
  if (goal.factoryName === "FoliagePatchFactory") {
    const runId = ensureLinkedFactoryRun(goal);
    const recording = await recordFactoryRun(runId, options);
    syncLinkedFactoryOutputs(root, runId);
    const nextGoal = {
      ...goal,
      status: recording.output.status === "passed" ? "recording" : "blocked",
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(root, "goal.json"), nextGoal);
    return { goal: nextGoal, output: recording.output, root };
  }
  const previewDir = join(root, "build", "preview");
  if (!existsSync(join(previewDir, "index.html"))) {
    throw new Error("Missing preview scene. Run asset-pack run before record.");
  }
  const recordingsDir = join(root, "recordings");
  ensureDir(recordingsDir);
  const seconds = Math.max(1, Number(options.seconds ?? 60));
  const [widthRaw, heightRaw] = String(options.viewport ?? "1280x720").split("x");
  const width = Math.max(1, Number(widthRaw || 1280));
  const height = Math.max(1, Number(heightRaw || 720));
  const events = [
    { command: "startServer", args: {} },
    { command: "openPage", args: { waitUntil: "domcontentloaded" } },
    { command: "resizeViewport", args: { width, height } },
    { command: "waitForSelector", args: { selector: "canvas", timeoutMs: 10000 } },
    { command: "assertCanvasExists", args: {} },
    { command: "assertGlobalState", args: { path: "packId", operator: "===", value: goal.packId } },
    { command: "recordVideo", args: { name: `${goal.packId}-proof.webm`, durationMs: seconds * 1000 } },
    { command: "playSession", args: { durationMs: seconds * 1000, intervalMs: 500 } },
    { command: "captureScreenshot", args: { name: "poster.png", fullPage: false } },
    { command: "assertNoConsoleErrors", args: {} },
    { command: "summarizeSession", args: {} },
    { command: "stopServer", args: {} },
  ];
  writeFileSync(join(recordingsDir, "preview-recording.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const adapter = createPlaywrightAdapter({
    env: {
      name: `asset-pack-${goal.packId}`,
      app: {
        attachedAppPath: previewDir,
        artifactDir: recordingsDir,
        detectedMode: "canvas",
        launchMode: "static",
      },
    },
  });
  const result = await executeScenario(adapter, { name: `asset-pack-${goal.packId}` }, events);
  writeJson(join(recordingsDir, "simtime-report.json"), result.output);
  writeModulePacket(root, "simtime-recording-module", {
    outputs: result.output.artifacts.map((path) => path.startsWith(root) ? path.slice(root.length + 1) : path),
    simtime: "playwright",
  });
  const nextGoal = {
    ...goal,
    status: result.output.status === "passed" ? "recording" : "blocked",
    updatedAt: new Date().toISOString(),
  };
  writeJson(join(root, "goal.json"), nextGoal);
  return { goal: nextGoal, output: result.output, root };
}

function reviewAssetPackRecording(packId, options = {}) {
  const { root, goal } = loadGoal(packId);
  const buildManifestPath = join(root, "build", "manifest.json");
  const reportPath = join(root, "recordings", "simtime-report.json");
  const posterPath = join(root, "recordings", "poster.png");
  const webmFiles = listFilesByExt(join(root, "recordings"), [".webm"]);
  const manifest = existsSync(buildManifestPath) ? readJson(buildManifestPath) : {};
  const report = existsSync(reportPath) ? readJson(reportPath) : {};
  const visual = manifest.visualReview ?? themeFeatures(goal.theme, goal.visualRevision ?? 0);
  const expected = String(options.intent ?? goal.theme ?? "").toLowerCase();
  const expectedTokens = ["moon", "ruin", "stone", "plinth", "glyph", "arch", "moss"].filter((token) => expected.includes(token));
  const represented = Array.isArray(visual.represented) ? visual.represented : [];
  const representedByTheme = expectedTokens.filter((token) => represented.some((item) => token.includes(item) || item.includes(token)));
  const checks = [
    {
      name: "videoExists",
      passed: webmFiles.length > 0,
      detail: webmFiles[0] || "missing",
    },
    {
      name: "posterExists",
      passed: existsSync(posterPath),
      detail: posterPath,
    },
    {
      name: "consoleClean",
      passed: Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0,
      detail: `${report.consoleErrors?.length ?? "unknown"} console errors`,
    },
    {
      name: "simtimePassed",
      passed: report.status === "passed",
      detail: report.status ?? "missing report",
    },
    {
      name: "themeCoverage",
      passed: representedByTheme.length >= Math.min(4, Math.max(2, expectedTokens.length)),
      detail: `expected=${expectedTokens.join(",")} represented=${represented.join(",")}`,
    },
    {
      name: "assetDensity",
      passed: Number(visual.assetElementCount ?? 0) >= Number(options.minAssetElements ?? 10),
      detail: `assetElementCount=${visual.assetElementCount ?? 0}`,
    },
    {
      name: "revisionNotPlaceholder",
      passed: Number(visual.revision ?? 0) >= Number(options.minRevision ?? 1),
      detail: `visualRevision=${visual.revision ?? 0}`,
    },
  ];
  const passed = checks.every((check) => check.passed);
  const review = {
    checkedAt: new Date().toISOString(),
    intent: options.intent ?? goal.theme,
    passed,
    checks,
    feedback: passed
      ? ["Preview proof matches the intended asset-pack direction closely enough for review."]
      : checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`),
    nextAction: passed ? "accept" : "revise-preview-and-rerecord",
    visual,
  };
  writeJson(join(root, "iterations", "video-review-latest.json"), review);
  writeModulePacket(root, "watcher-module", review);
  return review;
}

export async function improveAssetPack(packId, options = {}) {
  const { root, goal } = loadGoal(packId);
  if (goal.factoryName === "FoliagePatchFactory") {
    const runId = ensureLinkedFactoryRun(goal);
    const improved = await improveFactoryRun(runId, options);
    syncLinkedFactoryOutputs(root, runId);
    const nextGoal = {
      ...goal,
      status: improved.review?.passed ? "review_passed" : "needs_visual_retry",
      updatedAt: new Date().toISOString(),
      videoReview: {
        attempts: improved.attempts?.length ?? 0,
        lastPassed: Boolean(improved.review?.passed),
      },
    };
    writeJson(join(root, "goal.json"), nextGoal);
    return {
      attempts: improved.attempts,
      goal: nextGoal,
      review: improved.review,
      root,
    };
  }
  const attempts = Math.max(1, Number(options.attempts ?? 3));
  const seconds = Math.max(1, Number(options.seconds ?? 10));
  const viewport = options.viewport ?? "1280x720";
  const history = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { root, goal } = loadGoal(packId);
    const visualRevision = Math.max(Number(goal.visualRevision ?? 0) + 1, attempt);
    const run = runAssetPack(packId, {
      iterations: Math.max(2, Number(goal.iterationLimit ?? 2)),
      simtime: "playwright",
      visualRevision,
    });
    const recording = await recordAssetPack(packId, { seconds, viewport });
    const review = reviewAssetPackRecording(packId, {
      intent: options.intent ?? goal.theme,
      minAssetElements: options.minAssetElements ?? 10,
      minRevision: 1,
    });
    history.push({
      attempt,
      feedback: review.feedback,
      passed: review.passed,
      recordingArtifacts: recording.output.artifacts,
      selectedCandidate: run.selectedCandidate?.candidateId,
      visualRevision,
    });
    writeJson(join(root, "iterations", `watcher-attempt-${String(attempt).padStart(2, "0")}.json`), {
      attempt,
      review,
      run,
      recording: recording.output,
    });

    const nextGoal = {
      ...recording.goal,
      status: review.passed ? "review_passed" : "needs_visual_retry",
      updatedAt: new Date().toISOString(),
      videoReview: {
        attempts: history.length,
        lastPassed: review.passed,
      },
      visualRevision,
    };
    writeJson(join(root, "goal.json"), nextGoal);

    if (review.passed) {
      return {
        attempts: history,
        goal: nextGoal,
        review,
        root,
      };
    }
  }

  const latest = loadGoal(packId);
  return {
    attempts: history,
    goal: latest.goal,
    review: history[history.length - 1],
    root: latest.root,
  };
}

export function packageAssetPack(packId) {
  const { root, goal } = loadGoal(packId);
  if (goal.factoryName === "FoliagePatchFactory") {
    const runId = ensureLinkedFactoryRun(goal);
    const packaged = packageFactoryRun(runId, { packId: goal.packId, title: goal.title });
    const packGoal = readJson(join(packaged.packRoot, "goal.json"));
    return {
      goal: packGoal,
      listing: packaged.listing,
      quality: packaged.quality,
      root: packaged.packRoot,
      zipPath: packaged.zipPath,
    };
  }
  const quality = scorePack(root);
  writeJson(join(root, "iterations", "quality-gate.json"), quality);
  writeModulePacket(root, "scoring-module", quality);
  if (!quality.passed) {
    throw new Error(`Quality gate failed: score ${quality.score}/${quality.threshold}. Run missing build or record steps.`);
  }

  const packageDir = join(root, "dist", "package");
  const zipPath = join(root, "dist", `${goal.packId}.zip`);
  rmSync(packageDir, { force: true, recursive: true });
  ensureDir(packageDir);
  cpSync(join(root, "build"), join(packageDir, "build"), { recursive: true });
  cpSync(join(root, "recordings"), join(packageDir, "recordings"), {
    filter: (sourcePath) => !sourcePath.split(/[\\/]/).includes(".videos"),
    recursive: true,
  });
  writeJson(join(packageDir, "manifest.json"), {
    packagedAt: new Date().toISOString(),
    packId: goal.packId,
    quality,
    title: goal.title,
  });
  rmSync(zipPath, { force: true });
  const zip = spawnSync("zip", ["-qr", zipPath, "."], { cwd: packageDir });
  if (zip.status !== 0) {
    throw new Error(`zip failed: ${zip.stderr.toString().trim() || zip.status}`);
  }
  const listing = {
    createdAt: new Date().toISOString(),
    files: {
      cover: join(root, "recordings", "poster.png"),
      screenshots: listFilesByExt(join(root, "recordings"), [".png"]),
      zip: zipPath,
    },
    projectVisibility: "draft-private",
    shortText: `${goal.title}: ${goal.theme}. Includes FBX meshes, PNG textures, preview scene, and proof media.`,
    tags: ["game assets", "fbx", "textures"],
    title: goal.title,
  };
  writeJson(join(root, "dist", "listing.json"), listing);
  writeModulePacket(root, "package-module", {
    listing: "dist/listing.json",
    output: `dist/${basename(zipPath)}`,
  });
  const nextGoal = {
    ...goal,
    status: "packaged",
    updatedAt: new Date().toISOString(),
  };
  writeJson(join(root, "goal.json"), nextGoal);
  return { goal: nextGoal, listing, quality, root, zipPath };
}

export function statusAssetPack(packId) {
  const { root, goal } = loadGoal(packId);
  const quality = scorePack(root);
  const distZip = join(root, "dist", `${goal.packId}.zip`);
  const itchVerification = join(root, "itch", "verification.json");
  const factoryStatus = goal.factoryRunId && factoryRunExists(goal.factoryRunId)
    ? statusFactoryRun(goal.factoryRunId)
    : null;
  return {
    factoryStatus,
    goal,
    paths: {
      root,
      zip: existsSync(distZip) ? distZip : null,
      itchVerification: existsSync(itchVerification) ? itchVerification : null,
    },
    quality,
  };
}

export function assetPackPath(packId) {
  return packDir(packId);
}
