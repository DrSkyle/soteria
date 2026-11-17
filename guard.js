/* Soteria by DrSkyle: guard page.
 * Shown in place of the browser's extensions page. A correct password (or an
 * approval from your partner) opens the page you were going to, for a few
 * minutes. Anything else stays here.
 */
(function () {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const L = globalThis.DevilabsSoteria.logic;
  const $ = (id) => document.getElementById(id);
  const next = new URLSearchParams(location.search).get("next") || "";
  const target = L.isManagePage(next) ? next : ""; // never an open redirect
  const send = (m) => api.runtime.sendMessage(m);
  let partnerReq = null;

  api.storage.local.get({ partner: null }).then(({ partner }) => {
    if (!partner) return;
    $("partner").hidden = false;
    $("ask").textContent = "Ask " + (partner.name || "your partner") + " instead";
  });

  async function go() {
    const tab = await api.tabs.getCurrent();
    if (target && tab) await api.tabs.update(tab.id, { url: target });
    else if (tab) await api.tabs.remove(tab.id);
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("input").value;
    if (!v) return;
    $("msg").textContent = "";
    let res;
    try {
      res = partnerReq
        ? await send({ type: L.MSG.verifyPassword, site: "__extensions__", partnerRequest: partnerReq, partnerResponse: v })
        : await send({ type: L.MSG.verifyPassword, site: "__extensions__", attempt: v });
    } catch (err) {
      res = { ok: false, error: "failed" };
    }
    $("input").value = "";
    if (res && res.ok) return go();
    if (res && res.error === "partner-only") $("msg").textContent = "Quiet hours: only your partner can open this.";
    else if (res && res.cooldown > 0) $("msg").textContent = "Too many attempts. Try again in " + res.cooldown + "s.";
    else $("msg").textContent = partnerReq ? "That reply didn't match." : "Incorrect password.";
  });

  $("ask").addEventListener("click", async () => {
    const res = await send({ type: L.MSG.askPartner, site: "__extensions__" }).catch(() => null);
    if (!res || !res.ok) return void ($("msg").textContent = "Couldn't make a request. Try again.");
    partnerReq = res.request;
    $("req").value = res.request;
    $("reqbox").hidden = false;
    $("ask").hidden = true;
    $("input").type = "text";
    $("input").placeholder = "Paste their reply";
    $("input").focus();
  });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("req").value); $("copy").textContent = "Copied"; } catch (e) { $("req").select(); }
  });
  $("leave").addEventListener("click", async () => {
    const tab = await api.tabs.getCurrent();
    if (tab) api.tabs.remove(tab.id);
  });
  $("input").focus();
})();
