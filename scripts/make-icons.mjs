// Genera los iconos PNG a partir de public/icons/icon.svg
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "public", "icons");
const svg = readFileSync(join(iconsDir, "icon.svg"));

async function render(size, out) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(join(iconsDir, out));
  console.log("✓", out);
}

async function maskable() {
  const bg = { create: { width: 512, height: 512, channels: 4, background: "#1E7A3C" } };
  const inner = await sharp(svg, { density: 384 }).resize(360, 360).png().toBuffer();
  await sharp(bg).composite([{ input: inner, gravity: "center" }]).png()
    .toFile(join(iconsDir, "icon-maskable.png"));
  console.log("✓ icon-maskable.png");
}

await render(192, "icon-192.png");
await render(512, "icon-512.png");
await render(180, "icon-180.png");
await maskable();
console.log("Listo.");
