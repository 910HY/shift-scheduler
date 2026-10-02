/**
 * Mark 驗收截圖。先開 `npm run dev`，再跑 `npm run shots:qr`。
 * 產出 shots/ 下面六個檔名：
 *   qr-gen-staff.png、qr-gen-supervisor.png、qr-staff-day.png、
 *   qr-staff-print.png、qr-supervisor-day.png、qr-bad-link.png
 *
 * 可選：SHOTS_BASE（預設 http://127.0.0.1:4317）、CHROME_PATH。
 */
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "shots");
const base = (process.env.SHOTS_BASE ?? "http://127.0.0.1:4317").replace(/\/$/, "");
const staffPath = "/?view=person&staff=K4&shift=B2&date=2026-09-28&loc=arr-hall";
const supervisorPath = "/?view=supervisor&date=2026-09-28&loc=arr-hall";
const badPath = "/?view=person";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/local/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const executablePath = await firstExisting(chromeCandidates);
if (!executablePath) {
  console.error("搵唔到 Chrome。請設 CHROME_PATH。");
  process.exit(1);
}

const probe = await fetch(base).catch(() => null);
if (!probe?.ok) {
  console.error(`開唔到 ${base}。請先喺另一個終端機跑 npm run dev。`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + "/", { waitUntil: "networkidle0" });
  await page.click("[data-testid=open-qr]");
  await page.waitForSelector("[data-testid=qr-link]", { timeout: 20000 });
  const picked = await page.$$eval("[data-testid=qr-staff] option", (options) => {
    const hit = options.find((option) => (option.textContent ?? "").trim() === "B2 K4");
    return hit?.value ?? "";
  });
  if (picked) await page.select("[data-testid=qr-staff]", picked);
  await page.waitForFunction(() => {
    const input = document.querySelector("[data-testid=qr-link]");
    const svg = document.querySelector("[data-testid=qr-image] svg");
    return input instanceof HTMLInputElement && input.value.includes("view=person") && input.value.includes("staff=K4") && svg;
  }, { timeout: 15000 });
  await shot(page, "[data-testid=qr-dialog]", "qr-gen-staff.png");

  await page.click("[data-testid=qr-mode-supervisor]");
  await page.waitForFunction(() => {
    const input = document.querySelector("[data-testid=qr-link]");
    const svg = document.querySelector("[data-testid=qr-image] svg");
    return input instanceof HTMLInputElement && input.value.includes("view=supervisor") && svg;
  }, { timeout: 15000 });
  await shot(page, "[data-testid=qr-dialog]", "qr-gen-supervisor.png");

  const fresh = await browser.createBrowserContext();
  const person = await fresh.newPage();
  await person.setViewport({ width: 390, height: 844 });
  await person.goto(base + staffPath, { waitUntil: "networkidle0" });
  await person.waitForSelector("[data-testid=person-sheet]");
  await expandSheet(person);
  await person.screenshot({ path: path.join(outDir, "qr-staff-day.png"), fullPage: true });
  console.log("shots/qr-staff-day.png");
  await person.emulateMediaType("print");
  await expandSheet(person);
  await person.screenshot({ path: path.join(outDir, "qr-staff-print.png"), fullPage: true });
  console.log("shots/qr-staff-print.png");

  const supervisor = await fresh.newPage();
  await supervisor.setViewport({ width: 1280, height: 900 });
  await supervisor.goto(base + supervisorPath, { waitUntil: "networkidle0" });
  await supervisor.waitForSelector("[data-testid=scan-shift]", { timeout: 20000 });
  await supervisor.waitForFunction(() => document.querySelectorAll("[data-testid=scan-shift]").length >= 2);
  const height = await supervisor.evaluate(() => {
    const shifts = [...document.querySelectorAll("[data-testid=scan-shift]")];
    const second = shifts[1];
    const bottom = second ? second.getBoundingClientRect().bottom + window.scrollY : 1600;
    return Math.min(Math.ceil(bottom + 16), 2400);
  });
  await supervisor.screenshot({
    path: path.join(outDir, "qr-supervisor-day.png"),
    clip: { x: 0, y: 0, width: 1280, height },
  });
  console.log("shots/qr-supervisor-day.png");

  const error = await fresh.newPage();
  await error.setViewport({ width: 390, height: 844 });
  await error.goto(base + badPath, { waitUntil: "networkidle0" });
  await error.waitForSelector("[data-testid=scan-error]");
  await shot(error, "[data-testid=scan-error]", "qr-bad-link.png");
  console.log(`六張截圖喺 ${outDir}`);
} finally {
  await browser.close();
}

async function expandSheet(page) {
  await page.evaluate(() => {
    const sheet = document.querySelector("[data-testid=person-sheet]");
    if (sheet instanceof HTMLElement) {
      sheet.style.position = "static";
      sheet.style.height = "auto";
      sheet.style.overflow = "visible";
    }
  });
}

async function shot(page, selector, filename) {
  const handle = await page.$(selector);
  if (!handle) throw new Error(`搵唔到 ${selector}`);
  await handle.screenshot({ path: path.join(outDir, filename) });
  console.log(`shots/${filename}`);
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next path
    }
  }
  return null;
}
