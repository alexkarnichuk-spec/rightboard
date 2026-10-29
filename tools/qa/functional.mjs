/* RightBoard — функциональные проверки главной.
   Проверяем то, что не видно в отчёте о вёрстке: иерархию заголовков,
   обрезанный текст, работу меню, лайтбокса и фасада видео.

   Запуск: node tools/qa/functional.mjs [url] */

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const TARGET = process.argv[2] || "http://127.0.0.1:8123/";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars"],
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

/* ------------------------------------------------- структура и текст */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(TARGET, { waitUntil: "networkidle2" });

  const structure = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent.trim().slice(0, 60),
    }));
    const clipped = [];
    document.querySelectorAll("p, h1, h2, h3, h4, li, td, th, .stat__label, .symptom p").forEach((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (el.scrollHeight > el.clientHeight + 2 && style.overflow !== "visible") {
        clipped.push({ tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 40) });
      }
    });
    const anchors = Array.from(document.querySelectorAll('a[href^="#"]')).map((a) => a.getAttribute("href"));
    const missingAnchors = anchors.filter((href) => href.length > 1 && !document.querySelector(href));
    const externalLinks = Array.from(document.querySelectorAll('a[href^="http"], a[href^="tel:"]')).map((a) => ({
      href: a.getAttribute("href"),
      rel: a.getAttribute("rel"),
      text: a.textContent.trim().slice(0, 40),
    }));
    const imagesWithoutAlt = Array.from(document.images)
      .filter((img) => !img.hasAttribute("alt"))
      .map((img) => img.currentSrc);
    const lazyCount = Array.from(document.images).filter((img) => img.loading === "lazy").length;
    const h1 = document.querySelectorAll("h1").length;
    const main = document.querySelectorAll("main").length;
    return { headings, clipped, missingAnchors, externalLinks, imagesWithoutAlt, lazyCount, h1, main };
  });

  check("Ровно один <h1>", structure.h1 === 1, `найдено ${structure.h1}`);
  check("Есть <main>", structure.main === 1);

  const levels = structure.headings.map((h) => h.level);
  let skipped = null;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) skipped = `${levels[i - 1]} → ${levels[i]}`;
  }
  check("Нет пропущенных уровней заголовков", !skipped, skipped || "");
  check("Нет обрезанного текста", structure.clipped.length === 0, JSON.stringify(structure.clipped).slice(0, 200));
  check("Все якорные ссылки ведут в существующие секции", structure.missingAnchors.length === 0,
    structure.missingAnchors.join(", ").slice(0, 160));
  check("У всех изображений есть alt", structure.imagesWithoutAlt.length === 0,
    structure.imagesWithoutAlt.length + " без alt");
  check("Изображения ниже первого экрана — lazy", structure.lazyCount >= 10, `lazy: ${structure.lazyCount}`);
  const unsafe = structure.externalLinks.filter((l) => l.href?.startsWith("http") && l.rel !== "noopener");
  check("Внешние ссылки с rel=noopener", unsafe.length === 0, JSON.stringify(unsafe).slice(0, 160));

  console.log("\nИерархия заголовков:");
  structure.headings.forEach((h) => console.log(`  ${"  ".repeat(h.level - 1)}h${h.level} ${h.text}`));

  await page.close();
}

/* ---------------------------------------------------------- мобильное меню */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await page.goto(TARGET, { waitUntil: "networkidle2" });

  const toggleVisible = await page.$eval(".nav-toggle", (el) => getComputedStyle(el).display !== "none");
  check("Кнопка меню видна на мобильном", toggleVisible);

  await page.click(".nav-toggle");
  await new Promise((r) => setTimeout(r, 250));
  const opened = await page.evaluate(() => {
    const panel = document.querySelector("#nav-panel");
    return {
      visible: !panel.hidden && getComputedStyle(panel).display !== "none",
      expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
      locked: getComputedStyle(document.documentElement).overflow === "hidden",
      hasClose: Boolean(panel.querySelector(".nav-panel__close")),
      closeVisible: panel.querySelector(".nav-panel__close")
        ? panel.querySelector(".nav-panel__close").getBoundingClientRect().width >= 40
        : false,
      focusInClose: document.activeElement?.classList.contains("nav-panel__close") ?? false,
      phoneButton: Boolean(panel.querySelector('a[href^="tel:"]')),
    };
  });
  check("Меню открывается", opened.visible);
  check("aria-expanded переключается", opened.expanded === "true", opened.expanded);
  check("Прокрутка блокируется при открытом меню", opened.locked);
  check("В меню есть кнопка закрытия", opened.hasClose && opened.closeVisible);
  check("Фокус на кнопке закрытия", opened.focusInClose);
  check("Кнопки телефона в меню нет", opened.phoneButton === false);

  await page.click(".nav-panel__close");
  await new Promise((r) => setTimeout(r, 250));
  const closedByButton = await page.evaluate(() => ({
    hidden: document.querySelector("#nav-panel").hidden,
    focusBack: document.activeElement?.classList.contains("nav-toggle") ?? false,
  }));
  check("Кнопка закрытия закрывает меню", closedByButton.hidden);
  check("Фокус возвращается на бургер", closedByButton.focusBack);

  await page.click(".nav-toggle");
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 250));
  const closed = await page.evaluate(() => document.querySelector("#nav-panel").hidden);
  check("Меню закрывается по Escape", closed);

  await page.close();
}

/* -------------------------------------------------------------- лайтбокс */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(TARGET, { waitUntil: "networkidle2" });
  await page.evaluate(() => document.querySelector("#cases").scrollIntoView());
  await new Promise((r) => setTimeout(r, 400));

  await page.click('[data-lightbox]');
  await new Promise((r) => setTimeout(r, 400));
  const state = await page.evaluate(() => {
    const box = document.querySelector("#lightbox");
    return {
      open: box.classList.contains("is-open") && !box.hidden,
      src: box.querySelector("img").getAttribute("src"),
      focusInBox: box.contains(document.activeElement),
    };
  });
  check("Лайтбокс открывается", state.open);
  check("Лайтбокс показывает выбранное фото", Boolean(state.src && state.src.includes("69593150")), state.src);
  check("Фокус переходит в лайтбокс", state.focusInBox);

  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 300));
  const next = await page.evaluate(() => document.querySelector("#lightbox img").getAttribute("src"));
  check("Стрелка листает фото", next !== state.src, next);

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
  const closed = await page.evaluate(() => document.querySelector("#lightbox").hidden);
  check("Лайтбокс закрывается по Escape", closed);

  await page.close();
}

/* ---------------------------------------------------------- фасад видео */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(TARGET, { waitUntil: "networkidle2" });
  const before = await page.$$eval("iframe", (els) => els.length);
  check("До клика Kinescope не загружается", before === 0, `iframe: ${before}`);

  await page.evaluate(() => document.querySelector(".video-facade").click());
  await new Promise((r) => setTimeout(r, 400));
  const src = await page.evaluate(() => document.querySelector(".video-facade iframe")?.getAttribute("src") ?? "");
  check("После клика вставляется плеер Kinescope", src.includes("kinescope.io/embed/"), src.slice(0, 60));
  await page.close();
}

/* --------------------------------------------------- поведение без JS */
{
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(TARGET, { waitUntil: "networkidle2" });
  const content = await page.evaluate(() => ({
    text: document.body.innerText.length,
    images: Array.from(document.images).filter((i) => i.naturalWidth > 0).length,
    hiddenText: Array.from(document.querySelectorAll("h2")).filter((h) => {
      const style = getComputedStyle(h);
      return style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.5;
    }).length,
  }));
  check("Без JS контент доступен", content.text > 3000, `${content.text} символов текста`);
  check("Без JS изображения видны", content.images >= 10, `${content.images} картинок`);
  check("Без JS заголовки не скрыты", content.hiddenText === 0, `скрыто ${content.hiddenText}`);
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n--- ${results.length - failed.length}/${results.length} проверок пройдено ---`);
if (failed.length) process.exitCode = 1;
