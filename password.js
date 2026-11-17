/* Soteria by DrSkyle
 * Password hashing. The password itself is never stored; only a salted PBKDF2
 * hash is. Runs in the background and in extension pages (secure contexts), and
 * never in a web page, because crypto.subtle is missing on plain http sites.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});
  const ITERATIONS = 150000;

  function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function newSalt(len) {
    return toB64(root.crypto.getRandomValues(new Uint8Array(len || 16)));
  }

  async function hash(password, saltB64) {
    const enc = new TextEncoder();
    const key = await root.crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await root.crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromB64(saltB64), iterations: ITERATIONS, hash: "SHA-256" },
      key,
      256
    );
    return toB64(new Uint8Array(bits));
  }

  // Compare without bailing out at the first different character.
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function verify(password, saltB64, expectedHash) {
    try {
      return safeEqual(await hash(password, saltB64), expectedHash);
    } catch (e) {
      return false;
    }
  }

  DVL.pw = Object.freeze({ newSalt, hash, verify, safeEqual });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.pw;
})(typeof globalThis !== "undefined" ? globalThis : this);
