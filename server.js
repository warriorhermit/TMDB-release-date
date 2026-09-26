const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = Number(process.env.PORT || 7000);
const TMDB_TOKEN = process.env.TMDB_API_TOKEN || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const DEFAULT_REGION = (process.env.DEFAULT_REGION || "IN").toUpperCase();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 21600000);

const manifest = {
  id: "com.nuvio.tmdb.release-dates",
  version: "1.1.0",
  name: "TMDB Release Dates",
  description: "Adds TMDB theatrical and digital release dates to movie metadata.",
  resources: [
    {
      name: "meta",
      types: ["movie"],
      idPrefixes: ["tt"]
    }
  ],
  types: ["movie"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: {
    configurable: false
  }
};

const builder = new addonBuilder(manifest);
const cache = new Map();

function cacheGet(key) {
  const x = cache.get(key);
  if (!x) return null;
  if (Date.now() - x.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return x.value;
}

function cacheSet(key, value) {
  cache.set(key, { time: Date.now(), value });
  return value;
}

async function tmdb(path, params = {}) {
  const url = new URL("https://api.themoviedb.org/3" + path);

  if (TMDB_TOKEN) {
    // TMDB API Read Access Token authentication.
  } else if (TMDB_API_KEY) {
    url.searchParams.set("api_key", TMDB_API_KEY);
  } else {
    throw new Error("TMDB credentials are not configured");
  }

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  const headers = { accept: "application/json" };
  if (TMDB_TOKEN) headers.Authorization = `Bearer ${TMDB_TOKEN}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TMDB HTTP ${response.status}`);
  }
  return response.json();
}

async function findMovie(imdbId) {
  const key = "find:" + imdbId;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await tmdb(`/find/${encodeURIComponent(imdbId)}`, {
    external_source: "imdb_id"
  });

  return cacheSet(key, (data.movie_results || [])[0] || null);
}

async function getReleaseDates(tmdbId) {
  const key = "release:" + tmdbId;
  const cached = cacheGet(key);
  if (cached) return cached;

  return cacheSet(key, await tmdb(`/movie/${tmdbId}/release_dates`));
}

function formatDate(value) {
  if (!value) return null;
  const [y, m, d] = value.substring(0, 10).split("-");
  if (!y || !m || !d) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(+y, +m - 1, +d)));
}

function firstRelease(country, type) {
  return (country.release_dates || [])
    .filter(x => Number(x.type) === type && x.release_date)
    .sort((a, b) => a.release_date.localeCompare(b.release_date))[0] || null;
}

function chooseCountry(results) {
  const order = [
    DEFAULT_REGION,
    "US",
    "GB",
    ...results.map(x => x.iso_3166_1)
  ];

  for (const code of [...new Set(order)]) {
    const country = results.find(x => x.iso_3166_1 === code);
    if (!country) continue;

    const theatrical = firstRelease(country, 3);
    const digital = firstRelease(country, 4);

    if (theatrical || digital) {
      return { code, theatrical, digital };
    }
  }

  return { code: DEFAULT_REGION, theatrical: null, digital: null };
}

async function makeMeta(imdbId) {
  const movie = await findMovie(imdbId);
  if (!movie) return null;

  const releaseData = await getReleaseDates(movie.id);
  const selected = chooseCountry(releaseData.results || []);

  const theatrical = selected.theatrical
    ? formatDate(selected.theatrical.release_date)
    : null;

  const digital = selected.digital
    ? formatDate(selected.digital.release_date)
    : null;

  // Keep this as one releaseInfo string because this is a standard
  // Stremio metadata field and Nuvio renders it on movie details pages.
  const releaseInfoParts = [];
  if (theatrical) releaseInfoParts.push(`Theatrical: ${theatrical}`);
  if (digital) releaseInfoParts.push(`Digital: ${digital}`);

  const meta = {
    id: imdbId,
    type: "movie",
    name: movie.title || movie.original_title || imdbId,

    // This is the key field consumed by Nuvio/Stremio detail metadata.
    releaseInfo: releaseInfoParts.length
      ? releaseInfoParts.join("  •  ")
      : (movie.release_date || ""),

    // Keep normal movie metadata so preferring this external addon does
    // not produce a bare title/date-only details page.
    released: movie.release_date || undefined,
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : undefined,
    description: movie.overview || undefined,
    poster: movie.poster_path
      ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`
      : undefined,
    background: movie.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`
      : undefined,
    genres: Array.isArray(movie.genre_ids)
      ? undefined
      : undefined,
    links: [
      {
        name: `TMDB${selected.code ? ` (${selected.code})` : ""}`,
        category: "movie",
        url: `https://www.themoviedb.org/movie/${movie.id}`
      }
    ],
    behaviorHints: {
      defaultVideoId: imdbId
    }
  };

  return meta;
}

builder.defineMetaHandler(async (args) => {
  if (args.type !== "movie") return { meta: {} };

  const imdbId = String(args.id || "").split(":")[0];

  if (!/^tt\d+$/.test(imdbId)) {
    return { meta: {} };
  }

  try {
    const meta = await makeMeta(imdbId);
    if (!meta) return { meta: {} };

    return {
      meta,
      cacheMaxAge: 21600,
      staleRevalidate: 86400,
      staleError: 604800
    };
  } catch (error) {
    console.error(`[meta ${imdbId}] ${error.message}`);
    return { meta: {} };
  }
});

serveHTTP(builder.getInterface(), {
  port: PORT,
  cacheMaxAge: 21600
});

console.log(`TMDB Release Dates v1.1.0 listening on port ${PORT}`);
console.log(`Default region: ${DEFAULT_REGION}`);
console.log(`Manifest: /manifest.json`);
