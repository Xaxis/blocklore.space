/**
 * Writes web/app/favicon.ico from web/app/icon.svg: the mark at 16, 32 and 48 pixels, each a PNG
 * inside the ICO container. Run again after the mark changes.
 *
 *   node tools/favicon.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const svg = readFileSync(path.join(root, "web", "app", "icon.svg"), "utf8");
const sizes = [16, 32, 48];
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--disable-gpu-watchdog"],
});
const pngs: Buffer[] = [];
try {
  for (const s of sizes) {
    const page = await browser.newPage({ viewport: { width: s, height: s } });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`,
    );
    pngs.push(
      await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}

// ICONDIR, then one ICONDIRENTRY per image, then the PNGs.
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  const png = pngs[i] as Buffer;
  head.writeUInt8(s % 256, e);
  head.writeUInt8(s % 256, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
const out = path.join(root, "web", "app", "favicon.ico");
writeFileSync(out, Buffer.concat([head, ...pngs]));
console.log(`wrote ${path.relative(root, out)} (${sizes.join(", ")} px)`);
