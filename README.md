# Daily Summary Widget

A JARVIS-style daily briefing on your iOS home screen, built with
[Scriptable](https://scriptable.app). It's a phone port of the Home-tab summary
from [Logan's New Tab](https://github.com/logankm02/logans-new-tab) —
same prompt, same calm tone, regenerated independently on-device.

## What it shows

One short briefing per day covering:

- **Calendar** — today + the most time-sensitive thing this week (native iOS Calendar, including any Google account synced into it)
- **Tasks** — a nudge toward what matters (native iOS Reminders)
- **Sports** — Liverpool / Bills, only if a game is today or tomorrow (ESPN public API)
- **News** — one top headline, pinned at the bottom (Google News RSS, no key)
- **Weather** — only when it's actually actionable, e.g. rain or snow (open-meteo, no key)

It generates with Google Gemini and **caches one summary per day**; the headline
is fetched fresh each run (cached ~30 min). The widget stays cheap no matter how
often iOS refreshes it. Weather is intentionally downplayed — your phone already
shows the temperature.

## Setup

1. Install **Scriptable** from the App Store.
2. Copy `daily-summary-widget.js` into Scriptable:
   - Open Scriptable → **+** (new script) → paste the file contents, **or**
   - Drop the file into the `Scriptable` folder in iCloud Drive.
3. Run the script once **inside the app**. It will:
   - Prompt for your **Gemini API key** ([aistudio.google.com](https://aistudio.google.com)) — stored in the iOS Keychain, not in the file.
   - Ask for **Calendar**, **Reminders**, and **Location** permissions.
   - Show a preview of the medium widget.
4. Add the widget: long-press the home screen → **+** → **Scriptable** →
   pick **Medium** → add → long-press it → **Edit Widget** → choose this script.

### Iterating from GitHub (no iCloud / no copy-paste)

Instead of pasting `daily-summary-widget.js` itself, paste **`loader.js`** into
Scriptable once and point the widget at that. On every run the loader fetches
the latest `daily-summary-widget.js` from this repo's raw URL and executes it,
so the loop becomes: edit here → `git push` → re-run on phone. The loader needs
network each run (the widget already does) and your Gemini key still lives in the
phone Keychain, never in the repo.

## Configuration

Edit the `CONFIG` block at the top of `daily-summary-widget.js`:

| Key             | Default | Meaning                                  |
| --------------- | ------- | ---------------------------------------- |
| `soccerTeamId`  | `364`   | ESPN soccer team id (Liverpool)          |
| `soccerTeamName`| `Liverpool` | Display name used in the prompt      |
| `nflTeamId`     | `2`     | ESPN NFL team id (Buffalo Bills)         |
| `calendarDays`  | `7`     | How many days ahead to scan the calendar |
| `models`        | Gemini Flash Lite → Flash | Fallback order            |

To reset the stored API key, run the script in-app after deleting the
`daily-summary-gemini-key` Keychain entry (or add a reset action — see TODO).

## Notes

- **Best widget size:** Medium — there's room for the full briefing.
- **Refresh:** iOS decides when to refresh widgets (~every 15–30 min). The daily
  cache means a refresh only hits Gemini once per day; the rest read the cache.
- **Force a fresh summary:** run the script in-app (it regenerates if the cached
  date isn't today), or delete `daily-summary-cache.json` from Scriptable's
  local documents.

## TODO / ideas

- [ ] Settings via Scriptable parameters instead of editing `CONFIG`.
- [ ] Small-size layout (truncated) and large-size (summary + glance row).
- [ ] Optional: share the summary with the Chrome extension via a tiny backend
      so both surfaces show the identical text.
- [ ] "Regenerate" action when run in-app.
