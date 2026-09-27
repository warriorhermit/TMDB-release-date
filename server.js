const express = require("express");

const app = express();
const PORT = process.env.PORT || 7000;
const SERVER_TMDB_API_TOKEN = process.env.TMDB_API_TOKEN || "";
const SERVER_TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const DEFAULT_REGION = (process.env.DEFAULT_REGION || "US").toUpperCase();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 21600000);

const cache = new Map();
const activeRequests = new Map();

// Global CORS Middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function getCredentials(configStr) {
  let token = SERVER_TMDB_API_TOKEN;
  let key = SERVER_TMDB_API_KEY;

  if (configStr) {
    const decoded = decodeURIComponent(configStr).trim();
    if (decoded.startsWith("eyJ") || decoded.length > 50) {
      token = decoded;
      key = "";
    } else if (decoded.length > 0) {
      key = decoded;
      token = "";
    }
  }

  return { token, key };
}

function headers(token) {
  return token
    ? { Authorization: `Bearer ${token}`, accept: "application/json" }
    : { accept: "application/json" };
}

function tmdbUrl(path, creds) {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  if (!creds.token && creds.key) u.searchParams.set("api_key", creds.key);
  return u.toString();
}

async function tmdbGet(path, creds) {
  const r = await fetch(tmdbUrl(path, creds), { headers: headers(creds.token) });
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  if (!r.ok) throw new Error(data.status_message || `TMDB HTTP ${r.status}`);
  return data;
}

function formatMinutes(minutes) {
  if (!minutes || Number.isNaN(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
  }).format(dt);
}

function isoDate(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function chooseRelease(countries, type) {
  const preferred = [...new Set([DEFAULT_REGION, "US", "GB", "IN"])];
  for (const region of preferred) {
    const country = countries.find(c => c.iso_3166_1 === region);
    const release = (country?.release_dates || [])
      .filter(x => x.type === type && isoDate(x.release_date))
      .sort((a, b) => isoDate(a.release_date).localeCompare(isoDate(b.release_date)))[0];
    if (release) return { ...release, region };
  }

  const candidates = [];
  for (const country of countries) {
    for (const release of country.release_dates || []) {
      if (release.type === type && isoDate(release.release_date)) {
        candidates.push({ ...release, region: country.iso_3166_1 });
      }
    }
  }
  candidates.sort((a, b) => isoDate(a.release_date).localeCompare(isoDate(b.release_date)));
  return candidates[0] || null;
}

// Scrapes IMDb Technical Specs for alternate cut running times
async function fetchImdbAltRuntimes(imdbId) {
  if (!/^tt\d+$/i.test(imdbId)) return null;

  try {
    const res = await fetch(`https://www.imdb.com/title/${imdbId}/technical/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    const pattern = /(\d+)\s*(?:hr|hours?|h)\s*(?:(\d+)\s*(?:min|minutes?|m))?\s*(?:\((\d+)\s*min\))?\s*\(([^)]+)\)/gi;
    let match;
    const editionPattern = /director|extended|unrated|special edition|ultimate|alternate|uncut/i;

    while ((match = pattern.exec(html)) !== null) {
      const hours = parseInt(match[1], 10) || 0;
      const mins = parseInt(match[2], 10) || 0;
      const explicitTotalMin = parseInt(match[3], 10);
      const label = match[4].trim();

      if (editionPattern.test(label)) {
        const totalMinutes = explicitTotalMin || (hours * 60 + mins);
        return {
          editionName: label,
          runtime: formatMinutes(totalMinutes)
        };
      }
    }
  } catch (err) {
    console.warn(`[IMDb Scrape] Failed for ${imdbId}: ${err.message}`);
  }

  return null;
}

async function findMovieByImdb(imdbId, creds) {
  const find = await tmdbGet(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, creds);
  let movie = (find.movie_results || [])[0];
  if (movie?.id) return movie;
  throw new Error(`TMDB could not map IMDb ID ${imdbId} to a movie`);
}

async function resolveMovie(rawId, creds) {
  if (rawId.startsWith("tmdb:")) {
    const tmdbId = rawId.replace("tmdb:", "");
    const movie = await tmdbGet(`/movie/${tmdbId}`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^\d+$/.test(rawId)) {
    const movie = await tmdbGet(`/movie/${rawId}`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^tt\d+$/i.test(rawId)) {
    const matched = await findMovieByImdb(rawId, creds);
    const movie = await tmdbGet(`/movie/${matched.id}`, creds);
    return { movie, imdbId: rawId };
  }
  throw new Error(`Unsupported ID format: ${rawId}`);
}

async function getInfo(rawId, creds) {
  const cacheKey = `${creds.token || creds.key}:${rawId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (activeRequests.has(cacheKey)) return activeRequests.get(cacheKey);

  const promise = (async () => {
    const { movie, imdbId } = await resolveMovie(rawId, creds);
    const releases = await tmdbGet(`/movie/${movie.id}/release_dates`, creds);

    const countries = releases.results || [];
    const theatrical = chooseRelease(countries, 3);
    const digital = chooseRelease(countries, 4);

    const theatricalRuntime = formatMinutes(movie.runtime);

    // 1. First, search IMDb for alternate edition running time
    let specialCut = imdbId ? await fetchImdbAltRuntimes(imdbId) : null;

    // 2. Fallback to TMDB release notes if IMDb didn't list one
    if (!specialCut) {
      const editionPattern = /director|extended|unrated|special edition|ultimate|alternate|uncut/i;
      for (const country of countries) {
        for (const rel of country.release_dates || []) {
          if (rel.note && editionPattern.test(rel.note)) {
            const match = rel.note.match(/(\d+)\s*(?:min|mins|m\b)/i);
            const runtime = match ? formatMinutes(parseInt(match[1], 10)) : null;
            const editionName = rel.note.replace(/\(?\d+\s*(?:min\vert{}mins\vert{}m\b)\)?/i, "").trim();
            specialCut = { editionName, runtime };
            break;
          }
        }
        if (specialCut) break;
      }
    }

    const value = {
      rawId,
      tmdbId: movie.id,
      title: movie.title || movie.original_title || rawId,
      theatricalRuntime,
      theatrical,
      digital,
      specialCut
    };

    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  })();

  activeRequests.set(cacheKey, promise);
  try { return await promise; }
  finally { activeRequests.delete(cacheKey); }
}

function stream(info, req) {
  const runtimeTheatricalSuffix = info.theatricalRuntime ? ` [${info.theatricalRuntime}]` : "";

  const theatrical = info.theatrical
    ? `${parseDate(info.theatrical.release_date)} (${info.theatrical.region})`
    : "Not announced";

  const digital = info.digital
    ? `${parseDate(info.digital.release_date)} (${info.digital.region})`
    : "Not announced";

  const lines = [
    `🎬 Theatrical${runtimeTheatricalSuffix}: ${theatrical}`,
    `💻 Digital: ${digital}`
  ];

  // Only display alternate edition if found (no release dates, only name and runtime)
  if (info.specialCut) {
    const name = info.specialCut.editionName || "Alternate Cut";
    const runtime = info.specialCut.runtime ? `: ${info.specialCut.runtime}` : "";
    lines.push(`✂️ ${name}${runtime}`);
  }

  const host = req.get("host") || "localhost";
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  const dummyVideoUrl = `${protocol}://${host}/dummy.mp4`;

  return [
    {
      name: `Release Dates`,
      title: lines.join("\n"),
      description: lines.join(" | "),
      url: dummyVideoUrl,
      externalUrl: `https://www.themoviedb.org/movie/${info.tmdbId}`,
      behaviorHints: { bingeGroup: "release-dates" }
    }
  ];
}

// Dummy endpoint to satisfy video player stream checking
app.get("/dummy.mp4", (_req, res) => {
  res.type("video/mp4").status(204).end();
});

// HTML Configuration UI
app.get("/", (_req, res) => {
  res.type("html").send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Configure Release Dates Addon</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2.5rem; border-radius: 12px; width: 100%; max-width: 480px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
        h1 { margin-top: 0; font-size: 1.5rem; color: #38bdf8; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
        label { display: block; margin-top: 1.25rem; font-weight: 500; font-size: 0.9rem; }
        input[type="text"] { width: 100%; padding: 0.75rem; margin-top: 0.5rem; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; font-size: 0.9rem; }
        button { width: 100%; padding: 0.75rem; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: 600; margin-top: 1.5rem; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #0369a1; }
        .result { margin-top: 1.5rem; display: none; }
        .manifest-link { word-break: break-all; background: #0f172a; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 0.85rem; border: 1px solid #334155; margin-top: 0.5rem; color: #a5f3fc; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Release Dates Addon</h1>
        <p>Enter your TMDB API Read Access Token or API Key below to generate your custom manifest URL for Nuvio and Stremio.</p>
        <label for="token">TMDB API Token / Key</label>
        <input type="text" id="token" placeholder="eyJhbGciOiJIUzI1NiJ9... or API Key" autocomplete="off" />
        <button onclick="generateManifest()">Generate Manifest URL</button>
        <div class="result" id="resultBlock">
          <label>Your Manifest URL:</label>
          <div class="manifest-link" id="manifestUrl"></div>
        </div>
      </div>
      <script>
        function generateManifest() {
          const token = document.getElementById("token").value.trim();
          if (!token) return alert("Please enter a valid TMDB Token or Key");
          const encoded = encodeURIComponent(token);
          const url = window.location.origin + "/" + encoded + "/manifest.json";
          document.getElementById("manifestUrl").innerText = url;
          document.getElementById("resultBlock").style.display = "block";
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/health", (_req, res) => res.json({
  status: "ok",
  version: "3.6.0",
  defaultRegion: DEFAULT_REGION
}));

function getManifestJson() {
  return {
    id: "com.nuvio.release-dates.stream",
    version: "3.6.0",
    name: "Release Dates",
    description: "Shows theatrical, digital release dates and runtimes (with IMDb extended cut search) in Nuvio/Stremio.",
    resources: [
      "stream",
      { name: "stream", types: ["movie"], idPrefixes: ["tt", "tmdb:"] }
    ],
    types: ["movie"],
    idPrefixes: ["tt", "tmdb:"],
    catalogs: []
  };
}

app.get("/manifest.json", (_req, res) => res.json(getManifestJson()));
app.get("/:config/manifest.json", (_req, res) => res.json(getManifestJson()));

async function handleStream(req, res) {
  if (req.params.type !== "movie") return res.json({ streams: [] });

  let rawId = String(req.params.id);
  if (rawId.startsWith("tmdb:")) {
    rawId = "tmdb:" + rawId.slice(5).split(":")[0];
  } else {
    rawId = rawId.split(":")[0];
  }

  const creds = getCredentials(req.params.config);
  if (!creds.token && !creds.key) {
    const host = req.get("host") || "localhost";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    return res.json({
      streams: [{
        name: "⚠️ Release Dates",
        title: "TMDB API credentials missing. Please configure the addon.",
        description: "Missing API token/key.",
        url: `${protocol}://${host}/dummy.mp4`,
        externalUrl: `${protocol}://${host}/`
      }]
    });
  }

  try {
    const info = await getInfo(rawId, creds);
    return res.json({ streams: stream(info, req) });
  } catch (e) {
    console.error(`[${rawId}] ${e.message}`);
    const host = req.get("host") || "localhost";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    return res.json({
      streams: [{
        name: "⚠️ Release Dates",
        title: `Error: ${e.message}`,
        description: e.message,
        url: `${protocol}://${host}/dummy.mp4`,
        externalUrl: "https://www.themoviedb.org/"
      }]
    });
  }
}

app.get("/stream/:type/:id.json", handleStream);
app.get("/:config/stream/:type/:id.json", handleStream);
app.get("/:style/:apiKey/stream/:type/:id.json", handleStream);

app.listen(PORT, () => console.log(`Release Dates addon listening on ${PORT}`));
