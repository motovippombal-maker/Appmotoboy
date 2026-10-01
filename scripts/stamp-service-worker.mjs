import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const source = readFileSync(workerPath, "utf8");
// O deploy pela CLI pode reutilizar o mesmo commit com arquivos locais novos.
// Um ID por build garante que o navegador encontre uma versão nova do SW.
const revision = randomUUID().replaceAll("-", "");

const stamp = `const SW_BUILD_ID = "${revision.slice(0, 12)}";`;
const result = source.replace(/^const SW_BUILD_ID = "[^"]+";$/m, stamp);
if (result === source && !source.includes(stamp)) {
  throw new Error("Marcador de versão do service worker não encontrado.");
}
writeFileSync(workerPath, result);
console.log(`Service worker preparado para a revisão ${revision.slice(0, 12)}.`);
