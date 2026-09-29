const express = require("express");

const app = express();
const PORT = process.env.PORT || 7000;
const SERVER_TMDB_API_TOKEN = process.env.TMDB_API_TOKEN || "";
const SERVER_TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SERVER_TVDB_API_KEY = process.env.TVDB_API_KEY || "";
const DEFAULT_REGION = (process.env.DEFAULT_REGION || "US").toUpperCase();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 21600000);

const cache = new Map();
const activeRequests = new Map();

// In-memory TVDB JWT token cache
let tvdbJwtToken = null;
let tvdbTokenExpiresAt = 0;

// Global CORS Middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function getCredentials(configStr) {
  let tmdbToken = SERVER_TMDB_API_TOKEN;
  let tmdbKey = SERVER_TMDB_API_KEY;
  let tvdbKey = SERVER_TVDB_API_KEY;

  if (configStr) {
    const decoded = decodeURIComponent(configStr).trim();
    const parts = decoded.split(":");
    const mainTmdb = parts[0] || "";
    if (parts[1]) tvdbKey = parts[1];

    if (mainTmdb.startsWith("eyJ") || mainTmdb.length > 50) {
      tmdbToken = mainTmdb;
      tmdbKey = "";
    } else if (mainTmdb.length > 0) {
      tmdbKey = mainTmdb;
      tmdbToken = "";
    }
  }

  return { tmdbToken, tmdbKey, tvdbKey };
}

// ----------------- TMDB Helpers -----------------

function tmdbHeaders(token) {
  return token
    ? { Authorization: `Bearer ${token}`, accept: "application/json" }
    : { accept: "application/json" };
}

function tmdbUrl(path, creds) {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  if (!creds.tmdbToken && creds.tmdbKey) u.searchParams.set("api_key", creds.tmdbKey);
  return u.toString();
}

async function tmdbGet(path, creds) {
  const r = await fetch(tmdbUrl(path, creds), { headers: tmdbHeaders(creds.tmdbToken) });
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  if (!r.ok) throw new Error(data.status_message || `TMDB HTTP ${r.status}`);
  return data;
}

// ----------------- TVDB v4 Helpers -----------------

async function getTvdbToken(apiKey) {
  if (!apiKey) return null;
  const now = Date.now();
  if (tvdbJwtToken && tvdbTokenExpiresAt > now) {
    return tvdbJwtToken;
  }

  try {
    const res = await fetch("https://api4.thetvdb.com/v4/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ apikey: apiKey })
    });

    if (!res.ok) return null;
    const body = await res.json();
    const token = body?.data?.token;
    if (token) {
      tvdbJwtToken = token;
      // Refresh 1 day before 28-day expiration
      tvdbTokenExpiresAt = now + (27 * 24 * 60 * 60 * 1000);
      return token;
    }
  } catch (err) {
    console.warn(`[TVDB Login Failed]: ${err.message}`);
  }
  return null;
}

async function tvdbGet(path, jwtToken) {
  const res = await fetch(`https://api4.thetvdb.com/v4${path}`, {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      accept: "application/json"
    }
  });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchTvdbSpecialCut(imdbId, episodeName, season, episode, tvdbKey) {
  if (!tvdbKey || !imdbId) return null;
  const jwt = await getTvdbToken(tvdbKey);
  if (!jwt) return null;

  try {
    const searchRes = await tvdbGet(`/search?remote_id=${encodeURIComponent(imdbId)}`, jwt);
    const series = (searchRes?.data || []).find(x => x.type === "series" || x.primary_type === "series");
    if (!series?.tvdb_id) return null;

    const specialsRes = await tvdbGet(`/series/${series.tvdb_id}/episodes/default?season=0`, jwt);
    const specials = specialsRes?.data?.episodes || [];

    const editionPattern = /director|extended|unrated|special edition|alternate|superfan/i;
    const epTitleNorm = (episodeName || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    for (const spec of specials) {
      const specName = spec.name || "";
      const specNameNorm = specName.toLowerCase().replace(/[^a-z0-9]/g, "");

      if (editionPattern.test(specName)) {
        if (
          (epTitleNorm && specNameNorm.includes(epTitleNorm)) ||
          specNameNorm.includes(`s0${season}e${episode}`) ||
          specNameNorm.includes(`s${season}e${episode}`)
        ) {
          return {
            editionName: specName.trim(),
            runtime: formatMinutes(spec.runtime)
          };
        }
      }
    }
  } catch (err) {
    console.warn(`[TVDB Fetch Error]: ${err.message}`);
  }

  return null;
}

// ----------------- Parsing & Formatting -----------------

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

async function findByImdb(imdbId, creds) {
  const find = await tmdbGet(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, creds);
  const movie = (find.movie_results || [])[0];
  if (movie?.id) return { id: movie.id, type: "movie" };
  const tv = (find.tv_results || [])[0];
  if (tv?.id) return { id: tv.id, type: "tv" };
  throw new Error(`TMDB could not map IMDb ID ${imdbId}`);
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
    const found = await findByImdb(rawId, creds);
    const movie = await tmdbGet(`/movie/${found.id}`, creds);
    return { movie, imdbId: rawId };
  }
  throw new Error(`Unsupported ID format: ${rawId}`);
}

async function resolveTvShow(rawId, creds) {
  if (rawId.startsWith("tmdb:")) {
    const id = rawId.replace("tmdb:", "");
    const details = await tmdbGet(`/tv/${id}/external_ids`, creds);
    return { tvId: id, imdbId: details.imdb_id || null };
  }
  if (/^\d+$/.test(rawId)) {
    const details = await tmdbGet(`/tv/${rawId}/external_ids`, creds);
    return { tvId: rawId, imdbId: details.imdb_id || null };
  }
  if (/^tt\d+$/i.test(rawId)) {
    const found = await findByImdb(rawId, creds);
    return { tvId: found.id, imdbId: rawId };
  }
  throw new Error(`Unsupported TV Show ID: ${rawId}`);
}

async function getMovieInfo(rawId, creds) {
  const cacheKey = `movie:${creds.tmdbToken || creds.tmdbKey}:${rawId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (activeRequests.has(cacheKey)) return activeRequests.get(cacheKey);

  const promise = (async () => {
    const { movie } = await resolveMovie(rawId, creds);
    const releases = await tmdbGet(`/movie/${movie.id}/release_dates`, creds);

    const countries = releases.results || [];
    const theatrical = chooseRelease(countries, 3);
    const digital = chooseRelease(countries, 4);

    const theatricalRuntime = formatMinutes(movie.runtime);

    let specialCut = null;
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

    const value = {
      type: "movie",
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

async function getEpisodeInfo(seriesRawId, season, episode, creds) {
  const cacheKey = `tv:${creds.tmdbToken || creds.tmdbKey}:${creds.tvdbKey}:${seriesRawId}:${season}:${episode}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (activeRequests.has(cacheKey)) return activeRequests.get(cacheKey);

  const promise = (async () => {
    const { tvId, imdbId } = await resolveTvShow(seriesRawId, creds);
    const epData = await tmdbGet(`/tv/${tvId}/season/${season}/episode/${episode}`, creds);

    const airDate = parseDate(epData.air_date);
    const runtime = formatMinutes(epData.runtime);

    let specialCut = null;
    const editionPattern = /director|extended|unrated|special edition|alternate|superfan/i;

    if (epData.name && editionPattern.test(epData.name)) {
      specialCut = { editionName: epData.name, runtime };
    } else if (epData.overview && editionPattern.test(epData.overview)) {
      const match = epData.overview.match(/(\d+)\s*(?:min|mins|m\b)/i);
      const altRuntime = match ? formatMinutes(parseInt(match[1], 10)) : null;
      specialCut = { editionName: "Extended Cut", runtime: altRuntime };
    }

    if (!specialCut) {
      try {
        const specials = await tmdbGet(`/tv/${tvId}/season/0`, creds);
        const epTitleNorm = (epData.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

        for (const spec of specials.episodes || []) {
          const specNameNorm = (spec.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (
            editionPattern.test(spec.name) &&
            (specNameNorm.includes(epTitleNorm) || specNameNorm.includes(`s${season}e${episode}`))
          ) {
            specialCut = {
              editionName: spec.name.trim(),
              runtime: formatMinutes(spec.runtime)
            };
            break;
          }
        }
      } catch {
        // Season 0 missing on TMDB
      }
    }

    if (!specialCut && creds.tvdbKey) {
      const tvdbMatch = await fetchTvdbSpecialCut(imdbId, epData.name, season, episode, creds.tvdbKey);
      if (tvdbMatch) {
        specialCut = tvdbMatch;
      }
    }

    const value = {
      type: "series",
      tvId,
      season,
      episode,
      title: epData.name || `S${season}E${episode}`,
      airDate,
      runtime,
      specialCut
    };

    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  })();

  activeRequests.set(cacheKey, promise);
  try { return await promise; }
  finally { activeRequests.delete(cacheKey); }
}

function streamMovie(info, req) {
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

  if (info.specialCut) {
    const name = info.specialCut.editionName || "Extended Cut";
    const runtime = info.specialCut.runtime ? `: ${info.specialCut.runtime}` : "";
    lines.push(`✂️ ${name}${runtime}`);
  }

  const host = req.get("host") || "localhost";
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  const dummyVideoUrl = `${protocol}://${host}/dummy.mp4`;

  return [
    {
      name: `Release Info`,
      title: lines.join("\n"),
      description: lines.join(" | "),
      url: dummyVideoUrl,
      externalUrl: `https://www.themoviedb.org/movie/${info.tmdbId}`,
      behaviorHints: { bingeGroup: "release-info" }
    }
  ];
}

function streamEpisode(info, req) {
  const runtimeSuffix = info.runtime ? ` [${info.runtime}]` : "";
  const airDate = info.airDate ? info.airDate : "Not announced";

  const lines = [
    `📺 Air Date${runtimeSuffix}: ${airDate}`
  ];

  if (info.specialCut) {
    const name = info.specialCut.editionName || "Extended Cut";
    const runtime = info.specialCut.runtime ? `: ${info.specialCut.runtime}` : "";
    lines.push(`✂️ ${name}${runtime}`);
  }

  const host = req.get("host") || "localhost";
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  const dummyVideoUrl = `${protocol}://${host}/dummy.mp4`;

  return [
    {
      name: `Release Info`,
      title: lines.join("\n"),
      description: lines.join(" | "),
      url: dummyVideoUrl,
      externalUrl: `https://www.themoviedb.org/tv/${info.tvId}/season/${info.season}/episode/${info.episode}`,
      behaviorHints: { bingeGroup: "release-info" }
    }
  ];
}

// Dummy endpoint to satisfy video player stream checking
app.get("/dummy.mp4", (_req, res) => {
  res.type("video/mp4").status(204).end();
});

// HTML Configuration UI with official logos and attribution visible ONLY here
app.get("/", (_req, res) => {
  res.type("html").send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Configure Release Info Addon</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
        .card { background: #1e293b; padding: 2.25rem; border-radius: 14px; width: 100%; max-width: 500px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
        h1 { margin-top: 0; font-size: 1.6rem; color: #38bdf8; display: flex; align-items: center; gap: 0.5rem; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
        .logos { display: flex; align-items: center; justify-content: flex-start; gap: 1.5rem; margin-bottom: 1.5rem; padding: 0.75rem 1rem; background: #0f172a; border-radius: 8px; border: 1px solid #1e293b; }
        .logos img { height: 26px; object-fit: contain; }
        label { display: block; margin-top: 1.2rem; font-weight: 500; font-size: 0.9rem; color: #cbd5e1; }
        input[type="text"] { width: 100%; padding: 0.75rem; margin-top: 0.5rem; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; font-size: 0.9rem; }
        .btn-primary { width: 100%; padding: 0.8rem; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: 600; margin-top: 1.5rem; cursor: pointer; transition: background 0.2s; font-size: 0.95rem; }
        .btn-primary:hover { background: #0369a1; }
        .result { margin-top: 1.5rem; display: none; }
        .manifest-link { word-break: break-all; background: #0f172a; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 0.85rem; border: 1px solid #334155; margin-top: 0.5rem; color: #a5f3fc; }
        .btn-copy { width: 100%; padding: 0.7rem; background: #334155; color: #f8fafc; border: none; border-radius: 6px; font-weight: 600; margin-top: 0.75rem; cursor: pointer; transition: background 0.2s; }
        .btn-copy:hover { background: #475569; }
        .attribution-box { margin-top: 1.75rem; padding: 0.85rem 1rem; background: #0f172a; border-radius: 8px; border: 1px solid #334155; font-size: 0.8rem; color: #94a3b8; line-height: 1.4; }
        .attribution-box strong { color: #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🎬 Release Info</h1>
        
        <div class="logos">
          <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB Logo" title="The Movie Database" />
          <img src="https://thetvdb.com/images/logo.png" alt="TheTVDB Logo" title="TheTVDB" style="filter: brightness(0) invert(1);" />
        </div>

        <p>Displays theatrical & digital release dates, runtimes, and alternate cuts inside Nuvio and Stremio.</p>
        
        <label for="tmdb">TheMovieDB API Read Token or API Key (Required)</label>
        <input type="text" id="tmdb" placeholder="eyJhbGciOiJIUzI1NiJ9... or API Key" autocomplete="off" />

        <label for="tvdb">TheTVDB v4 Project API Key (Optional for extra TV cuts)</label>
        <input type="text" id="tvdb" placeholder="e.g. 12345678-abcd-ef01-2345-6789abcdef01" autocomplete="off" />

        <button class="btn-primary" onclick="generateManifest()">Generate Manifest URL</button>
        <div class="result" id="resultBlock">
          <label>Your Custom Manifest URL:</label>
          <div class="manifest-link" id="manifestUrl"></div>
          <button class="btn-copy" id="copyBtn" onclick="copyManifest()">📋 Copy Manifest URL</button>
        </div>

        <div class="attribution-box">
          Metadata provided by <strong>The Movie Database (TMDB)</strong> and <strong>TheTVDB</strong>. This product uses the TMDB and TVDB APIs but is not endorsed or certified by TMDB or TVDB.
        </div>
      </div>
      <script>
        function generateManifest() {
          const tmdb = document.getElementById("tmdb").value.trim();
          const tvdb = document.getElementById("tvdb").value.trim();
          if (!tmdb) return alert("Please enter a valid TMDB Token or Key");

          let configVal = tmdb;
          if (tvdb) configVal += ":" + tvdb;

          const encoded = encodeURIComponent(configVal);
          const url = window.location.origin + "/" + encoded + "/manifest.json";
          document.getElementById("manifestUrl").innerText = url;
          document.getElementById("resultBlock").style.display = "block";
          document.getElementById("copyBtn").innerText = "📋 Copy Manifest URL";
        }

        async function copyManifest() {
          const url = document.getElementById("manifestUrl").innerText;
          try {
            await navigator.clipboard.writeText(url);
            const btn = document.getElementById("copyBtn");
            btn.innerText = "✅ Copied to Clipboard!";
            setTimeout(() => { btn.innerText = "📋 Copy Manifest URL"; }, 2500);
          } catch (err) {
            alert("Failed to copy. Please manually select and copy the URL.");
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/health", (_req, res) => res.json({
  status: "ok",
  version: "4.3.0",
  defaultRegion: DEFAULT_REGION
}));

function getManifestJson() {
  return {
    id: "com.nuvio.release-info.stream",
    version: "4.3.0",
    name: "Release Info",
    description: "Shows theatrical, digital release dates and runtimes for Movies & TV series in Nuvio/Stremio.",
    resources: [
      "stream",
      { name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "tmdb:"] }
    ],
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb:"],
    catalogs: []
  };
}

app.get("/manifest.json", (_req, res) => res.json(getManifestJson()));
app.get("/:config/manifest.json", (_req, res) => res.json(getManifestJson()));

async function handleStream(req, res) {
  const { type, id } = req.params;
  if (type !== "movie" && type !== "series") return res.json({ streams: [] });

  const creds = getCredentials(req.params.config);
  if (!creds.tmdbToken && !creds.tmdbKey) {
    const host = req.get("host") || "localhost";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    return res.json({
      streams: [{
        name: "⚠️ Release Info",
        title: "TMDB API credentials missing. Please configure the addon.",
        description: "Missing API token/key.",
        url: `${protocol}://${host}/dummy.mp4`,
        externalUrl: `${protocol}://${host}/`
      }]
    });
  }

  try {
    if (type === "movie") {
      let rawId = String(id);
      if (rawId.startsWith("tmdb:")) {
        rawId = "tmdb:" + rawId.slice(5).split(":")[0];
      } else {
        rawId = rawId.split(":")[0];
      }

      const info = await getMovieInfo(rawId, creds);
      return res.json({ streams: streamMovie(info, req) });
    }

    if (type === "series") {
      const parts = String(id).split(":");
      let seriesRawId;
      let season;
      let episode;

      if (id.startsWith("tmdb:")) {
        seriesRawId = "tmdb:" + parts[1];
        season = parseInt(parts[2], 10);
        episode = parseInt(parts[3], 10);
      } else {
        seriesRawId = parts[0];
        season = parseInt(parts[1], 10);
        episode = parseInt(parts[2], 10);
      }

      if (Number.isNaN(season) || Number.isNaN(episode)) {
        return res.json({ streams: [] });
      }

      const info = await getEpisodeInfo(seriesRawId, season, episode, creds);
      return res.json({ streams: streamEpisode(info, req) });
    }
  } catch (e) {
    console.error(`[${type}:${id}] ${e.message}`);
    const host = req.get("host") || "localhost";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    return res.json({
      streams: [{
        name: "⚠️ Release Info",
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

app.listen(PORT, () => console.log(`Release Info addon listening on ${PORT}`));
