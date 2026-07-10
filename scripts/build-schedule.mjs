#!/usr/bin/env node
// Verlängert data/schedule.json um N Tage (Standard: 90).
// Regeln: lückenlos, nie zweimal dieselbe Kategorie hintereinander,
// jedes Experiment einmal pro Durchlauf, bevor Wiederholungen beginnen.
// Aufruf: node scripts/build-schedule.mjs [tage] [startdatum YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiments = JSON.parse(readFileSync(join(root, "data/experiments.json"), "utf8"));
const schedulePath = join(root, "data/schedule.json");
const schedule = existsSync(schedulePath) ? JSON.parse(readFileSync(schedulePath, "utf8")) : {};

const days = Number(process.argv[2] ?? 90);

const fmt = (d) => d.toISOString().slice(0, 10);
const berlinToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(new Date());

const existingDates = Object.keys(schedule).sort();
let start;
if (process.argv[3]) {
  start = new Date(process.argv[3] + "T00:00:00Z");
} else if (existingDates.length) {
  start = new Date(existingDates[existingDates.length - 1] + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() + 1);
} else {
  start = new Date(berlinToday() + "T00:00:00Z");
}

// Deterministischer Zufall, damit der Schedule reproduzierbar ist.
let seed = 42 + Object.keys(schedule).length;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// Wer im bestehenden Schedule zuletzt selten dran war, kommt zuerst in den Pool.
const usedCount = Object.fromEntries(experiments.map((e) => [e.id, 0]));
for (const id of Object.values(schedule)) if (id in usedCount) usedCount[id]++;
const minUsed = Math.min(...Object.values(usedCount));
let pool = experiments.filter((e) => usedCount[e.id] === minUsed);

let prevKategorie = existingDates.length
  ? experiments.find((e) => e.id === schedule[existingDates[existingDates.length - 1]])?.kategorie ?? null
  : null;

const date = new Date(start);
for (let i = 0; i < days; i++) {
  if (pool.length === 0) pool = [...experiments];
  let candidates = pool.filter((e) => e.kategorie !== prevKategorie);
  if (candidates.length === 0) candidates = experiments.filter((e) => e.kategorie !== prevKategorie);
  const pick = candidates[Math.floor(rand() * candidates.length)];
  schedule[fmt(date)] = pick.id;
  pool = pool.filter((e) => e.id !== pick.id);
  prevKategorie = pick.kategorie;
  date.setUTCDate(date.getUTCDate() + 1);
}

const sorted = Object.fromEntries(Object.entries(schedule).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(schedulePath, JSON.stringify(sorted, null, 2) + "\n");
const dates = Object.keys(sorted);
console.log(`Schedule: ${dates.length} Tage (${dates[0]} bis ${dates[dates.length - 1]})`);
