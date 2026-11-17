/* Soteria by DrSkyle: settings.
 * The whole page sits behind the password. Nothing sensitive is rendered into
 * the page until it is unlocked, and it locks again on the panic key. */
"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;
const DVL = globalThis.DevilabsSoteria;
const L = DVL.logic;
const C = DVL.collections;
const CONFIG = DVL.config;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

let S = null; // storage snapshot
let unlocked = false;
const openHosts = new Set();
const SESSION_KEY = "devilabs-soteria:settings-unlocked";

// ------------------------------------------------------------------ helpers

function h(tag, props, children) {
  const node = document.createElement(tag);
  for (const k of Object.keys(props || {})) {
    if (k === "class") node.className = props[k];
    else if (k === "text") node.textContent = props[k];
    else node.setAttribute(k, props[k]);
  }
  for (const c of children || []) if (c) node.append(c);
  return node;
}

function icon(d, size) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (size) s.setAttribute("class", size);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2.4");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}

function say(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

const send = (m) => {
  try {
    return Promise.resolve(api.runtime.sendMessage(m));
  } catch (e) {
    return Promise.reject(e);
  }
};

async function load() {
  S = await api.storage.local.get(L.DEFAULTS);
}

const sanctuaryNow = () => !!S.sanctuaryEnabled && L.inSanctuaryWindow(S.sanctuaryStart, S.sanctuaryEnd, new Date(), S.sanctuaryDays);

// -------------------------------------------------------------- navigation

function show(panel) {
  $$(".panel").forEach((p) => (p.hidden = p.id !== "panel-" + panel));
  $$("#nav button").forEach((b) => {
    if (b.dataset.panel === panel) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  try {
    history.replaceState(null, "", "#" + panel);
  } catch (e) {
    /* ignore */
  }
  if (panel === "activity") renderActivity();
  if (panel === "insights") renderInsights();
  if (panel === "home") renderHome();
}

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-panel]");
  if (b) show(b.dataset.panel);
});
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) show(g.dataset.goto);
});

// ------------------------------------------------------------- the gate

const gate = { epoch: 0, timer: null };

function openGate() {
  unlocked = false;
  wipe();
  document.body.classList.add("gated");
  $("#shell").inert = true;
  $("#gate").hidden = false;
  $("#gate-input").value = "";
  say($("#gate-msg"), "");
  setTimeout(() => $("#gate-input").focus(), 30);
}

function closeGate() {
  document.body.classList.remove("gated");
  $("#shell").inert = false;
  $("#gate").hidden = true;
}

// Nothing sensitive stays in the page while it's locked.
function wipe() {
  ["#site-list", "#today-list", "#attempt-list", "#charts", "#home-chart", "#home-next", "#week-head", "#week-stats", "#week-chart", "#week-text", "#week-reasons", "#week-next", "#week-hint", "#week-send-msg", "#home-outlook", "#ask-answer", "#ins-hours", "#ins-brain", "#ins-tips", "#ins-alerts", "#ins-headline", "#list-status", "#share-msg", "#partner-msg", "#approve-msg"].forEach((s) => ($(s).textContent = ""));
  ["#note", "#ask-input", "#owner-name", "#reset-pw", "#reset-pw2", "#share-code", "#partner-code", "#partner-name", "#approve-req", "#approve-reply"].forEach((s) => ($(s).value = ""));
  $("#mood").textContent = "";
  $("#home-num").textContent = "";
}

// ------------------------------------------------------ forgotten password

let resetApproved = false;

function renderReset() {
  const st = L.resetStatus(S.resetAt, Date.now());
  const ready = st.state === "ready" || resetApproved;
  $("#reset-new").hidden = !ready;
  $("#reset-start").hidden = st.state !== "none" || resetApproved;
  $("#reset-partner").hidden = !S.partner || ready;
  $("#reset-text").textContent = ready
    ? "Set a new password."
    : st.state === "waiting"
      ? "You can set a new password in " + st.hoursLeft + (st.hoursLeft === 1 ? " hour." : " hours.") + " The wait is there so a hard moment can't be used to skip the lock."
      : "You can set a new password after a 24-hour wait" + (S.partner ? ", or straight away if your partner approves." : ".");
}
$("#forgot").addEventListener("click", () => {
  $("#reset").hidden = !$("#reset").hidden;
  if (!$("#reset").hidden) renderReset();
});
$("#reset-start").addEventListener("click", async () => {
  S.resetAt = Date.now() + L.RESET_WAIT_MS;
  await api.storage.local.set({ resetAt: S.resetAt });
  renderReset();
});
$("#reset-partner").addEventListener("click", async () => {
  if (await requireApproval("__reset__")) {
    resetApproved = true;
    renderReset();
  }
});
$("#reset-set").addEventListener("click", async () => {
  const msg = $("#reset-msg");
  const a = $("#reset-pw").value, b = $("#reset-pw2").value;
  if (!(resetApproved || L.resetStatus(S.resetAt, Date.now()).state === "ready")) return say(msg, "The wait isn't over yet.", "err");
  if (a.length < 8) return say(msg, "Use at least 8 characters.", "err");
  if (a !== b) return say(msg, "The passwords don't match.", "err");
  const salt = DVL.pw.newSalt();
  const { lockEpoch } = await api.storage.local.get({ lockEpoch: 0 });
  await api.storage.local.set({ passHash: await DVL.pw.hash(a, salt), salt, lockout: { fails: 0, until: 0, last: 0 }, resetAt: 0, unlocks: {}, manageUntil: 0, lockEpoch: lockEpoch + 1 });
  resetApproved = false;
  say(msg, "New password saved.", "ok");
  setTimeout(() => location.reload(), 900);
});

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#gate-input");
  const msg = $("#gate-msg");
  if (!input.value || gate.timer) return;
  let res;
  try {
    res = await send({ type: L.MSG.verifyPassword, attempt: input.value, site: "settings" });
  } catch (err) {
    res = { ok: false, error: "unavailable" };
  }
  if (res && res.ok) {
    try {
      sessionStorage.setItem(SESSION_KEY, String(S.lockEpoch) + (sanctuaryNow() ? ":s" : ""));
    } catch (err) {
      /* ignore */
    }
    closeGate();
    return start();
  }
  input.value = "";
  const box = $(".gate-box");
  box.classList.remove("shake");
  void box.offsetWidth;
  box.classList.add("shake");
  if (res && res.error === "partner-only") return say(msg, "Quiet hours: settings stay locked until they end. Your partner can still unlock sites from the lock screen.", "err");
  if (res && res.cooldown > 0) {
    let left = res.cooldown;
    input.disabled = true;
    const paint = () => say(msg, "Too many attempts. Try again in " + left + "s.", "err");
    paint();
    gate.timer = setInterval(() => {
      if (--left <= 0) {
        clearInterval(gate.timer);
        gate.timer = null;
        input.disabled = false;
        say(msg, "");
        input.focus();
      } else paint();
    }, 1000);
  } else say(msg, res && res.error ? "Soteria couldn't check that. Try again." : "Incorrect password.", "err");
  input.focus();
});

function unlockedThisSession() {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (v === null) return false;
    return v.replace(/:s$/, "") === String(S.lockEpoch) && (!sanctuaryNow() || v.endsWith(":s"));
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------- sites

function siteMeta(host) {
  const now = new Date();
  const snoozedUntil = (S.snoozes || {})[host] || 0;
  const st = L.limitStatus(S, host, now);
  if (snoozedUntil > now.getTime()) return { text: "Snoozed until " + new Date(snoozedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), warn: false };
  if (st.hasLimit) {
    const used = L.formatDuration(st.used);
    return { text: st.limited ? "Daily limit reached" : used + " of " + L.formatDuration(st.limit + st.extra) + " today", warn: st.limited };
  }
  return { text: "Locked", warn: false };
}

function detailRow(label, control, forId) {
  return h("div", { class: "detail" }, [h(forId ? "label" : "span", forId ? { for: forId, text: label } : { text: label }), control]);
}

function siteRow(host, index) {
  const open = openHosts.has(host);
  const id = "site-" + index;
  const meta = siteMeta(host);
  const head = h("button", { class: "site-head", type: "button", "aria-expanded": String(open), "aria-controls": id + "-detail" }, [
    h("span", { class: "site-text" }, [h("span", { class: "site-name", text: host }), h("span", { class: "site-meta" + (meta.warn ? " warn" : ""), "data-meta": host, text: meta.text })]),
    icon("M9 5l7 7-7 7", "site-chev"),
  ]);
  const detail = h("div", { class: "site-detail", id: id + "-detail" });
  detail.hidden = !open;

  head.addEventListener("click", () => {
    const now = detail.hidden;
    detail.hidden = !now;
    head.setAttribute("aria-expanded", String(now));
    now ? openHosts.add(host) : openHosts.delete(host);
  });

  // Snooze
  const snoozedUntil = (S.snoozes || {})[host] || 0;
  const snoozeCtl = h("div", { class: "ctl" });
  if (snoozedUntil > Date.now()) {
    const end = h("button", { class: "btn small", type: "button", text: "End snooze" });
    end.addEventListener("click", async () => {
      const s = { ...S.snoozes };
      delete s[host];
      await api.storage.local.set({ snoozes: s });
    });
    snoozeCtl.append(end);
  } else {
    const sel = h("select", { class: "select", "aria-label": "Snooze length for " + host });
    [["15", "15 minutes"], ["60", "1 hour"], ["240", "4 hours"]].forEach(([v, t]) => sel.append(h("option", { value: v, text: t })));
    sel.value = "60";
    const go = h("button", { class: "btn small", type: "button", text: "Snooze" });
    go.addEventListener("click", async () => {
      await api.storage.local.set({ snoozes: { ...S.snoozes, [host]: Date.now() + Number(sel.value) * 60000 } });
    });
    snoozeCtl.append(sel, go);
  }
  detail.append(detailRow("Snooze", snoozeCtl));

  // Daily limit
  const limit = h("select", { class: "select", id: id + "-limit" });
  [["0", "No limit"], ["15", "15 minutes"], ["30", "30 minutes"], ["60", "1 hour"], ["120", "2 hours"], ["240", "4 hours"]].forEach(([v, t]) => limit.append(h("option", { value: v, text: t })));
  limit.value = String((S.allowances || {})[host] || 0);
  limit.addEventListener("change", async () => {
    const a = { ...S.allowances };
    if (limit.value === "0") delete a[host];
    else a[host] = Number(limit.value);
    await api.storage.local.set({ allowances: a });
  });
  const limitLabel = h("span", { text: "Daily limit" });
  detail.append(h("div", { class: "detail" }, [limitLabel, h("div", { class: "ctl" }, [limit])]));

  // Group
  const group = h("input", { class: "input", id: id + "-group", type: "text", placeholder: "None", maxlength: "40", autocomplete: "off" });
  group.value = (S.siteGroups || {})[host] || "";
  group.addEventListener("change", async () => {
    const g = { ...S.siteGroups };
    const v = group.value.trim().slice(0, 40);
    if (v) g[host] = v;
    else delete g[host];
    await api.storage.local.set({ siteGroups: g });
  });
  detail.append(detailRow("Group", h("div", { class: "ctl" }, [group]), id + "-group"));

  // Remove (two taps, so a stray click can't remove protection)
  const rm = h("button", { class: "btn danger small", type: "button", text: "Remove site" });
  let armed = null;
  rm.addEventListener("click", async () => {
    if (!armed) {
      rm.textContent = "Tap again to remove";
      armed = setTimeout(() => {
        armed = null;
        rm.textContent = "Remove site";
      }, 3000);
      return;
    }
    clearTimeout(armed);
    await api.storage.local.set({ sites: S.sites.filter((s) => s !== host) });
  });
  detail.append(h("div", { class: "detail" }, [h("span", {}), rm]));

  return h("div", { class: "site" }, [head, detail]);
}

function renderSites() {
  const list = $("#site-list");
  list.textContent = "";
  $("#site-empty").hidden = S.sites.length > 0;
  let i = 0;
  const groups = L.groupSites(S.sites, S.siteGroups);
  const showTitles = groups.length > 1 || (groups[0] && groups[0].name);
  for (const g of groups) {
    if (showTitles) list.append(h("h3", { class: "group-title", text: g.name || "Ungrouped" }));
    const box = h("div", { class: "group" });
    for (const host of g.hosts) box.append(siteRow(host, i++));
    list.append(box);
  }
}

// Only the status lines change when usage ticks in: re-rendering the list
// would close dropdowns that someone is in the middle of using.
function refreshMeta() {
  $$("[data-meta]").forEach((el) => {
    const m = siteMeta(el.dataset.meta);
    el.textContent = m.text;
    el.classList.toggle("warn", m.warn);
  });
}

async function grantAndAdd(hosts, msgEl, groupName) {
  hosts = [...new Set(hosts)].filter((x) => !S.sites.includes(x));
  if (!hosts.length) return false;
  say(msgEl, "Your browser will ask for permission…");
  let granted = false;
  try {
    granted = await api.permissions.request({ origins: hosts.flatMap(L.hostOrigins) });
  } catch (e) {
    granted = false;
  }
  if (!granted) {
    say(msgEl, "Soteria needs that permission to protect " + (hosts.length === 1 ? hosts[0] : "these sites") + ".", "err");
    return false;
  }
  const patch = { sites: [...S.sites, ...hosts] };
  if (groupName) {
    patch.siteGroups = { ...S.siteGroups };
    hosts.forEach((x) => (patch.siteGroups[x] = patch.siteGroups[x] || groupName));
  }
  await api.storage.local.set(patch);
  say(msgEl, hosts.length === 1 ? "Protecting " + hosts[0] + "." : "Protecting " + hosts.length + " sites.", "ok");
  return true;
}

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#site-msg");
  const host = L.normalizeHost($("#site-input").value);
  if (!host) return say(msg, "Enter a site like example.com.", "err");
  if (S.sites.includes(host)) return say(msg, host + " is already protected.", "err");
  if (!S.passHash) return say(msg, "Create a password first, under Security.", "err");
  if (await grantAndAdd([host], msg)) $("#site-input").value = "";
});

// ------------------------------------------------------------ collections

const dlg = $("#collections");
const picked = new Set();

function renderCollections() {
  const box = $("#col-list");
  box.textContent = "";
  for (const c of C.COLLECTIONS) {
    const fresh = c.hosts.filter((x) => !S.sites.includes(x));
    const added = fresh.length === 0;
    const b = h("button", { class: "col", type: "button", "aria-pressed": String(picked.has(c.id)) }, [
      h("span", { class: "row-text" }, [h("span", { class: "row-title", text: c.name }), h("span", { class: "row-sub", text: added ? "All added" : c.blurb + " · " + fresh.length + " new" })]),
      h("span", { class: "col-check" }, [icon("M5 12l5 5 9-10")]),
    ]);
    b.disabled = added;
    b.addEventListener("click", () => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
      renderCollections();
    });
    box.append(b);
  }
  const n = C.hostsFor([...picked]).filter((x) => !S.sites.includes(x)).length;
  $("#col-add").disabled = n === 0;
  $("#col-add").textContent = n ? "Add " + n + (n === 1 ? " site" : " sites") : "Add sites";
}

$("#open-collections").addEventListener("click", () => {
  if (!S.passHash) return say($("#site-msg"), "Create a password first, under Security.", "err");
  picked.clear();
  renderCollections();
  dlg.showModal();
});
$("#col-cancel").addEventListener("click", () => dlg.close());
$("#col-add").addEventListener("click", async () => {
  const ids = [...picked];
  const hosts = C.hostsFor(ids).filter((x) => !S.sites.includes(x));
  dlg.close();
  // Hosts added through a collection get that collection's name as their group.
  const first = C.COLLECTIONS.find((c) => ids.length === 1 && c.id === ids[0]);
  await grantAndAdd(hosts, $("#site-msg"), first && first.name);
});

// ------------------------------------------------------------------ sharing

const shareDlg = $("#share");
let shareHosts = [];

function previewShare() {
  const code = $("#share-code").value.trim();
  const msg = $("#share-msg");
  shareHosts = [];
  $("#share-import").disabled = true;
  if (!code) return (msg.textContent = "");
  const r = C.decodeShare(code);
  if (!r.ok) return (msg.textContent = r.error);
  shareHosts = r.hosts.filter((x) => !S.sites.includes(x));
  msg.textContent = r.name + ": " + r.hosts.length + (r.hosts.length === 1 ? " site" : " sites") + (shareHosts.length < r.hosts.length ? ", " + shareHosts.length + " new" : "");
  $("#share-import").disabled = shareHosts.length === 0;
  $("#share-import").textContent = shareHosts.length ? "Add " + shareHosts.length + (shareHosts.length === 1 ? " site" : " sites") : "Already added";
}

$("#open-share").addEventListener("click", () => {
  $("#share-code").value = "";
  $("#share-msg").textContent = "";
  $("#share-import").textContent = "Import";
  $("#share-import").disabled = true;
  shareDlg.showModal();
});
$("#share-close").addEventListener("click", () => shareDlg.close());
$("#share-make").addEventListener("click", () => {
  if (!S.sites.length) return ($("#share-msg").textContent = "Protect a few sites first, then you can share the list.");
  $("#share-code").value = C.encodeShare($("#share-name").value, S.sites);
  $("#share-msg").textContent = "Code made for " + Math.min(S.sites.length, C.MAX_SHARED) + " sites. Copy it and send it to a friend.";
  $("#share-import").disabled = true;
});
$("#share-copy").addEventListener("click", async () => {
  const v = $("#share-code").value;
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    $("#share-msg").textContent = "Copied.";
  } catch (e) {
    $("#share-code").select();
    $("#share-msg").textContent = "Select the code and copy it.";
  }
});
$("#share-code").addEventListener("input", previewShare);
$("#share-import").addEventListener("click", async () => {
  if (!S.passHash) return ($("#share-msg").textContent = "Create a password first, under Security.");
  const r = C.decodeShare($("#share-code").value);
  const hosts = shareHosts.slice();
  shareDlg.close();
  await grantAndAdd(hosts, $("#site-msg"), r.ok ? r.name : undefined);
});

// ---------------------------------------------------------------- security

const fill = $("#strength-fill");
const slabel = $("#strength-label");
const LEVELS = [
  { w: "0%", c: "var(--danger)", t: "" },
  { w: "25%", c: "var(--danger)", t: "Weak" },
  { w: "50%", c: "var(--accent)", t: "Fair" },
  { w: "75%", c: "var(--accent)", t: "Good" },
  { w: "100%", c: "var(--ok)", t: "Strong" },
];
$("#pw-new").addEventListener("input", (e) => {
  const lv = LEVELS[L.passwordScore(e.target.value)];
  fill.style.width = lv.w;
  fill.style.background = lv.c;
  slabel.textContent = lv.t;
});

$("#pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#pw-msg");
  const next = $("#pw-new").value;
  if (S.passHash) {
    const cur = $("#pw-current").value;
    if (!cur) return say(msg, "Enter your current password.", "err");
    const res = await send({ type: L.MSG.verifyPassword, attempt: cur, site: "settings" }).catch(() => ({ ok: false }));
    if (!res.ok) return say(msg, res.cooldown ? "Too many attempts. Try again in " + res.cooldown + "s." : "Current password is incorrect.", "err");
  }
  if (next.length < 8) return say(msg, "Use at least 8 characters.", "err");
  if (next !== $("#pw-confirm").value) return say(msg, "The passwords don't match.", "err");
  const salt = DVL.pw.newSalt();
  await api.storage.local.set({ passHash: await DVL.pw.hash(next, salt), salt, lockout: { fails: 0, until: 0, last: 0 }, firstActive: S.firstActive || Date.now() });
  ["#pw-current", "#pw-new", "#pw-confirm"].forEach((s) => ($(s).value = ""));
  fill.style.width = "0";
  slabel.textContent = "";
  say(msg, next.toLowerCase() === "correcthorsebatterystaple" ? "Password saved. Also, nice reference." : "Password saved.", "ok");
});

$("#disguise").addEventListener("change", (e) => api.storage.local.set({ disguise: e.target.checked }));
$("#autorelock").addEventListener("change", (e) => api.storage.local.set({ autoRelockMinutes: Number(e.target.value) }));
$("#remember").addEventListener("change", (e) => api.storage.local.set({ rememberMinutes: Number(e.target.value), unlocks: {} }));
$("#idlerelock").addEventListener("change", (e) => api.storage.local.set({ idleRelockMinutes: Number(e.target.value) }));

// ----------------------------------------------------------------- partner

// Ask the partner to approve a change. Resolves true only with a valid reply.
const RELEASE_DAYS = 7;
async function requireApproval(site = "__partner__") {
  // If the person started the "can't reach my partner" wait and it has passed,
  // they can make the change without them.
  if (S.partnerReleaseAt && Date.now() >= S.partnerReleaseAt) return true;
  const dlg = $("#approve");
  const msg = $("#approve-msg");
  const made = await send({ type: L.MSG.askPartner, site }).catch(() => null);
  if (!made || !made.ok) return false;
  $("#approve-req").value = made.request;
  $("#approve-reply").value = "";
  msg.textContent = "";
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    const pending = () => (S.partnerReleaseAt && S.partnerReleaseAt > Date.now() ? Math.ceil((S.partnerReleaseAt - Date.now()) / 86400000) : 0);
    if (pending()) msg.textContent = "You can make this change without your partner in " + pending() + (pending() === 1 ? " day." : " days.");
    $("#approve-unreachable").onclick = async () => {
      if (!pending()) {
        S.partnerReleaseAt = Date.now() + RELEASE_DAYS * 86400000;
        await api.storage.local.set({ partnerReleaseAt: S.partnerReleaseAt });
      }
      msg.textContent = "Okay. In " + pending() + (pending() === 1 ? " day" : " days") + " you can make this change without them. Until then you still need their reply.";
    };
    $("#approve-cancel").onclick = () => finish(false);
    dlg.oncancel = () => finish(false);
    $("#approve-copy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(made.request);
        msg.textContent = "Copied.";
      } catch (e) {
        $("#approve-req").select();
      }
    };
    $("#approve-go").onclick = async () => {
      const r = await send({ type: L.MSG.verifyPassword, site, partnerRequest: made.request, partnerResponse: $("#approve-reply").value }).catch(() => ({ ok: false }));
      if (r && r.ok) return finish(true);
      msg.textContent = r && r.cooldown ? "Too many attempts. Try again in " + r.cooldown + "s." : "That reply didn't match. Ask your partner to approve this exact request.";
    };
    dlg.showModal();
  });
}

// Changes that would weaken the partner's role need the partner to agree, but
// only once a partner exists and has asked to be the guard for quiet hours.
const guardPartner = async () => (S.partner && S.partnerOnlyQuiet ? requireApproval() : true);

function renderPartner() {
  $("#guard-ext").checked = !!S.guardExtensions;
  $("#language").value = S.language || "auto";
  $("#owner-name").value = S.ownerName || "";
  const has = !!S.partner;
  $("#partner-setup").hidden = has;
  $("#partner-active").hidden = !has;
  if (has) {
    $("#partner-who").textContent = (S.partner.name || "Your partner") + " (key ending " + DVL.partner.fingerprint(S.partner.key) + ")";
    $("#partner-only").checked = !!S.partnerOnlyQuiet;
  }
}

// ---- language
{
  const sel = $("#language");
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Automatic";
  sel.append(auto);
  for (const [code, name] of Object.entries(DVL.localeNames)) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = name;
    sel.append(o);
  }
  sel.addEventListener("change", () => api.storage.local.set({ language: sel.value }));
}
$("#owner-name").addEventListener("change", (e) => api.storage.local.set({ ownerName: e.target.value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30) }));

$("#guard-ext").addEventListener("change", async (e) => {
  const want = e.target.checked;
  if (!want) return void (await api.storage.local.set({ guardExtensions: false }));
  if (!S.passHash) {
    e.target.checked = false;
    return say($("#partner-msg"), "Create a password first, above.", "err");
  }
  // Must be asked for straight from the click, before anything else is awaited.
  let granted = false;
  try {
    granted = await api.permissions.request({ permissions: ["tabs"] });
  } catch (err) {
    granted = false;
  }
  if (!granted) {
    e.target.checked = false;
    return say($("#partner-msg"), "Soteria needs permission to see tab addresses for this. It wasn't granted.", "err");
  }
  await api.storage.local.set({ guardExtensions: true });
});

$("#partner-save").addEventListener("click", async () => {
  const msg = $("#partner-msg");
  const code = $("#partner-code").value.trim();
  if (!S.passHash) return say(msg, "Create a password first, above.", "err");
  if (!(await DVL.partner.checkPublicCode(code))) return say(msg, "That isn't a valid partner code. Ask them to copy it again from the partner page.", "err");
  const name = $("#partner-name").value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);
  await api.storage.local.set({ partner: { key: code.replace(/\s+/g, ""), name, since: Date.now() } });
  $("#partner-code").value = "";
  $("#partner-name").value = "";
  say(msg, "Partner saved.", "ok");
});

$("#partner-page").addEventListener("click", async () => {
  const msg = $("#partner-msg");
  if (CONFIG.partnerUrl) {
    try {
      await navigator.clipboard.writeText(CONFIG.partnerUrl);
      return say(msg, "Link copied. Send it to your partner.", "ok");
    } catch (e) {
      return say(msg, "Send your partner this link: " + CONFIG.partnerUrl, "ok");
    }
  }
  say(msg, "Send your partner the file partner.html from the Soteria download. They open it in any browser.", "ok");
});

$("#partner-only").addEventListener("change", async (e) => {
  const want = e.target.checked;
  if (!want && S.partnerOnlyQuiet && !(await requireApproval())) return void (e.target.checked = true);
  if (want && S.sanctuaryEnabled && L.sanctuaryHours(S.sanctuaryStart, S.sanctuaryEnd) > 12) {
    e.target.checked = false;
    return say($("#partner-msg"), "Your quiet hours are longer than 12 hours, which could lock you out of settings. Shorten them first, under Schedule.", "err");
  }
  if (want && !S.sanctuaryEnabled) say($("#partner-msg"), "Turn on quiet hours under Schedule too, or this has no effect.", "err");
  await api.storage.local.set({ partnerOnlyQuiet: want });
});

$("#partner-remove").addEventListener("click", async () => {
  if (!(await requireApproval())) return;
  await api.storage.local.set({ partner: null, partnerOnlyQuiet: false, asks: {}, partnerReleaseAt: 0 });
  say($("#partner-msg"), "Partner removed.", "ok");
});

// ---------------------------------------------------------------- schedule

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function renderSchedule() {
  $("#sanctuary").checked = !!S.sanctuaryEnabled;
  $("#sanc-start").value = S.sanctuaryStart;
  $("#sanc-end").value = S.sanctuaryEnd;
  const box = $("#days");
  box.textContent = "";
  DAY_NAMES.forEach((name, n) => {
    const b = h("button", { class: "chip", type: "button", "aria-pressed": String(S.sanctuaryDays.includes(n)), "aria-label": name, text: name.slice(0, 3) });
    b.addEventListener("click", async () => {
      if (!(await guardPartner())) return;
      const set = new Set(S.sanctuaryDays);
      set.has(n) ? set.delete(n) : set.add(n);
      await api.storage.local.set({ sanctuaryDays: [...set].sort() });
    });
    box.append(b);
  });
}

$("#sanctuary").addEventListener("change", async (e) => {
  if (!(await guardPartner())) return renderSchedule();
  api.storage.local.set({ sanctuaryEnabled: e.target.checked });
});
$("#sanc-start").addEventListener("change", async (e) => {
  if (!e.target.value) return;
  if (!(await guardPartner())) return renderSchedule();
  api.storage.local.set({ sanctuaryStart: e.target.value });
});
$("#sanc-end").addEventListener("change", async (e) => {
  if (!e.target.value) return;
  if (!(await guardPartner())) return renderSchedule();
  api.storage.local.set({ sanctuaryEnd: e.target.value });
});

// -------------------------------------------------------------------- week

let weekText = "";

function renderWeek(now) {
  const r = DVL.summary.build(S.brain || DVL.brain.blank(), S, now);
  const key = DVL.summary.weekKey(now);
  $("#week-head").textContent = r.headline;
  const body = $("#week-text");
  body.textContent = "";
  for (const p of r.paragraphs) body.append(h("p", { class: "week-p", text: p }));
  const stats = $("#week-stats"), chart = $("#week-chart"), rs = $("#week-reasons");
  stats.textContent = "";
  chart.textContent = "";
  rs.textContent = "";
  $("#week-next").hidden = true;
  $("#week-copy").hidden = !r.ready;
  $("#week-send").hidden = !(r.ready && S.partner);
  const hint = $("#week-hint");
  const dayNow = new Date(now).getDay();
  hint.hidden = !(r.ready && S.partner && (dayNow === 0 || dayNow === 1) && S.checkinSent !== key);
  if (!hint.hidden) hint.textContent = "A good time to send your week to " + (S.partner.name || "your partner") + ".";
  $("#week-image").hidden = !r.ready;
  weekText = r.text || "";
  if (r.ready) {
    for (const s of r.stats) stats.append(h("div", { class: "week-stat" }, [h("span", { class: "week-stat-num", text: String(s.value) }), h("span", { class: "muted", text: s.label })]));
    chart.append(barChart(r.bars.map((b) => ({ date: b.label, value: b.value })), "Unlocks per day this week", (v) => v + (v === 1 ? " unlock" : " unlocks")));
    chart.append(h("div", { class: "chart-title" }, r.bars.map((b) => h("span", { class: "muted", text: b.label }))));
    if (r.reasons.length) {
      rs.append(h("span", { class: "muted", text: "Why you went in: " }));
      rs.append(document.createTextNode(r.reasons.map((x) => x.label + " " + x.n).join("  ·  ")));
    }
    if (r.nextStep) {
      $("#week-next").textContent = r.nextStep;
      $("#week-next").hidden = false;
    }
  }
  // A new summary appears each Sunday. The dot clears once it has been seen.
  const unseen = r.ready && S.summarySeen !== key;
  $("#home-dot").hidden = !unseen;
  if (unseen && !$("#panel-home").hidden) api.storage.local.set({ summarySeen: key });
}

$("#week-image").addEventListener("click", () => {
  const r = DVL.summary.build(S.brain || DVL.brain.blank(), S, Date.now());
  if (!r.ready) return;
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const label = "Week of " + start.toLocaleDateString([], { month: "short", day: "numeric" });
  const canvas = document.createElement("canvas");
  canvas.width = DVL.card.W;
  canvas.height = DVL.card.H;
  DVL.card.draw(canvas.getContext("2d"), DVL.card.W, DVL.card.H, DVL.card.cardData(r, label));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "soteria-week.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
});

$("#week-send").addEventListener("click", async () => {
  const r = DVL.summary.build(S.brain || DVL.brain.blank(), S, Date.now());
  if (!r.ready || !S.partner) return;
  const who = S.partner.name || "your partner";
  const code = DVL.partner.makeCheckin({ name: S.ownerName, week: r.weekStart, tries: r.raw.tries, walked: r.raw.walked, unlocked: r.raw.unlocked, clean: r.raw.clean, active: r.raw.active, tone: r.tone });
  const msg = $("#week-send-msg");
  let done = false;
  try {
    if (navigator.share) {
      await navigator.share({ text: code });
      done = true;
    }
  } catch (e) {
    done = false; // cancelled, or not allowed: fall back to copying
  }
  if (!done) {
    try {
      await navigator.clipboard.writeText(code);
      msg.textContent = "Copied. Send it to " + who + ", and they can open it on the partner page.";
    } catch (e) {
      msg.textContent = "Couldn't copy it. Here it is: " + code;
    }
  } else msg.textContent = "Shared.";
  await api.storage.local.set({ checkinSent: DVL.summary.weekKey(Date.now()) });
});

$("#week-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(weekText);
    $("#week-copy").textContent = "Copied";
    setTimeout(() => ($("#week-copy").textContent = "Copy summary"), 1600);
  } catch (e) {
    $("#week-copy").textContent = "Couldn't copy";
  }
});

// -------------------------------------------------------------------- home

function renderHome() {
  if (!unlocked) return;
  const now = Date.now();
  const BR = DVL.brain, IN2 = DVL.insight;
  const brain = S.brain || BR.blank();
  const n = S.sites.length ? DVL.ask.streakDays(brain, now, S.firstActive) : 0;
  $("#home-num").textContent = String(n);
  $("#home-label").textContent = !S.sites.length ? "Nothing protected yet" : n === 1 ? "day without unlocking" : "days without unlocking";

  // One honest line about right now.
  const dec = BR.decide(brain, "", now, 0, Math.random);
  const out = $("#home-outlook");
  if (!S.sites.length) out.textContent = "Add a site in Sites and Soteria starts watching.";
  else if (!dec.known) out.textContent = IN2.headline(S.habits || {}, new Date(now));
  else if (dec.level === "high") out.textContent = "This is a time you tend to give in. Soteria is keeping extra watch.";
  else if (dec.level === "watchful") out.textContent = "A busier time than usual for you.";
  else out.textContent = "A quiet moment. Nothing unusual about right now.";

  // A one-time, gentle note after two weeks of use. Never again once dismissed.
  const days = S.firstActive ? Math.floor((now - S.firstActive) / 86400000) : 0;
  const note = $("#home-support");
  note.hidden = !(CONFIG.supportUrl && days >= 14 && !S.supportNoteSeen);

  renderWeek(now);

  // The single most useful next thing.
  const next = $("#home-next");
  next.textContent = "";
  const tips = IN2.suggestions(S, S.habits || {}, { canLimit: true });
  if (tips.length) {
    const t = tips[0];
    const apply = h("button", { class: "btn primary small", type: "button", text: "Apply" });
    apply.addEventListener("click", () => api.storage.local.set(t.change).then(renderHome));
    next.append(h("div", { class: "tip" }, [h("div", { class: "tip-text" }, [h("span", { class: "row-title", text: t.title }), h("span", { class: "muted", text: t.body })]), h("div", { class: "tip-actions" }, [apply])]));
  } else {
    next.append(h("p", { class: "log-empty", text: "Nothing to change right now. Soteria will say so here when it notices something." }));
  }

  const tries = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const rec = (brain.daily || {})[L.localDateKey(d)];
    tries.push({ date: L.localDateKey(d), value: rec ? rec.tries : 0 });
  }
  const box = $("#home-chart");
  box.textContent = "";
  box.append(barChart(tries, "Times a lock screen appeared, per day", (v) => v + (v === 1 ? " time" : " times")));
}

$("#home-lock").addEventListener("click", async () => {
  const { lockEpoch } = await api.storage.local.get({ lockEpoch: 0 });
  await api.storage.local.set({ lockEpoch: lockEpoch + 1, snoozes: {}, unlocks: {} });
});
$("#home-support-go").addEventListener("click", () => api.tabs.create({ url: CONFIG.supportUrl }));
$("#home-support-hide").addEventListener("click", () => {
  $("#home-support").hidden = true;
  api.storage.local.set({ supportNoteSeen: true });
});

// ---------------------------------------------------------------- insights

const IN = DevilabsSoteria.insight;

function renderInsights() {
  if (!unlocked) return;
  $("#adaptive").checked = S.adaptive !== false;
  $("#ins-headline").textContent = IN.headline(S.habits || {}, new Date());

  // 24 bars, one per hour of the day.
  const { hours } = IN.totals(S.habits || {});
  const label = (i) => new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: "numeric" });
  const box = $("#ins-hours");
  box.textContent = "";
  box.append(barChart(hours.map((v, i) => ({ date: label(i), value: v })), "Unlocks by hour of day", (v) => String(Math.round(v))));
  box.append(h("div", { class: "chart-title" }, [h("span", { class: "muted", text: "12 AM" }), h("span", { class: "muted", text: "12 PM" }), h("span", { class: "muted", text: "11 PM" })]));

  const BR = DVL.brain;
  const brain = S.brain || BR.blank();
  const bx = $("#ins-brain");
  bx.textContent = "";
  const row = (k, v) => bx.append(h("div", { class: "row" }, [h("span", { class: "row-title", text: k }), h("span", { class: "muted", text: v })]));
  const known = brain.model.n >= BR.MIN_OUTCOMES;
  row("Moments recorded", String(brain.model.n));
  if (known) {
    const p = BR.predict(brain, "", BR.features(brain, "", Date.now(), 0));
    row("Chance you would give in right now", Math.round(p * 100) + "%");
    row("How typical this hour is for you", Math.round(BR.density(brain, Date.now()) * 100) + "%");
  } else {
    row("Prediction", "Still gathering (needs " + (BR.MIN_OUTCOMES - brain.model.n) + " more)");
  }
  for (const a of BR.armSummary(brain)) row("What works in " + (a.bucket === "high" ? "hard" : "busier") + " moments", (a.pause ? a.pause + " second pause" : "No pause") + ", resisted " + Math.round(a.mean * 100) + "% of " + a.n + " times");
  const dr = BR.drift(brain, Date.now());
  row("Trend", dr.state === "up" ? "Reaching for these sites more than usual" : dr.state === "down" ? "Reaching for these sites less than usual" : dr.state === "steady" ? "Steady" : "Still gathering");

  const tips = $("#ins-tips");
  tips.textContent = "";
  const list = IN.suggestions(S, S.habits || {}, { canLimit: true });
  if (!list.length) tips.append(h("p", { class: "log-empty", text: "Nothing to suggest right now. Soteria will say so when it notices something worth changing." }));
  for (const t of list) {
    const apply = h("button", { class: "btn primary small", type: "button", text: "Apply" });
    const skip = h("button", { class: "btn small", type: "button", text: "Not now" });
    apply.addEventListener("click", () => api.storage.local.set(t.change).then(renderInsights));
    skip.addEventListener("click", () => api.storage.local.set({ dismissedTips: [...(S.dismissedTips || []), t.id] }).then(renderInsights));
    tips.append(h("div", { class: "tip" }, [h("div", { class: "tip-text" }, [h("span", { class: "row-title", text: t.title }), h("span", { class: "muted", text: t.body })]), h("div", { class: "tip-actions" }, [skip, apply])]));
  }

  const alerts = $("#ins-alerts");
  alerts.textContent = "";
  const items = (S.alerts || []).slice().reverse();
  if (!items.length) alerts.append(h("p", { class: "log-empty", text: "No alerts. Soteria tells you here if something tries to get around it, or if wrong passwords start piling up." }));
  for (const a of items) {
    const when = L.relativeTime(a.ts, Date.now());
    alerts.append(h("div", { class: "alert" + (a.seen ? "" : " unseen") }, [h("span", { class: "row-title", text: a.text + (a.count > 1 ? " (" + a.count + " times)" : "") }), h("span", { class: "muted", text: when })]));
  }
  const t = DVL.threats;
  $("#ins-threat").textContent = t ? "Phishing check uses " + t.count.toLocaleString() + " known domains from the open-source Phishing.Database (" + t.built + "). It runs on this device and updates with Soteria." : "";
  renderList();
  $("#nav-dot").hidden = !(S.alerts || []).some((a) => !a.seen);
}

$("#ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#ask-input").value.trim();
  if (!q) return;
  $("#ask-answer").textContent = DVL.ask.answer(q, S, Date.now());
});

function renderList() {
  const n = (S.customList || []).length;
  $("#list-status").textContent = n ? S.customListName + ": " + n.toLocaleString() + " domains" : "No list added.";
  $("#list-clear").hidden = !n;
}
$("#list-pick").addEventListener("click", () => $("#list-file").click());
$("#list-file").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) {
    $("#list-status").textContent = "That file is too large (8 MB limit).";
    return;
  }
  const domains = DVL.insight.parseDomainList(await f.text());
  e.target.value = "";
  if (!domains.length) {
    $("#list-status").textContent = "No domains found in that file.";
    return;
  }
  await api.storage.local.set({ customList: domains, customListName: f.name.slice(0, 60) });
  renderList();
});
$("#list-clear").addEventListener("click", () => api.storage.local.set({ customList: [], customListName: "" }).then(renderList));

$("#adaptive").addEventListener("change", (e) => api.storage.local.set({ adaptive: e.target.checked }));
$("#ins-seen").addEventListener("click", () => api.storage.local.set({ alerts: (S.alerts || []).map((a) => Object.assign({}, a, { seen: true })) }).then(renderInsights));
$("#ins-reset").addEventListener("click", () => api.storage.local.set({ habits: {}, brain: null, dismissedTips: [] }).then(renderInsights));

// ---------------------------------------------------------------- activity

function barChart(series, label, fmt) {
  const max = Math.max(1, ...series.map((x) => x.value));
  const box = h("div", { class: "bars", role: "img", "aria-label": label + ". " + series.map((x) => x.date + ": " + fmt(x.value)).join(", ") });
  for (const x of series) {
    const bar = h("i", { class: x.value ? "" : "zero" });
    bar.style.height = (x.value ? Math.max(6, (x.value / max) * 100) : 5) + "%";
    box.append(bar);
  }
  return box;
}

function renderActivity() {
  if (!unlocked) return;
  const now = new Date();
  const attempts14 = L.attemptsByDay(S.watchLog, 14, now);
  const time14 = L.secondsByDay(S.usageDaily, 14, now);
  $("#stat-attempts").textContent = String(attempts14.slice(-7).reduce((a, b) => a + b.value, 0));
  const today = L.localDateKey(now);
  $("#stat-time").textContent = L.formatDuration((S.usageDaily || {})[today] || 0);

  const charts = $("#charts");
  charts.textContent = "";
  const block = (title, total, svg) => h("div", {}, [h("div", { class: "chart-title" }, [h("span", { text: title }), h("span", { text: total })]), svg]);
  charts.append(
    block("Blocked attempts", String(attempts14.reduce((a, b) => a + b.value, 0)), barChart(attempts14, "Blocked attempts per day", (v) => v + (v === 1 ? " attempt" : " attempts"))),
    block("Time on protected sites", L.formatDuration(time14.reduce((a, b) => a + b.value, 0)), barChart(time14, "Time on protected sites per day", L.formatDuration))
  );

  const todayList = $("#today-list");
  todayList.textContent = "";
  const rows = S.sites
    .map((host) => ({ host, st: L.limitStatus(S, host, now), used: S.usageDate === today ? (S.usage || {})[host] || 0 : 0 }))
    .filter((r) => r.used > 0 || r.st.hasLimit)
    .sort((a, b) => b.used - a.used);
  if (!rows.length) todayList.append(h("p", { class: "log-empty", text: "No time recorded today." }));
  for (const r of rows) {
    const pct = r.st.hasLimit ? Math.min(100, (r.used / (r.st.limit + r.st.extra)) * 100) : 0;
    const right = r.st.hasLimit ? L.formatDuration(r.used) + " of " + L.formatDuration(r.st.limit + r.st.extra) : L.formatDuration(r.used);
    const kids = [h("div", { class: "row", style: "padding:0;min-height:0" }, [h("span", { class: "row-title", text: r.host }), h("span", { class: "muted", text: right })])];
    if (r.st.hasLimit) kids.push(h("div", { class: "bar" }, [h("i", { class: r.st.limited ? "over" : "", style: "width:" + pct + "%" })]));
    todayList.append(h("div", { class: "row-body" }, kids));
  }

  const attemptList = $("#attempt-list");
  attemptList.textContent = "";
  const recent = (S.watchLog || []).slice().reverse().slice(0, 15);
  if (!recent.length) attemptList.append(h("p", { class: "log-empty", text: "No failed attempts. Nobody has tried to get in." }));
  for (const e of recent) {
    attemptList.append(h("div", { class: "log-row" }, [h("span", {}, [document.createTextNode(e.site), e.flagged ? h("span", { class: "badge flag", text: "Locked out" }) : null]), h("span", { class: "muted", text: L.relativeTime(e.time, Date.now()) })]));
  }
}

$("#clear-log").addEventListener("click", () => api.storage.local.set({ watchLog: [] }));

// -------------------------------------------------------------------- data

$("#export").addEventListener("click", async () => {
  const data = await api.storage.local.get(L.BACKUP_KEYS);
  const blob = new Blob([JSON.stringify({ format: L.BACKUP_FORMAT, version: 2, exportedAt: Date.now(), data }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: "devilabs-soteria-backup-" + new Date().toISOString().slice(0, 10) + ".json" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  say($("#backup-msg"), "Backup saved.", "ok");
});

$("#import").addEventListener("click", () => {
  $("#import-file").value = "";
  $("#import-file").click();
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  const msg = $("#backup-msg");
  if (!file) return;
  const parsed = L.parseBackup(await file.text());
  if (!parsed.ok) return say(msg, "That doesn't look like a Soteria backup.", "err");
  const d = parsed.data;
  if (!(await guardPartner())) return;
  if (!window.confirm("Replace your current setup with this backup (" + d.sites.length + (d.sites.length === 1 ? " site" : " sites") + ")?")) return;
  if (d.sites.length) {
    say(msg, "Your browser will ask for permission…");
    let granted = false;
    try {
      granted = await api.permissions.request({ origins: d.sites.flatMap(L.hostOrigins) });
    } catch (err) {
      granted = false;
    }
    if (!granted) return say(msg, "Permission wasn't granted, so nothing was imported.", "err");
  }
  // Re-locks everything open elsewhere, since the password may have just changed.
  await api.storage.local.set({ ...d, snoozes: {}, lockout: { fails: 0, until: 0, last: 0 }, lockEpoch: S.lockEpoch + 1 });
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
  say(msg, "Backup imported.", "ok");
  setTimeout(() => location.reload(), 700);
});

let noteTimer = null;
$("#note").addEventListener("input", (e) => {
  clearTimeout(noteTimer);
  say($("#note-msg"), "");
  noteTimer = setTimeout(async () => {
    await api.storage.local.set({ keepsakeNote: e.target.value.slice(0, 5000) });
    say($("#note-msg"), "Saved.", "ok");
  }, 500);
});

$("#erase").addEventListener("click", async () => {
  if (!window.confirm("Erase your password, sites and settings from this browser? This can't be undone.")) return;
  if (S.partner && !(await requireApproval())) return;
  await api.storage.local.clear();
  location.href = api.runtime.getURL("welcome.html");
});

// ------------------------------------------------------------------ support

function renderSupport() {
  $("#support-donate").hidden = !CONFIG.supportUrl;
  $("#support-source").hidden = !CONFIG.sourceUrl;
}
$("#support-donate").addEventListener("click", () => api.tabs.create({ url: CONFIG.supportUrl }));
$("#support-source").addEventListener("click", () => api.tabs.create({ url: CONFIG.sourceUrl }));

// --------------------------------------------------------------- rendering

function renderAll() {
  renderSupport();
  renderPartner();
  if (!$("#panel-home").hidden) renderHome();
  renderSites();
  renderSchedule();
  $("#disguise").checked = !!S.disguise;
  $("#autorelock").value = String(S.autoRelockMinutes);
  $("#idlerelock").value = String(S.idleRelockMinutes);
  $("#remember").value = String(S.rememberMinutes);
  $("#pw-current").hidden = !S.passHash;
  $("#pw-status").textContent = S.passHash ? "Enter your current password to choose a new one." : "Choose a password to start protecting sites.";
  $("#pw-save").textContent = S.passHash ? "Change password" : "Create password";
  if (document.activeElement !== $("#note")) $("#note").value = S.keepsakeNote || "";
  const m = DVL.mood.computeMood({ firstActive: S.firstActive, watchLog: S.watchLog, announcedMilestones: S.announcedMilestones, now: Date.now() });
  $("#mood").textContent = m.phrase;
  if (m.milestone) api.storage.local.set({ announcedMilestones: [...S.announcedMilestones, m.milestone] });
  if (!$(".panel:not([hidden])")) show(S.passHash ? "sites" : "security");
  else if (!$("#panel-activity").hidden) renderActivity();
}

async function start() {
  await load();
  unlocked = true;
  const want = (location.hash || "").replace("#", "");
  renderAll();
  if (want && $("#panel-" + want)) show(want);
  else show("home");

  const { pendingHost } = await api.storage.local.get({ pendingHost: null });
  if (pendingHost) {
    show("sites");
    $("#site-input").value = pendingHost;
    say($("#site-msg"), "Press Add to protect " + pendingHost + ".");
    await api.storage.local.remove("pendingHost");
  }
}

// Live updates, without pulling the page out from under someone mid-edit.
let dirty = false;
const SITE_KEYS = ["sites", "siteGroups", "snoozes", "allowances", "disguise", "autoRelockMinutes", "idleRelockMinutes", "rememberMinutes", "sanctuaryEnabled", "sanctuaryStart", "sanctuaryEnd", "sanctuaryDays", "passHash", "watchLog", "usageDaily", "habits", "brain", "customList", "alerts", "adaptive", "summarySeen", "supportNoteSeen", "partner", "partnerOnlyQuiet", "guardExtensions", "resetAt", "language", "ownerName", "checkinSent", "dismissedTips"];
const USAGE_KEYS = ["usage", "usageDate", "extraTime"];

function busyEditing() {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest(".main");
}

api.storage.onChanged.addListener(async (changes) => {
  if (changes.lockEpoch && S) {
    S.lockEpoch = changes.lockEpoch.newValue || 0;
    // The panic key (or a backup import) locks settings along with everything else.
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
    if (unlocked) return openGate();
  }
  if (!unlocked) return;
  const keys = Object.keys(changes);
  const structural = keys.some((k) => SITE_KEYS.includes(k));
  const usageOnly = !structural && keys.some((k) => USAGE_KEYS.includes(k));
  for (const k of keys) S[k] = changes[k].newValue === undefined ? L.DEFAULTS[k] : changes[k].newValue;
  if (usageOnly) {
    refreshMeta();
    if (!$("#panel-activity").hidden) renderActivity();
    if (!$("#panel-insights").hidden) renderInsights();
    return;
  }
  if (!structural) return;
  if (busyEditing()) {
    dirty = true;
    return;
  }
  renderAll();
});

document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (dirty && unlocked && !busyEditing()) {
      dirty = false;
      renderAll();
    }
  }, 50);
});

// ------------------------------------------------------------------- init

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$("#panic-keys").textContent = isMac ? "Command + Shift + L" : "Ctrl + Shift + L";

// A small thing for the curious: five quick clicks on her portrait.
(function () {
  const mark = $("#mark");
  let n = 0;
  let t = null;
  mark.addEventListener("click", () => {
    clearTimeout(t);
    t = setTimeout(() => (n = 0), 800);
    if (++n >= 5) {
      n = 0;
      mark.classList.remove("spin");
      void mark.offsetWidth;
      mark.classList.add("spin");
    }
  });
})();

(async function init() {
  await load();
  if (!S.passHash) {
    // No password yet: nothing to protect, so no gate. Setup lives in Security.
    return start();
  }
  if (unlockedThisSession()) return start();
  openGate();
})();
