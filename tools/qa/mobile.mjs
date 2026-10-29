/* RightBoard — мобильный аудит.
   Снимает геометрию экрана 375 px и печатает «ASCII-макет» первых экранов,
   чтобы проверить композицию без визуального просмотра.

   Запуск: node tools/qa/mobile.mjs [url] */

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

const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(TARGET, { waitUntil: "networkidle2" });
await page.evaluate(async () => {
  await new Promise((resolve) => {
    let y = 0;
    const step = () => {
      y += window.innerHeight * 0.8;
      window.scrollTo(0, y);
      if (y < document.body.scrollHeight) setTimeout(step, 35);
      else {
        window.scrollTo(0, 0);
        setTimeout(resolve, 250);
      }
    };
    step();
  });
});

/* --------------------------------------------------- 1. геометрия экрана */
const geometry = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const hero = document.querySelector(".hero");
  const h1 = document.querySelector("h1");
  const overline = document.querySelector(".hero__overline");
  const lead = document.querySelector(".hero__lead");
  const btns = Array.from(document.querySelectorAll(".hero .btn")).map((b) => {
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const statStrip = document.querySelector(".stat-strip");
  const statCells = Array.from(statStrip.children).map((c) => Math.round(c.getBoundingClientRect().width));
  const rows = {};
  [
    ["hero", ".hero"],
    ["problem", "#problem"],
    ["mpk", "#mpk"],
    ["compare", "#compare"],
    ["check", "#check"],
    ["cases", "#cases"],
    ["about", "#about"],
    ["contact", "#contact"],
  ].forEach(([k, sel]) => {
    const el = document.querySelector(sel);
    if (el) rows[k] = Math.round(el.getBoundingClientRect().height);
  });

  const symptomRow = document.querySelector(".symptom-row");
  const grid = symptomRow ? getComputedStyle(symptomRow).gridTemplateColumns : "";

  const header = document.querySelector(".site-header__inner").getBoundingClientRect();
  const stickyBar = document.querySelector(".sticky-cta");

  return {
    vw,
    heroHeight: Math.round(hero.getBoundingClientRect().height),
    h1: {
      fontSize: getComputedStyle(h1).fontSize,
      lines: Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)),
      width: Math.round(h1.getBoundingClientRect().width),
    },
    overlineHeight: Math.round(overline.getBoundingClientRect().height),
    leadFontSize: getComputedStyle(lead).fontSize,
    btns,
    statColumns: statCells.length,
    statCellWidth: statCells[0],
    sectionHeights: rows,
    symptomGrid: grid,
    headerHeight: Math.round(header.height),
    stickyBarDisplay: stickyBar ? getComputedStyle(stickyBar).display : "нет",
  };
});

console.log("=== ГЕОМЕТРИЯ 375 px ===");
console.log(JSON.stringify(geometry, null, 1));

/* ------------------------------------------------- 2. ASCII-макет hero */
const heroAscii = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const blocks = [];
  document.querySelectorAll(".hero *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 4) return;
    if (["SOURCE", "PICTURE"].includes(el.tagName)) return;
    blocks.push({
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      left: Math.round(r.left),
      right: Math.round(r.right),
      fill: el.tagName === "IMG" || el.tagName === "SPAN" ? "#" : (el.tagName === "H1" ? "=" : (el.tagName === "A" ? "+" : ".")),
    });
  });
  const startY = 0;
  const endY = Math.max(...blocks.map((b) => b.bottom));
  const cols = 46;
  const rowsCount = Math.min(90, Math.round((endY - startY) / 26));
  const grid = Array.from({ length: rowsCount }, () => Array(cols).fill(" "));
  for (const b of blocks) {
    const r0 = Math.max(0, Math.floor(((b.top - startY) / (endY - startY)) * rowsCount));
    const r1 = Math.min(rowsCount - 1, Math.ceil(((b.bottom - startY) / (endY - startY)) * rowsCount) - 1);
    const c0 = Math.max(0, Math.floor((b.left / vw) * cols));
    const c1 = Math.min(cols - 1, Math.ceil((b.right / vw) * cols) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (grid[r][c] === " " || b.fill === "#") grid[r][c] = b.fill;
      }
    }
  }
  return { totalHeight: endY, art: grid.map((row) => row.join("")) };
});

console.log(`\n=== МАКЕТ HERO (высота ${heroAscii.totalHeight}px, '#'=фото '='=заголовок '+'=кнопка '.'=текст) ===`);
heroAscii.art.forEach((line, i) => console.log(String(i * 26).padStart(4) + " " + line));

await browser.close();
