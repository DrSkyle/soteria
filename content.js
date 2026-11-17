/* Soteria by DrSkyle
 * Content script. Runs only on sites you have added. Hides the page before it
 * paints, decides whether it should be locked, and keeps the lock screen up
 * until the password is right.
 *
 * The password is never checked here: this script only passes what was typed
 * to the background, which holds the hash and the lockout counter.
 */
(function () {
  "use strict";

  const G = globalThis;
  if (G.__devilabsSoteriaContent) return; // injected twice (registered + apply-now)
  G.__devilabsSoteriaContent = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const DVL = G.DevilabsSoteria;
  const root = document.documentElement;
  if (!DVL || !DVL.logic || !root) return;

  const L = DVL.logic;
  const t = (key, vars) => DVL.i18n.t(key, vars);
  const MSG = L.MSG;
  const NS = "devilabs-soteria";
  const OVERLAY_ID = NS + "-overlay";
  const PILL_ID = NS + "-pill";
  const LOCKED_CLASS = NS + "-locked";
  const CONSOLE_FN = "soteria";
  const CONSOLE_EVENT = "__devilabs_soteria_console_attempt__";
  const BEAT_MS = 10000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const isTop = (() => {
    try {
      return G.window === G.top;
    } catch (e) {
      return false;
    }
  })();

  let cfg = null;
  const S = {
    entry: null,
    locked: false,
    reason: null,
    overlay: null,
    guard: null,
    graceUntil: 0,
    beat: null,
    hiddenTimer: null,
    consoleOn: false,
    busy: false,
    cooldownTimer: null,
    stealth: null,
    bodyPrev: null,
    lastTamper: 0,
    choice: null,
    partnerReq: null,
    why: null,
    pill: null,
    pillLive: null,
    announced: null,
    skipShown: false,
    justExpired: false,
    decision: null,
    pauseTimer: null,
  };

  // ------------------------------------------------------------ small helpers

  // Styles are set through the CSSOM rather than <style> elements or style
  // attributes, because a strict Content-Security-Policy can block the latter.
  const setImp = (el, prop, val) => {
    try {
      el.style.setProperty(prop, val, "important");
    } catch (e) {
      /* ignore */
    }
  };
  const delProp = (el, prop) => {
    try {
      el.style.removeProperty(prop);
    } catch (e) {
      /* ignore */
    }
  };

  function send(message) {
    try {
      const p = api.runtime.sendMessage(message);
      return p && typeof p.then === "function" ? p : Promise.resolve(p);
    } catch (e) {
      return Promise.reject(e);
    }
  }

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

  function svg(viewBox, paths) {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("aria-hidden", "true");
    for (const spec of paths) {
      const p = document.createElementNS(SVG_NS, spec.tag || "path");
      for (const k of Object.keys(spec.attrs)) p.setAttribute(k, spec.attrs[k]);
      s.append(p);
    }
    return s;
  }

  const strokeAttrs = { fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" };

  // Hide the whole page until we know what to do with it, so nothing flashes.
  setImp(root, "opacity", "0");
  const show = () => delProp(root, "opacity");
  const failOpen = setTimeout(show, 5000);

  // ---------------------------------------------------------- unlock memory

  const sessionKey = (entry) => NS + ":unlocked:" + entry;

  // An unlock lasts for this tab only. One made during sanctuary hours is
  // tagged, because an earlier unlock must not carry into those hours.
  function sessionUnlocked(entry, needSanctuary) {
    // Preferred: a time-limited grant kept by the extension, shared by every tab.
    const g = (cfg.unlocks || {})[entry];
    if (g && g.until > Date.now() && g.epoch === cfg.lockEpoch && (needSanctuary ? g.s === true : true)) return true;
    // With timed unlocks on, the extension's grant is the only authority. The
    // per-tab flag would outlive it, so it is used only when nothing is remembered.
    if (cfg.rememberMinutes > 0) return false;
    try {
      const v = sessionStorage.getItem(sessionKey(entry));
      if (v === null) return false;
      const tagged = v.endsWith(":s");
      return v.replace(/:s$/, "") === String(cfg.lockEpoch) && (needSanctuary ? tagged : true);
    } catch (e) {
      return false;
    }
  }

  function markUnlocked(entry, duringSanctuary) {
    try {
      sessionStorage.setItem(sessionKey(entry), cfg.lockEpoch + (duringSanctuary ? ":s" : ""));
    } catch (e) {
      /* sandboxed frame: the unlock simply won't persist across reloads */
    }
  }

  // ------------------------------------------------------------- the decision

  function entryFor(c) {
    const host = L.normalizeHost(location.hostname);
    if (!host) return null;
    return (c.sites || []).find((s) => L.matchesSite(host, s)) || null;
  }

  function sanctuaryNow(c) {
    return !!c.sanctuaryEnabled && L.inSanctuaryWindow(c.sanctuaryStart, c.sanctuaryEnd, new Date(), c.sanctuaryDays);
  }

  function decide() {
    const entry = entryFor(cfg);
    if (!entry) return { entry: null, locked: false };
    const now = new Date();
    const sanctuaryActive = sanctuaryNow(cfg);
    // A timed unlock that ended just now. When the lock returns for that reason
    // it is not a new moment of reaching for the site, so it is not counted.
    const gr = (cfg.unlocks || {})[entry];
    S.justExpired = !!(gr && gr.fixed && gr.until <= now.getTime() && now.getTime() - gr.until < 90000);
    const status = L.limitStatus(cfg, entry, now);
    const d = L.decideLockState({
      match: true,
      hasPassword: !!cfg.passHash,
      sanctuaryActive,
      snoozedUntil: (cfg.snoozes || {})[entry] || 0,
      now: now.getTime(),
      limited: status.limited && now.getTime() >= S.graceUntil,
      sessionUnlocked: sessionUnlocked(entry, sanctuaryActive),
    });
    return Object.assign({ entry }, d);
  }

  function reevaluate() {
    if (!cfg) return;
    const d = decide();
    S.entry = d.entry;
    clearTimeout(failOpen);
    if (!d.entry) {
      if (S.locked) release(false);
      show();
      return;
    }
    if (d.locked) {
      if (!S.locked || S.reason !== d.reason) lock(d.reason);
    } else if (S.locked) {
      release(false);
    } else {
      show();
    }
  }

  // --------------------------------------------------------- protecting page

  const BODY_PROPS = [
    ["filter", "blur(30px) saturate(0.7)"],
    ["pointer-events", "none"],
    ["user-select", "none"],
    ["overflow", "hidden"],
  ];

  function protectBody() {
    const b = document.body;
    if (!b) return false;
    if (!S.bodyPrev || S.bodyPrev.node !== b) {
      S.bodyPrev = { node: b, vals: BODY_PROPS.map(([p]) => [p, b.style.getPropertyValue(p), b.style.getPropertyPriority(p)]) };
    }
    BODY_PROPS.forEach(([p, v]) => setImp(b, p, v));
    try {
      b.inert = true; // keeps keyboard and screen readers out of the hidden page
    } catch (e) {
      /* older engine */
    }
    return true;
  }

  function unprotectBody() {
    const prev = S.bodyPrev;
    S.bodyPrev = null;
    if (!prev || !prev.node) return;
    for (const [p, val, pri] of prev.vals) {
      if (val) prev.node.style.setProperty(p, val, pri);
      else delProp(prev.node, p);
    }
    try {
      prev.node.inert = false;
    } catch (e) {
      /* older engine */
    }
  }

  function whenBodyReady(cb) {
    if (document.body) return cb();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      mo.disconnect();
      cb();
    };
    const mo = new MutationObserver(() => document.body && finish());
    mo.observe(root, { childList: true });
    setTimeout(finish, 2500);
  }

  // A page may try to remove the overlay or its class. Put them back.
  function startGuard() {
    stopGuard();
    S.guard = new MutationObserver(() => {
      if (!S.locked) return;
      let tampered = false;
      if (S.overlay && !S.overlay.isConnected) {
        root.appendChild(S.overlay);
        tampered = true;
      }
      if (!root.classList.contains(LOCKED_CLASS)) {
        root.classList.add(LOCKED_CLASS);
        tampered = true;
      }
      if (tampered && Date.now() - S.lastTamper > 30000) {
        S.lastTamper = Date.now();
        send({ type: MSG.tamper, site: S.entry }).catch(() => {});
      }
      if (document.body && document.body.style.getPropertyValue("filter") === "") protectBody();
    });
    S.guard.observe(root, { childList: true, attributes: true, attributeFilter: ["class"] });
  }

  function stopGuard() {
    if (S.guard) S.guard.disconnect();
    S.guard = null;
  }

  // ------------------------------------------------------------- tab stealth

  // While locked, the tab shows a plain title and icon so the tab strip
  // doesn't give away what's behind the blur.
  const BLANK_ICON = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>');

  function stealthTab() {
    if (S.stealth) return;
    const st = (S.stealth = { title: document.title, icons: [], injected: null, observer: null });
    document.title = "New Tab";
    const titleEl = document.querySelector("title") || (document.head || root).appendChild(document.createElement("title"));
    st.observer = new MutationObserver(() => {
      if (document.title !== "New Tab") document.title = "New Tab";
    });
    st.observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    const links = document.querySelectorAll('link[rel~="icon"]');
    st.icons = Array.from(links).map((el) => ({ el, href: el.getAttribute("href") }));
    links.forEach((el) => el.setAttribute("href", BLANK_ICON));
    if (!links.length) {
      st.injected = h("link", { rel: "icon", href: BLANK_ICON });
      (document.head || root).appendChild(st.injected);
    }
  }

  function restoreTab() {
    const st = S.stealth;
    S.stealth = null;
    if (!st) return;
    if (st.observer) st.observer.disconnect();
    document.title = st.title;
    st.icons.forEach(({ el, href }) => (href === null ? el.removeAttribute("href") : el.setAttribute("href", href)));
    if (st.injected) st.injected.remove();
  }

  // ------------------------------------------------------------ overlay copy

  function copyFor(reason) {
    const host = S.entry;
    if (reason === "limit") {
      return { title: t("lock.title.limit"), sub: t("lock.sub.limit", { host }) };
    }
    if (reason === "sanctuary") {
      return { title: t("lock.title.sanctuary"), sub: t("lock.sub.sanctuary", { host, time: L.formatClock(cfg.sanctuaryEnd) }) };
    }
    return { title: t("lock.title.locked"), sub: t("lock.sub.locked", { host }) };
  }

  // ----------------------------------------------------------- lock overlay

  // Quiet hours with partner-only on: only the partner can unlock, so the
  // disguise (which only knows the password) steps aside.
  const isDisguised = () => !!cfg.disguise && !partnerOnlyNow();
  const partnerOnlyNow = () => !!(cfg.partner && cfg.partnerOnlyQuiet && sanctuaryNow(cfg));

  function buildVault(reason) {
    const copy = copyFor(reason);
    const mark = h("div", { class: "dvl-mark" });
    const img = h("img", { alt: "", src: (DVL.brand && DVL.brand.avatar) || "" });
    img.addEventListener("error", () => {
      img.remove();
      mark.append(
        svg("0 0 24 24", [
          { tag: "rect", attrs: { x: "5", y: "11", width: "14", height: "9", rx: "2", fill: "currentColor" } },
          { attrs: Object.assign({ d: "M8 11V8a4 4 0 0 1 8 0v3" }, strokeAttrs) },
        ])
      );
    });
    mark.append(img);

    const title = h("p", { class: "dvl-title", id: NS + "-title", text: copy.title });
    const sub = h("p", { class: "dvl-sub", text: copy.sub });
    const input = h("input", { class: "dvl-input", type: "password", placeholder: t("lock.password"), "aria-label": t("lock.password"), autocomplete: "new-password", autocapitalize: "off", spellcheck: "false" });
    const go = h("button", { class: "dvl-go", type: "submit", "aria-label": t("lock.unlock") });
    go.append(svg("0 0 24 24", [{ attrs: Object.assign({ d: "M5 12h13m-5-6 6 6-6 6" }, strokeAttrs) }]));
    const field = h("div", { class: "dvl-field" }, [input, go]);
    const msg = h("p", { class: "dvl-msg", role: "status", "aria-live": "polite" });
    const chips = buildChoices(reason);
    const whys = buildReasons(reason);
    const form = h("form", { class: "dvl-form" }, [field, chips, whys, msg].filter(Boolean));
    const leave = h("button", { class: "dvl-link", type: "button", text: t("lock.leave") });
    const partnerBox = buildPartner(reason, input, sub, msg);
    const stack = h("div", { class: "dvl-stack" }, [mark, title, sub, form, partnerBox, leave].filter(Boolean));
    const overlay = h("div", { id: OVERLAY_ID, lang: DVL.i18n.language(), dir: DVL.i18n.dir(), role: "dialog", "aria-modal": "true", "aria-labelledby": NS + "-title" }, [stack, h("p", { class: "dvl-brand", text: "Soteria" })]);

    leave.addEventListener("click", () => {
      location.href = "about:blank";
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (S.busy || S.cooldownTimer) return;
      const attempt = input.value;
      if (!attempt) return;
      S.busy = true;
      overlay.classList.add("dvl-busy");
      const res = await verify(attempt);
      S.busy = false;
      overlay.classList.remove("dvl-busy");
      if (res.ok) return onUnlocked(res);

      input.value = "";
      overlay.classList.remove("dvl-shake");
      void overlay.offsetWidth; // restart the animation
      overlay.classList.add("dvl-shake");
      if (res.cooldown > 0) startCooldown(res.cooldown, input, msg);
      else if (res.error === "partner-only") msg.textContent = t("lock.err.partnerOnly");
      else if (res.error) msg.textContent = t("lock.err.check");
      else msg.textContent = S.partnerReq ? t("lock.err.reply") : t("lock.err.password");
      input.focus();
    });

    // A small thing for the curious: the Konami code does nothing but answer.
    const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let buf = [];
    overlay.addEventListener("keydown", (e) => {
      buf = buf.concat(e.key).slice(-code.length);
      if (buf.join() === code.join()) {
        buf = [];
        const prev = title.textContent;
        title.textContent = t("lock.nice");
        setTimeout(() => (title.textContent = prev), 1400);
      }
    });

    overlay.focusTarget = input;
    adaptTo(overlay, input, go, sub, msg, reason);
    return overlay;
  }

  // Ask a trusted person instead of typing your own password. Soteria makes a
  // one-time request code; the partner approves it on their device and sends a
  // reply back; the reply is pasted into the same box.
  function buildPartner(reason, input, sub, msg) {
    S.partnerReq = null;
    if (reason === "limit" || !cfg.partner) return null;
    const name = cfg.partner.name || t("lock.partner.fallback");
    const box = h("div", { class: "dvl-partner" });
    const ask = h("button", { class: "dvl-link", type: "button", text: t("lock.partner.ask", { name }) });
    const area = h("textarea", { class: "dvl-req", readonly: "readonly", rows: "3", "aria-label": t("lock.partner.reqLabel", { name }) });
    const copy = h("button", { class: "dvl-chip dvl-chip-quiet", type: "button", text: t("lock.partner.copy") });
    const row = h("div", { class: "dvl-reqrow" }, [area, copy]);
    row.hidden = true;
    box.append(ask, row);
    async function start() {
      const pick = S.choice || {};
      let res;
      try {
        res = await send({ type: MSG.askPartner, site: S.entry, minutes: pick.minutes, sliding: pick.sliding });
      } catch (e) {
        res = null;
      }
      if (!res || !res.ok) return void (msg.textContent = t("lock.partner.noRequest"));
      S.partnerReq = res.request;
      area.value = res.request;
      row.hidden = false;
      ask.hidden = true;
      input.type = "text";
      input.placeholder = t("lock.partner.paste", { name });
      input.setAttribute("aria-label", t("lock.partner.replyLabel", { name }));
      input.autocomplete = "off";
      msg.textContent = t("lock.partner.send", { name });
      input.focus();
    }
    ask.addEventListener("click", start);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(area.value);
        copy.textContent = t("lock.partner.copied");
      } catch (e) {
        area.select();
      }
      setTimeout(() => (copy.textContent = t("lock.partner.copy")), 1500);
    });
    if (partnerOnlyNow()) {
      sub.textContent = t("lock.partner.quiet", { name });
      ask.hidden = true;
      queueMicrotask(start);
    }
    return box;
  }

  // Why are you going in? Optional, one tap, and tap again to clear. It only
  // feeds the weekly summary, so you can see what you actually go there for.
  const WHYS = [["messages", "lock.why.messages"], ["work", "lock.why.work"], ["bored", "lock.why.bored"], ["other", "lock.why.other"]];
  function buildReasons(reason) {
    S.why = null;
    if (reason === "limit" || isDisguised()) return null;
    const row = h("div", { class: "dvl-choices dvl-whys", role: "group", "aria-label": t("lock.why.group") });
    const btns = WHYS.map(([id, key]) => {
      const b = h("button", { class: "dvl-chip dvl-chip-quiet", type: "button", "aria-pressed": "false", text: t(key) });
      b.addEventListener("click", () => {
        S.why = S.why === id ? null : id;
        btns.forEach((x, i) => x.setAttribute("aria-pressed", WHYS[i][0] === S.why ? "true" : "false"));
      });
      return b;
    });
    row.append(h("span", { class: "dvl-why-label", text: t("lock.why.label") }), ...btns);
    return row;
  }

  // How long are you staying? Choosing before you go in is what makes a visit a
  // decision. Fixed lengths end on time; the last choice lasts while you keep
  // using the site. Not offered for daily-limit extensions.
  function buildChoices(reason) {
    S.choice = null;
    if (reason === "limit" || isDisguised()) return null;
    const ch = L.unlockChoices(cfg.rememberMinutes);
    if (!ch.slidingMinutes) return null;
    const options = ch.fixed.slice(0, 3).map((m) => ({ label: t("lock.stay.min", { n: m }), minutes: m, sliding: false }));
    options.push({ label: t("lock.stay.here"), minutes: ch.slidingMinutes, sliding: true });
    // In a hard moment the shortest option is already selected.
    const hard = S.decision && S.decision.level === "high";
    let pick = hard ? options[0] : options.find((o) => !o.sliding && o.minutes === 15) || options[0];
    S.choice = pick;
    const row = h("div", { class: "dvl-choices", role: "radiogroup", "aria-label": t("lock.stay.group") });
    const btns = options.map((o) => {
      const b = h("button", { class: "dvl-chip", type: "button", role: "radio", "aria-checked": o === pick ? "true" : "false", text: o.label });
      b.addEventListener("click", () => {
        pick = o;
        S.choice = o;
        btns.forEach((x, i) => x.setAttribute("aria-checked", options[i] === o ? "true" : "false"));
      });
      return b;
    });
    row.append(...btns);
    return row;
  }

  // The lock screen adapts to the moment. In a quiet hour it stays out of the
  // way. In an hour you tend to struggle (by your own history, kept on this
  // device) it asks for a short pause first, and says why.
  // Picks how firm this moment should be. Once Soteria has seen enough
  // outcomes it uses its own learned rules; before that it falls back to the
  // simple hour-of-day rule.
  function decideFriction(reason) {
    if (cfg.adaptive === false || reason === "limit" || isDisguised()) return { pause: 0, arm: -1, bucket: "", level: "calm", x: null };
    const lk = cfg.lockout || {};
    const fails = Date.now() - (lk.last || 0) < 15 * 60000 ? lk.fails || 0 : 0;
    if (DVL.brain && cfg.brain) {
      const dec = DVL.brain.decide(cfg.brain, S.entry, Date.now(), fails, Math.random);
      if (dec.known) {
        return Object.assign(dec, { why: dec.level === "high" ? t("lock.reason.high") : dec.level === "watchful" ? t("lock.reason.busy") : "" });
      }
    }
    if (DVL.insight) {
      const risk = DVL.insight.riskNow(cfg.habits, new Date(), fails);
      const fr = DVL.insight.friction(risk.level, true);
      return { pause: fr.pause, arm: -1, bucket: "", level: risk.level, x: null, why: risk.level === "high" ? t("lock.reason.high") : risk.level === "watchful" ? t("lock.reason.busy") : "" };
    }
    return { pause: 0, arm: -1, bucket: "", level: "calm", x: null };
  }

  // The lock screen adapts to the moment: quiet hours stay out of the way, and
  // in a hard moment it asks for a short pause first and says why.
  function adaptTo(overlay, input, go, sub, msg, reason) {
    const dec = S.decision;
    if (!dec || dec.pause <= 0) return;
    let left = dec.pause;
    input.disabled = true;
    go.disabled = true;
    const paint = () => (msg.textContent = t("lock.breath", { n: left }));
    if (dec.why) sub.textContent = sub.textContent + " " + dec.why;
    paint();
    S.pauseTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(S.pauseTimer);
        S.pauseTimer = null;
        if (!S.cooldownTimer) {
          input.disabled = false;
          go.disabled = false;
          msg.textContent = "";
          input.focus();
        }
      } else paint();
    }, 1000);
  }

  function startCooldown(seconds, input, msg) {
    let left = seconds;
    input.disabled = true;
    const paint = () => (msg.textContent = t("lock.cooldown", { n: left }));
    paint();
    S.cooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(S.cooldownTimer);
        S.cooldownTimer = null;
        input.disabled = false;
        msg.textContent = "";
        input.focus();
      } else paint();
    }, 1000);
  }

  // Disguise mode: a plain browser-error look-alike with no password field.
  const DECOYS = [
    { title: "This site can't be reached", sub: (e) => e + " unexpectedly closed the connection.", code: (e) => "ERR_CONNECTION_CLOSED\n\nChecking the connection to " + e + "...\nChecking the proxy, firewall and DNS configuration." },
    { title: "404", sub: (e) => "The page you're looking for on " + e + " isn't here anymore.", code: (e) => "HTTP ERROR 404\n\nThe requested URL was not found on " + e + "." },
    { title: "This page isn't working", sub: (e) => e + " didn't send any data.", code: (e) => "ERR_EMPTY_RESPONSE\n\n" + e + " closed the connection without sending any data." },
  ];

  function buildDisguise() {
    const decoy = DECOYS[L.hashIndex(S.entry, DECOYS.length)];
    const pre = h("pre", { class: "dvl-err-pre", text: decoy.code(S.entry) });
    pre.hidden = true;
    const reload = h("button", { class: "dvl-err-btn", type: "button", text: "Reload" });
    const more = h("button", { class: "dvl-err-more", type: "button", text: "Details" });
    reload.addEventListener("click", () => location.reload());
    more.addEventListener("click", () => {
      pre.hidden = !pre.hidden;
    });
    const box = h("div", { class: "dvl-err" }, [
      svg("0 0 24 24", [{ tag: "rect", attrs: Object.assign({ x: "4", y: "3", width: "16", height: "18", rx: "2" }, strokeAttrs) }, { attrs: Object.assign({ d: "M9 9h.01M15 9h.01M9 16c1.5-1.5 4.5-1.5 6 0" }, strokeAttrs) }]),
      h("h1", { class: "dvl-err-title", text: decoy.title }),
      h("p", { class: "dvl-err-sub", text: decoy.sub(S.entry) }),
      h("div", { class: "dvl-err-actions" }, [reload, more]),
      pre,
    ]);
    return h("div", { id: OVERLAY_ID, class: "dvl-disguise" }, [box]);
  }

  async function verify(attempt) {
    try {
      const pick = S.choice || {};
      if (S.partnerReq) return (await send({ type: MSG.verifyPassword, partnerRequest: S.partnerReq, partnerResponse: attempt, site: S.entry, sanctuary: sanctuaryNow(cfg), why: S.why || undefined })) || { ok: false, error: "failed" };
      const res = await send({ type: MSG.verifyPassword, attempt, site: S.entry, sanctuary: sanctuaryNow(cfg), minutes: pick.minutes, sliding: pick.sliding, why: S.why || undefined, extendHost: S.reason === "limit" ? S.entry : undefined });
      return res || { ok: false, error: "failed" };
    } catch (e) {
      return { ok: false, error: "unavailable" };
    }
  }

  // --------------------------------------------------------- lock / release

  function lock(reason) {
    if (S.pauseTimer) clearInterval(S.pauseTimer);
    S.pauseTimer = null;
    if (!S.overlay && isTop && (S.skipShown || S.justExpired)) {
      // The lock came back because a timed unlock ended, not because you reached for the site.
      S.skipShown = false;
      S.decision = decideFriction(reason);
    } else if (!S.overlay && isTop) {
      S.decision = decideFriction(reason);
      const d = S.decision;
      send({ type: MSG.event, kind: "shown", site: S.entry, decision: d && d.x ? { x: d.x, arm: d.arm, bucket: d.bucket } : undefined }).catch(() => {});
    } else if (!S.decision) S.decision = decideFriction(reason);
    if (S.overlay) S.overlay.remove();
    S.locked = true;
    S.reason = reason;
    stealthTab();
    root.classList.add(LOCKED_CLASS);

    const disguised = isDisguised();
    const overlay = disguised ? buildDisguise() : buildVault(reason);
    S.overlay = overlay;
    root.appendChild(overlay);
    startGuard();
    if (disguised) installConsoleUnlock();
    else if (overlay.focusTarget) setTimeout(() => overlay.focusTarget.focus(), 30);

    whenBodyReady(() => {
      protectBody();
      if (S.locked) show();
    });
  }

  function release(animate) {
    const overlay = S.overlay;
    S.locked = false;
    S.reason = null;
    S.overlay = null;
    S.decision = null;
    stopGuard();
    if (S.cooldownTimer) clearInterval(S.cooldownTimer);
    S.cooldownTimer = null;
    if (S.pauseTimer) clearInterval(S.pauseTimer);
    S.pauseTimer = null;
    removeConsoleUnlock();
    const finish = () => {
      if (overlay) overlay.remove();
      root.classList.remove(LOCKED_CLASS);
      unprotectBody();
      restoreTab();
      show();
    };
    if (animate && overlay) {
      overlay.classList.add("dvl-leaving");
      setTimeout(finish, 200);
    } else finish();
  }

  function onUnlocked(res) {
    if (res && res.grant) {
      // Use the grant straight away; the storage change arrives a moment later.
      cfg.unlocks = Object.assign({}, cfg.unlocks, { [S.entry]: res.grant });
    } else markUnlocked(S.entry, sanctuaryNow(cfg));
    if (S.reason === "limit") S.graceUntil = Date.now() + 8000;
    release(true);
  }

  // ------------------------------------------------------- console unlock

  function onConsoleAttempt(e) {
    if (!S.locked) return;
    const attempt = typeof e.detail === "string" ? e.detail : "";
    verify(attempt).then((res) => {
      if (res.ok) {
        console.log("Unlocked.");
        onUnlocked(res);
      } else if (res.cooldown > 0) console.log("Too many attempts. Try again in " + res.cooldown + "s.");
      else console.log(res.error ? "Soteria couldn't check that." : "Incorrect password.");
    });
  }

  function installConsoleUnlock() {
    if (S.consoleOn) return;
    S.consoleOn = true;
    window.addEventListener(CONSOLE_EVENT, onConsoleAttempt);
    send({ type: MSG.installConsoleUnlock, fnName: CONSOLE_FN, eventName: CONSOLE_EVENT }).catch(() => {});
  }

  function removeConsoleUnlock() {
    if (!S.consoleOn) return;
    S.consoleOn = false;
    window.removeEventListener(CONSOLE_EVENT, onConsoleAttempt);
    send({ type: MSG.removeConsoleUnlock, fnName: CONSOLE_FN }).catch(() => {});
  }

  // ------------------------------------------------------------- heartbeat

  // Re-checks the clock-driven rules (sanctuary hours, snooze expiry) and
  // counts time on a site that has a daily limit.
  function beat() {
    if (!cfg) return;
    reevaluate();
    if (!S.locked && S.entry && isTop && document.visibilityState === "visible" && document.hasFocus() && (((cfg.unlocks || {})[S.entry] || {}).until > Date.now() && !(cfg.unlocks[S.entry] || {}).fixed)) {
      send({ type: MSG.touchUnlock, site: S.entry }).catch(() => {});
    }
    if (!S.locked && S.entry && isTop && document.visibilityState === "visible" && document.hasFocus() && (cfg.allowances || {})[S.entry] > 0) {
      send({ type: MSG.usageTick, host: S.entry, seconds: BEAT_MS / 1000 }).catch(() => {});
    }
  }

  // The last minute of a timed unlock is shown in a small corner pill, so the
  // lock coming back is never a surprise. It cannot be extended without the
  // password. When time is up the lock screen returns straight away.
  function tickPill() {
    if (!cfg || !S.entry || !isTop || S.locked) return removePill();
    const g = (cfg.unlocks || {})[S.entry];
    if (!g || !g.fixed) return removePill();
    const left = g.until - Date.now();
    if (left <= 0) {
      S.skipShown = true;
      removePill();
      return reevaluate();
    }
    if (left > 60000) return removePill();
    // Screen readers hear the countdown only at a few points, not every second.
    if (!S.pillLive) {
      S.pillLive = h("div", { role: "status", "aria-live": "polite" });
      S.pillLive.style.cssText = "position:fixed!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;";
      document.documentElement.appendChild(S.pillLive);
      S.announced = new Set();
    }
    const secs = Math.ceil(left / 1000);
    for (const mark of [60, 30, 10]) {
      if (secs <= mark && !S.announced.has(mark)) {
        S.announced.add(mark);
        S.pillLive.textContent = t("lock.pill", { time: Math.floor(mark / 60) + ":" + String(mark % 60).padStart(2, "0") });
      }
    }
    if (!S.pill) {
      S.pill = h("div", { id: PILL_ID, role: "status", "aria-live": "off" });
      document.documentElement.appendChild(S.pill);
    }
    const s = Math.ceil(left / 1000);
    S.pill.textContent = t("lock.pill", { time: Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") });
  }
  function removePill() {
    if (S.pill) S.pill.remove();
    S.pill = null;
    if (S.pillLive) S.pillLive.remove();
    S.pillLive = null;
  }

  // Optional: lock again after the tab has been in the background a while.
  document.addEventListener("visibilitychange", () => {
    clearTimeout(S.hiddenTimer);
    if (!document.hidden || !cfg || !cfg.autoRelockMinutes || !S.entry || S.locked) return;
    S.hiddenTimer = setTimeout(() => {
      try {
        sessionStorage.removeItem(sessionKey(S.entry));
      } catch (e) {
        /* ignore */
      }
      const next = { ...(cfg.unlocks || {}) };
      delete next[S.entry];
      api.storage.local.set({ unlocks: next }).catch(() => {});
      cfg.unlocks = next;
      reevaluate();
    }, cfg.autoRelockMinutes * 60 * 1000);
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !cfg) return;
    for (const k of Object.keys(changes)) cfg[k] = changes[k].newValue;
    if (changes.language) DVL.i18n.setLanguage(cfg.language);
    reevaluate();
  });

  api.storage.local
    .get(L.CONTENT_KEYS.reduce((o, k) => ((o[k] = L.DEFAULTS[k]), o), {}))
    .then((data) => {
      cfg = data;
      DVL.i18n.setLanguage(cfg.language);
      reevaluate();
      S.beat = setInterval(beat, BEAT_MS);
      setInterval(tickPill, 1000);
    })
    .catch(() => show());
})();
