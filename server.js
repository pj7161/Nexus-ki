"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

loadEnv();
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const API_BASE_URL = (process.env.API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "";
const MODEL = process.env.MODEL || "gpt-4o-mini";
const IMAGE_BASE_URL = (process.env.IMAGE_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const IMAGE_KEY = process.env.IMAGE_API_KEY || "";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const VIDEO_MODEL = process.env.VIDEO_MODEL || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_BODY = 12 * 1024 * 1024;
const sessions = new Map();
const limits = new Map();
const videoJobs = new Map();

const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
function json(res, status, payload, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error("Die Anfrage ist zu groß.")); req.destroy(); } else chunks.push(chunk); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("Ungültige JSON-Anfrage.")); } });
    req.on("error", reject);
  });
}
function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
function rateLimit(key, max, windowMs) {
  const now = Date.now(); let item = limits.get(key);
  if (!item || now - item.start > windowMs) item = { count: 0, start: now };
  item.count++; limits.set(key, item); return item.count > max;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf("="); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))]; }));
}
function sessionFor(req) {
  const token = cookies(req).nexus_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) { sessions.delete(token); return null; }
  session.expires = Date.now() + SESSION_TTL;
  return session;
}
function cookieOptions(clear = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { "Set-Cookie": clear ? `nexus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}` : `nexus_session=${arguments[1]}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}` };
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function requireAuth(req, res) {
  const session = sessionFor(req);
  if (!session) { json(res, 401, { error: "Bitte zuerst anmelden." }); return false; }
  return true;
}
async function login(req, res) {
  const ip = clientIp(req);
  if (rateLimit(`login:${ip}`, 8, 15 * 60 * 1000)) return json(res, 429, { error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." });
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) return json(res, 503, { error: "Der Website-Administrator muss zuerst ein sicheres ADMIN_PASSWORD in der Server-Konfiguration setzen (mindestens 12 Zeichen)." });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const supplied = typeof body.password === "string" ? body.password : "";
  const expectedHash = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  if (!crypto.timingSafeEqual(expectedHash, suppliedHash)) return json(res, 401, { error: "Das Passwort ist nicht korrekt." });
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { created: Date.now(), expires: Date.now() + SESSION_TTL });
  json(res, 200, { ok: true }, { "Set-Cookie": `nexus_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL / 1000)}${process.env.NODE_ENV === "production" ? "; Secure" : ""}` });
}
async function chat(req, res) {
  if (!API_KEY) return json(res, 503, { error: "Die Chat-KI ist noch nicht verbunden. Hinterlege API_KEY in der Server-Konfiguration." });
  if (rateLimit(`chat:${clientIp(req)}`, 35, 60_000)) return json(res, 429, { error: "Zu viele Anfragen. Bitte eine Minute warten." });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 35) return json(res, 400, { error: "Ungültiger Nachrichtenverlauf." });
  const messages = [];
  for (const m of body.messages) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 100_000) return json(res, 400, { error: "Eine Nachricht enthält ungültige Daten." });
    messages.push({ role: m.role, content: m.content });
  }
  try {
    const upstream = await fetch(`${API_BASE_URL}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: "Du bist NEXUS AI, ein vielseitiger, ehrlicher und hilfreicher persönlicher KI-Assistent. Antworte in der Sprache des Nutzers. Behaupte niemals, eine externe Aktion durchgeführt zu haben, wenn du sie nicht tatsächlich durchgeführt hast. Wenn eine Funktion nicht verfügbar ist, sage das klar. Bei wichtigen Fakten nenne Unsicherheiten." }, ...messages], temperature: 0.7 }) });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json(res, upstream.status >= 500 ? 502 : 400, { error: data?.error?.message || `KI-Anbieter meldet HTTP ${upstream.status}.` });
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) return json(res, 502, { error: "Das Modell hat keine Textantwort geliefert." });
    return json(res, 200, { reply: reply.trim(), model: MODEL });
  } catch (e) { return json(res, 502, { error: `KI-Verbindung fehlgeschlagen: ${e.message}` }); }
}
async function image(req, res) {
  if (!IMAGE_KEY) return json(res, 503, { error: "Bildgenerierung ist noch nicht verbunden. Hinterlege IMAGE_API_KEY." });
  if (rateLimit(`image:${clientIp(req)}`, 5, 60_000)) return json(res, 429, { error: "Zu viele Bildanfragen. Bitte kurz warten." });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 4000) return json(res, 400, { error: "Bitte einen Bildprompt mit maximal 4.000 Zeichen eingeben." });
  try {
    const upstream = await fetch(`${IMAGE_BASE_URL}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${IMAGE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: ["1024x1024", "1536x1024", "1024x1536"].includes(body.size) ? body.size : "1024x1024", n: 1 }) });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json(res, upstream.status >= 500 ? 502 : 400, { error: data?.error?.message || `Bildanbieter meldet HTTP ${upstream.status}.` });
    const item = data?.data?.[0];
    if (item?.b64_json) return json(res, 200, { image: `data:image/png;base64,${item.b64_json}`, model: IMAGE_MODEL });
    if (item?.url) return json(res, 200, { image: item.url, model: IMAGE_MODEL });
    return json(res, 502, { error: "Der Bildanbieter hat kein Bild zurückgegeben." });
  } catch (e) { return json(res, 502, { error: `Bildgenerierung fehlgeschlagen: ${e.message}` }); }
}
async function search(req, res) {
  if (!BRAVE_KEY) return json(res, 503, { error: "Websuche ist noch nicht verbunden. Hinterlege BRAVE_SEARCH_API_KEY." });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const q = typeof body.query === "string" ? body.query.trim() : "";
  if (!q || q.length > 400) return json(res, 400, { error: "Bitte einen Suchbegriff eingeben." });
  if (rateLimit(`search:${clientIp(req)}`, 20, 60_000)) return json(res, 429, { error: "Zu viele Suchanfragen." });
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search"); url.searchParams.set("q", q); url.searchParams.set("count", "8");
    const upstream = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY } });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json(res, 502, { error: data?.message || `Suchanbieter meldet HTTP ${upstream.status}.` });
    const results = (data.web?.results || []).slice(0, 8).map(x => ({ title: x.title, url: x.url, description: x.description }));
    return json(res, 200, { results });
  } catch (e) { return json(res, 502, { error: `Websuche fehlgeschlagen: ${e.message}` }); }
}
async function videoStart(req, res) {
  if (!REPLICATE_TOKEN || !VIDEO_MODEL) return json(res, 503, { error: "Video Studio benötigt ein Replicate-Token und ein kompatibles VIDEO_MODEL in der Server-Konfiguration." });
  let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 3000) return json(res, 400, { error: "Bitte einen Videoprompt mit maximal 3.000 Zeichen eingeben." });
  if (rateLimit(`video:${clientIp(req)}`, 2, 60_000)) return json(res, 429, { error: "Zu viele Videoaufträge. Bitte kurz warten." });
  try {
    const upstream = await fetch(`https://api.replicate.com/v1/models/${VIDEO_MODEL}/predictions`, { method: "POST", headers: { Authorization: `Bearer ${REPLICATE_TOKEN}`, "Content-Type": "application/json", Prefer: "wait=1" }, body: JSON.stringify({ input: { prompt, aspect_ratio: body.ratio === "16:9" ? "16:9" : "9:16", duration: Number(body.duration) || 5 } }) });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json(res, 502, { error: data?.detail || data?.error || `Videoanbieter meldet HTTP ${upstream.status}.` });
    videoJobs.set(data.id, { created: Date.now() });
    return json(res, 200, { id: data.id, status: data.status, output: data.output || null });
  } catch (e) { return json(res, 502, { error: `Videoauftrag fehlgeschlagen: ${e.message}` }); }
}
async function videoStatus(req, res, id) {
  if (!REPLICATE_TOKEN) return json(res, 503, { error: "Videoanbieter nicht verbunden." });
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return json(res, 400, { error: "Ungültige Auftrags-ID." });
  try {
    const upstream = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json(res, 502, { error: data?.detail || `Videoanbieter meldet HTTP ${upstream.status}.` });
    return json(res, 200, { status: data.status, output: data.output || null, error: data.error || null });
  } catch (e) { return json(res, 502, { error: `Statusabfrage fehlgeschlagen: ${e.message}` }); }
}
function serveStatic(req, res, session) {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400); return res.end("Bad Request"); }
  if (pathname === "/") pathname = session ? "/index.html" : "/login.html";
  if (pathname === "/workspace") {
    if (!session) { res.writeHead(302, { Location: "/" }); return res.end(); }
    pathname = "/index.html";
  }
  const privateAssets = new Set(["/index.html", "/style.css", "/app.js"]);
  const publicAssets = new Set(["/login.html", "/login.css", "/login.js", "/favicon.svg"]);
  if (privateAssets.has(pathname) && !session) { res.writeHead(302, { Location: "/" }); return res.end(); }
  if (!privateAssets.has(pathname) && !publicAssets.has(pathname)) { res.writeHead(404); return res.end("Not found"); }
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
    const headers = { "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(self), geolocation=()", "Cache-Control": "no-cache", "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://cdnjs.cloudflare.com; connect-src 'self' https://api.openai.com https://api.replicate.com https://api.search.brave.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" };
    res.writeHead(200, headers); res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/session") return json(res, 200, { authenticated: Boolean(sessionFor(req)), passwordConfigured: ADMIN_PASSWORD.length >= 12 });
  if (req.method === "POST" && req.url === "/api/login") { if (!sameOrigin(req)) return json(res, 403, { error: "Ungültige Herkunft." }); return login(req, res); }
  if (req.method === "POST" && req.url === "/api/logout") { if (!sameOrigin(req)) return json(res, 403, { error: "Ungültige Herkunft." }); const token = cookies(req).nexus_session; if (token) sessions.delete(token); return json(res, 200, { ok: true }, cookieOptions(true)); }
  if (req.url.startsWith("/api/")) {
    if (!requireAuth(req, res)) return;
    if (req.method === "GET" && req.url === "/api/status") return json(res, 200, { chat: Boolean(API_KEY), model: MODEL, image: Boolean(IMAGE_KEY), search: Boolean(BRAVE_KEY), video: Boolean(REPLICATE_TOKEN && VIDEO_MODEL) });
    if (req.method === "POST" && req.url === "/api/chat") return chat(req, res);
    if (req.method === "POST" && req.url === "/api/image") return image(req, res);
    if (req.method === "POST" && req.url === "/api/search") return search(req, res);
    if (req.method === "POST" && req.url === "/api/video") return videoStart(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/video/")) return videoStatus(req, res, req.url.split("/").pop());
    return json(res, 404, { error: "API-Endpunkt nicht gefunden." });
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end("Method Not Allowed"); }
  serveStatic(req, res, sessionFor(req));
});

server.listen(PORT, () => {
  console.log(`NEXUS AI läuft auf Port ${PORT}`);
  if (ADMIN_PASSWORD.length < 12) console.warn("WARNUNG: ADMIN_PASSWORD fehlt oder ist kürzer als 12 Zeichen. Login ist gesperrt.");
  console.log(`Dienste: Chat=${!!API_KEY}, Bild=${!!IMAGE_KEY}, Websuche=${!!BRAVE_KEY}, Video=${!!(REPLICATE_TOKEN && VIDEO_MODEL)}`);
});
