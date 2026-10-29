/* RightBoard — измерение «дыхания» секций.
   Проверяем не валидность, а композицию: нет ли огромных пустот,
   не перевёрстаны ли строки, не вылезает ли контент из своих колонок.

   Запуск: node tools/qa/rhythm.mjs [url] */

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

const widths = [375, 768, 1024, 1440];

for (const width of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.goto(TARGET, { waitUntil: "networkidle2" });
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += window.innerHeight * 0.8;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 40);
        else {
          window.scrollTo(0, 0);
          setTimeout(resolve, 200);
        }
      };
      step();
    });
  });

  const report = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("main > section"));
    const rows = sections.map((section) => {
      const rect = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      const inner = section.querySelector(".wrap");
      const innerRect = inner?.getBoundingClientRect();
      return {
        id: section.id || "(hero)",
        height: Math.round(rect.height),
        padTop: Math.round(parseFloat(style.paddingTop)),
        padBottom: Math.round(parseFloat(style.paddingBottom)),
        innerWidth: innerRect ? Math.round(innerRect.width) : 0,
        scrollHeight: section.scrollHeight,
      };
    });

    // Разрывы между соседними блоками текста внутри секции
    const gaps = [];
    document.querySelectorAll(".sec-head, .symptom-list, .feature-grid, .stats, .stat-strip, table, .cases-grid, .about__media, .contact__grid, .hero__row").forEach((el) => {
      const prev = el.previousElementSibling;
      if (!prev) return;
      const a = prev.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const gap = Math.round(b.top - a.bottom);
      if (gap > 90) {
        gaps.push({
          after: prev.className || prev.tagName.toLowerCase(),
          before: el.className || el.tagName.toLowerCase(),
          gap,
        });
      }
    });

    // Строки, у которых слишком мало текста на слишком широкой полосе
    const narrowLines = [];
    document.querySelectorAll("h1, h2, h3, p, .lead").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 10) return;
      const chars = (el.textContent || "").trim().length;
      const lines = Math.max(1, Math.round(rect.height / (parseFloat(getComputedStyle(el).lineHeight) || 20)));
      const charsPerLine = chars / lines;
      if (charsPerLine < 14 && rect.width > 380 && chars > 8) {
        narrowLines.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 40),
          text: el.textContent.trim().slice(0, 40),
          charsPerLine: Math.round(charsPerLine),
        });
      }
    });

    // Пустые «дырки»: большой вертикальный разрыв между двумя непустыми блоками
    return {
      docHeight: document.documentElement.scrollHeight,
      sections: rows,
      bigGaps: gaps.slice(0, 8),
      narrowLines: narrowLines.slice(0, 8),
    };
  });

  console.log(`\n===== ${width}px — высота документа ${report.docHeight}px =====`);
  report.sections.forEach((s) =>
    console.log(
      `  ${s.id.padEnd(10)} h=${String(s.height).padStart(4)}  pad=${String(s.padTop).padStart(3)}/${String(s.padBottom).padStart(3)}  inner=${s.innerWidth}`
    )
  );
  if (report.bigGaps.length) {
    console.log("  крупные разрывы:");
    report.bigGaps.forEach((g) => console.log(`    ${g.gap}px до .${g.before} (после .${g.after})`));
  }
  if (report.narrowLines.length) {
    console.log("  слишком узкие строки:");
    report.narrowLines.forEach((n) =>
      console.log(`    <${n.tag} class="${n.cls}"> ${n.charsPerLine} симв/строку — «${n.text}»`)
    );
  }

  await page.close();
}

await browser.close();
