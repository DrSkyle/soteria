# Soteria

A private, password-locked website blocker for Firefox.

Pick the sites that pull you in. Soteria blurs and locks them, and only your
password opens them. Everything happens on your device: no account, no network,
no tracking, nothing sent anywhere.

## What it does

- Blur and lock any site you choose, behind one password.
- Quiet hours and daily limits for the moments that are hardest.
- A panic key (`Ctrl+Shift+L` / `Cmd+Shift+L`) locks every protected site at once.
- Optional accountability partner: approve unlocks with short codes, no server.
- Warns about known phishing domains and look-alike addresses, using a list
  bundled with the extension.
- Local-only activity counts so you can see your own patterns.

## Install

### From Firefox Add-ons

Install from the official listing: <!-- add your AMO link here -->

### For development

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this folder.

The temporary add-on lasts until Firefox closes.

## Privacy

Soteria stores its settings, password hash (PBKDF2), and usage counts in the
browser's local extension storage. It never sends data anywhere and has no
server. The phishing list is checked locally. See `privacy.md` if present.

## Licence

MIT. See [LICENSE](LICENSE).

## Support

Soteria is free and open source. If it helps you, you can support development
here: https://www.patreon.com/cw/DrSkyle/membership
