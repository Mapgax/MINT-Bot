#!/usr/bin/env node
/* Zugänge zur MINT-Bibliothek verwalten – der einzige Weg, BIB_ZUGAENGE zu ändern.

   Quelle der Wahrheit ist eine Notiz im lokalen Obsidian-Vault (Second Brain).
   Ihr Ordner steht in der .brainignore des Vaults, damit die Codes nie in die
   Cloud-Datenbank oder an ein LLM gehen. Aus der Notiz wird BIB_ZUGAENGE neu
   gebaut, per Vercel-CLI gesetzt und die Produktion neu ausgerollt – erst dann
   gilt die Änderung (auch das Sperren: alte Cookies prüfen gegen die Liste).

   Aufruf (im Ordner bibliothek/):
     node scripts/zugang.mjs neu <name>        neuen Code anlegen
     node scripts/zugang.mjs sperren <name>    Zugang entziehen
     node scripts/zugang.mjs liste             wer hat Zugang (ohne Codes)
     node scripts/zugang.mjs sync              Vercel an die Notiz angleichen
   Option --nur-lokal: nur die Notiz ändern, Vercel nicht anfassen. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";

const VAULT = process.env.OBSIDIAN_VAULT_PATH || "/Users/andreas/Projects/Obsidian/second_brain";
const ORDNER = "Manual Notes/Zugaenge";
const NOTIZ = process.env.BIB_VAULT_NOTE || join(VAULT, ORDNER, "MINT-Bibliothek.md");
const SEITE = process.env.BIB_URL || "https://mint-bibliothek.vercel.app";
const bibliothek = join(dirname(fileURLToPath(import.meta.url)), "..");

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

// Ohne 0/O, 1/l/I: der Code wird abgetippt, oft vom Handy.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const neuerCode = () =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

// ---------- Vault-Notiz ----------
const KOPF = `---
privacy: local-only
---
# MINT-Bibliothek – Zugänge

> **Nur lokal.** Der Ordner \`${ORDNER}/\` steht in der \`.brainignore\` – diese Notiz
> geht nie in die Datenbank und an kein LLM.
> **Nicht von Hand ändern.** Im Ordner \`MINT-Bot/bibliothek\`:
> \`node scripts/zugang.mjs neu <name>\` · \`sperren <name>\` · \`liste\`.
> Seite: ${SEITE}

| Name | Code | angelegt | Status |
|---|---|---|---|
`;

/** Sorgt dafür, dass der Ordner ignoriert wird, BEVOR ein Code dort landet. */
function sichereBrainignore() {
  const datei = join(VAULT, ".brainignore");
  const zeile = `${ORDNER}/`;
  const inhalt = existsSync(datei) ? readFileSync(datei, "utf8") : "";
  if (inhalt.split("\n").some((l) => l.trim() === zeile)) return;
  appendFileSync(datei, `${inhalt.endsWith("\n") || !inhalt ? "" : "\n"}
# ${heute()}: Zugangscodes (MINT-Bibliothek u. a.) – Geheimnisse bleiben lokal.
${zeile}
`);
  console.log(`.brainignore ergänzt: ${zeile}`);
}

function lies() {
  if (!existsSync(NOTIZ)) return [];
  return readFileSync(NOTIZ, "utf8").split("\n")
    .filter((l) => /^\|\s*[a-z0-9][a-z0-9-]*\s*\|/.test(l))
    .map((l) => {
      const [name, code, angelegt, status] = l.split("|").slice(1, 5).map((s) => s.trim().replace(/`/g, ""));
      return { name, code, angelegt, status };
    });
}

function schreibe(eintraege) {
  sichereBrainignore();
  mkdirSync(dirname(NOTIZ), { recursive: true });
  const zeilen = eintraege.map((e) => `| ${e.name} | \`${e.code}\` | ${e.angelegt} | ${e.status} |`);
  writeFileSync(NOTIZ, KOPF + zeilen.join("\n") + "\n");
}

const aktive = (eintraege) => eintraege.filter((e) => e.status === "aktiv");
const envWert = (eintraege) => aktive(eintraege).map((e) => `${e.name}:${e.code}`).join(",");

// ---------- Vercel ----------
function vercel(args, input) {
  return execFileSync("vercel", args, {
    cwd: bibliothek,
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function syncVercel(eintraege) {
  /* Ohne aktiven Zugang ein Platzhalter ohne gültigen Eintrag: dann kommt
     niemand mehr rein (Login meldet „nicht eingerichtet“, Cookies zählen nicht). */
  const wert = envWert(eintraege) || "niemand";
  try {
    vercel(["env", "rm", "BIB_ZUGAENGE", "production", "--yes"]);
  } catch { /* gab es noch nicht */ }
  vercel(["env", "add", "BIB_ZUGAENGE", "production"], wert);
  console.log("Vercel: BIB_ZUGAENGE gesetzt. Rolle Produktion neu aus …");
  vercel(["redeploy", SEITE.replace(/^https?:\/\//, ""), "--target", "production"]);
  console.log(`Vercel: neu ausgerollt – gilt ab jetzt auf ${SEITE}`);
}

// ---------- Befehle ----------
const [befehl, rohName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const nurLokal = process.argv.includes("--nur-lokal");
const name = String(rohName ?? "").toLowerCase().trim();
const eintraege = lies();

function brauchtName() {
  if (!/^[a-z0-9-]{2,40}$/.test(name)) {
    console.error("Name: 2–40 Zeichen, nur a-z, 0-9 und Bindestrich (z. B. familie-meier).");
    process.exit(1);
  }
}

switch (befehl) {
  case "neu": {
    brauchtName();
    const alt = eintraege.find((e) => e.name === name);
    if (alt?.status === "aktiv") {
      console.error(`"${name}" hat schon einen aktiven Code (siehe Vault-Notiz).`);
      process.exit(1);
    }
    const code = neuerCode();
    const eintrag = { name, code, angelegt: heute(), status: "aktiv" };
    schreibe(alt ? eintraege.map((e) => (e === alt ? eintrag : e)) : [...eintraege, eintrag]);
    console.log(`Vault-Notiz: ${name} angelegt.`);
    if (!nurLokal) syncVercel(lies());
    console.log(`\nZum Weitergeben:\n  ${SEITE}\n  Zugangscode: ${code}\n`);
    break;
  }
  case "sperren": {
    brauchtName();
    const e = eintraege.find((x) => x.name === name && x.status === "aktiv");
    if (!e) {
      console.error(`Kein aktiver Zugang "${name}".`);
      process.exit(1);
    }
    e.status = `gesperrt ${heute()}`;
    schreibe(eintraege);
    console.log(`Vault-Notiz: ${name} gesperrt.`);
    if (!nurLokal) syncVercel(eintraege);
    break;
  }
  case "liste": {
    if (!eintraege.length) console.log("Noch keine Zugänge.");
    for (const e of eintraege) console.log(`${e.status === "aktiv" ? "✅" : "⛔"} ${e.name.padEnd(20)} ${e.angelegt}  ${e.status}`);
    console.log(`\nCodes stehen in: ${NOTIZ}`);
    break;
  }
  case "sync": {
    syncVercel(eintraege);
    break;
  }
  default:
    console.log("Aufruf: node scripts/zugang.mjs neu <name> | sperren <name> | liste | sync  [--nur-lokal]");
    process.exit(befehl ? 1 : 0);
}
