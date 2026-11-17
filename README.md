# Soteria

**A website blocker that learns you.**

Free and open source (MIT). No account, no ads, nothing leaves your device.

Soteria puts your own password in front of the sites you want to use less, notices when you tend to give in, and makes those moments a little harder. It also warns you about phishing sites and tells you if anything tries to get around it.

- **No account. No ads. No tracking.** Soteria makes no network requests. This is enforced by a test in this repo, not just a promise.
- **Learns on your device.** It keeps counts (which hours you unlock, whether you gave in or walked away) and nothing else. You can erase it any time.
- **Works in** Chrome, Edge, Brave, Vivaldi, Arc, Opera and Firefox.

## What you get

| | |
|---|---|
| **A lock that is yours** | Your password, a lock screen that can disguise itself as an ordinary error page, and a panic key (`Ctrl/Cmd+Shift+L`) that locks everything at once. |
| **Timed unlocks** | When you unlock a site you choose how long: 5, 15, 30 minutes, or while you're there. A small pill shows the last minute and the lock comes back on time. |
| **It learns when you struggle** | At hours you tend to give in, it asks for a short pause first, and keeps whichever nudge actually works for you. |
| **Your week** | A short, honest summary every Sunday: what you walked away from, when it got hard, and why you went in. Save it as an image. |
| **Phishing and look-alikes** | Warns on known phishing sites (about 390,000 domains from the open-source [Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database), checked on your device) and on copies of the sites you protect. |
| **An accountability partner** | Pick a friend. At your hardest hours, only they can unlock things: Soteria shows a one-time request code, they approve it on their own device and send a reply code back. No server, no account, nothing uploaded. See below. |
| **Share a list** | Turn your blocklist into a short code. A friend pastes it and has the same list. |

Every feature is free. There is no paid tier, no trial and no locked feature.

## Accountability partner, how it works

1. Your friend opens `partner.html` (any browser, works offline) and taps **Create my partner code**. Their private key stays on their device.
2. You paste their public code into Soteria (Security, Accountability partner).
3. When you ask for an unlock, Soteria shows a one-time request. You send it to your friend. They see what you're asking for ("instagram.com for 15 minutes") and approve it, or just don't reply.
4. Their reply is a signature that Soteria checks against their public key. It works once, for that exact request, for 15 minutes.

Turn on **Only my partner can unlock during quiet hours** and your own password stops working then, including for settings. Turning that off, changing quiet hours, removing the partner or erasing Soteria all need your partner's reply.

**Honest limits.** This is only as strong as your partner is separate from you: if you make the key yourself, it is a speed bump, not a guard. Anyone with full control of your browser can still disable any extension. If your partner disappears, there is a 7-day wait after which you can make the change without them, and quiet hours longer than 12 hours are refused so you can't lock yourself out.

## Languages and accessibility

- **Languages:** English, Spanish, French, German, Portuguese, Italian, Japanese, Chinese (Simplified) and Arabic (right to left) on the lock screen, the toolbar popup, first-run setup and the partner page, with the store listing translated too. Pick one in Settings, Security, or leave it on Automatic. The settings pages, the extensions-page guard screen, the weekly summary and Ask Soteria are still English. The translations were written by the project, not by professional translators, so native speakers' corrections are very welcome. To add a language, copy `i18n-src/en.txt`, translate the values, add a line to `i18n-src/meta.json` and run `node tools/build-locales.mjs`.
- **Accessibility:** every page is checked with the axe-core accessibility engine, text keeps at least 4.5:1 contrast over any page behind the lock screen (a test enforces this), the page behind the lock is made inert, focus is visible, reduced-motion and forced-colours modes are respected, and the unlock countdown is announced to screen readers at 30 and 10 seconds. Automated checks catch only part of this, so please report anything that gets in your way.

## Weekly check-in

If you have a partner, Home shows "Send to my partner" under your week. It makes a short code with only your totals (no sites, no times, no reasons). Your partner pastes it into the partner page and sees your week in their language. It is self-reported: Soteria can't prove the numbers, so it is a conversation starter, not a verdict.

## Forgot your password, and removal

- **Forgot your password?** There is no back door, but there is a way back: on the settings lock screen, choose "Forgot your password?" and start a 24-hour wait, then set a new one. The wait is so a hard moment can't be used to skip the lock. If you have an accountability partner, their approval skips the wait.
- **Protect Soteria from removal (optional).** Turn on "Ask for my password before the extensions page opens" and the browser's extensions page asks for your password (or your partner's approval) first. It needs the optional "tabs" permission, which Soteria asks for only when you switch this on and uses only to read the address of a tab. **Be aware:** the browser's own right-click "Remove" on the toolbar icon can't be blocked by any extension, and nothing stops you using a different browser. It makes removing Soteria slower, not impossible. For a real lock, use your operating system or browser administration tools.

## Install

**One click:** download **Soteria Setup** from [Releases](../../releases). It finds the browsers on your computer and takes each one to the install step. (Browsers don't allow anything to install an extension silently, so you click Add.)

**Or** add it from the Chrome Web Store or Firefox Add-ons: _links here after publishing_.

## Privacy, exactly

Soteria stores your settings and what it has learned in your browser's own storage. It never sends them anywhere. The only data it keeps about you is counts: unlocks per hour and weekday, whether each lock screen ended in an unlock, and optional one-tap reasons. `npm test` fails if any network call is added.

## Build from source

```sh
npm install
npm test
npm run build        # dist/chrome.zip, dist/firefox.zip
npm run installer    # run Soteria Setup from source
```

## Support

Soteria is free and kept going by donations. If it helps you, please consider supporting it: [Patreon](https://www.patreon.com/cw/DrSkyle/membership). Questions and ideas: _contact link here_.

## License

[MIT](LICENSE). Use it, change it, share it.
