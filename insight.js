/* Soteria by DrSkyle: insight.
 * Everything that lets Soteria notice how it is used, and spot trouble.
 * Pure logic, no browser APIs. It only ever sees counts (which hour, which
 * weekday, how many times), never page content, and it never leaves the device.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const MIN_EVENTS = 8; // below this Soteria says it is still gathering
  const DECAY_PER_DAY = 0.985; // old habits fade, so Soteria follows you as you change
  const MAX_ALERTS = 30;

  // --------------------------------------------------------------- habits

  const blank = () => ({ h: new Array(24).fill(0), d: new Array(7).fill(0), unlocks: 0, fails: 0, tries: 0, t: 0 });

  // kind: "shown" (a lock screen appeared), "unlock", "fail".
  // "tries" counts moments you reached for the site; that is the signal that
  // matters, because unlocking is only the end of it.
  function recordEvent(habits, ev) {
    const out = Object.assign({}, habits || {});
    const prev = out[ev.site] || blank();
    const rec = { h: prev.h.slice(), d: prev.d.slice(), unlocks: prev.unlocks, fails: prev.fails, tries: prev.tries, t: ev.ts };
    if (prev.t && ev.ts > prev.t) {
      const days = Math.min(30, (ev.ts - prev.t) / 86400000);
      const f = Math.pow(DECAY_PER_DAY, days);
      rec.h = rec.h.map((n) => n * f);
      rec.d = rec.d.map((n) => n * f);
      rec.unlocks *= f;
      rec.fails *= f;
      rec.tries *= f;
    }
    const when = new Date(ev.ts);
    if (ev.kind === "shown") rec.tries += 1;
    if (ev.kind === "unlock") {
      rec.unlocks += 1;
      rec.h[when.getHours()] += 1;
      rec.d[when.getDay()] += 1;
    }
    if (ev.kind === "fail") rec.fails += 1;
    out[ev.site] = rec;
    // Keep the table small: at most 200 sites.
    const keys = Object.keys(out);
    if (keys.length > 200) {
      keys.sort((a, b) => out[a].t - out[b].t);
      for (const k of keys.slice(0, keys.length - 200)) delete out[k];
    }
    return out;
  }

  function totals(habits) {
    const hours = new Array(24).fill(0);
    const days = new Array(7).fill(0);
    let events = 0;
    for (const rec of Object.values(habits || {})) {
      rec.h.forEach((n, i) => (hours[i] += n));
      rec.d.forEach((n, i) => (days[i] += n));
      events += rec.unlocks;
    }
    return { hours, days, events };
  }

  // ----------------------------------------------------------------- risk

  // How hard is this moment for you, going by your own history? Returns a
  // level plus a plain reason. "learning" means not enough data to say.
  function riskNow(habits, now, recentFails) {
    const { hours, days, events } = totals(habits);
    const fails = recentFails || 0;
    if (events < MIN_EVENTS) {
      return { level: fails >= 3 ? "high" : "learning", score: 0, reason: fails >= 3 ? "several wrong passwords" : "learning" };
    }
    const hr = now.getHours();
    const max = Math.max(...hours, 1);
    const near = Math.max(hours[hr], hours[(hr + 23) % 24] * 0.5, hours[(hr + 1) % 24] * 0.5);
    let score = near / max; // 0..1, 1 = your busiest hour
    const dayMax = Math.max(...days, 1);
    score = score * 0.8 + (days[now.getDay()] / dayMax) * 0.2;
    if (fails >= 3) score += 0.3;
    let level = score >= 0.6 ? "high" : score >= 0.3 ? "watchful" : "calm";
    let reason = level === "high" ? "this is a time you usually reach for these sites" : level === "watchful" ? "a busier time than usual" : "a quiet time";
    if (fails >= 3) reason = "several wrong passwords just now";
    return { level, score: Math.min(1, score), reason };
  }

  // What the risk level changes. Calm moments stay out of the way. Hard moments
  // add a short pause before the password box, and shorten how long an unlock
  // is remembered.
  function friction(level, adaptive) {
    if (!adaptive) return { pause: 0, rememberFactor: 1 };
    if (level === "high") return { pause: 8, rememberFactor: 0.25 };
    if (level === "watchful") return { pause: 3, rememberFactor: 0.6 };
    return { pause: 0, rememberFactor: 1 };
  }

  // -------------------------------------------------------- suggestions

  // The longest run of hours (wrapping midnight) that holds most of your use.
  function peakWindow(hours) {
    const total = hours.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let best = null;
    for (let len = 2; len <= 6; len++) {
      for (let start = 0; start < 24; start++) {
        let sum = 0;
        for (let i = 0; i < len; i++) sum += hours[(start + i) % 24];
        const share = sum / total;
        // Prefer the shortest window that captures at least half.
        if (share >= 0.5 && (!best || len < best.len || (len === best.len && share > best.share))) best = { start, len, share };
      }
      if (best) break;
    }
    return best;
  }

  const hhmm = (h) => String(((h % 24) + 24) % 24).padStart(2, "0") + ":00";

  // Concrete, one-tap changes. Each carries the exact storage change to apply,
  // so the person sees what will happen before they agree.
  function suggestions(state, habits, opts) {
    const out = [];
    const { hours, events } = totals(habits);
    if (events < MIN_EVENTS) return out;
    const dismissed = new Set((state.dismissedTips || []));
    const canLimit = !opts || opts.canLimit !== false;

    const win = peakWindow(hours);
    if (win && !state.sanctuaryEnabled && !dismissed.has("sanctuary")) {
      const start = hhmm(win.start);
      const end = hhmm(win.start + win.len);
      out.push({
        id: "sanctuary",
        title: "Quiet hours at " + start + " to " + end,
        body: Math.round(win.share * 100) + "% of the times you opened protected sites fell in this window. Sanctuary hours would keep them locked then.",
        change: { sanctuaryEnabled: true, sanctuaryStart: start, sanctuaryEnd: end },
      });
    }

    if (canLimit) {
      const ranked = Object.entries(habits)
        .filter(([site, r]) => r.unlocks >= 8 && !(state.allowances || {})[site] && (state.sites || []).includes(site))
        .sort((a, b) => b[1].unlocks - a[1].unlocks);
      if (ranked.length && !dismissed.has("limit:" + ranked[0][0])) {
        const [site, r] = ranked[0];
        out.push({
          id: "limit:" + site,
          title: "A daily limit for " + site,
          body: "You have opened it about " + Math.round(r.unlocks) + " times recently. A 30 minute daily limit gives you a natural stopping point.",
          change: { allowances: Object.assign({}, state.allowances || {}, { [site]: 30 }) },
        });
      }
    }

    const worst = Object.entries(habits)
      .filter(([, r]) => r.tries >= 10 && r.unlocks / Math.max(r.tries, 1) > 0.8 && (state.rememberMinutes || 0) > 15)
      .length;
    if (worst && !dismissed.has("remember")) {
      out.push({
        id: "remember",
        title: "Remember unlocks for less time",
        body: "You nearly always unlock when asked. A shorter memory of 15 minutes makes each visit a deliberate one.",
        change: { rememberMinutes: 15, unlocks: {} },
      });
    }
    return out;
  }

  // The same sentence as headline(), as data, so it can be written in any language.
  function headlineParts(habits) {
    const { hours, events } = totals(habits);
    if (events < MIN_EVENTS) return { kind: "learning", n: Math.max(0, MIN_EVENTS - Math.floor(events)) };
    const win = peakWindow(hours);
    return win ? { kind: "window", start: win.start, end: win.start + win.len } : { kind: "spread" };
  }

  // One honest sentence about you, for the popup and the Insights page.
  function headline(habits, now) {
    const { hours, events } = totals(habits);
    if (events < MIN_EVENTS) return "Still getting to know you. " + Math.max(0, MIN_EVENTS - Math.floor(events)) + " more unlocks and I can start to see patterns.";
    const win = peakWindow(hours);
    if (!win) return "Your use is spread through the day.";
    const clock = (h) => new Date(2000, 0, 1, ((h % 24) + 24) % 24).toLocaleTimeString([], { hour: "numeric" });
    return "You reach for these sites most between " + clock(win.start) + " and " + clock(win.start + win.len) + ".";
  }

  // ------------------------------------------------------------- alerts

  function addAlert(alerts, a) {
    const list = Array.isArray(alerts) ? alerts.slice() : [];
    const last = list[list.length - 1];
    // Collapse repeats of the same thing within ten minutes.
    if (last && last.kind === a.kind && last.site === a.site && a.ts - last.ts < 600000) {
      list[list.length - 1] = Object.assign({}, last, { count: (last.count || 1) + 1, ts: a.ts });
    } else {
      list.push({ kind: a.kind, site: a.site || "", ts: a.ts, count: 1, text: a.text, seen: false });
    }
    return list.slice(-MAX_ALERTS);
  }

  // Wrong passwords arriving from many sites at once, or very fast, look like
  // someone trying things rather than a typo.
  function failureBurst(watchLog, now) {
    const recent = (watchLog || []).filter((e) => now - e.time < 10 * 60000);
    const sites = new Set(recent.map((e) => e.site));
    if (recent.length >= 8) return { burst: true, text: recent.length + " wrong passwords in 10 minutes." };
    if (recent.length >= 4 && sites.size >= 3) return { burst: true, text: "Wrong passwords on " + sites.size + " different sites in 10 minutes." };
    return { burst: false };
  }

  // -------------------------------------------------- malicious websites

  function fnv(str, seed) {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  let bits = null;
  function loadBits(t) {
    if (bits) return bits;
    const bin = typeof atob === "function" ? atob(t.data) : Buffer.from(t.data, "base64").toString("binary");
    bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    return bits;
  }

  function filterHas(t, domain) {
    const b = loadBits(t);
    const a = fnv(domain, 0);
    const c = fnv(domain, 0x9e3779b9) | 1;
    for (let i = 0; i < t.k; i++) {
      const pos = ((a + Math.imul(i, c)) >>> 0) % t.m;
      if (!(b[pos >> 3] & (1 << (pos & 7)))) return false;
    }
    return true;
  }

  // Is this host, or any parent domain of it, on the phishing list?
  function knownThreat(host, t) {
    if (!t || !host) return false;
    const parts = host.toLowerCase().split(".");
    for (let i = 0; i < parts.length - 1; i++) if (filterHas(t, parts.slice(i).join("."))) return true;
    return false;
  }

  // Look-alike check: "instagrarn.com" for "instagram.com". Folds the usual
  // tricks (rn for m, 0 for o, 1 for l) then allows one slip.
  const fold = (s) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1|]/g, "l").replace(/-/g, "");

  function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }

  function lookalikeOf(host, sites) {
    const parts = host.split(".");
    if (parts.length < 2) return "";
    const label = fold(parts[parts.length - 2]);
    for (const site of sites || []) {
      if (host === site || host.endsWith("." + site)) continue;
      const sp = site.split(".");
      const want = fold(sp[sp.length - 2] || "");
      if (want.length < 5) continue;
      if (label === want || distance(label, want) === 1) return site;
      // "instagram-login.com", "instagram.secure-check.com"
      if (parts.slice(0, -1).some((p) => fold(p).includes(want)) && !host.endsWith("." + site)) return site;
    }
    return "";
  }

  // Reads a list the person picked themselves: a hosts file ("0.0.0.0 bad.com"),
  // one domain per line, or an AdBlock-style "||bad.com^" line. Anything that
  // isn't a plain domain is skipped, so a list can never inject anything but a
  // host name. Returns unique domains, capped.
  function parseDomainList(text, cap) {
    const max = cap || 50000;
    const out = new Set();
    const re = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.replace(/[#!].*$/, "").trim().toLowerCase();
      if (!line || line.startsWith("[") || line.startsWith("@@")) continue;
      line = line.replace(/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+/, "").replace(/^\|\|/, "").replace(/[\^$/].*$/, "").replace(/^www\./, "");
      if (re.test(line) && !/^(localhost|local|broadcasthost)/.test(line)) out.add(line);
      if (out.size >= max) break;
    }
    return [...out];
  }

  function inCustomList(host, list) {
    if (!host || !list || !list.length) return false;
    const set = list instanceof Set ? list : new Set(list);
    const parts = host.toLowerCase().split(".");
    for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join("."))) return true;
    return false;
  }

  DVL.insight = Object.freeze({
    parseDomainList,
    inCustomList,
    MIN_EVENTS,
    recordEvent,
    totals,
    riskNow,
    friction,
    peakWindow,
    suggestions,
    headline,
    headlineParts,
    addAlert,
    failureBurst,
    knownThreat,
    lookalikeOf,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = DVL.insight;
})(typeof globalThis !== "undefined" ? globalThis : this);
