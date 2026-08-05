#!/usr/bin/env node
// Verlängert data/schedule.json um N Tage (Standard: 90).
// Regeln: lückenlos, nie zweimal dieselbe Kategorie hintereinander,
// jedes Experiment einmal pro Durchlauf, bevor Wiederholungen beginnen.
//
// Dazu der Status aus der Datenbank (Schema `mint`):
//   archiviert  – geschafft und nicht behalten: kommt nie wieder
//   nochmal     – auf der Nochmal-Liste: bleibt dort, wird nicht neu geplant
//   fundus      – verpasst: wird zu rund 20 % der Tage wieder eingeplant
// Ohne DB-Zugang läuft das Script mit einer Warnung im alten Verhalten weiter.
//
// Aufruf: node scripts/build-schedule.mjs [tage] [startdatum YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, closePools, hasDb } from "../lib/db.js";

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

// ---------- Status aus der Datenbank ----------
const status = {};
if (hasDb()) {
  try {
    for (const r of await query(`SELECT id, status FROM mint.themen`, [], { job: true })) {
      status[r.id] = r.status;
    }
  } catch (err) {
    console.warn(`⚠️  Datenbank nicht erreichbar (${err.message}) – plane ohne Status.`);
  }
} else {
  console.warn("⚠️  MINT_DB_URL_JOB fehlt – plane ohne Status (nichts wird ausgeschlossen).");
}

// Archiviertes ist erledigt, Behaltenes steht schon auf der Nochmal-Liste.
// Beides gehört nicht in die Tagesplanung.
const planbar = experiments.filter((e) => status[e.id] !== "archiviert" && status[e.id] !== "nochmal");
const fundusAlle = planbar.filter((e) => status[e.id] === "fundus");
const ausgeschlossen = experiments.length - planbar.length;

if (!planbar.length) {
  console.error("Alle Experimente sind archiviert oder auf der Nochmal-Liste – erst neue erzeugen (/mint-experimente).");
  process.exit(1);
}

/* Zwei getrennte Töpfe. Entscheidend ist, dass der reguläre Topf das
   Verpasste NICHT enthält – sonst kämen Fundus-Experimente über beide Wege
   herein und die Quote wäre faktisch viel höher als 20 %. */
const neuAlle = planbar.filter((e) => status[e.id] !== "fundus");

// Wer im bestehenden Schedule zuletzt selten dran war, kommt zuerst in den Pool.
const usedCount = Object.fromEntries(neuAlle.map((e) => [e.id, 0]));
for (const id of Object.values(schedule)) if (id in usedCount) usedCount[id]++;
const minUsed = usedCount.length === 0 ? 0 : Math.min(...Object.values(usedCount), Infinity);
let pool = neuAlle.filter((e) => usedCount[e.id] === minUsed);
let fundusPool = [...fundusAlle];

let prevKategorie = existingDates.length
  ? experiments.find((e) => e.id === schedule[existingDates[existingDates.length - 1]])?.kategorie ?? null
  : null;

/* Verpasstes soll wiederkommen, aber die Tageskarte muss überwiegend neu
   bleiben – sonst besteht ein Monat nur aus Wiederholungen. Deshalb rund 20 %
   aus dem Fundus, 80 % aus dem regulären Pool. */
const FUNDUS_QUOTE = 0.2;
let ausFundus = 0;

const date = new Date(start);
for (let i = 0; i < days; i++) {
  const wuerfel = rand();
  // Leerer Neu-Topf heißt: jedes ungenutzte Experiment war einmal dran. Dann
  // beginnt der nächste Durchlauf.
  if (pool.length === 0 && neuAlle.length) pool = [...neuAlle];
  if (fundusPool.length === 0 && fundusAlle.length) fundusPool = [...fundusAlle];

  /* Fundus, wenn der Würfel es sagt – oder wenn es schlicht nichts Neues mehr
     gibt (dann ist der Fundus die einzige Quelle, und die ⚠️-Push-Nachricht
     mahnt ohnehin neue Experimente an). */
  const fundusDran = (wuerfel < FUNDUS_QUOTE || pool.length === 0) && fundusPool.length > 0;
  const topf = fundusDran ? fundusPool : pool;

  let candidates = topf.filter((e) => e.kategorie !== prevKategorie);
  if (candidates.length === 0) candidates = topf;
  if (candidates.length === 0) candidates = planbar.filter((e) => e.kategorie !== prevKategorie);
  if (candidates.length === 0) candidates = planbar;

  const pick = candidates[Math.floor(rand() * candidates.length)];
  schedule[fmt(date)] = pick.id;
  if (fundusDran) ausFundus++;
  // Aus beiden Töpfen entfernen, damit ein Fundus-Experiment nicht kurz darauf
  // regulär nochmal drankommt.
  pool = pool.filter((e) => e.id !== pick.id);
  fundusPool = fundusPool.filter((e) => e.id !== pick.id);
  prevKategorie = pick.kategorie;
  date.setUTCDate(date.getUTCDate() + 1);
}

const sorted = Object.fromEntries(Object.entries(schedule).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(schedulePath, JSON.stringify(sorted, null, 2) + "\n");
const dates = Object.keys(sorted);
console.log(`Schedule: ${dates.length} Tage (${dates[0]} bis ${dates[dates.length - 1]})`);
console.log(`Neue Tage: ${days} – davon ${ausFundus} aus dem Fundus ` +
  `(${Math.round((ausFundus / days) * 100)} %, Ziel ${FUNDUS_QUOTE * 100} %)`);
if (ausgeschlossen) console.log(`Ausgeschlossen: ${ausgeschlossen} (archiviert oder auf der Nochmal-Liste)`);
await closePools();
