// @ts-check
/// <reference path="./kino.d.ts" />
// Fútbol Libre: today's football (and other sports) matches and the sports channels of three sister sites, with backups.
// Read it top to bottom: 1. texts  2. sites and settings  3. agenda  4. channels  5. shapes  6. live exports
//                        7. browse, search, home  8. section and categories  9. resolve  10. settings
//
// The sites, in the order they are tried (the next one only when the one before fails or comes back empty):
//   primary   futbollibretvplus.com   agenda: api.wqxag.com/diaries.json (JSON)
//   backup 1  futbollibreenvivo.futbol agenda: /api/agenda (JSON)
//   backup 2  futbol-libre.app        agenda: /agenda (HTML), playback: /api/direct-playback.php
// A match or a channel is a "ref" listing candidate players (tokens); resolve tries them until one answers a live playlist.

// ---- 1. texts ----------------------------------------------------------------------------------------------------

const TEXTS = {
  es: {
    catToday: "Partidos de hoy", catMain: "Canales deportivos", catMore: "Más canales",
    now: "En vivo ahora", next: "Próximos partidos", channels: "Canales", tabToday: "Hoy", tabChannels: "Canales",
    live: "EN VIVO", heroTitle: "Fútbol en vivo", heroText: "Partidos de hoy y canales deportivos, con varios servidores de respaldo.",
    offline: "Sin señal por ahora. Si el partido aún no empieza, vuelve en un rato o prueba otro.",
    unavailable: "Ningún servidor responde ahora. Intenta de nuevo en un momento.",
    unknownRef: "Ese partido o canal ya no está.",
    noAgenda: "No se pudo leer la agenda. Intenta de nuevo en un momento.",
    statusOk: "{n} partidos · {site}", statusEmpty: "Sin partidos · {site}", statusDown: "Sin conexión con ningún sitio",
    sitePrimary: "sitio principal", siteBackup1: "respaldo 1", siteBackup2: "respaldo 2",
    domains: "Principal: {a} · Respaldo 1: {b} · Respaldo 2: {c}", up: "responde", down: "no responde",
    days: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
  },
  en: {
    catToday: "Today's matches", catMain: "Sports channels", catMore: "More channels",
    now: "Live now", next: "Upcoming matches", channels: "Channels", tabToday: "Today", tabChannels: "Channels",
    live: "LIVE", heroTitle: "Live football", heroText: "Today's matches and sports channels, with several backup servers.",
    offline: "No signal right now. If the match has not started, come back in a while or try another.",
    unavailable: "No server answers right now. Try again in a moment.",
    unknownRef: "That match or channel is gone.",
    noAgenda: "The schedule could not be read. Try again in a moment.",
    statusOk: "{n} matches · {site}", statusEmpty: "No matches · {site}", statusDown: "No site answers",
    sitePrimary: "main site", siteBackup1: "backup 1", siteBackup2: "backup 2",
    domains: "Main: {a} · Backup 1: {b} · Backup 2: {c}", up: "answers", down: "is down",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
};

function t(key, vars) {
  const lang = String(kino.lang || "").toLowerCase().startsWith("es") ? "es" : "en";
  const v = TEXTS[lang][key] != null ? TEXTS[lang][key] : TEXTS.es[key];
  if (typeof v !== "string") return v != null ? v : key;
  return vars ? v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] != null ? vars[k] : "")) : v;
}

// ---- 2. sites and settings ---------------------------------------------------------------------------------------

const PRIMARY = "https://futbollibretvplus.com";
const BACKUP1 = "https://futbollibreenvivo.futbol";
const BACKUP2 = "https://futbol-libre.app";
const AGENDA_API = "https://api.wqxag.com/diaries.json";
const IMG = "https://img.wqxag.com";
const SOURCE_TEXT = { primary: "sitePrimary", backup1: "siteBackup1", backup2: "siteBackup2" };
const HOUR = 3600000;
const MATCH_MS = 150 * 60000; // a match counts as live for 2 h 30 after its start

const MEM = new Map();
let lastAgendaSource = "";

async function cached(key, ttlMs, fn) {
  const hit = MEM.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = await fn();
  MEM.set(key, { at: Date.now(), v });
  return v;
}

// The person's UTC offset, to show kick-off times (the engine has no Intl); the sites' own times are Lima's, UTC-5.
function offsetHours() {
  const n = parseInt(String(kino.config.get("utcOffset") || "-5"), 10);
  return Number.isFinite(n) ? n : -5;
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function clock(ms) {
  const d = new Date(ms + offsetHours() * HOUR);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}

function whenText(ms) {
  const shift = offsetHours() * HOUR;
  const d = new Date(ms + shift);
  const today = new Date(Date.now() + shift);
  const same = d.getUTCFullYear() === today.getUTCFullYear() && d.getUTCMonth() === today.getUTCMonth() && d.getUTCDate() === today.getUTCDate();
  return same ? clock(ms) : `${t("days")[d.getUTCDay()]} ${clock(ms)}`;
}

// ---- 3. agenda ---------------------------------------------------------------------------------------------------

function entities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function slug(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

// "Liga: Local vs Visitante" (the primary puts a line break after the colon).
function splitTitle(raw) {
  const text = entities(raw);
  const m = /^([^:]{2,80}):\s*(.+)$/.exec(text);
  return m ? { league: m[1].trim(), title: m[2].trim() } : { league: "", title: text };
}

function b64(s) {
  let x = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  try { return atob(x); } catch { return ""; }
}

// The player tokens a stream address stands for; "" for a host nobody here knows how to open.
function tokenOf(url) {
  const u = String(url || "");
  const id = (/[?&](?:stream|canal)=([A-Za-z0-9_-]{1,40})/.exec(u) || [])[1];
  if (!id) return "";
  if (/^https:\/\/(?:www\.)?tvf90\.com\//.test(u)) return "tvf90." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\/vivo\/canales\.php/.test(u)) return "la18c." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\//.test(u)) return "la18." + id;
  if (/^https:\/\/streamxhd\.st\//.test(u)) return "sxhd." + id;
  if (/^https:\/\/(?:futbollibretv\.sx|streamtp[a-z0-9.-]*)\//.test(u)) return "tp." + id;
  return "";
}

// A token's sister players for the same stream id, so a dead server falls through to another site's.
function withSisters(tokens) {
  const out = [];
  const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  tokens.forEach(add);
  for (const x of tokens) {
    const [kind, id] = x.split(".");
    if (kind === "tvf90") add("la18." + id);
    if (kind === "la18" || kind === "la18c") add("tvf90." + id);
  }
  return out.slice(0, 7);
}

function makeEvent(source, startMs, league, title, flag, tokens) {
  const clean = withSisters(tokens);
  if (!clean.length || !title || !(startMs > 0)) return null;
  return { id: "e" + hash(source === "backup2" ? title + startMs : title + "|" + startMs), start: startMs, league, title, flag, tokens: clean, source };
}

function limaMs(date, hour) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hour));
  if (!d || !h) return 0;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]) + 5 * HOUR;
}

async function agendaPrimary() {
  const r = await kino.fetch(AGENDA_API, { timeoutMs: 9000 });
  if (!r.ok) throw kino.error("unavailable", "agenda " + r.status);
  const data = r.json().data;
  if (!Array.isArray(data)) throw kino.error("unavailable", "agenda shape");
  const out = [];
  for (const row of data) {
    const a = (row && row.attributes) || {};
    const { league, title } = splitTitle(a.diary_description);
    const c = a.country && a.country.data && a.country.data.attributes;
    const img = c && c.image && c.image.data && c.image.data.attributes && c.image.data.attributes.url;
    const tokens = [];
    for (const em of ((a.embeds && a.embeds.data) || [])) {
      const frame = (em.attributes && em.attributes.embed_iframe) || "";
      const m = /[?&]r=([^&]+)/.exec(frame);
      const tok = tokenOf(m ? b64(decodeURIComponent(m[1])) : frame);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("primary", limaMs(a.date_diary, a.diary_hour), league || (c && c.name) || "", title, img ? IMG + img : undefined, tokens);
    if (ev) out.push(ev);
  }
  return out;
}

async function agendaBackup1() {
  const r = await kino.fetch(BACKUP1 + "/api/agenda", { timeoutMs: 9000 });
  if (!r.ok) throw kino.error("unavailable", "agenda " + r.status);
  const events = r.json().events;
  if (!Array.isArray(events)) throw kino.error("unavailable", "agenda shape");
  const out = [];
  for (const e of events) {
    const { league, title } = splitTitle(e.title);
    const tokens = [];
    for (const em of e.embeds || []) {
      const tok = tokenOf(em.iframe);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("backup1", limaMs(e.date, e.time), league, title, typeof e.flag === "string" && /^https:/.test(e.flag) ? e.flag : undefined, tokens);
    if (ev) out.push(ev);
  }
  return out;
}

async function agendaBackup2() {
  const r = await kino.fetch(BACKUP2 + "/agenda", { timeoutMs: 12000 });
  if (!r.ok) throw kino.error("unavailable", "agenda " + r.status);
  const out = [];
  for (const chunk of r.text().split('<div class="source-agenda-event"').slice(1)) {
    const instant = Date.parse((/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "");
    const comp = entities((/source-agenda-competition">([^<]*)</.exec(chunk) || [])[1] || "").replace(/:$/, "");
    const strong = entities(((/<strong>([\s\S]*?)<\/strong>/.exec(chunk) || [])[1] || "").replace(/<[^>]+>/g, " "));
    const title = comp && strong.startsWith(comp) ? strong.slice(comp.length).replace(/^[:\s]+/, "") : strong;
    const flagPath = (/source-agenda-flag" src="([^"]+)"/.exec(chunk) || [])[1];
    const tokens = [];
    const re = /href="\/match\/([a-z0-9-]{1,100})#source=(\d{1,8})"/g;
    let m;
    while ((m = re.exec(chunk))) tokens.push(`b2e.${m[1]}.${m[2]}`);
    const ev = makeEvent("backup2", instant, comp, title, flagPath ? BACKUP2 + flagPath : undefined, tokens.slice(0, 7));
    if (ev) out.push(ev);
  }
  return out;
}

// The agenda from the first site that answers with matches; one that errors or comes back empty hands over to the next.
async function loadAgenda() {
  const order = [["primary", agendaPrimary], ["backup1", agendaBackup1], ["backup2", agendaBackup2]];
  let answered = "";
  for (const [name, fn] of order) {
    try {
      const list = await fn();
      answered = answered || name;
      const now = Date.now();
      const kept = list.filter((e) => e.start + 3 * HOUR > now).sort((a, b) => a.start - b.start);
      if (kept.length) {
        lastAgendaSource = name;
        return kept;
      }
    } catch (e) {
      kino.log("agenda " + name + " failed: " + (e && e.code));
    }
  }
  lastAgendaSource = answered;
  return [];
}

function agenda() {
  return cached("agenda", 45000, loadAgenda);
}

function isLive(e) {
  const now = Date.now();
  return e.start - 10 * 60000 <= now && now <= e.start + MATCH_MS;
}

// ---- 4. channels -------------------------------------------------------------------------------------------------

const B1_LOGO = BACKUP1 + "/img/channels/";
const B2_LOGO = BACKUP2 + "/assets/channel-logos/manual/";

// [slug, name, stream id, logo]
const MAIN = [
  ["espn", "ESPN", "espn", B1_LOGO + "espn-1.webp"],
  ["espn2", "ESPN 2", "espn2", B1_LOGO + "espn-2.webp"],
  ["espn3", "ESPN 3", "espn3", B1_LOGO + "espn-3.webp"],
  ["foxsports", "Fox Sports", "foxsports", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2", "Fox Sports 2", "foxsports2", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3", "Fox Sports 3", "foxsports3", B1_LOGO + "fox-sports-3.webp"],
  ["dsports", "DSports", "dsports", B2_LOGO + "channel-8.jpg"],
  ["dsports2", "DSports 2", "dsports2", B2_LOGO + "channel-8.jpg"],
  ["dsportsplus", "DSports Plus", "dsportsplus", B2_LOGO + "channel-8.jpg"],
  ["liga1max", "Liga 1 MAX", "liga1max", PRIMARY + "/img/logo-canal/liga_1_max.webp"],
  ["telemundo", "Telemundo", "telemundo", B2_LOGO + "channel-50.png"],
  ["espnmx", "ESPN México", "espnmx", B1_LOGO + "espn-1.webp"],
  ["espn2mx", "ESPN 2 México", "espn2mx", B1_LOGO + "espn-2.webp"],
  ["espn3mx", "ESPN 3 México", "espn3mx", B1_LOGO + "espn-3.webp"],
  ["foxsportsmx", "Fox Sports México", "foxsportsmx", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2mx", "Fox Sports 2 México", "foxsports2mx", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3mx", "Fox Sports 3 México", "foxsports3mx", B1_LOGO + "fox-sports-3.webp"],
  ["foxsportspremium", "Fox Sports Premium", "foxsportspremium", B1_LOGO + "fox-sports-premium.webp"],
  ["tudnmx", "TUDN México", "tudn_mx", B1_LOGO + "tudn-mx.webp"],
].map(([id, name, stream, logo]) => ({ id: "c-" + id, name, stream, logo, tokens: withSisters(["tvf90." + stream, "la18." + stream]) }));

// Backup 2's directory of ~100 channels, each with up to four servers (1 tvf90, 2 streamxhd, 3 streamtp, 4 la18hd).
async function moreChannels() {
  return cached("more", 30 * 60000, async () => {
    const r = await kino.fetch(BACKUP2 + "/channels", { timeoutMs: 12000 });
    if (!r.ok) throw kino.error("unavailable", "channels " + r.status);
    const out = [];
    const re = /<a class="channel-card" href="\/channel\/([a-z0-9-]{1,80})"><div class="channel-logo"><img src="([^"]+)" alt="([^"]*)"/g;
    let m;
    while ((m = re.exec(r.text()))) {
      out.push({ id: "b2-" + m[1], name: entities(m[3]) || m[1], logo: /\.svg$/i.test(m[2]) ? undefined : BACKUP2 + m[2], tokens: [1, 4, 2, 3].map((s) => `b2c.${m[1]}.${s}`) });
    }
    if (!out.length) throw kino.error("unavailable", "channels empty");
    return out;
  }).catch(() => []);
}

async function allChannels() {
  return MAIN.concat(await moreChannels());
}

// ---- 5. shapes ---------------------------------------------------------------------------------------------------

function refOf(tokens) {
  return "c:" + tokens.join(",");
}

function eventItem(e) {
  const live = isLive(e);
  return {
    id: e.id,
    ref: refOf(e.tokens),
    title: e.title,
    kind: "live",
    ...(e.flag ? { poster: e.flag } : {}),
    overview: [e.league, whenText(e.start)].filter(Boolean).join(" · "),
    badges: [live ? t("live") : whenText(e.start)],
  };
}

function channelItem(c) {
  return { id: c.id, ref: refOf(c.tokens), title: c.name, kind: "live", ...(c.logo ? { poster: c.logo } : {}) };
}

function liveEvent(e) {
  return { id: e.id, title: e.title, categoryId: "hoy", ref: refOf(e.tokens), ...(e.flag ? { logo: e.flag } : {}) };
}

function liveChannel(c, categoryId) {
  return { id: c.id, title: c.name, categoryId, ref: refOf(c.tokens), ...(c.logo ? { logo: c.logo } : {}) };
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// ---- 6. live exports (capability: channels) ----------------------------------------------------------------------

export async function liveCategories() {
  const cats = [
    { id: "hoy", title: t("catToday"), genre: "deportes" },
    { id: "main", title: t("catMain"), genre: "deportes" },
  ];
  if ((await moreChannels()).length) cats.push({ id: "mas", title: t("catMore"), genre: "deportes" });
  return cats;
}

export async function liveChannels({ categoryId }) {
  if (categoryId === "hoy") return { items: (await agenda()).map(liveEvent) };
  if (categoryId === "main") return { items: MAIN.map((c) => liveChannel(c, "main")) };
  if (categoryId === "mas") return { items: (await moreChannels()).map((c) => liveChannel(c, "mas")) };
  return { items: [] };
}

export async function liveSearch({ query }) {
  const q = norm(query);
  if (q.length < 2) return { items: [] };
  const events = (await agenda()).filter((e) => norm(e.title + " " + e.league).includes(q)).map(liveEvent);
  const chans = (await allChannels()).filter((c) => norm(c.name).includes(q)).map((c) => liveChannel(c, c.id.startsWith("b2-") ? "mas" : "main"));
  return { items: events.concat(chans).slice(0, 100) };
}

// A channel's guide: the matches whose players use the channel's stream id.
export async function guide({ channelIds, from, to }) {
  const events = await agenda();
  const out = [];
  for (const id of channelIds || []) {
    const ch = MAIN.find((c) => c.id === id);
    if (!ch) continue;
    for (const e of events) {
      if (!e.tokens.some((tok) => tok.split(".")[1] === ch.stream)) continue;
      const end = e.start + MATCH_MS;
      if (end < from || e.start > to) continue;
      out.push({ channelId: id, title: e.title, start: e.start, end, ...(e.league ? { description: e.league } : {}) });
    }
  }
  return out;
}

// ---- 7. browse, search, home -------------------------------------------------------------------------------------

function leagueRef(name) {
  return "lg:" + slug(name);
}

async function listFor(ref) {
  const r = String(ref);
  if (r === "ch") return (await allChannels()).map(channelItem);
  const events = await agenda();
  if (r === "now") return events.filter(isLive).map(eventItem);
  if (r === "next") return events.filter((e) => !isLive(e) && e.start > Date.now()).map(eventItem);
  if (r.startsWith("lg:")) return events.filter((e) => leagueRef(e.league) === r).map(eventItem);
  return events.map(eventItem);
}

export async function browse(ref) {
  return { items: await listFor(ref) };
}

export async function search(query) {
  const q = norm(query.q);
  if (q.length < 2) return [];
  const within = query.within ? String(query.within) : "";
  if (within) {
    const list = await listFor(within);
    return list.filter((it) => norm(it.title + " " + (it.overview || "")).includes(q)).slice(0, 40);
  }
  const events = (await agenda()).filter((e) => norm(e.title + " " + e.league).includes(q)).map(eventItem);
  const chans = MAIN.filter((c) => norm(c.name).includes(q)).map(channelItem);
  return events.concat(chans).slice(0, 40);
}

function row(id, title, items, genre) {
  const list = items.slice(0, 20);
  return list.length ? { id, title, ref: id, items: list, genre: genre || "deportes" } : null;
}

export async function home() {
  const events = await agenda();
  return [
    row("now", t("now"), events.filter(isLive).map(eventItem)),
    row("next", t("next"), events.filter((e) => !isLive(e) && e.start > Date.now()).map(eventItem)),
    row("ch", t("channels"), MAIN.map(channelItem)),
  ].filter(Boolean);
}

// ---- 8. section and categories -----------------------------------------------------------------------------------

function leagues(events) {
  const map = new Map();
  for (const e of events) {
    if (!e.league) continue;
    const key = leagueRef(e.league);
    if (!map.has(key)) map.set(key, { ref: key, name: e.league, flag: e.flag, items: [] });
    map.get(key).items.push(e);
  }
  return [...map.values()];
}

export async function section({ tab }) {
  const tabs = [{ id: "today", label: t("tabToday") }, { id: "channels", label: t("tabChannels") }];
  const chosen = tab === "channels" ? "channels" : "today";
  const rows = [];
  let hero = { title: t("heroTitle"), text: t("heroText") };
  if (chosen === "today") {
    const events = await agenda();
    const first = events.find(isLive) || events.find((e) => e.start > Date.now());
    if (first) hero = { title: first.title, text: [first.league, isLive(first) ? t("live") : whenText(first.start)].filter(Boolean).join(" · "), ...(first.flag ? { image: first.flag } : {}) };
    rows.push(row("now", t("now"), events.filter(isLive).map(eventItem)));
    for (const lg of leagues(events).slice(0, 12)) rows.push(row(lg.ref, lg.name, lg.items.map(eventItem)));
  } else {
    rows.push(row("ch", t("catMain"), MAIN.map(channelItem)));
    rows.push(row("ch", t("catMore"), (await moreChannels()).map(channelItem)));
  }
  return { tabs, tab: chosen, hero, rows: rows.filter(Boolean).map((r, i) => ({ ...r, id: `${chosen}-${i}` })) };
}

export async function categories() {
  const events = await agenda();
  const tiles = [
    { id: "now", title: t("now"), ref: "now" },
    { id: "next", title: t("next"), ref: "next" },
    { id: "ch", title: t("channels"), ref: "ch", art: MAIN[0].logo },
  ];
  for (const lg of leagues(events).slice(0, 18)) tiles.push({ id: lg.ref.replace(":", "-"), title: lg.name.slice(0, 40), ref: lg.ref, ...(lg.flag ? { art: lg.flag } : {}) });
  return tiles;
}

// ---- 9. resolve --------------------------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SLUG = /^[a-z0-9-]{1,100}$/;
const PLAYBACK = /playbackURL\s*=\s*"([^"]+)"/;

function unslash(s) {
  return String(s).replace(/\\\//g, "/");
}

async function get(url, headers, ms) {
  return kino.fetch(url, { headers, timeoutMs: ms });
}

async function viaTvf90(id, ms) {
  const r = await get(`https://tvf90.com/5.php?stream=${id}`, { Referer: "https://tvf90.com/" }, ms);
  const m = r.ok && PLAYBACK.exec(r.text());
  return m ? unslash(m[1]) : "";
}

async function viaLa18(id, plural, ms) {
  const r = await get(`https://la18hd.su/vivo/${plural ? "canales" : "canal"}.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  const m = r.ok && /"src":"([^"]+)"/.exec(r.text());
  return m ? unslash(m[1]) : "";
}

// streamxhd hides the address in pieces: [index, base64] pairs, each a char code plus a key made of two small functions.
async function viaStreamxhd(id, ms) {
  const r = await get(`https://streamxhd.st/live1.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  if (!r.ok) return "";
  const html = r.text();
  const arr = /var playbackURL="",(\w+)=\[\][^;]*;\s*\1=(\[\[[\s\S]*?\]\]);/.exec(html);
  const keyFns = /var k=(\w+)\(\)\+(\w+)\(\);/.exec(html);
  if (!arr || !keyFns) return "";
  const fn = (name) => {
    const f = new RegExp("function " + name + "\\(\\)\\{return (\\d+);\\}").exec(html);
    return f ? parseInt(f[1], 10) : NaN;
  };
  const k = fn(keyFns[1]) + fn(keyFns[2]);
  const pairs = [];
  const re = /\[(\d+),"([A-Za-z0-9+/=]+)"\]/g;
  let m;
  while ((m = re.exec(arr[2]))) pairs.push([parseInt(m[1], 10), m[2]]);
  if (!pairs.length || !Number.isFinite(k)) return "";
  pairs.sort((a, b) => a[0] - b[0]);
  let out = "";
  for (const [, b] of pairs) out += String.fromCharCode(parseInt(atob(b).replace(/\D/g, ""), 10) - k);
  return /^https:\/\//.test(out) ? out : "";
}

async function viaStreamtp(id, ms) {
  const r = await get(`https://streamtp99a.sbs/global1.php?stream=${id}`, {}, ms);
  const m = r.ok && PLAYBACK.exec(r.text());
  return m ? unslash(m[1]) : "";
}

// Backup 2's own API names the player it uses for a source; that player's address goes back through the same recipes.
async function viaBackup2(query, ms) {
  const r = await get(`${BACKUP2}/api/direct-playback.php?${query}`, {}, ms);
  if (!r.ok) return "";
  const data = r.json();
  const tok = data && data.success ? tokenOf(data.url) : "";
  return tok && !tok.startsWith("b2") ? runToken(tok, ms) : "";
}

async function runToken(token, ms) {
  const [kind, a, b] = token.split(".");
  if (kind === "b2e" && SLUG.test(a) && /^\d{1,8}$/.test(b)) return viaBackup2(`type=event&slug=${a}&source=${b}`, ms);
  if (kind === "b2c" && SLUG.test(a) && /^[1-4]$/.test(b)) return viaBackup2(`type=channel&slug=${a}&server=${b}`, ms);
  if (!ID.test(a || "")) return "";
  if (kind === "tvf90") return viaTvf90(a, ms);
  if (kind === "la18") return viaLa18(a, false, ms);
  if (kind === "la18c") return viaLa18(a, true, ms);
  if (kind === "sxhd") return viaStreamxhd(a, ms);
  if (kind === "tp") return viaStreamtp(a, ms);
  return "";
}

// A live playlist, or "offline" when the server answers 404/5xx; a host this plugin cannot check is trusted as is.
async function verify(url) {
  if (!/^https:\/\/[^/]*\.(?:ftlly|fubo18|domhsd)\.com[:/]/.test(url)) return "ok";
  try {
    const r = await kino.fetch(url, { timeoutMs: 4500 });
    if (r.ok) return /^#EXTM3U/.test(r.text().trimStart()) ? "ok" : "offline";
    return r.status >= 400 ? "offline" : "ok";
  } catch {
    return "ok";
  }
}

export async function resolve(ref) {
  const m = /^c:([A-Za-z0-9_.,-]{1,900})$/.exec(String(ref));
  if (!m) throw kino.error("not_found", "ref", { userMessage: t("unknownRef") });
  const started = Date.now();
  let sawOffline = false;
  for (const token of m[1].split(",").slice(0, 8)) {
    const left = 18000 - (Date.now() - started);
    if (left < 2500) break;
    try {
      const url = await runToken(token, Math.min(8000, left - 1500));
      if (!url) continue;
      if ((await verify(url)) === "offline") {
        sawOffline = true;
        continue;
      }
      return { url, mime: "application/vnd.apple.mpegurl", expiresInSeconds: 4 * 3600 };
    } catch (e) {
      kino.log("player " + token.split(".")[0] + " failed: " + (e && e.code));
    }
  }
  throw kino.error("unavailable", sawOffline ? "offline" : "no player", { userMessage: t(sawOffline ? "offline" : "unavailable") });
}

// ---- 10. settings ------------------------------------------------------------------------------------------------

export async function settingsStatus() {
  try {
    const events = await agenda();
    const site = t(SOURCE_TEXT[lastAgendaSource] || "sitePrimary");
    if (!lastAgendaSource) return { siteStatus: t("statusDown") };
    return { siteStatus: t(events.length ? "statusOk" : "statusEmpty", { n: events.length, site }) };
  } catch {
    return { siteStatus: t("statusDown") };
  }
}

async function answers(url) {
  try {
    const r = await kino.fetch(url, { timeoutMs: 9000 });
    return r.ok;
  } catch {
    return false;
  }
}

export async function action(key) {
  if (key !== "checkSites") return null;
  const [a, b, c] = await Promise.all([answers(PRIMARY + "/"), answers(BACKUP1 + "/"), answers(BACKUP2 + "/")]);
  return { message: t("domains", { a: t(a ? "up" : "down"), b: t(b ? "up" : "down"), c: t(c ? "up" : "down") }) };
}
