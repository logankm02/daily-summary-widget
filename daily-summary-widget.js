// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: sun;
//
// Daily Summary Widget — a JARVIS-style daily briefing for the iOS home screen.
// Port of the Chrome new-tab Home summary (Logan's New Tab / logans-new-tab) to Scriptable.
//
// Data sources (all on-device or public, no extra backend):
//   • Calendar  — native iOS Calendar (next 7 days)
//   • Tasks     — native iOS Reminders (incomplete)
//   • Weather   — open-meteo.com (no key)
//   • Fixtures  — ESPN public API (Liverpool + Bills)
//   • Summary   — Google Gemini (your API key)
//
// Setup: see README.md. First run in-app prompts for your Gemini key and
// permissions, then caches one briefing per day so the widget stays cheap.

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  soccerTeamId: 364, // Liverpool — ESPN team id
  soccerTeamName: "Liverpool",
  nflTeamId: 2, // Buffalo Bills — ESPN team id
  calendarDays: 7,
  models: ["gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-2.0-flash"],
};

const CACHE_FILE = "daily-summary-cache.json";
const NEWS_CACHE_FILE = "daily-summary-news.json";

// ── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  const apiKey = await getApiKey();
  // The briefing is cached once per day; the headline is fetched fresh each run
  // (it's free and changes through the day), so they run independently.
  const [summary, news] = await Promise.all([getSummary(apiKey), getNews()]);

  const widget = buildWidget(summary, news);
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // Running inside the Scriptable app — preview a medium widget.
    await widget.presentMedium();
  }
  Script.complete();
}

// ── Gemini key (stored in Keychain) ──────────────────────────────────────────
async function getApiKey() {
  if (Keychain.contains("daily-summary-gemini-key")) {
    return Keychain.get("daily-summary-gemini-key");
  }
  if (config.runsInWidget) return ""; // can't prompt from a widget
  const a = new Alert();
  a.title = "Gemini API key";
  a.message = "Paste your Google Gemini API key (aistudio.google.com). Stored in the iOS Keychain.";
  a.addSecureTextField("API key");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  const idx = await a.present();
  if (idx === -1) return "";
  const key = a.textFieldValue(0).trim();
  if (key) Keychain.set("daily-summary-gemini-key", key);
  return key;
}

// ── Summary (with per-day cache) ──────────────────────────────────────────────
async function getSummary(apiKey) {
  const today = todayKey();
  const cached = readCache();
  if (cached?.date === today && cached.summary) return cached.summary;

  if (!apiKey) {
    return "Add a Gemini API key (run this script once in the Scriptable app) to get daily summaries.";
  }

  try {
    const [calendar, tasks, weather, fixtures] = await Promise.all([
      getCalendar(),
      getTasks(),
      getWeather(),
      getFixtures(),
    ]);
    const text = await generateSummary(apiKey, { calendar, tasks, weather, fixtures });
    writeCache({ date: today, summary: text });
    return text;
  } catch (err) {
    if (cached?.summary) return cached.summary; // fall back to whatever we last had
    return `Could not generate summary${err?.message ? ` — ${err.message}` : ""}.`;
  }
}

// ── Data: Calendar (next N days) ──────────────────────────────────────────────
async function getCalendar() {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + CONFIG.calendarDays * 86400000);
    const events = await CalendarEvent.between(now, end);
    return events.slice(0, 6).map((e) => ({
      title: e.title,
      start: e.startDate,
      allDay: e.isAllDay,
    }));
  } catch {
    return [];
  }
}

// ── Data: Reminders / tasks ──────────────────────────────────────────────────
async function getTasks() {
  try {
    const reminders = await Reminder.allIncomplete();
    return reminders.slice(0, 8).map((r) => r.title).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Data: Weather (open-meteo, current + rest of today) ──────────────────────
async function getWeather() {
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await Location.current();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m&hourly=temperature_2m,precipitation_probability,weathercode` +
      `&forecast_days=1&timezone=auto`;
    const data = await new Request(url).loadJSON();
    const hours = data.hourly?.time || [];
    const nowHour = new Date().getHours();
    const rest = hours
      .map((t, i) => ({
        hour: new Date(t).getHours(),
        temp: Math.round(data.hourly.temperature_2m[i]),
        rain: data.hourly.precipitation_probability[i],
        code: data.hourly.weathercode[i],
      }))
      .filter((h) => h.hour >= nowHour);
    if (!rest.length) return null;

    const temps = rest.map((h) => h.temp);
    const place = await Location.reverseGeocode(loc.latitude, loc.longitude).catch(() => []);
    return {
      location: place?.[0]?.locality || place?.[0]?.administrativeArea || "your area",
      current: Math.round(data.current?.temperature_2m ?? temps[0]),
      lo: Math.min(...temps),
      hi: Math.max(...temps),
      maxRain: Math.max(...rest.map((h) => h.rain)),
      isHeavyRain: rest.some((h) => [61, 63, 65, 80, 81, 82, 95, 96, 99].includes(h.code)),
      isSnow: rest.some((h) => [71, 73, 75].includes(h.code)),
    };
  } catch {
    return null;
  }
}

// ── Data: ESPN fixtures (Liverpool + Bills) ──────────────────────────────────
async function getFixtures() {
  const [liverpool, bills] = await Promise.all([
    getNextSoccerFixture(CONFIG.soccerTeamId),
    getNextNflFixture(CONFIG.nflTeamId),
  ]);
  return { liverpool, bills };
}

async function getNextSoccerFixture(teamId) {
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 86400000);
  const fmt = (d) => d.toISOString().split("T")[0].replace(/-/g, "");
  const leagues = ["eng.1", "uefa.champions", "uefa.europa", "eng.fa", "eng.league_cup"];
  const idStr = String(teamId);
  for (const league of leagues) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${fmt(now)}-${fmt(twoWeeks)}&limit=20`;
      const d = await new Request(url).loadJSON();
      const match = (d.events || []).find((e) =>
        e.competitions?.[0]?.competitors?.some((c) => c.team?.id === idStr),
      );
      if (match) {
        const opp = match.competitions[0].competitors.find((c) => c.team?.id !== idStr);
        return { opponent: opp?.team?.displayName, date: match.date };
      }
    } catch { /* try next league */ }
  }
  return null;
}

async function getNextNflFixture(teamId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/schedule`;
    const data = await new Request(url).loadJSON();
    const now = new Date();
    const idStr = String(teamId);
    const game = (data.events || []).find((e) => {
      const state = e.competitions?.[0]?.status?.type?.state;
      return state === "in" || new Date(e.date) >= now;
    });
    if (!game) return null;
    const opp = game.competitions[0].competitors.find((c) => c.team?.id !== idStr);
    return { opponent: opp?.team?.displayName, date: game.date };
  } catch {
    return null;
  }
}

// ── Data: News (Google News RSS, no key) ─────────────────────────────────────
// Fetched fresh each run but cached briefly so frequent widget refreshes don't
// hammer the feed and so it survives a dropped connection.
async function getNews() {
  const cached = readNewsCache();
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.news;
  try {
    const xml = await new Request(
      "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    ).loadString();
    const title = firstHeadline(xml);
    if (!title) return cached?.news || null;
    const news = { title: tidy(stripSource(title)) };
    writeNewsCache({ ts: Date.now(), news });
    return news;
  } catch {
    return cached?.news || null; // offline: show the last headline we had
  }
}

// Pull the first <item><title> out of the RSS, ignoring the channel's own title.
function firstHeadline(xml) {
  const parser = new XMLParser(xml);
  let inItem = false, capturing = false, current = "", result = null;
  parser.didStartElement = (name) => {
    if (name === "item") inItem = true;
    if (inItem && name === "title" && result === null) { capturing = true; current = ""; }
  };
  parser.foundCharacters = (str) => { if (capturing) current += str; };
  parser.didEndElement = (name) => {
    if (name === "title" && capturing) { result = current.trim(); capturing = false; }
    if (name === "item") inItem = false;
  };
  parser.parse();
  return result;
}

// Google News titles read "Headline - Source"; drop the trailing source.
function stripSource(title) {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

// ── Gemini call (mirrors the Chrome extension's prompt) ──────────────────────
async function generateSummary(apiKey, { calendar, tasks, weather, fixtures }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const sections = [];
  sections.push(
    calendar.length
      ? `Upcoming schedule (next ${CONFIG.calendarDays} days): ${calendar
          .map((e) => {
            const d = e.start;
            const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            const timeLabel = e.allDay ? "all day" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `${e.title} (${dateLabel}, ${timeLabel})`;
          })
          .join("; ")}.`
      : `No events in the next ${CONFIG.calendarDays} days.`,
  );
  if (tasks.length) sections.push(`Task list: ${tasks.join("; ")}.`);
  if (fixtures.liverpool?.opponent) {
    sections.push(`${CONFIG.soccerTeamName} fixture soon: vs ${fixtures.liverpool.opponent}.`);
  }
  if (fixtures.bills?.opponent) {
    const d = new Date(fixtures.bills.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    sections.push(`Bills next game: vs ${fixtures.bills.opponent} on ${d}.`);
  }
  if (weather) {
    const rainNote =
      weather.maxRain >= 60 ? `, ${weather.maxRain}% rain chance`
      : weather.maxRain >= 30 ? `, ${weather.maxRain}% chance of rain`
      : "";
    const precipNote = weather.isHeavyRain ? " — heavy rain likely" : weather.isSnow ? " — snow likely" : "";
    sections.push(`Weather today (${weather.location}): currently ${weather.current}°C, ranging ${weather.lo}–${weather.hi}°C${rainNote}${precipNote}.`);
  }

  const prompt =
    `You are JARVIS — a calm, dry, precise personal assistant. Today is ${today}.\n\n` +
    `Briefing data:\n${sections.join("\n")}\n\n` +
    `Write a daily briefing of 2-3 sentences, addressed to me in the second person ("you"). Guidance:\n` +
    `- Lead with what matters today: anything on the calendar today, plus the single most time-sensitive item in the week ahead. If nothing is on the calendar today, say so plainly. If there is something in the future we mention keep it very brief.\n` +
    `- If there are tasks on the list, work in a brief, pointed nudge toward the one or two that matter most. Skip entirely if there are none.\n` +
    `- Mention a Bills or Liverpool game only if it falls today or tomorrow; otherwise leave it out.\n` +
    `- I can already see the temperature on my phone, so do NOT report the forecast or give a jacket/hoodie call. Mention weather ONLY if it's genuinely actionable today — rain, snow, or a sharp swing worth planning around — and then in just a few words. Otherwise omit weather entirely.\n\n` +
    `Rules: use only the data above — never invent events, times, scores, or details. No greetings or time-of-day salutations (I may read this at any hour), no cheerleading, no sign-off, no filler. Keep it tight and matter-of-fact.`;

  let lastErr = "";
  for (const model of CONFIG.models) {
    try {
      const req = new Request(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      );
      req.method = "POST";
      req.headers = { "Content-Type": "application/json" };
      req.body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.85, thinkingConfig: { thinkingBudget: 0 } },
      });
      const data = await req.loadJSON();
      if (data?.error) {
        const msg = data.error.message || "";
        if (req.response?.statusCode === 404 || msg.includes("not found")) continue;
        lastErr = msg;
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return tidy(text);
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(lastErr || "no model responded");
}

// Collapse the stray double spaces (and other runs of whitespace) the model
// sometimes emits, without touching paragraph breaks.
function tidy(text) {
  return text
    .replace(/[ \t]{2,}/g, " ")   // runs of spaces/tabs → one space
    .replace(/ +\n/g, "\n")        // trailing spaces before newlines
    .trim();
}

// ── Widget UI ─────────────────────────────────────────────────────────────────
function buildWidget(summary, news) {
  const w = new ListWidget();
  const dark = Device.isUsingDarkAppearance();

  const bg = new LinearGradient();
  bg.locations = [0, 1];
  bg.colors = dark
    ? [new Color("#1f2633"), new Color("#2b3040")]
    : [new Color("#e8edf0"), new Color("#e9efe7")];
  w.backgroundGradient = bg;
  w.setPadding(16, 18, 16, 18);

  const ink = dark ? new Color("#f2f2f2") : new Color("#2c3033");
  const muted = dark ? new Color("#ffffff", 0.6) : new Color("#2c3033", 0.55);
  const accent = dark ? new Color("#5fc6ff") : new Color("#1f6fe0");

  const body = w.addText(summary);
  body.font = Font.regularSystemFont(15);
  body.textColor = ink;
  body.minimumScaleFactor = 0.7;

  w.addSpacer();

  // Pinned news line: accent "WIRE" tag + a single headline.
  if (news?.title) {
    const row = w.addStack();
    row.centerAlignContent();
    const tag = row.addText("WIRE");
    tag.font = Font.semiboldRoundedSystemFont(9);
    tag.textColor = accent;
    row.addSpacer(7);
    const hl = row.addText(news.title);
    hl.font = Font.mediumSystemFont(11);
    hl.textColor = muted;
    hl.lineLimit = 1;
    hl.minimumScaleFactor = 0.75;
  }

  return w;
}

// ── Cache helpers (file in Scriptable's local documents) ─────────────────────
function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}
function readCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (!fm.fileExists(p)) return null;
    return JSON.parse(fm.readString(p));
  } catch {
    return null;
  }
}
function writeCache(obj) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(obj));
  } catch { /* best effort */ }
}
function todayKey() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
}

function newsCachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), NEWS_CACHE_FILE);
}
function readNewsCache() {
  try {
    const fm = FileManager.local();
    const p = newsCachePath();
    if (!fm.fileExists(p)) return null;
    return JSON.parse(fm.readString(p));
  } catch {
    return null;
  }
}
function writeNewsCache(obj) {
  try {
    FileManager.local().writeString(newsCachePath(), JSON.stringify(obj));
  } catch { /* best effort */ }
}

await main();
