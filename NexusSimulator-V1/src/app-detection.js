import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const TEXT_EXTENSIONS = new Set([".html", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"]);

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function collectFiles(targetPath, depth = 3, limit = 80) {
  const files = [];

  function walk(path, remainingDepth) {
    if (files.length >= limit || remainingDepth < 0) return;
    const stats = statSync(path);
    if (stats.isFile()) {
      files.push(path);
      return;
    }
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(join(path, entry), remainingDepth - 1);
      if (files.length >= limit) return;
    }
  }

  walk(targetPath, depth);
  return files;
}

function readPackageJson(files) {
  const packageFile = files.find((file) => basename(file) === "package.json");
  if (!packageFile) return null;
  try {
    return JSON.parse(readText(packageFile));
  } catch {
    return null;
  }
}

export function detectApp(targetPath) {
  const absolutePath = resolve(targetPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`App path does not exist: ${targetPath}`);
  }

  const stats = statSync(absolutePath);
  const rootPath = stats.isFile() ? dirname(absolutePath) : absolutePath;
  const files = collectFiles(absolutePath);
  const packageJson = readPackageJson(files);
  const textFiles = files.filter((file) => TEXT_EXTENSIONS.has(extname(file)));
  const combinedText = textFiles.map(readText).join("\n");
  const relativeNames = files.map((file) => file.slice(rootPath.length + 1));

  const hasIndexHtml = stats.isFile()
    ? basename(absolutePath) === "index.html"
    : files.some((file) => basename(file) === "index.html");
  const hasHtml = files.some((file) => extname(file) === ".html");
  const scripts = packageJson?.scripts ?? {};
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const hasVite = Boolean(scripts.dev?.includes("vite") || dependencies.vite);
  const hasThree = /\bfrom\s+["']three["']|three\.module|unpkg\.com\/three|cdn\.jsdelivr\.net\/npm\/three|["']three["']\s*:/.test(combinedText);
  const hasAframe = /aframe|a-frame|aframe\.min\.js|["']aframe["']\s*:/.test(combinedText);
  const hasCanvas = /<canvas\b|getContext\(["'](?:2d|webgl|webgl2)["']\)|CanvasRenderingContext2D|WebGLRenderingContext/.test(combinedText);

  let appKind = "web";
  let detectedMode = "web";
  if (hasAframe) {
    appKind = "aframe";
    detectedMode = "aframe";
  } else if (hasThree) {
    appKind = "threejs";
    detectedMode = "threejs";
  } else if (hasCanvas) {
    appKind = "canvas";
    detectedMode = "canvas";
  }

  let launchMode = "unknown";
  if (hasVite) launchMode = "dev-server";
  else if (hasIndexHtml || hasHtml) launchMode = "static";

  const notes = [];
  if (hasIndexHtml) notes.push("index.html found");
  if (hasVite) notes.push("vite app detected");
  if (hasCanvas) notes.push("canvas usage detected");
  if (hasThree) notes.push("three.js usage detected");
  if (hasAframe) notes.push("a-frame usage detected");
  if (!notes.length) notes.push("no specific web app markers found");

  let confidence = "low";
  if (hasVite || hasIndexHtml) confidence = appKind === "web" ? "medium" : "high";
  else if (hasHtml || hasCanvas || hasThree || hasAframe) confidence = "medium";

  return {
    appKind,
    confidence,
    detectedMode,
    filesInspected: relativeNames.length,
    launchMode,
    notes,
    suggestedSimtime: "web-app",
    targetPath: absolutePath,
  };
}
