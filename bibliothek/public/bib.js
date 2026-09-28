/* MINT-Bibliothek – alle bisherigen Themen des MINT-Bots zum Nachmachen.
   Nur lesend: Abhaken wirkt ausschließlich im localStorage dieses Browsers,
   die Haupt-App und ihre Datenbank bekommen davon nichts mit.
   Karten-Darstellung aus ../../app.js übernommen – ohne Geschafft, Stern,
   Konfetti und Erklär-Helfer. Bei Design-Änderungen dort bitte hier mitziehen. */
"use strict";

const SENSORIK = {
  laut: { icon: "🔊", label: "laut" },
  nass: { icon: "💧", label: "nass" },
  matschig: { icon: "🟤", label: "matschig" },
  klebrig: { icon: "🍯", label: "klebrig" },
  riecht: { icon: "👃", label: "riecht" },
  knall: { icon: "💥", label: "knallt" },
  dunkel: { icon: "🌑", label: "dunkel" },
  sprudelt: { icon: "🫧", label: "sprudelt" },
  kalt: { icon: "❄️", label: "kalt" },
};

const KATEGORIEN = {
  "weltraum-physik": { icon: "🚀", label: "Weltraum & Physik" },
  "natur-tiere": { icon: "🐞", label: "Natur & Tiere" },
  technik: { icon: "⚙️", label: "Technik & Maschinen" },
  kuechenchemie: { icon: "🧪", label: "Küchen-Chemie" },
};

const SPRACHE = { de: "Deutsch", nl: "Niederländisch" };

const DAUER = [
  { wert: 10, label: "bis 10 Min" },
  { wert: 20, label: "bis 20 Min" },
];

const ORT = [
  { wert: "drinnen", label: "🏠 drinnen" },
  { wert: "draussen", label: "🌳 draußen" },
];

const leererFilter = () => ({
  q: "", kategorien: new Set(), ohne: new Set(), dauer: null, ort: null, video: false,
});

const state = {
  themen: [], byId: new Map(), suchtext: new Map(),
  filter: leererFilter(),
  filterOffen: false,
  listenScroll: 0,
};

// ---------- localStorage (nur Schritt-Häkchen, nur auf diesem Gerät) ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privates Fenster */ }
  },
};
const stepsKey = (id) => `bib.steps.${id}`;

// ---------- Rendering-Helfer ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// ---------- Suche ----------
/* "Münze", "Muenze" und "Munze" sollen dasselbe finden – auf Handys fehlen
   Umlaute oft, und wer aus der Schweiz tippt, schreibt ss statt ß. */
function normalisiere(text) {
  const klein = String(text).toLowerCase().replace(/ß/g, "ss");
  const umschrieben = klein.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  const ohneZeichen = klein.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `${umschrieben} ${ohneZeichen}`;
}

function suchtextFuer(exp) {
  return normalisiere([
    exp.titel, exp.fakt, exp.wasPassiert, exp.erklaerung, exp.elternInfo,
    ...exp.material, ...exp.schritte.map((s) => s.text),
    KATEGORIEN[exp.kategorie]?.label,
  ].join(" "));
}

function passt(exp) {
  const f = state.filter;
  if (f.kategorien.size && !f.kategorien.has(exp.kategorie)) return false;
  if (f.video && !exp.videos.length) return false;
  if (f.dauer && exp.dauerMinuten > f.dauer) return false;
  if (f.ort && exp.ort !== f.ort && exp.ort !== "egal") return false;
  if (exp.sensorik.some((s) => f.ohne.has(s))) return false;
  if (f.q) {
    const text = state.suchtext.get(exp.id);
    // Jedes Wort muss vorkommen; die Normalisierung liefert beide Schreibweisen.
    for (const wort of f.q.toLowerCase().split(/\s+/).filter(Boolean)) {
      const varianten = normalisiere(wort).split(" ");
      if (!varianten.some((v) => text.includes(v))) return false;
    }
  }
  return true;
}

const aktiveFilter = () => {
  const f = state.filter;
  return f.ohne.size + (f.dauer ? 1 : 0) + (f.ort ? 1 : 0) + (f.video ? 1 : 0);
};

// ---------- Eltern-Bereich ----------
function parentBox(exp) {
  const kat = KATEGORIEN[exp.kategorie];
  const badges = el("div", { class: "badge-row" },
    el("span", { class: "badge" }, `${kat.icon} ${kat.label}`),
    el("span", { class: "badge" }, `⏱️ ca. ${exp.dauerMinuten} Min`),
    exp.sensorik.map((s) => el("span", { class: "badge" }, `${SENSORIK[s].icon} ${SENSORIK[s].label}`)),
    exp.wartezeit ? el("span", { class: "badge warn" }, `⏳ Wartezeit: ${exp.wartezeit}`) : null,
    exp.ort === "draussen" ? el("span", { class: "badge" }, "🌳 draußen") : null,
  );
  const material = el("ul", { class: "material-list" },
    exp.material.map((m) =>
      el("li", {}, el("input", { type: "checkbox", "aria-label": `${m} bereitgelegt` }), m)
    )
  );
  return el("details", { class: "card parent-box", open: true },
    el("summary", {}, "👋 Für Eltern: Vorbereitung"),
    badges,
    el("p", { class: "parent-info" }, exp.elternInfo),
    el("div", { class: "section-title" }, "🧺 Das braucht ihr:"),
    material,
  );
}

function videoKnoepfe(exp) {
  return exp.videos.map((v) => el("a", {
    class: "btn btn-secondary video-btn",
    href: v.url,
    target: "_blank",
    rel: "noopener noreferrer",
  }, `🎬 Video vom ErklärBär ansehen${exp.videos.length > 1 || v.sprache !== "de" ? ` (${SPRACHE[v.sprache] ?? v.sprache})` : ""}`));
}

// ---------- Experiment-Karte ----------
function experimentCard(exp) {
  const frag = document.createDocumentFragment();
  frag.append(parentBox(exp));

  frag.append(el("div", { class: "card hero" },
    el("span", { class: "big-emoji" }, exp.emoji),
    el("h1", {}, exp.titel),
    el("p", { class: "fakt" }, exp.fakt),
  ));
  frag.append(...videoKnoepfe(exp));

  // Schritte mit Abhaken + Fortschrittsbalken
  let checked = new Set(store.get(stepsKey(exp.id), []));
  const progressLabel = el("div", { class: "progress" });
  const progressFill = el("div");
  const updateProgress = () => {
    progressLabel.textContent = `${checked.size} von ${exp.schritte.length} Schritten geschafft`;
    progressFill.style.width = `${(checked.size / exp.schritte.length) * 100}%`;
  };

  const knoepfe = exp.schritte.map((step, i) => {
    const btn = el("button", {
      class: "step" + (checked.has(i) ? " done" : ""),
      "aria-pressed": checked.has(i) ? "true" : "false",
      onclick: () => {
        if (checked.has(i)) checked.delete(i); else checked.add(i);
        btn.classList.toggle("done", checked.has(i));
        btn.setAttribute("aria-pressed", checked.has(i) ? "true" : "false");
        store.set(stepsKey(exp.id), [...checked]);
        updateProgress();
      },
    },
      el("span", { class: "step-num" }, String(i + 1)),
      el("span", { class: "step-emoji" }, step.emoji),
      el("span", { class: "step-text" }, step.text),
    );
    return btn;
  });
  updateProgress();

  const vonVorn = el("button", {
    class: "link-btn",
    onclick: () => {
      checked = new Set();
      store.set(stepsKey(exp.id), []);
      knoepfe.forEach((b) => { b.classList.remove("done"); b.setAttribute("aria-pressed", "false"); });
      updateProgress();
    },
  }, "↺ Von vorn anfangen");

  frag.append(
    el("div", { class: "section-title" }, "🧑‍🔬 Los geht's – Schritt für Schritt:"),
    progressLabel,
    el("div", { class: "progress-bar" }, progressFill),
    ...knoepfe,
    el("div", { class: "reset-row" }, vonVorn),
  );

  // Auflösung erst nach dem Ausprobieren aufklappen
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "👀 Was passiert da?"),
    el("p", {}, exp.wasPassiert),
  ));
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "🧠 Warum ist das so?"),
    el("p", {}, exp.erklaerung),
  ));
  return frag;
}

// ---------- Liste ----------
function listItem(exp) {
  const kat = KATEGORIEN[exp.kategorie];
  const sub = [`${kat.icon} ${kat.label}`, `⏱️ ${exp.dauerMinuten} Min`, exp.videos.length ? "🎬 Video" : null]
    .filter(Boolean).join(" · ");
  return el("a", { class: "list-item", href: `#/thema/${exp.id}` },
    el("span", { class: "li-emoji" }, exp.emoji),
    el("span", {}, exp.titel, el("span", { class: "li-sub" }, sub)),
  );
}

function chip(label, an, onclick, extraClass = "") {
  return el("button", { class: `chip ${extraClass}`.trim(), "aria-pressed": an ? "true" : "false", onclick }, label);
}

function sucheZeile() {
  const input = el("input", {
    type: "search",
    class: "suche-input",
    placeholder: "Thema suchen … (z. B. Magnet, Ballon, Wasser)",
    "aria-label": "Themen durchsuchen",
    value: state.filter.q,
  });
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filter.q = input.value.trim();
      renderTreffer();
    }, 150);
  });
  return el("div", { class: "suche-row" }, input);
}

function filterBereich() {
  const f = state.filter;
  const neu = () => { renderFilter(); renderTreffer(); };
  const toggle = (set, wert) => { if (set.has(wert)) set.delete(wert); else set.add(wert); neu(); };

  const kategorien = el("div", { class: "chip-row", role: "group", "aria-label": "Bereich" },
    Object.entries(KATEGORIEN).map(([key, k]) =>
      chip(`${k.icon} ${k.label}`, f.kategorien.has(key), () => toggle(f.kategorien, key))),
  );

  // Nur Sensorik-Merkmale anbieten, die in den Themen auch vorkommen.
  const vorhanden = new Set(state.themen.flatMap((t) => t.sensorik));
  const ohne = Object.entries(SENSORIK).filter(([key]) => vorhanden.has(key));

  const n = aktiveFilter();
  const details = el("details", {
    class: "filter-box",
    open: state.filterOffen,
    ontoggle: (ev) => { state.filterOffen = ev.currentTarget.open; },
  },
    el("summary", {}, `⚙️ Mehr Filter${n ? ` (${n} aktiv)` : ""}`),
    el("p", { class: "filter-label" }, "Anzeigen"),
    el("div", { class: "chip-row" },
      chip("🎬 mit Video", f.video, () => { f.video = !f.video; neu(); }),
      DAUER.map((d) => chip(`⏱️ ${d.label}`, f.dauer === d.wert, () => { f.dauer = f.dauer === d.wert ? null : d.wert; neu(); })),
      ORT.map((o) => chip(o.label, f.ort === o.wert, () => { f.ort = f.ort === o.wert ? null : o.wert; neu(); })),
    ),
    el("p", { class: "filter-label" }, "Ausblenden, was das Kind nicht mag"),
    el("div", { class: "chip-row" },
      ohne.map(([key, s]) => chip(`ohne ${s.icon} ${s.label}`, f.ohne.has(key), () => toggle(f.ohne, key), "ohne")),
    ),
  );
  return el("div", {}, kategorien, details);
}

let filterSlot = null;
let trefferSlot = null;

function renderFilter() {
  filterSlot.replaceChildren(filterBereich());
}

function renderTreffer() {
  const treffer = state.themen.filter(passt);
  const irgendwas = state.filter.q || state.filter.kategorien.size || aktiveFilter();
  const zuruecksetzen = () => {
    state.filter = leererFilter();
    renderListe();
  };
  trefferSlot.replaceChildren(
    el("div", { class: "treffer-zeile" },
      el("span", {}, irgendwas
        ? `${treffer.length} von ${state.themen.length} Themen`
        : `${state.themen.length} Themen · zuletzt dran zuerst`),
      irgendwas ? el("button", { class: "link-btn", onclick: zuruecksetzen }, "Filter zurücksetzen") : null,
    ),
    ...(treffer.length
      ? treffer.map(listItem)
      : [el("div", { class: "empty-state" },
          el("span", { class: "big-emoji" }, "🔍"),
          "Dazu gibt es noch kein Thema.", el("br"),
          el("button", { class: "link-btn", onclick: zuruecksetzen }, "Filter zurücksetzen"))]),
  );
}

function renderListe() {
  const view = document.getElementById("view");
  filterSlot = el("div");
  trefferSlot = el("div");
  view.replaceChildren(sucheZeile(), filterSlot, trefferSlot, fusszeile());
  renderFilter();
  renderTreffer();
}

function renderDetail(exp) {
  const view = document.getElementById("view");
  view.replaceChildren(
    el("a", { class: "back-btn", href: "#/" }, "← Zurück zur Übersicht"),
    experimentCard(exp),
    fusszeile(),
  );
}

function fusszeile() {
  return el("div", { class: "fuss" },
    el("button", {
      class: "link-btn",
      onclick: async () => {
        await fetch("/api/logout", { method: "POST" }).catch(() => {});
        location.replace("/login");
      },
    }, "Abmelden"),
  );
}

// ---------- Routing (#/thema/<id>) ----------
function route() {
  const m = /^#\/thema\/([a-z0-9-]+)$/.exec(location.hash);
  const exp = m && state.byId.get(m[1]);
  if (exp) {
    renderDetail(exp);
    window.scrollTo(0, 0);
  } else {
    renderListe();
    window.scrollTo(0, state.listenScroll);
  }
}

// Scroll-Position der Liste merken, damit „Zurück“ an derselben Stelle landet.
document.addEventListener("click", (ev) => {
  if (ev.target.closest?.(".list-item")) state.listenScroll = window.scrollY;
});

async function init() {
  // Das Scrollen steuert route() selbst – sonst landet ein Neuladen mitten im Ablauf.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  try {
    const res = await fetch("/api/themen", { credentials: "same-origin" });
    if (res.status === 401) { location.replace("/login"); return; }
    if (!res.ok) throw new Error(`Fehler ${res.status}`);
    const { themen } = await res.json();
    state.themen = themen;
    state.byId = new Map(themen.map((t) => [t.id, t]));
    state.suchtext = new Map(themen.map((t) => [t.id, suchtextFuer(t)]));
    document.getElementById("header-info").textContent = `${themen.length} Themen`;
    window.addEventListener("hashchange", route);
    route();
  } catch {
    document.getElementById("view").replaceChildren(
      el("div", { class: "empty-state" }, "🙁 Die Themen konnten nicht geladen werden. Bitte Seite neu laden."));
  }
}

init();
