import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto("http://127.0.0.1:8123/", { waitUntil: "networkidle2" });
const r = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll(".hero .btn")).map((b) => {
    const x = b.getBoundingClientRect();
    return { t: b.textContent.trim(), w: Math.round(x.width), y: Math.round(x.top), sameRow: Math.round(x.top) };
  });
  const stats = Array.from(document.querySelectorAll(".stat-strip .stat")).map((s) => {
    const x = s.getBoundingClientRect();
    return { w: Math.round(x.width), y: Math.round(x.top), val: s.querySelector(".stat__value").textContent.trim() };
  });
  const cases = Array.from(document.querySelectorAll(".case")).map((c) => {
    const x = c.getBoundingClientRect();
    return { w: Math.round(x.width), h: Math.round(x.height), y: Math.round(x.top), num: c.querySelector(".case__num").textContent.trim() };
  });
  const ov = document.querySelector(".hero__overline");
  return { btns, stats, cases, overlineLines: Math.round(ov.getBoundingClientRect().height / parseFloat(getComputedStyle(ov).lineHeight)) };
});
console.log("КНОПКИ:", JSON.stringify(r.btns));
console.log("ФАКТЫ:", JSON.stringify(r.stats));
console.log("КЕЙСЫ:", JSON.stringify(r.cases));
console.log("строк оверлайна:", r.overlineLines);
await browser.close();
