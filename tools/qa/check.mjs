/* RightBoard — automated layout QA.
   Запускает настоящий Chrome и измеряет то, что нельзя проверить глазами
   в консоли: горизонтальное переполнение, контраст, размеры тап-целей,
   вес страницы, ошибки JS и упавшие запросы.

   Запуск:  node tools/qa/check.mjs [url]  (по умолчанию http://127.0.0.1:8123/)
   Результат: tools/qa/report.json + скриншоты в tools/qa/shots/ */

import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TARGET = process.argv[2] || "http://127.0.0.1:8123/";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("Не найден Chrome/Edge.");
  process.exit(1);
}

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 780, mobile: true },
  { name: "mobile-375", width: 375, height: 812, mobile: true },
  { name: "mobile-414", width: 414, height: 896, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: true },
  { name: "laptop-900", width: 900, height: 800, mobile: false },
  { name: "laptop-1024", width: 1024, height: 768, mobile: false },
  { name: "desktop-1440", width: 1440, height: 900, mobile: false },
  { name: "wide-1920", width: 1920, height: 1080, mobile: false },
];

/* ---------------------------------------------------------------- helpers */

const parseColor = (value) => {
  const m = String(value).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
};

const relLum = ({ r, g, b }) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (fg, bg) => {
  const l1 = relLum(fg);
  const l2 = relLum(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

/* Какой фон реально за текстом: поднимаемся по предкам до непрозрачного слоя */
const effectiveBackground = (el) => {
  let node = el;
  while (node && node !== document.documentElement) {
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0.85) return bg;
    node = node.parentElement;
  }
  const body = parseColor(getComputedStyle(document.body).backgroundColor);
  return body && body.a > 0.85 ? body : { r: 255, g: 255, b: 255, a: 1 };
};

/* ------------------------------------------------------------------- main */

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

await mkdir(SHOTS, { recursive: true });

const report = { url: TARGET, generatedAt: new Date().toISOString(), viewports: [], summary: {} };

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 200)}`));
  page.on("requestfailed", (req) => failedRequests.push(`${req.url().slice(0, 120)} — ${req.failure()?.errorText}`));

  await page.setViewport({
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });

  await page.goto(TARGET, { waitUntil: "networkidle2", timeout: 45000 });
  await page.evaluate(async () => {
    // прокрутить, чтобы сработали lazy-load и reveal
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += window.innerHeight * 0.7;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 60);
        else {
          window.scrollTo(0, 0);
          setTimeout(resolve, 250);
        }
      };
      step();
    });
  });
  await new Promise((r) => setTimeout(r, 400));

  const metrics = await page.evaluate((isMobile) => {
    const parseColor = (value) => {
      const m = String(value).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const relLum = ({ r, g, b }) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => {
      const l1 = relLum(fg);
      const l2 = relLum(bg);
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (hi + 0.05) / (lo + 0.05);
    };
    const effectiveBackground = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = parseColor(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0.85) return bg;
        node = node.parentElement;
      }
      const body = parseColor(getComputedStyle(document.body).backgroundColor);
      return body && body.a > 0.85 ? body : { r: 255, g: 255, b: 255, a: 1 };
    };

    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;

    const offenders = [];
    document.querySelectorAll("body *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.visibility === "hidden") return;
      // .skip-link живёт за левым краем экрана намеренно
      if (el.closest(".skip-link")) return;
      if (rect.right > root.clientWidth + 1 || rect.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className && typeof el.className === "string" ? el.className.slice(0, 60) : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        });
      }
    });

    // Контраст проверяем на всех текстовых узлах, у которых есть видимый текст
    const contrastIssues = [];
    const seen = new Set();
    document
      .querySelectorAll("h1, h2, h3, h4, p, li, a, span, td, th, strong, small, figcaption, button")
      .forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text || text.length < 2) return;
        if (el.children.length && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
          return;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return;
        if (parseFloat(style.opacity) < 0.5) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const fg = parseColor(style.color);
        if (!fg) return;
        const bg = effectiveBackground(el);
        const ratio = contrast(fg, bg);
        const size = parseFloat(style.fontSize);
        const bold = parseInt(style.fontWeight, 10) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const required = large ? 3 : 4.5;
        if (ratio < required - 0.05) {
          const key = `${el.tagName}.${typeof el.className === "string" ? el.className : ""}|${style.color}`;
          if (seen.has(key)) return;
          seen.add(key);
          contrastIssues.push({
            selector: el.tagName.toLowerCase() +
              (typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/).join(".")
                : ""),
            text: text.slice(0, 48),
            ratio: Math.round(ratio * 100) / 100,
            required,
            color: style.color,
            background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
            fontSize: size,
          });
        }
      });

    // Тап-цели на мобильных
    const smallTargets = [];
    if (isMobile) {
      document.querySelectorAll("a, button").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") return;
        if (el.closest(".site-nav") || el.closest(".nav-panel")) return;
        if (rect.height < 40 || rect.width < 24) {
          smallTargets.push({
            text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 32),
            h: Math.round(rect.height),
            w: Math.round(rect.width),
          });
        }
      });
    }

    // Вес и состав ресурсов
    const resources = performance.getEntriesByType("resource");
    const byType = {};
    let total = 0;
    resources.forEach((entry) => {
      const size = entry.transferSize || entry.encodedBodySize || 0;
      total += size;
      const ext = (entry.name.split("?")[0].match(/\.([a-z0-9]+)$/i) || [, "other"])[1].toLowerCase();
      byType[ext] = (byType[ext] || 0) + size;
    });
    const html = performance.getEntriesByType("navigation")[0];
    if (html) {
      const size = html.transferSize || html.encodedBodySize || 0;
      total += size;
      byType.html = (byType.html || 0) + size;
    }

    const images = Array.from(document.images);
    const brokenImages = images
      // у <img> без src в лайтбоксе naturalWidth === 0 — это не битая картинка
      .filter((img) => img.getAttribute("src") && img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src);

    return {
      docHeight: Math.round(root.scrollHeight),
      overflow,
      offenders: offenders.slice(0, 8),
      contrastIssues,
      smallTargets: smallTargets.slice(0, 10),
      resources: { totalKB: Math.round(total / 1024), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])) },
      imageCount: images.length,
      brokenImages,
      fontsLoaded: document.fonts ? document.fonts.status : "n/a",
    };
  }, vp.mobile);

  await page.screenshot({
    path: path.join(SHOTS, `${vp.name}.png`),
    fullPage: vp.name === "mobile-375" || vp.name === "desktop-1440",
    captureBeyondViewport: false,
  });

  report.viewports.push({ ...vp, ...metrics, consoleErrors, failedRequests });
  console.log(
    `${vp.name.padEnd(14)} overflow=${String(metrics.overflow).padStart(3)}px  ` +
      `contrast=${String(metrics.contrastIssues.length).padStart(2)}  ` +
      `tap=${String(metrics.smallTargets.length).padStart(2)}  ` +
      `weight=${String(metrics.resources.totalKB).padStart(5)}KB  ` +
      `img=${metrics.imageCount}/${metrics.brokenImages.length}broken  ` +
      `js=${consoleErrors.length}err/${failedRequests.length}fail`
  );

  await page.close();
}

await browser.close();

const allConsole = report.viewports.flatMap((v) => v.consoleErrors);
const allFailed = report.viewports.flatMap((v) => v.failedRequests);
const worstOverflow = Math.max(...report.viewports.map((v) => v.overflow));
const contrastCount = report.viewports.find((v) => v.name === "desktop-1440")?.contrastIssues ?? [];
const mobileWeight = report.viewports.find((v) => v.name === "mobile-375")?.resources.totalKB ?? 0;

report.summary = {
  worstOverflowPx: worstOverflow,
  contrastIssues: contrastCount.length,
  consoleErrors: [...new Set(allConsole)],
  failedRequests: [...new Set(allFailed)],
  mobileWeightKB: mobileWeight,
  brokenImages: report.viewports.find((v) => v.name === "desktop-1440")?.brokenImages ?? [],
  pass: worstOverflow <= 0 && contrastCount.length === 0 && allConsole.length === 0 && allFailed.length === 0,
};

await writeFile(path.join(HERE, "report.json"), JSON.stringify(report, null, 2), "utf8");

console.log("\n--- СВОДКА ---");
console.log(JSON.stringify(report.summary, null, 2));
if (contrastCount.length) {
  console.log("\nКонтраст ниже нормы:");
  contrastCount.slice(0, 12).forEach((issue) =>
    console.log(`  ${issue.ratio} < ${issue.required}  ${issue.selector}  «${issue.text}»`)
  );
}
const overflowSample = report.viewports.find((v) => v.name === "mobile-375")?.offenders ?? [];
if (overflowSample.length) {
  console.log("\nЭлементы за границей экрана (375px):");
  overflowSample.forEach((o) => console.log(`  <${o.tag} class="${o.cls}"> left=${o.left} right=${o.right}`));
}
