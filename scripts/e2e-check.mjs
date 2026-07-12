import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";

const base = process.env.E2E_BASE_URL || "http://localhost:3000";
const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const output = process.env.E2E_OUTPUT_DIR || "artifacts";
const desktop = process.env.E2E_LAYOUT === "desktop";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: !desktop,
  hasTouch: !desktop,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  geolocation: { latitude: 34.702485, longitude: 135.495951 },
  permissions: ["geolocation"]
});
const page = await context.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("requestfailed", (request) => {
  const failure = request.failure();
  failedRequests.push(`${request.method()} ${request.url()} ${failure?.errorText ?? "failed"}`);
});

async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
}

async function visibleText(text, timeout = 30_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

await page.goto(base, { waitUntil: "networkidle" });
await visibleText("MICHIKUSA");

async function assertFallbackMapCanMove() {
  const fallbackMap = page.locator(".demo-map");
  if ((await fallbackMap.count()) === 0) return;

  const mapContent = page.getByTestId("demo-map-content");
  if ((await mapContent.count()) !== 1) {
    throw new Error("Fallback map is missing an interactive map surface.");
  }

  const mapBox = await fallbackMap.boundingBox();
  if (!mapBox) throw new Error("Fallback map is not visible.");

  const before = await mapContent.evaluate((node) => getComputedStyle(node).transform);
  const dragStart = {
    x: mapBox.x + mapBox.width / 2,
    y: mapBox.y + mapBox.height * 0.35
  };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 72, dragStart.y + 36, { steps: 4 });
  await page.mouse.up();
  const after = await mapContent.evaluate((node) => getComputedStyle(node).transform);

  if (before === after) {
    throw new Error("Fallback map did not move after a drag gesture.");
  }
}

await assertFallbackMapCanMove();

const technicalLabels = ["ADK", "DEMO", "デモ", "AI OUTING AGENT", "AGENT IS MOVING", "Google ADK", "Calendar", "Google Routes"];
async function assertProductCopy() {
  const copy = await page.locator("body").innerText();
  for (const technicalLabel of technicalLabels) {
    if (copy.includes(technicalLabel)) {
      throw new Error(`Technical label leaked into the product UI: ${technicalLabel}`);
    }
  }
}
await assertProductCopy();

if (desktop) {
  const desktopLayout = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const mapStage = document.querySelector(".map-stage");
    const controlStage = document.querySelector(".control-stage");
    return {
      shellDisplay: shell ? getComputedStyle(shell).display : "missing",
      columns: shell ? getComputedStyle(shell).gridTemplateColumns : "missing",
      mapStage: Boolean(mapStage),
      controlStage: Boolean(controlStage)
    };
  });
  if (
    desktopLayout.shellDisplay !== "grid" ||
    desktopLayout.columns.split(" ").length < 2 ||
    !desktopLayout.mapStage ||
    !desktopLayout.controlStage
  ) {
    throw new Error(`Desktop layout is not active: ${JSON.stringify(desktopLayout)}`);
  }
}
await shot("01-home");

const start = page.getByRole("button", { name: /外に連れ出して|このまま道草する|今日を動かす|道草をつくる/ }).first();
await start.click();
const mascot = page.getByTestId("michi-mascot");
await mascot.waitFor({ state: "visible", timeout: 8_000 });
const mascotMotion = await mascot.locator("img").evaluate((image) => getComputedStyle(image).animationName);
if (!mascotMotion.includes("michiWalk")) {
  throw new Error(`Mascot walk animation is not active: ${mascotMotion}`);
}
await visibleText("ミチが考え中");
await page.waitForTimeout(350);
await shot("02-agent-planning");

await visibleText("この道草で出発", 45_000);
await visibleText("おまたせ！きょうの予定、立てたよ。");
const resultMascotMotion = await page.getByTestId("michi-mascot").locator("img").evaluate((image) => getComputedStyle(image).animationName);
if (!resultMascotMotion.includes("michiCelebrate")) {
  throw new Error(`Mascot celebration animation is not active: ${resultMascotMotion}`);
}
await assertProductCopy();
await shot("03-route-ready");

await page.getByRole("button", { name: /この道草で出発/ }).click();
await visibleText("着いた", 20_000);
await shot("04-navigation");

// Exercise the seven-node replan workflow once before completing the route.
const replanMenu = page.locator(".active-topline button").first();
if (await replanMenu.isVisible()) {
  await replanMenu.click();
  await visibleText("15分遅れている");
  await page.getByRole("button", { name: /15分遅れている/ }).click();
  await visibleText("着いた", 30_000);
  await shot("05-replanned");
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64"
);
await writeFile(`${output}/e2e-photo.png`, tinyPng);

let guard = 0;
while (guard < 6) {
  guard += 1;
  const shareButton = page.getByRole("button", { name: /思い出をシェア/ });
  if (await shareButton.isVisible().catch(() => false)) break;

  const arrived = page.getByRole("button", { name: /^着いた$/ });
  if (await arrived.isVisible().catch(() => false)) {
    await arrived.click();
    await page.waitForTimeout(200);
    if (guard === 1) await shot("06-spot-activity");
  }

  const timerStart = page.getByRole("button", { name: /分はじめる/ });
  if (await timerStart.isVisible().catch(() => false)) {
    await timerStart.click();
    await page.waitForTimeout(8_500);
    await page.getByRole("button", { name: /^できた$/ }).click();
    await page.waitForTimeout(250);
    continue;
  }

  const photoStart = page.getByRole("button", { name: /一枚残す/ });
  if (await photoStart.isVisible().catch(() => false)) {
    await page.locator('input[type="file"]').setInputFiles(`${output}/e2e-photo.png`);
    await page.getByRole("button", { name: /この一枚で完了/ }).click();
    await page.waitForTimeout(250);
    continue;
  }

  const found = page.getByRole("button", { name: /^見つけた$/ });
  if (await found.isVisible().catch(() => false)) {
    await found.click();
    await page.waitForTimeout(250);
    continue;
  }

  await page.waitForTimeout(300);
}

await visibleText("思い出をシェア", 30_000);
await shot("07-complete");

const report = {
  title: await page.title(),
  finalUrl: page.url(),
  consoleErrors,
  failedRequests,
  screenshots: [
    "01-home.png",
    "02-agent-planning.png",
    "03-route-ready.png",
    "04-navigation.png",
    "05-replanned.png",
    "06-spot-activity.png",
    "07-complete.png"
  ]
};
await writeFile(`${output}/e2e-report.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

if (consoleErrors.length || failedRequests.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
