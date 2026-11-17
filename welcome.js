/* Soteria by DrSkyle: first-run setup.
 * Four steps, each with one job: welcome, password, what to protect, done. */
"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const DVL = globalThis.DevilabsSoteria;
const L = DVL.logic;
const $ = (id) => document.getElementById(id);
const t = (key, vars) => DVL.i18n.t(key, vars);

const ORDER = ["welcome", "password", "choose", "done"];
const picked = new Set(); // collection ids
const custom = []; // extra hosts typed by hand
let S = null;

function go(step) {
  document.querySelectorAll(".step").forEach((s) => (s.hidden = s.dataset.step !== step));
  const i = ORDER.indexOf(step);
  document.querySelectorAll("#dots li").forEach((d, n) => d.classList.toggle("on", n === i));
  $("dots").hidden = i < 0;
  const heading = document.querySelector('.step[data-step="' + step + '"] h1');
  if (heading) heading.focus();
}

// ---------------------------------------------------------------- password

const fill = $("strength-fill");
const label = $("strength-label");
const LEVELS = [
  { w: "0%", c: "var(--danger)", k: "" },
  { w: "25%", c: "var(--danger)", k: "wel.str.weak" },
  { w: "50%", c: "var(--accent)", k: "wel.str.fair" },
  { w: "75%", c: "var(--accent)", k: "wel.str.good" },
  { w: "100%", c: "var(--ok)", k: "wel.str.strong" },
];

$("pw-new").addEventListener("input", (e) => {
  const lv = LEVELS[L.passwordScore(e.target.value)];
  fill.style.width = lv.w;
  fill.style.background = lv.c;
  label.textContent = lv.k ? t(lv.k) : "";
});

$("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw-new").value;
  const msg = $("pw-msg");
  msg.className = "msg err";
  if (pw.length < 8) return void (msg.textContent = t("wel.pw.short"));
  if (pw !== $("pw-confirm").value) return void (msg.textContent = t("wel.pw.mismatch"));
  $("pw-go").disabled = true;
  const salt = DVL.pw.newSalt();
  const passHash = await DVL.pw.hash(pw, salt);
  const cur = await api.storage.local.get({ firstActive: 0 });
  await api.storage.local.set({ passHash, salt, lockout: { fails: 0, until: 0, last: 0 }, firstActive: cur.firstActive || Date.now() });
  S.passHash = passHash;
  msg.className = "msg ok";
  msg.textContent = "";
  $("pw-go").disabled = false;
  go("choose");
});

// ---------------------------------------------------------------- choosing

function chosenHosts() {
  return [...new Set([...DVL.collections.hostsFor([...picked]), ...custom])].filter((h) => !S.sites.includes(h));
}

function renderChoose() {
  const tiles = $("tiles");
  tiles.textContent = "";
  for (const c of DVL.collections.COLLECTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.setAttribute("aria-pressed", String(picked.has(c.id)));
    const name = document.createElement("span");
    name.className = "headline";
    const nm = t("col." + c.id + ".name");
    name.textContent = nm.startsWith("col.") ? c.name : nm;
    const sub = document.createElement("span");
    sub.className = "caption";
    const bl = t("col." + c.id + ".blurb");
    sub.textContent = t("wel.col.sub", { blurb: bl.startsWith("col.") ? c.blurb : bl, n: c.hosts.length });
    b.append(name, sub);
    b.addEventListener("click", () => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
      renderChoose();
    });
    tiles.append(b);
  }

  const chips = $("chosen");
  chips.textContent = "";
  for (const h of custom) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", "true");
    chip.setAttribute("aria-label", h + " ×");
    chip.textContent = h + "  ×";
    chip.addEventListener("click", () => {
      custom.splice(custom.indexOf(h), 1);
      renderChoose();
    });
    chips.append(chip);
  }

  const n = chosenHosts().length;
  $("protect").textContent = n ? t(n === 1 ? "wel.protect.one" : "wel.protect.many", { n }) : t("wel.protect.none");
  $("protect").disabled = false;
  $("skip").hidden = n > 0;
}

$("custom-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = $("choose-msg");
  const host = L.normalizeHost($("custom").value);
  msg.className = "msg err";
  if (!host) return void (msg.textContent = t("wel.err.enter"));
  if (custom.includes(host) || S.sites.includes(host)) return void (msg.textContent = t("wel.err.dupe", { host }));
  custom.push(host);
  $("custom").value = "";
  msg.textContent = "";
  renderChoose();
});

$("protect").addEventListener("click", async () => {
  const msg = $("choose-msg");
  const hosts = chosenHosts();
  msg.className = "msg err";
  if (!hosts.length) return void finish();
  $("protect").disabled = true;
  msg.className = "msg";
  msg.textContent = t("wel.perm.ask");
  let granted = false;
  try {
    granted = await api.permissions.request({ origins: hosts.flatMap(L.hostOrigins) });
  } catch (e) {
    granted = false;
  }
  if (!granted) {
    msg.className = "msg err";
    msg.textContent = t("wel.perm.denied");
    $("protect").disabled = false;
    return;
  }
  S.sites = [...S.sites, ...hosts];
  await api.storage.local.set({ sites: S.sites });
  finish(hosts.length);
});

$("skip").addEventListener("click", () => finish(0));

async function finish(count) {
  await api.storage.local.set({ onboarded: true });
  if (count === 0) {
    $("done-title").textContent = t("wel.done.title2");
    $("done-lede").textContent = t("wel.done.lede2");
  }
  go("done");
}

// --------------------------------------------------------------------- init

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEYS = isMac ? "Command + Shift + L" : "Ctrl + Shift + L";

// Each tip starts with a short bold lead, then the detail. {keys} becomes a keyboard key.
function renderTips() {
  for (const li of document.querySelectorAll("[data-tip]")) {
    li.textContent = "";
    const text = t(li.dataset.tip, { keys: "\u0000" });
    const m = /^(.+?[.。])\s*(.*)$/s.exec(text);
    const lead = m ? m[1] : "";
    const rest = m ? m[2] : text;
    if (lead) {
      const s = document.createElement("strong");
      s.textContent = lead;
      li.append(s, " ");
    }
    rest.split("\u0000").forEach((part, i) => {
      if (i) {
        const k = document.createElement("kbd");
        k.textContent = KEYS;
        li.append(k);
      }
      li.append(part);
    });
  }
}
$("pw-toggle").addEventListener("click", () => {
  const show = $("pw-new").type === "password";
  $("pw-new").type = $("pw-confirm").type = show ? "text" : "password";
  $("pw-toggle").setAttribute("aria-pressed", String(show));
  $("pw-toggle").textContent = t(show ? "wel.pw.hide" : "wel.pw.show");
});
$("start").addEventListener("click", () => go("password"));
$("open-settings").addEventListener("click", () => api.runtime.openOptionsPage());
$("ready-settings").addEventListener("click", () => api.runtime.openOptionsPage());
$("close").addEventListener("click", () => window.close());

(async function init() {
  S = await api.storage.local.get({ passHash: null, sites: [], onboarded: false, language: "auto" });
  DVL.i18n.setLanguage(S.language);
  DVL.i18n.apply(document);
  renderTips();
  renderChoose();
  if (S.passHash && S.onboarded) go("ready");
  else if (S.passHash) go("choose"); // set a password earlier but didn't finish
  else go("welcome");
})();
