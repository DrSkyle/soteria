/* Soteria by DrSkyle: partner.
 * Partner approval with no server and no account. Your partner keeps a private
 * key on their own device; Soteria keeps only their public key. To unlock late
 * at night (or to remove the partner), Soteria shows a one-time request code,
 * your partner approves it on their device, and sends back a reply that Soteria
 * checks against their public key. A reply works once, for that request only.
 *
 * The same file runs inside the extension and on the partner page.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});
  const KEY = "SOTERIAKEY1.", REQ = "SOTERIAREQ1.", OK = "SOTERIAOK1.";
  const ALGO = { name: "ECDSA", namedCurve: "P-256" };
  const SIGN = { name: "ECDSA", hash: "SHA-256" };
  const enc = new TextEncoder(), dec = new TextDecoder();

  function b64u(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clean = (t) => String(t || "").replace(/\s+/g, "");
  const subtle = () => root.crypto.subtle;

  // ---- the partner's side: make a key, sign a request
  async function generateKeyPair() {
    const pair = await subtle().generateKey(ALGO, true, ["sign", "verify"]);
    const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    const privateJwk = await subtle().exportKey("jwk", pair.privateKey);
    return { publicCode: KEY + b64u(raw), privateJwk };
  }

  async function sign(privateJwk, requestText) {
    const key = await subtle().importKey("jwk", privateJwk, ALGO, false, ["sign"]);
    const sig = new Uint8Array(await subtle().sign(SIGN, key, enc.encode(clean(requestText))));
    return OK + b64u(sig);
  }

  // ---- Soteria's side: make a request, check a reply
  function makeRequest({ site, minutes, now, nonceBytes }) {
    const nonce = b64u(nonceBytes);
    const payload = JSON.stringify({ v: 1, s: String(site), m: Number(minutes) || 0, n: nonce, t: now });
    return { text: REQ + b64u(enc.encode(payload)), nonce };
  }

  function parseRequest(text) {
    const m = /^SOTERIAREQ1\.([A-Za-z0-9_-]+)$/.exec(clean(text));
    if (!m) return { ok: false };
    try {
      const d = JSON.parse(dec.decode(unb64u(m[1])));
      if (!d || d.v !== 1 || typeof d.s !== "string" || d.s.length > 253 || !Number.isFinite(d.m) || d.m < 0 || d.m > 1440 || !/^[A-Za-z0-9_-]{16,32}$/.test(d.n) || !Number.isFinite(d.t)) return { ok: false };
      return { ok: true, site: d.s, minutes: d.m, nonce: d.n, time: d.t };
    } catch (e) {
      return { ok: false };
    }
  }

  function parsePublicCode(code) {
    const m = /^SOTERIAKEY1\.([A-Za-z0-9_-]+)$/.exec(clean(code));
    if (!m) return null;
    try {
      const raw = unb64u(m[1]);
      return raw.length === 65 && raw[0] === 4 ? raw : null;
    } catch (e) {
      return null;
    }
  }

  // Is this a real P-256 public key, not just something that looks like one?
  async function checkPublicCode(code) {
    const raw = parsePublicCode(code);
    if (!raw) return false;
    try {
      await subtle().importKey("raw", raw, ALGO, false, ["verify"]);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function verify(publicCode, requestText, responseText) {
    const raw = parsePublicCode(publicCode);
    const m = /^SOTERIAOK1\.([A-Za-z0-9_-]+)$/.exec(clean(responseText));
    if (!raw || !m) return false;
    try {
      const sig = unb64u(m[1]);
      if (sig.length !== 64) return false;
      const key = await subtle().importKey("raw", raw, ALGO, false, ["verify"]);
      return await subtle().verify(SIGN, key, sig, enc.encode(clean(requestText)));
    } catch (e) {
      return false;
    }
  }

  // ---- weekly check-in: the owner's totals for a week, as a pasteable code.
  // It is self-reported (nothing signs it), so it can show a partner what
  // someone chose to share, not prove it. Totals only: no sites, no hours.
  const WEEK = "SOTERIAWEEK1.";
  const TONES = ["better", "steady", "harder", "quiet"];
  function check4(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h & 0xffff).toString(16).padStart(4, "0");
  }
  const int = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

  function makeCheckin(c) {
    const name = String(c.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);
    const body = b64u(enc.encode(JSON.stringify({ v: 1, n: name, w: c.week, t: c.tries, k: c.walked, u: c.unlocked, c: c.clean, a: c.active, o: c.tone })));
    return WEEK + body + "." + check4(body);
  }

  function parseCheckin(text) {
    const m = /^SOTERIAWEEK1\.([A-Za-z0-9_-]+)\.([0-9a-f]{4})$/.exec(clean(text));
    if (!m) return { ok: false, error: "format" };
    if (check4(m[1]) !== m[2]) return { ok: false, error: "damaged" };
    try {
      const d = JSON.parse(dec.decode(unb64u(m[1])));
      const good = d && d.v === 1 && typeof d.n === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.w) && int(d.t, 99999) && int(d.k, 99999) && int(d.u, 99999) && int(d.c, 7) && int(d.a, 7) && d.c <= d.a && TONES.includes(d.o);
      if (!good) return { ok: false, error: "format" };
      return { ok: true, name: d.n.replace(/[\u0000-\u001f<>]/g, "").slice(0, 30), week: d.w, tries: d.t, walked: d.k, unlocked: d.u, clean: d.c, active: d.a, tone: d.o };
    } catch (e) {
      return { ok: false, error: "format" };
    }
  }

  // A short tail of the key, so two people can confirm they mean the same one.
  const fingerprint = (code) => clean(code).slice(-6);

  DVL.partner = Object.freeze({ generateKeyPair, sign, makeRequest, parseRequest, parsePublicCode, checkPublicCode, verify, fingerprint, makeCheckin, parseCheckin, b64u });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.partner;
})(typeof globalThis !== "undefined" ? globalThis : this);
