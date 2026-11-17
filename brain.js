/* Soteria by DrSkyle: brain.
 * Adjusts to one person, on the device. No libraries, no network, nothing sent
 * anywhere: every routine here is small enough to read and test.
 *
 *  1. Estimates "will you give in at this lock screen?" from time of day,
 *     weekday, recent attempts, time since the last unlock and recent wrong
 *     passwords.
 *  2. Scores how typical this hour is for you across a 168-slot week.
 *  3. Tries different pause lengths and keeps the ones that actually help you
 *     resist, per kind of moment, while still exploring a little.
 *  4. Notices when your habits change from one stretch of days to the next.
 *
 * It tunes only how gentle or firm the lock screen is. It never touches
 * passwords, lockouts or what is protected.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});

  const ARMS = [0, 3, 8, 15]; // pause seconds the bandit chooses between
  const FEATURES = 11;
  const MIN_OUTCOMES = 6; // outcomes before the model is trusted at all
  const PENDING_MS = 3 * 60000; // a lock screen left unanswered this long counts as resisted
  const WEEK = 168;

  const blank = () => ({
    model: { w: new Array(FEATURES).fill(0), n: 0, site: {} },
    weekly: new Array(WEEK).fill(0),
    t: 0,
    recent: {},
    lastUnlock: {},
    bandit: {},
    daily: {},
    pending: {},
  });

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  const slotOf = (d) => d.getDay() * 24 + d.getHours();
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  // ------------------------------------------------------------- features

  function features(brain, site, now, fails) {
    const d = new Date(now);
    const hr = d.getHours() + d.getMinutes() / 60;
    const a = (2 * Math.PI * hr) / 24;
    const w = (2 * Math.PI * d.getDay()) / 7;
    const rec = ((brain.recent || {})[site] || []).filter((t) => now - t < 3600000).length;
    const since = (brain.lastUnlock || {})[site];
    const sinceMin = since ? (now - since) / 60000 : 1440;
    return [
      1,
      Math.sin(a), Math.cos(a), Math.sin(2 * a), Math.cos(2 * a),
      Math.sin(w), Math.cos(w),
      Math.min(rec, 6) / 6,
      1 / (1 + sinceMin / 30),
      Math.min(fails || 0, 5) / 5,
      d.getDay() === 0 || d.getDay() === 6 ? 1 : 0,
    ];
  }

  // ---------------------------------------------------------------- model

  function predict(brain, site, x) {
    const m = brain.model;
    let z = m.site[site] || 0;
    for (let i = 0; i < x.length; i++) z += m.w[i] * x[i];
    return sigmoid(z);
  }

  // One small correction step that shrinks as evidence builds, plus a little
  // damping so a handful of outcomes can't swing it wildly.
  function learn(brain, site, x, y) {
    const m = brain.model;
    const p = predict(brain, site, x);
    const lr = 0.4 / Math.sqrt(1 + m.n / 10);
    const err = y - p;
    for (let i = 0; i < x.length; i++) m.w[i] += lr * (err * x[i] - 0.002 * m.w[i]);
    m.site[site] = clamp((m.site[site] || 0) + lr * err * 0.5, -3, 3);
    m.n += 1;
  }

  // ------------------------------------------------------ hour-of-week density

  // Decay, then drop a unit of weight on this hour of the week.
  function noteHabit(brain, now) {
    const f = brain.t && now > brain.t ? Math.pow(0.985, Math.min(60, (now - brain.t) / 86400000)) : 1;
    brain.weekly = brain.weekly.map((v) => v * f);
    brain.weekly[slotOf(new Date(now))] += 1;
    brain.t = now;
  }

  // How typical is this hour for you, 0..1 (1 = your busiest time). Smoothed
  // across neighbouring hours and wrapped around the week.
  function density(brain, now) {
    const d = new Date(now);
    const s = slotOf(d);
    // Hour-of-week alone is thin early on (a few events per slot), so blend it
    // with the plain hour-of-day curve, which fills in faster.
    const sm = new Array(WEEK).fill(0);
    for (let i = 0; i < WEEK; i++) {
      if (!brain.weekly[i]) continue;
      for (let k = -3; k <= 3; k++) sm[(i + k + WEEK) % WEEK] += brain.weekly[i] * Math.exp(-(k * k) / 2);
    }
    const hourly = new Array(24).fill(0);
    for (let i = 0; i < WEEK; i++) hourly[i % 24] += brain.weekly[i];
    const hs = new Array(24).fill(0);
    for (let i = 0; i < 24; i++) for (let k = -2; k <= 2; k++) hs[(i + k + 24) % 24] += hourly[i] * Math.exp(-(k * k) / 2);
    const week = sm[s] / Math.max(...sm, 1e-9);
    const day = hs[d.getHours()] / Math.max(...hs, 1e-9);
    return 0.35 * week + 0.65 * day;
  }

  // ---------------------------------------------------------------- bandit

  function gaussian(rng) {
    const u = Math.max(rng(), 1e-12), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Gamma(shape) by Marsaglia and Tsang, which gives Beta draws.
  function gamma(shape, rng) {
    if (shape < 1) return gamma(shape + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do {
        x = gaussian(rng);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  const beta = (a, b, rng) => {
    const x = gamma(a, rng), y = gamma(b, rng);
    return x / (x + y);
  };

  const arm = (brain, bucket, i) => ((brain.bandit || {})[bucket] || {})[i] || { a: 1, b: 1 };

  // Draw a plausible success rate for each pause length and use the best draw.
  // Uncertain choices still get tried, proven ones get used.
  function chooseArm(brain, bucket, rng) {
    let best = 0, bestV = -1;
    for (let i = 0; i < ARMS.length; i++) {
      const { a, b } = arm(brain, bucket, i);
      const v = beta(a, b, rng);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return best;
  }

  // reward: did you resist? Longer pauses cost a little, so Soteria uses the
  // gentlest one that works instead of drifting to the longest.
  function rewardArm(brain, bucket, i, resisted) {
    brain.bandit = brain.bandit || {};
    const row = (brain.bandit[bucket] = brain.bandit[bucket] || {});
    const cur = row[i] || { a: 1, b: 1 };
    const r = resisted ? clamp(1 - 0.015 * ARMS[i], 0, 1) : 0;
    row[i] = { a: cur.a + r, b: cur.b + (1 - r) };
  }

  // ------------------------------------------------------------- decision

  function levelFrom(score) {
    return score >= 0.6 ? "high" : score >= 0.3 ? "watchful" : "calm";
  }

  // What to do at a lock screen right now. rng is injectable for tests.
  function decide(brain, site, now, fails, rng) {
    const known = brain.model.n >= MIN_OUTCOMES;
    // Features are kept even while still learning, so every moment teaches.
    const x = features(brain, site, now, fails);
    if (!known) return { known: false, level: "learning", pause: 0, arm: -1, bucket: "", p: 0, score: 0, x };
    const p = predict(brain, site, x);
    const dens = density(brain, now);
    let score = 0.5 * dens + 0.5 * p;
    if ((fails || 0) >= 3) score += 0.25;
    score = clamp(score, 0, 1);
    const level = levelFrom(score);
    if (level === "calm") return { known: true, level, pause: 0, arm: -1, bucket: "calm", p, score, x };
    const i = chooseArm(brain, level, rng || Math.random);
    return { known: true, level, pause: ARMS[i], arm: i, bucket: level, p, score, x };
  }

  const REASONS = ["messages", "work", "bored", "other"];

  // One record per day: how many lock screens, how many unlocks, and where, when
  // and why. Counts only. Older records without the extra fields still work.
  function dayRec(brain, key) {
    const r = brain.daily[key] || { tries: 0, unlocks: 0 };
    r.s = r.s || {};
    r.h = r.h || {};
    r.r = r.r || {};
    brain.daily[key] = r;
    return r;
  }

  // A lock screen appeared. Settle any earlier one that went unanswered, then
  // remember this one so its outcome can teach the model.
  function onShown(brain, site, now, decision) {
    settle(brain, now, site);
    brain.recent[site] = ((brain.recent[site] || []).concat(now)).slice(-20);
    brain.pending[site] = { ts: now, x: decision && decision.x, arm: decision ? decision.arm : -1, bucket: decision ? decision.bucket : "" };
    const d = new Date(now);
    const day = dayRec(brain, dayKey(d));
    day.tries += 1;
    const sd = (day.s[site] = day.s[site] || { t: 0, u: 0 });
    sd.t += 1;
    const keys = Object.keys(brain.daily).sort();
    while (keys.length > 42) delete brain.daily[keys.shift()];
  }

  function resolve(brain, site, gaveIn) {
    const p = brain.pending[site];
    if (!p) return;
    delete brain.pending[site];
    if (p.x) learn(brain, site, p.x, gaveIn ? 1 : 0);
    if (p.arm >= 0 && p.bucket) rewardArm(brain, p.bucket, p.arm, !gaveIn);
  }

  function onUnlock(brain, site, now, why) {
    resolve(brain, site, true);
    noteHabit(brain, now);
    brain.lastUnlock[site] = now;
    const d = new Date(now);
    const day = dayRec(brain, dayKey(d));
    day.unlocks += 1;
    const sd = (day.s[site] = day.s[site] || { t: 0, u: 0 });
    sd.u += 1;
    day.h[d.getHours()] = (day.h[d.getHours()] || 0) + 1;
    if (REASONS.includes(why)) day.r[why] = (day.r[why] || 0) + 1;
  }

  // A lock screen nobody answered for a few minutes means you walked away from
  // the site. That is a win, and it is what the model and bandit learn from.
  function settle(brain, now, except) {
    for (const site of Object.keys(brain.pending)) {
      if (site !== except && now - brain.pending[site].ts < PENDING_MS) continue;
      if (site === except || now - brain.pending[site].ts >= PENDING_MS) resolve(brain, site, false);
    }
  }

  // ------------------------------------------------------- drift detection

  // Watches daily attempts. Compares the last few days with your own earlier
  // baseline, so "a lot" means a lot for you.
  function drift(brain, now) {
    const days = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push((brain.daily[dayKey(d)] || { tries: 0 }).tries);
    }
    const base = days.slice(0, 21);
    const nonzero = base.filter((n) => n > 0).length;
    if (nonzero < 7) return { state: "learning" };
    const mean = base.reduce((a, b) => a + b, 0) / base.length;
    const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) * (b - mean), 0) / base.length) || 1;
    let s = 0, sLow = 0;
    for (const n of days.slice(21)) {
      s = Math.max(0, s + (n - mean) / sd - 0.5);
      sLow = Math.max(0, sLow + (mean - n) / sd - 0.5);
    }
    const recent = days.slice(21).reduce((a, b) => a + b, 0) / 7;
    if (s > 2.5) return { state: "up", mean, recent };
    if (sLow > 2.5) return { state: "down", mean, recent };
    return { state: "steady", mean, recent };
  }

  // How out of character is it to be unlocking right now? Near 1 means you
  // almost never use these sites at this hour.
  const unusualness = (brain, now) => (brain.model.n + Object.keys(brain.recent).length < 3 ? 0 : 1 - density(brain, now));

  // What the pause choices currently suggest works, for the Insights page.
  function armSummary(brain) {
    const out = [];
    for (const bucket of ["watchful", "high"]) {
      let best = null;
      ARMS.forEach((s, i) => {
        const { a, b } = arm(brain, bucket, i);
        const n = a + b - 2;
        if (n < 3) return;
        const mean = a / (a + b);
        if (!best || mean > best.mean) best = { bucket, pause: s, mean, n: Math.round(n) };
      });
      if (best) out.push(best);
    }
    return out;
  }

  DVL.brain = Object.freeze({
    REASONS, ARMS, MIN_OUTCOMES, PENDING_MS, blank, features, predict, learn, noteHabit, density,
    chooseArm, rewardArm, decide, onShown, onUnlock, settle, drift, unusualness, armSummary, beta,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = DVL.brain;
})(typeof globalThis !== "undefined" ? globalThis : this);
