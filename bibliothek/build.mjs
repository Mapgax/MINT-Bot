#!/usr/bin/env node
/* Holt, was die Bibliothek mit der Haupt-App teilt, aus dem Repo-Root:
   das Stylesheet (gleiches Design ohne Kopie im Repo) und die Daten.
   Die Daten landen bewusst in data/ und NICHT in public/ – ausgeliefert
   werden sie nur über /api/themen, und das verlangt einen Login. */
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const root = join(hier, "..");

mkdirSync(join(hier, "data"), { recursive: true });
copyFileSync(join(root, "style.css"), join(hier, "public/style.css"));
for (const datei of ["experiments.json", "schedule.json", "videos.json"]) {
  copyFileSync(join(root, "data", datei), join(hier, "data", datei));
}
console.log("Bibliothek: style.css und data/*.json übernommen.");
