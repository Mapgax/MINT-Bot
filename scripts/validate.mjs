#!/usr/bin/env node
// Validiert data/experiments.json und data/schedule.json gegen das Schema.
// Aufruf: node scripts/validate.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const KATEGORIEN = ["weltraum-physik", "natur-tiere", "technik", "kuechenchemie"];
export const SENSORIK = ["laut", "nass", "matschig", "klebrig", "riecht", "knall", "dunkel", "sprudelt", "kalt"];
export const ORTE = ["drinnen", "draussen", "egal"];
export const TYPEN = ["experiment", "beispiel"];

const errors = [];
const err = (msg) => errors.push(msg);

const experiments = JSON.parse(readFileSync(join(root, "data/experiments.json"), "utf8"));
if (!Array.isArray(experiments) || experiments.length === 0) err("experiments.json muss ein nicht-leeres Array sein");

const ids = new Set();
for (const e of experiments) {
  const where = `Experiment "${e.id ?? "(ohne id)"}"`;
  if (!e.id || !/^[a-z0-9-]+$/.test(e.id)) err(`${where}: id fehlt oder enthält ungültige Zeichen (nur a-z, 0-9, -)`);
  if (ids.has(e.id)) err(`${where}: doppelte id`);
  ids.add(e.id);
  if (!e.titel) err(`${where}: titel fehlt`);
  if (!e.emoji) err(`${where}: emoji fehlt`);
  if (!KATEGORIEN.includes(e.kategorie)) err(`${where}: ungültige kategorie "${e.kategorie}"`);
  if (!TYPEN.includes(e.typ)) err(`${where}: ungültiger typ "${e.typ}"`);
  if (!e.fakt || e.fakt.length < 20) err(`${where}: fakt fehlt oder ist zu kurz`);
  if (!Number.isInteger(e.dauerMinuten) || e.dauerMinuten < 1 || e.dauerMinuten > 30) err(`${where}: dauerMinuten muss 1–30 sein`);
  if (e.wartezeit !== null && typeof e.wartezeit !== "string") err(`${where}: wartezeit muss String oder null sein`);
  if (!ORTE.includes(e.ort)) err(`${where}: ungültiger ort "${e.ort}"`);
  if (!Array.isArray(e.sensorik) || e.sensorik.some((s) => !SENSORIK.includes(s))) err(`${where}: sensorik enthält ungültige Werte (erlaubt: ${SENSORIK.join(", ")})`);
  if (!Array.isArray(e.material) || e.material.length === 0) err(`${where}: material fehlt`);
  if (!e.elternInfo) err(`${where}: elternInfo fehlt`);
  if (!Array.isArray(e.schritte) || e.schritte.length < 3 || e.schritte.length > 6) err(`${where}: schritte muss 3–6 Einträge haben`);
  for (const s of e.schritte ?? []) {
    if (!s.text || !s.emoji) err(`${where}: jeder Schritt braucht text und emoji`);
    if (s.text && s.text.length > 160) err(`${where}: Schritt-Text zu lang (max. 160 Zeichen): "${s.text.slice(0, 40)}…"`);
  }
  if (!e.wasPassiert) err(`${where}: wasPassiert fehlt`);
  if (!e.erklaerung) err(`${where}: erklaerung fehlt`);
  if (typeof e.nochmalTauglich !== "boolean") err(`${where}: nochmalTauglich muss true/false sein`);
}

const schedulePath = join(root, "data/schedule.json");
if (existsSync(schedulePath)) {
  const schedule = JSON.parse(readFileSync(schedulePath, "utf8"));
  const dates = Object.keys(schedule).sort();
  let prevDate = null;
  let prevKategorie = null;
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err(`Schedule: ungültiges Datum "${date}"`);
    const id = schedule[date];
    const exp = experiments.find((e) => e.id === id);
    if (!exp) {
      err(`Schedule ${date}: unbekannte Experiment-id "${id}"`);
      continue;
    }
    if (prevDate) {
      const gap = (new Date(date) - new Date(prevDate)) / 86400000;
      if (gap !== 1) err(`Schedule: Lücke oder Duplikat zwischen ${prevDate} und ${date}`);
      if (exp.kategorie === prevKategorie) err(`Schedule ${date}: gleiche Kategorie wie am Vortag (${exp.kategorie})`);
    }
    prevDate = date;
    prevKategorie = exp.kategorie;
  }
  console.log(`Schedule: ${dates.length} Tage (${dates[0]} bis ${dates[dates.length - 1]})`);
}

const proKategorie = Object.fromEntries(KATEGORIEN.map((k) => [k, experiments.filter((e) => e.kategorie === k).length]));
console.log(`Experimente: ${experiments.length}`, proKategorie);

if (errors.length) {
  console.error(`\n${errors.length} Fehler:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("Alles gültig ✔");
