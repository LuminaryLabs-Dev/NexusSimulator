import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  ensureDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendJsonLine(path, value) {
  ensureDirectory(dirname(path));
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function diffValue(before, after, path, operations, limit) {
  if (operations.length >= limit || stableJson(before) === stableJson(after)) return;
  if (before === undefined) {
    operations.push({ op: "add", path, value: cloneJson(after) });
    return;
  }
  if (after === undefined) {
    operations.push({ op: "remove", path });
    return;
  }
  if (Array.isArray(before) || Array.isArray(after) || !before || !after || typeof before !== "object" || typeof after !== "object") {
    operations.push({ op: "replace", path, value: cloneJson(after) });
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    diffValue(before[key], after[key], `${path}/${escapePointer(key)}`, operations, limit);
    if (operations.length >= limit) return;
  }
}

export function jsonPatchDiff(before, after, limit = 500) {
  const operations = [];
  diffValue(before, after, "", operations, limit + 1);
  return {
    format: "json-patch",
    operations: operations.slice(0, limit),
    truncated: operations.length > limit,
  };
}

export function withTimeout(promise, timeoutMs, label, signal = null) {
  let timeout;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms.`);
      error.code = "TIMEOUT";
      reject(error);
    }, timeoutMs);
    if (signal) {
      abortHandler = () => {
        const error = new Error(`${label} was cancelled.`);
        error.code = "CANCELLED";
        reject(error);
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  });
}

export function toErrorRecord(error, detail = {}) {
  return {
    code: error?.code ?? "WORLD_COMMAND_FAILED",
    message: error?.message ?? String(error),
    retryable: error?.code === "TIMEOUT" || error?.code === "CANCELLED",
    ...detail,
  };
}
