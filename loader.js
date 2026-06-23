// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: sun;
//
// Daily Summary Widget — GitHub loader.
//
// Paste this into Scriptable ONCE and point your home-screen widget at it.
// On every run it fetches the latest daily-summary-widget.js from GitHub and
// executes it, so you iterate in the repo and just `git push` — no iCloud,
// no copy/paste, no reinstall. This loader itself never needs editing.
//
// First run: do it inside the Scriptable app so the fetched code can prompt
// for your Gemini key and Calendar/Reminders/Location permissions.

const URL =
  "https://raw.githubusercontent.com/logankm02/daily-summary-widget/main/daily-summary-widget.js";

// ?t= busts GitHub's raw CDN cache (~5 min) so you get changes right after pushing.
const code = await new Request(`${URL}?t=${Date.now()}`).loadString();
await eval(`(async () => { ${code} })()`);
