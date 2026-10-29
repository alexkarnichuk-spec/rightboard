import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const TARGET = process.argv[2] || "http://127.0.0.1:8123/";
await page.goto(TARGET, { waitUntil: "networkidle2" });
const dump = await page.evaluate(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 2) return;
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className : "";
    if (r.height > 6 && (el.tagName === "H1" || el.tagName === "H2" || cls.includes("overline") || cls.includes("lead") || cls.includes("photo") || cls.includes("actions") || cls.includes("media") || cls.includes("stat-strip") || cls.includes("stats") || cls.includes("row"))) {
      out.push("  ".repeat(depth) + `<${el.tagName.toLowerCase()} class="${cls.slice(0,40)}"> top=${Math.round(r.top)} h=${Math.round(r.height)} w=${Math.round(r.width)}`);
    }
    Array.from(el.children).forEach((c) => walk(c, depth + 1));
  };
  walk(document.querySelector(".hero"), 0);
  // overline: сколько строк и как выглядят
  const ov = document.querySelector(".hero__overline");
  const ovSpans = Array.from(ov.children).map((s) => ({ t: s.textContent.trim().slice(0,40), w: Math.round(s.getBoundingClientRect().width), top: Math.round(s.getBoundingClientRect().top) }));
  return { tree: out, overlineSpans: ovSpans };
});
console.log(dump.tree.join("\n"));
console.log("\nOVERLINE spans:");
console.log(JSON.stringify(dump.overlineSpans, null, 1));
await browser.close();
