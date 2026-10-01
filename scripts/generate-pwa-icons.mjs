import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = await readFile(path.join(root, "public", "icons", "moto-syxp-mark.svg"));
const output = path.join(root, "public", "icons");
await mkdir(output, { recursive: true });

for (const size of [192, 512]) {
  await sharp(source).resize(size, size).png().toFile(path.join(output, `moto-syxp-${size}.png`));
}

await sharp({ create: { width: 512, height: 512, channels: 4, background: "#05090f" } })
  .composite([{ input: await sharp(source).resize(280, 280).png().toBuffer(), gravity: "centre" }])
  .png()
  .toFile(path.join(output, "moto-syxp-maskable-512.png"));

await sharp(source).resize(180, 180).png().toFile(path.join(output, "apple-touch-icon.png"));

const motoPombalBadge = await readFile(path.join(root, "public", "brand", "motopombal-badge.png"));
for (const size of [192, 512]) {
  await sharp(motoPombalBadge).resize(size, size).png().toFile(path.join(output, `moto-pombal-${size}.png`));
}

await sharp({ create: { width: 512, height: 512, channels: 4, background: "#071b42" } })
  .composite([{ input: await sharp(motoPombalBadge).resize(390, 390).png().toBuffer(), gravity: "centre" }])
  .png()
  .toFile(path.join(output, "moto-pombal-maskable-512.png"));

await sharp(motoPombalBadge).resize(180, 180).png().toFile(path.join(output, "apple-touch-icon.png"));
