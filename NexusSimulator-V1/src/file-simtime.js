import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const fileSupports = ["listFiles", "readFile", "assertFileExists", "assertFileContains"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(path) {
  return resolve(path ?? ".");
}

export function createFileAdapter() {
  const id = "file";
  const type = "file";
  const surface = "filesystem";
  let state;

  function reset() {
    state = {
      checks: [],
      events: [],
      files: [],
      lastRead: null,
      logs: [],
      status: "passed",
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function check(name, passed, detail = "") {
    state.checks.push({ name, passed, detail });
    if (!passed) state.status = "failed";
  }

  function listFiles(rootPath, maxDepth = 2) {
    const root = normalizePath(rootPath);
    const files = [];

    function walk(path, depth) {
      if (depth < 0) return;
      if (!existsSync(path)) return;
      const stats = statSync(path);
      if (stats.isFile()) {
        files.push(path);
        return;
      }
      if (!stats.isDirectory()) return;
      for (const entry of readdirSync(path)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(resolve(path, entry), depth - 1);
      }
    }

    walk(root, Number(maxDepth));
    return files.sort();
  }

  function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "listFiles": {
        const files = listFiles(args.path, args.maxDepth ?? 2);
        state.files = files;
        check("listFiles", true, `${files.length} files`);
        log(`listed ${files.length} files under ${normalizePath(args.path)}`);
        return;
      }
      case "readFile": {
        const path = normalizePath(args.path);
        if (!existsSync(path) || !statSync(path).isFile()) {
          check("readFile", false, path);
          throw new Error(`file-simtime cannot read missing file: ${path}`);
        }
        const content = readFileSync(path, "utf8");
        state.lastRead = { content, path };
        check("readFile", true, path);
        log(`read ${path}`);
        return;
      }
      case "assertFileExists": {
        const path = normalizePath(args.path);
        const passed = existsSync(path);
        check("fileExists", passed, path);
        if (!passed) throw new Error(`Expected file to exist: ${path}`);
        return;
      }
      case "assertFileContains": {
        const path = normalizePath(args.path);
        if (!existsSync(path) || !statSync(path).isFile()) {
          check("fileContains", false, path);
          throw new Error(`Expected readable file: ${path}`);
        }
        const content = readFileSync(path, "utf8");
        const text = String(args.text ?? "");
        const passed = content.includes(text);
        check("fileContains", passed, `${path} contains ${JSON.stringify(text)}`);
        if (!passed) throw new Error(`Expected ${path} to contain ${JSON.stringify(text)}.`);
        return;
      }
      default:
        throw new Error(`file-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone({
      checks: state.checks,
      files: state.files,
      lastReadPath: state.lastRead?.path ?? null,
      logs: state.logs,
      simtime: id,
      status: state.status,
    });
  }

  reset();

  return {
    id,
    type,
    surface,
    label: "file-simtime",
    supports: fileSupports,
    post,
    getOutput,
    getState,
    reset,
  };
}
