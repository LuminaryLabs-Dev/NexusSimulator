import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { assetPackPath, statusAssetPack } from "./asset-pack.js";

const rootDir = resolve(process.cwd(), ".nexus-simulator");
const itchDir = join(rootDir, "itch");
const storageStatePath = join(itchDir, "storage-state.json");

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

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright is not installed. Original error: ${error.code ?? error.message}`);
  }
}

function requireApproval(options = {}) {
  if (options.approved || process.env.NEXUS_SIM_ITCH_APPROVED === "1") return;
  throw new Error("Itch credential use requires --approved or NEXUS_SIM_ITCH_APPROVED=1.");
}

function requireStorageState() {
  if (!existsSync(storageStatePath)) {
    throw new Error("Missing itch Playwright auth state. Run itch auth login --headed first.");
  }
}

function packItchDir(packId) {
  const dir = join(assetPackPath(packId), "itch");
  ensureDir(dir);
  return dir;
}

function packDraftPath(packId) {
  return join(packItchDir(packId), "draft.json");
}

async function newPage(options = {}) {
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: options.headed ? false : true });
  const context = await browser.newContext({
    storageState: existsSync(storageStatePath) ? storageStatePath : undefined,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click().catch(() => null);
      return selector;
    }
  }
  return null;
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.fill(value).catch(() => null);
      return selector;
    }
  }
  return null;
}

async function setFirstFile(page, filePath) {
  const inputs = await page.locator("input[type=file]").all();
  if (!inputs.length) return false;
  await inputs[0].setInputFiles(filePath);
  return true;
}

export async function itchAuthLogin(options = {}) {
  const { browser, context, page } = await newPage({ headed: options.headed !== false });
  try {
    await page.goto("https://itch.io/login", { waitUntil: "domcontentloaded" });
    const timeoutMs = Number(options.timeoutMs ?? 180000);
    await page.waitForURL((url) => !url.href.includes("/login"), { timeout: timeoutMs }).catch(() => null);
    ensureDir(itchDir);
    await context.storageState({ path: storageStatePath });
    const result = {
      ok: true,
      savedAt: new Date().toISOString(),
      storageStatePath,
      url: page.url(),
    };
    writeJson(join(itchDir, "auth-login.json"), result);
    return result;
  } finally {
    await browser.close().catch(() => null);
  }
}

export async function createItchDraft(packId, options = {}) {
  requireApproval(options);
  requireStorageState();
  const status = statusAssetPack(packId);
  if (status.goal.status !== "packaged") {
    throw new Error(`Pack must be packaged before itch draft create. Current status: ${status.goal.status}`);
  }
  const listingPath = join(assetPackPath(packId), "dist", "listing.json");
  if (!existsSync(listingPath)) {
    throw new Error("Missing dist/listing.json. Run asset-pack package first.");
  }
  const listing = readJson(listingPath);
  const slug = options.project || status.goal.packId;
  const { browser, page } = await newPage({ headed: options.headed === true });
  const itchDirForPack = packItchDir(packId);
  try {
    await page.goto("https://itch.io/game/new", { waitUntil: "domcontentloaded" });
    await fillFirst(page, [
      "input[name=title]",
      "input#game_title",
      "input[name='game[title]']",
      "label:has-text('Title') input",
    ], listing.title);
    await fillFirst(page, [
      "input[name=short_text]",
      "textarea[name=short_text]",
      "textarea[name='game[short_text]']",
      "label:has-text('Short description') textarea",
    ], listing.shortText);
    await fillFirst(page, [
      "input[name=custom_url]",
      "input[name='game[custom_url]']",
      "input#game_custom_url",
    ], slug);
    await clickFirst(page, [
      "text=Draft",
      "label:has-text('Draft')",
      "label:has-text('Restricted')",
      "label:has-text('Private')",
    ]);
    await clickFirst(page, [
      "button:has-text('Save')",
      "input[type=submit][value*='Save']",
      "button:has-text('Create')",
      "input[type=submit][value*='Create']",
    ]);
    await page.waitForLoadState("domcontentloaded").catch(() => null);
    const screenshot = join(itchDirForPack, "draft-create.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
    const result = {
      createdAt: new Date().toISOString(),
      editUrl: page.url(),
      ok: true,
      project: slug,
      screenshot,
      title: listing.title,
      visibility: "draft-private-requested",
    };
    writeJson(packDraftPath(packId), result);
    return result;
  } catch (error) {
    const blocker = {
      blockedAt: new Date().toISOString(),
      error: error.message,
      ok: false,
      stage: "draft-create",
      url: page.url(),
    };
    writeJson(join(itchDirForPack, "blocker.json"), blocker);
    throw error;
  } finally {
    await browser.close().catch(() => null);
  }
}

export async function uploadItchDraft(packId, options = {}) {
  requireApproval(options);
  requireStorageState();
  const zipPath = resolve(options.zip || statusAssetPack(packId).paths.zip || "");
  if (!zipPath || !existsSync(zipPath) || !statSync(zipPath).isFile()) {
    throw new Error(`Missing upload zip: ${zipPath}`);
  }
  const draftPath = packDraftPath(packId);
  if (!existsSync(draftPath)) {
    throw new Error("Missing itch draft metadata. Run itch draft create first.");
  }
  const draft = readJson(draftPath);
  const { browser, page } = await newPage({ headed: options.headed === true });
  const itchDirForPack = packItchDir(packId);
  try {
    await page.goto(draft.editUrl || "https://itch.io/dashboard", { waitUntil: "domcontentloaded" });
    const fileSet = await setFirstFile(page, zipPath);
    if (!fileSet) {
      throw new Error("Could not find an itch file input on the draft page.");
    }
    await clickFirst(page, [
      "button:has-text('Upload')",
      "button:has-text('Save')",
      "input[type=submit][value*='Upload']",
      "input[type=submit][value*='Save']",
    ]);
    await page.waitForLoadState("domcontentloaded").catch(() => null);
    const screenshot = join(itchDirForPack, "draft-upload.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
    const result = {
      ...draft,
      ok: true,
      uploadedAt: new Date().toISOString(),
      upload: {
        file: zipPath,
        name: basename(zipPath),
        screenshot,
      },
    };
    writeJson(draftPath, result);
    return result;
  } catch (error) {
    const blocker = {
      blockedAt: new Date().toISOString(),
      error: error.message,
      ok: false,
      stage: "draft-upload",
      url: page.url(),
      zipPath,
    };
    writeJson(join(itchDirForPack, "blocker.json"), blocker);
    throw error;
  } finally {
    await browser.close().catch(() => null);
  }
}

export async function verifyItchDraft(packId, options = {}) {
  requireStorageState();
  const draftPath = packDraftPath(packId);
  if (!existsSync(draftPath)) {
    throw new Error("Missing itch draft metadata. Run itch draft create first.");
  }
  const draft = readJson(draftPath);
  const status = statusAssetPack(packId);
  const { browser, page } = await newPage({ headed: options.headed === true });
  const itchDirForPack = packItchDir(packId);
  try {
    await page.goto(draft.editUrl || "https://itch.io/dashboard", { waitUntil: "domcontentloaded" });
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const screenshot = join(itchDirForPack, "draft-verify.png");
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
    const verification = {
      checkedAt: new Date().toISOString(),
      draftUrl: page.url(),
      localZipExists: Boolean(status.paths.zip),
      ok: Boolean(status.paths.zip) && bodyText.length > 0,
      screenshot,
      titleSeen: bodyText.includes(status.goal.title),
      uploadNameSeen: draft.upload?.name ? bodyText.includes(draft.upload.name) : false,
      visibility: draft.visibility ?? "draft-private-requested",
    };
    writeJson(join(itchDirForPack, "verification.json"), verification);
    return verification;
  } finally {
    await browser.close().catch(() => null);
  }
}

export function itchAuthStatus() {
  return {
    authenticated: existsSync(storageStatePath),
    storageStatePath,
  };
}
