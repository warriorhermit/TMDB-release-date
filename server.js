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

// Known TV show ID translations when TMDB /find endpoint is unindexed or lagging
const KNOWN_IMDB_TO_TMDB = {
  "tt26540674": "219847", // Lanterns (HBO / DC Studios)
  "tt2375692":  "49010",  // Black Sails
  "tt3581920":  "100088", // The Last of Us
  "tt12637874": "106379", // Fallout
  "tt0944947":  "1399",   // Game of Thrones
  "tt1190634":  "82856"   // The Boys
};

// Curated dictionary for legendary movie alternate/extended cuts with running times
const KNOWN_MOVIE_CUTS = {
  "120":    { editionName: "Extended Edition", runtime: "3h 48m" }, // LOTR: Fellowship
  "121":    { editionName: "Extended Edition", runtime: "3h 55m" }, // LOTR: Two Towers
  "122":    { editionName: "Extended Edition", runtime: "4h 11m" }, // LOTR: Return of the King
  "49051":  { editionName: "Extended Edition", runtime: "3h 02m" }, // Hobbit 1
  "57158":  { editionName: "Extended Edition", runtime: "3h 06m" }, // Hobbit 2
  "122917": { editionName: "Extended Edition", runtime: "2h 44m" }, // Hobbit 3
  "791373": { editionName: "Director's Cut",   runtime: "4h 02m" }, // Snyder Cut
  "1495":   { editionName: "Director's Cut",   runtime: "3h 14m" }, // Kingdom of Heaven
  "19995":  { editionName: "Extended Collector's Edition", runtime: "2h 58m" }, // Avatar
  "78":     { editionName: "The Final Cut",    runtime: "1h 57m" }, // Blade Runner
  "679":    { editionName: "Special Edition",  runtime: "2h 34m" }, // Aliens
  "28":     { editionName: "Redux",            runtime: "3h 16m" }  // Apocalypse Now
};

// Curated dictionary for legendary TV alternate cuts
const KNOWN_TV_CUTS = {
  "1972:2:10": { editionName: "Extended Cut", runtime: "59m" },    // BSG Pegasus
  "1972:3:9":  { editionName: "Extended Cut", runtime: "1h 10m" }, // BSG Unfinished Business
  "1972:4:18": { editionName: "Extended Cut", runtime: "1h 07m" }, // BSG Islanded in a Stream of Stars
  "1972:4:20": { editionName: "Extended Finale", runtime: "2h 32m" } // BSG Daybreak
};

// Specific seasonal books for Game of Thrones
const GOT_SEASON_BOOKS = {
  1: 'Novel: "A Game of Thrones" by George R. R. Martin',
  2: 'Novel: "A Clash of Kings" by George R. R. Martin',
  3: 'Novel: "A Storm of Swords" (Part 1) by George R. R. Martin',
  4: 'Novel: "A Storm of Swords" (Part 2) by George R. R. Martin',
  5: 'Novels: "A Feast for Crows" & "A Dance with Dragons" by George R. R. Martin',
  6: 'Outlines for "The Winds of Winter" by George R. R. Martin',
  7: 'Outlines for "A Dream of Spring" by George R. R. Martin',
  8: 'Outlines for "A Dream of Spring" by George R. R. Martin'
};

// Curated backup for notable adaptations / continuity / folklore / mythology
const KNOWN_SERIES_CONTINUITY = {
  // Game of Thrones
  "1399": {
    franchise: "A Song of Ice and Fire Universe",
    wikiUrl: "https://en.wikipedia.org/wiki/Game_of_Thrones"
  },
  "tt0944947": {
    franchise: "A Song of Ice and Fire Universe",
    wikiUrl: "https://en.wikipedia.org/wiki/Game_of_Thrones"
  },

  // Video Game Adaptations
  "100088": {
    franchise: "The Last of Us Universe",
    basedOn: "Video Game: The Last of Us (Naughty Dog / PlayStation)",
    wikiUrl: "https://en.wikipedia.org/wiki/The_Last_of_Us_(TV_series)"
  },
  "tt3581920": {
    franchise: "The Last of Us Universe",
    basedOn: "Video Game: The Last of Us (Naughty Dog / PlayStation)",
    wikiUrl: "https://en.wikipedia.org/wiki/The_Last_of_Us_(TV_series)"
  },
  "106379": {
    franchise: "Fallout Universe",
    basedOn: "Video Game: Fallout (Bethesda / Interplay)",
    wikiUrl: "https://en.wikipedia.org/wiki/Fallout_(American_TV_series)"
  },
  "tt12637874": {
    franchise: "Fallout Universe",
    basedOn: "Video Game: Fallout (Bethesda / Interplay)",
    wikiUrl: "https://en.wikipedia.org/wiki/Fallout_(American_TV_series)"
  },
  "94605": { // Arcane
    franchise: "League of Legends Universe",
    basedOn: "Video Game: League of Legends (Riot Games)",
    wikiUrl: "https://en.wikipedia.org/wiki/Arcane_(TV_series)"
  },
  "tt11126994": {
    franchise: "League of Legends Universe",
    basedOn: "Video Game: League of Legends (Riot Games)",
    wikiUrl: "https://en.wikipedia.org/wiki/Arcane_(TV_series)"
  },
  "71024": { // Castlevania
    franchise: "Castlevania Universe",
    basedOn: "Video Game: Castlevania (Konami)",
    wikiUrl: "https://en.wikipedia.org/wiki/Castlevania_(TV_series)"
  },
  "tt6517102": {
    franchise: "Castlevania Universe",
    basedOn: "Video Game: Castlevania (Konami)",
    wikiUrl: "https://en.wikipedia.org/wiki/Castlevania_(TV_series)"
  },

  // Lanterns (HBO / DC Studios)
  "219847": {
    title: "Lanterns",
    franchise: "DC Universe",
    basedOn: "Green Lantern by John Broome & Gil Kane (DC Comics)",
    expectedAir: "Expected 2026",
    wikiUrl: "https://en.wikipedia.org/wiki/Lanterns_(TV_series)"
  },
  "tt26540674": {
    title: "Lanterns",
    franchise: "DC Universe",
    basedOn: "Green Lantern by John Broome & Gil Kane (DC Comics)",
    expectedAir: "Expected 2026",
    wikiUrl: "https://en.wikipedia.org/wiki/Lanterns_(TV_series)"
  },

  // Black Sails (Prequel to Treasure Island)
  "49010": {
    franchise: "Treasure Island Universe",
    basedOn: "Prequel to 'Treasure Island' by Robert Louis Stevenson",
    wikiUrl: "https://en.wikipedia.org/wiki/Black_Sails_(TV_series)"
  },
  "tt2375692": {
    franchise: "Treasure Island Universe",
    basedOn: "Prequel to 'Treasure Island' by Robert Louis Stevenson",
    wikiUrl: "https://en.wikipedia.org/wiki/Black_Sails_(TV_series)"
  }
};

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

// ----------------- Fiction / Stage Play / Folklore Classification Helper -----------------

function formatAdaptedType(rawLabel, rawType, rawDepicts) {
  const text = `${rawLabel} ${rawType} ${rawDepicts}`.toLowerCase();

  // Stage Plays, Musicals, and Operas
  if (/broadway musical|musical play|musical theatre|stage musical/i.test(text)) {
    return "🎭 Musical: ";
  }
  if (/opera|libretto|operetta/i.test(text)) {
    return "🎭 Opera: ";
  }
  if (/theatre play|theater play|stage play|dramatic play|tragedy|comedy play|\bplay\b/i.test(text)) {
    return "🎭 Stage Play: ";
  }

  // Mythology & Folklore
  if (/greek myth|norse myth|egyptian myth|hindu myth|roman myth|mythology|mythological|deity|pantheon/i.test(text)) {
    return "Mythology: ";
  }
  if (/folklore|fairy tale|fable|folk tale|legend|arthurian|urban legend/i.test(text)) {
    return "Folklore / Legend: ";
  }

  // Other Forms of Fiction
  if (/video game|game/i.test(text)) {
    return "Video Game: ";
  }
  if (/comic|manga|graphic novel|manhwa/i.test(text)) {
    return "Comic / Graphic Novel: ";
  }
  if (/short story/i.test(text)) {
    return "Short Story: ";
  }
  if (/novel|book|literary/i.test(text)) {
    return "Novel: ";
  }
  return "";
}

// ----------------- Wikidata Engines -----------------

async function fetchWikidataEpisodeAdaptation(seriesImdbId, season, episode, epImdbId = null) {
  let subjectPattern = "";
  if (epImdbId && /^tt\d+$/i.test(epImdbId)) {
    subjectPattern = `?ep wdt:P345 "${epImdbId}".`;
  } else if (seriesImdbId && /^tt\d+$/i.test(seriesImdbId)) {
    subjectPattern = `
      ?series wdt:P345 "${seriesImdbId}".
      ?ep wdt:P179 ?series ;
          wdt:P4908 ?seasonItem ;
          wdt:P1083 "${episode}".
    `;
  } else {
    return null;
  }

  const query = `
    SELECT ?workLabel ?creatorLabel ?workTypeLabel ?depictsLabel ?article WHERE {
      ${subjectPattern}
      { ?ep wdt:P144 ?work . } UNION { ?ep wdt:P921 ?work . } UNION { ?ep wdt:P180 ?work . }
      OPTIONAL { ?work wdt:P31 ?workType . }
      OPTIONAL { ?work wdt:P180 ?depicts . }
      OPTIONAL { { ?work wdt:P50 ?creator . } UNION { ?work wdt:P178 ?creator . } UNION { ?work wdt:P123 ?creator . } }
      OPTIONAL {
        ?article schema:about ?ep ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1
  `;

  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ReleaseInfoAddon/6.4 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return null;
    const json = await res.json();
    const binding = json?.results?.bindings?.[0];

    const work = binding?.workLabel?.value;
    const creator = binding?.creatorLabel?.value;
    const workType = binding?.workTypeLabel?.value || "";
    const depicts = binding?.depictsLabel?.value || "";
    const article = binding?.article?.value;

    if (work && !work.startsWith("Q")) {
      const prefix = formatAdaptedType(work, workType, depicts);
      const creatorSuffix = (creator && !creator.startsWith("Q")) ? ` (${creator})` : "";
      return {
        adaptedSource: `${prefix}"${work}"${creatorSuffix}`,
        episodeWikiUrl: article || null
      };
    }
  } catch (err) {
    console.warn(`[Wikidata Ep Adaptation Error]: ${err.message}`);
  }

  return null;
}

async function fetchWikidataMovieDetails(imdbId, fallbackTitle = "", baseTheatricalMinutes = null) {
  const defaultWikiUrl = fallbackTitle
    ? `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(fallbackTitle)}`
    : "https://en.wikipedia.org/";

  if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
    return { franchise: null, basedOn: null, follows: null, followedBy: null, specialCut: null, wikiUrl: defaultWikiUrl };
  }

  const query = `
    SELECT ?franchiseLabel ?basedOnLabel ?basedOnTypeLabel ?depictsLabel ?creatorLabel ?followsLabel ?followedByLabel ?partOfLabel ?article ?duration ?editionLabel WHERE {
      ?item wdt:P345 "${imdbId}".
      OPTIONAL { ?item wdt:P179 ?franchise. }
      OPTIONAL {
        { ?item wdt:P144 ?basedOnItem . } UNION { ?item wdt:P921 ?basedOnItem . } UNION { ?item wdt:P180 ?basedOnItem . }
        ?basedOnItem rdfs:label ?basedOnLabel filter (lang(?basedOnLabel) = "en") .
        OPTIONAL { ?basedOnItem wdt:P31 ?basedOnType . }
        OPTIONAL { ?basedOnItem wdt:P180 ?depicts . }
        OPTIONAL { { ?basedOnItem wdt:P50 ?creator . } UNION { ?basedOnItem wdt:P178 ?creator . } UNION { ?basedOnItem wdt:P123 ?creator . } }
      }
      OPTIONAL { ?item wdt:P155 ?follows. }
      OPTIONAL { ?item wdt:P156 ?followedBy. }
      OPTIONAL { ?item wdt:P361 ?partOf. }
      OPTIONAL {
        ?item p:P2047 ?durStatement.
        ?durStatement ps:P2047 ?duration.
        OPTIONAL { ?durStatement (pq:P444|pq:P453|pq:P1013) ?edition. }
      }
      OPTIONAL {
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;

  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ReleaseInfoAddon/6.4 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return { franchise: null, basedOn: null, follows: null, followedBy: null, specialCut: null, wikiUrl: defaultWikiUrl };
    const json = await res.json();
    const bindings = json?.results?.bindings || [];
    if (bindings.length === 0) return { franchise: null, basedOn: null, follows: null, followedBy: null, specialCut: null, wikiUrl: defaultWikiUrl };

    const first = bindings[0];
    const franchise = first?.franchiseLabel?.value;
    let basedOn = first?.basedOnLabel?.value;
    const basedOnType = first?.basedOnTypeLabel?.value || "";
    const depicts = first?.depictsLabel?.value || "";
    const creator = first?.creatorLabel?.value;
    const follows = first?.followsLabel?.value;
    const followedBy = first?.followedByLabel?.value;
    const partOf = first?.partOfLabel?.value;
    const wikiUrl = first?.article?.value || defaultWikiUrl;

    if (basedOn && !basedOn.startsWith("Q")) {
      const prefix = formatAdaptedType(basedOn, basedOnType, depicts);
      const creatorSuffix = (creator && !creator.startsWith("Q")) ? ` by ${creator}` : "";
      basedOn = `${prefix}${basedOn}${creatorSuffix}`;
    } else {
      basedOn = null;
    }

    let specialCut = null;
    const theatricalMin = baseTheatricalMinutes || 0;

    for (const b of bindings) {
      if (!b.duration?.value) continue;
      const parsedDur = parseFloat(b.duration.value);
      if (Number.isNaN(parsedDur) || parsedDur <= 0) continue;

      const minutes = parsedDur > 500 ? Math.round(parsedDur / 60) : Math.round(parsedDur);

      if (theatricalMin > 0 && minutes >= theatricalMin + 3) {
        const editionName = b.editionLabel?.value && !b.editionLabel.value.startsWith("Q")
          ? b.editionLabel.value
          : "Extended Cut";
        specialCut = { editionName, runtime: formatMinutes(minutes) };
        break;
      }
    }

    return {
      franchise: franchise && !franchise.startsWith("Q") ? franchise : (partOf && !partOf.startsWith("Q") ? partOf : null),
      basedOn,
      follows: follows && !follows.startsWith("Q") ? follows : null,
      followedBy: followedBy && !followedBy.startsWith("Q") ? followedBy : null,
      specialCut,
      wikiUrl
    };
  } catch (err) {
    console.warn(`[Wikidata Movie Error for ${imdbId}]: ${err.message}`);
    return { franchise: null, basedOn: null, follows: null, followedBy: null, specialCut: null, wikiUrl: defaultWikiUrl };
  }
}

async function fetchWikidataDetails(imdbId, fallbackTitle = "", currentAirYear = null) {
  const defaultWikiUrl = fallbackTitle
    ? `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(fallbackTitle)}`
    : "https://en.wikipedia.org/";

  if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
    return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, wikiUrl: defaultWikiUrl };
  }

  const query = `
    SELECT ?franchiseLabel ?basedOnLabel ?basedOnTypeLabel ?depictsLabel ?creatorLabel ?parentSeriesLabel ?followsLabel ?followedByLabel ?partOfLabel ?article
           ?instanceType ?predecessorLabel (YEAR(?origStart) AS ?origStartY) (YEAR(?origEnd) AS ?origEndY) WHERE {
      ?item wdt:P345 "${imdbId}".
      OPTIONAL { ?item wdt:P179 ?franchise. }
      OPTIONAL { ?item wdt:P31 ?instanceType. }
      OPTIONAL {
        { ?item wdt:P144 ?basedOnItem . } UNION { ?item wdt:P921 ?basedOnItem . } UNION { ?item wdt:P180 ?basedOnItem . }
        ?basedOnItem rdfs:label ?basedOnLabel filter (lang(?basedOnLabel) = "en") .
        OPTIONAL { ?basedOnItem wdt:P31 ?basedOnType . }
        OPTIONAL { ?basedOnItem wdt:P180 ?depicts . }
        OPTIONAL { ?basedOnItem wdt:P179 ?parentSeries . }
        OPTIONAL { { ?basedOnItem wdt:P50 ?creator . } UNION { ?basedOnItem wdt:P178 ?creator . } UNION { ?basedOnItem wdt:P123 ?creator . } }
      }
      OPTIONAL { ?item wdt:P155 ?follows. }
      OPTIONAL { ?item wdt:P156 ?followedBy. }
      OPTIONAL { ?item wdt:P361 ?partOf. }
      OPTIONAL {
        { ?item wdt:P155 ?predecessor. } UNION { ?item wdt:P1366 ?predecessor. }
        ?predecessor wdt:P31 ?predType .
        FILTER(?predType IN (wd:Q5398426, wd:Q15632733))
        OPTIONAL { ?predecessor (wdt:P580|wdt:P577) ?origStart. }
        OPTIONAL { ?predecessor wdt:P582 ?origEnd. }
      }
      OPTIONAL {
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1
  `;

  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ReleaseInfoAddon/6.4 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, wikiUrl: defaultWikiUrl };
    const json = await res.json();
    const binding = json?.results?.bindings?.[0];

    const franchise = binding?.franchiseLabel?.value;
    let basedOn = binding?.basedOnLabel?.value;
    const basedOnType = binding?.basedOnTypeLabel?.value || "";
    const depicts = binding?.depictsLabel?.value || "";
    const parentSeries = binding?.parentSeriesLabel?.value;
    const creator = binding?.creatorLabel?.value;
    const follows = binding?.followsLabel?.value;
    const followedBy = binding?.followedByLabel?.value;
    const partOf = binding?.partOfLabel?.value;
    const wikiUrl = binding?.article?.value || defaultWikiUrl;
    const instanceType = binding?.instanceType?.value || "";

    if (basedOn && !basedOn.startsWith("Q")) {
      const prefix = formatAdaptedType(basedOn, basedOnType, depicts);
      const creatorSuffix = (creator && !creator.startsWith("Q")) ? ` (${creator})` : "";

      if (parentSeries && !parentSeries.startsWith("Q") && !parentSeries.includes("Volume")) {
        basedOn = `Novel series: "${parentSeries}"${creatorSuffix}`;
      } else {
        basedOn = `${prefix}${basedOn}${creatorSuffix}`;
      }
    } else {
      basedOn = null;
    }

    let revivalOf = null;
    const predTitle = binding?.predecessorLabel?.value;
    const startY = binding?.origStartY?.value ? parseInt(binding.origStartY.value, 10) : null;
    const endY = binding?.origEndY?.value ? parseInt(binding.origEndY.value, 10) : null;
    const currentYear = currentAirYear ? parseInt(currentAirYear, 10) : null;

    const isExplicitRevival = instanceType.includes("Q2884170") || instanceType.includes("Q15632733");
    const hasLongHiatus = endY && currentYear && (currentYear - endY >= 5);

    if (predTitle && !predTitle.startsWith("Q") && (isExplicitRevival || hasLongHiatus)) {
      const yearRange = startY && endY ? ` (${startY}–${endY})` : (startY ? ` (${startY})` : "");
      revivalOf = `Revival of ${predTitle}${yearRange}`;
    }

    return {
      franchise: franchise && !franchise.startsWith("Q") ? franchise : (partOf && !partOf.startsWith("Q") ? partOf : null),
      basedOn,
      follows: follows && !follows.startsWith("Q") ? follows : null,
      followedBy: followedBy && !followedBy.startsWith("Q") ? followedBy : null,
      revivalOf,
      wikiUrl
    };
  } catch (err) {
    console.warn(`[Wikidata Details Error for ${imdbId}]: ${err.message}`);
    return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, wikiUrl: defaultWikiUrl };
  }
}

// ----------------- TVDB v4 Helpers -----------------

async function getTvdbToken(apiKey) {
  if (!apiKey) return null;
  const now = Date.now();
  if (tvdbJwtToken && tvdbTokenExpiresAt > now) return tvdbJwtToken;

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
    headers: { Authorization: `Bearer ${jwtToken}`, accept: "application/json" }
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
          return { editionName: specName.trim(), runtime: formatMinutes(spec.runtime) };
        }
      }
    }
  } catch (err) {
    console.warn(`[TVDB Fetch Error]: ${err.message}`);
  }
  return null;
}

// ----------------- Parsing & Formatting -----------------

function extractSourceMaterial(crew = []) {
  const adaptationPatterns = [
    /novel/i, /book/i, /comic/i, /graphic novel/i, /character/i,
    /short story/i, /theatre play|theater play|stage play|\bplay\b/i,
    /musical/i, /opera|libretto/i, /video game|game/i, /mythology|myth/i,
    /folklore|legend/i, /fairy tale/i, /playwright/i, /author/i, /story by/i
  ];

  const sources = [];

  for (const person of crew) {
    const rawJobs = [];
    if (person.job) rawJobs.push(person.job);
    if (Array.isArray(person.jobs)) {
      person.jobs.forEach(j => { if (j.job) rawJobs.push(j.job); });
    }

    for (const jobTitle of rawJobs) {
      if (adaptationPatterns.some(pattern => pattern.test(jobTitle))) {
        let cleanJob = jobTitle.replace(/^based\s+on\s+(the\s+)?/i, "").trim();
        if (/theatre play|theater play|stage play|\bplay\b/i.test(cleanJob)) {
          cleanJob = "Stage Play";
        } else if (/musical/i.test(cleanJob)) {
          cleanJob = "Musical";
        }
        const formattedJob = cleanJob.charAt(0).toUpperCase() + cleanJob.slice(1);
        sources.push(`${formattedJob} by ${person.name}`);
      }
    }
  }

  return [...new Set(sources)].slice(0, 2);
}

function extractStoryArcFromText(text = "") {
  if (!text) return null;

  // 1. Stage Plays, Theatrical Works, and Musicals
  const playMatch = text.match(/(?:based on|adapted from|adaptation of)\s+(?:the\s+)?(?:stage\s+|theatre\s+|theater\s+|broadway\s+)?(play|musical|opera|theatrical production)\s+(?:of\s+|titled\s+|by\s+)?["'“]?([^"'”.,;]+)["'”]?/i);
  if (playMatch && playMatch[2]) {
    const playType = /musical/i.test(playMatch[1]) ? "Musical" : (/opera/i.test(playMatch[1]) ? "Opera" : "Stage Play");
    return `🎭 ${playType}: "${playMatch[2].trim()}"`;
  }

  // 2. Folklore, Fairy Tales, or Mythology
  const mythMatch = text.match(/(?:based on|inspired by|adapts|adapting)\s+(?:the\s+)?([a-zA-Z\s]+(?:mythology|myth|folklore|legend|fairy tale|fable))(?:\s+of\s+["'“]?([^"'”.,;]+)["'”]?)?/i);
  if (mythMatch && mythMatch[1]) {
    const specificDetail = mythMatch[2] ? ` (${mythMatch[2].trim()})` : "";
    return `Mythology/Folklore: ${mythMatch[1].trim()}${specificDetail}`;
  }

  // 3. Video Games
  const vgMatch = text.match(/(?:based on|adapted from|adaptation of)\s+(?:the\s+)?(?:hit\s+|acclaimed\s+|popular\s+)?video game\s+(?:series\s+|franchise\s+)?["'“]?([^"'”.,;]+)["'”]?/i);
  if (vgMatch && vgMatch[1]) {
    return `Video Game: ${vgMatch[1].trim()}`;
  }

  // 4. Books, Novels, Comic arcs
  const arcMatch = text.match(/(?:based on|adapted from|adapting)\s+(?:the\s+(?:book|novel|comic|short story|play)\s+)?["'“]([^"'”]+)["'”]/i);
  return arcMatch && arcMatch[1] ? arcMatch[1].trim() : null;
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

async function findByImdb(imdbId, creds) {
  if (KNOWN_IMDB_TO_TMDB[imdbId]) {
    return { id: KNOWN_IMDB_TO_TMDB[imdbId], type: "tv" };
  }

  try {
    const find = await tmdbGet(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, creds);
    const movie = (find.movie_results || [])[0];
    if (movie?.id) return { id: movie.id, type: "movie" };
    const tv = (find.tv_results || [])[0];
    if (tv?.id) return { id: tv.id, type: "tv" };
  } catch {
    // Ignore find endpoint errors
  }

  return { id: null, type: "tv" };
}

async function resolveMovie(rawId, creds) {
  if (rawId.startsWith("tmdb:")) {
    const tmdbId = rawId.replace("tmdb:", "");
    const movie = await tmdbGet(`/movie/${tmdbId}?append_to_response=credits,release_dates`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^\d+$/.test(rawId)) {
    const movie = await tmdbGet(`/movie/${rawId}?append_to_response=credits,release_dates`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^tt\d+$/i.test(rawId)) {
    const found = await findByImdb(rawId, creds);
    if (found.id) {
      const movie = await tmdbGet(`/movie/${found.id}?append_to_response=credits,release_dates`, creds);
      return { movie, imdbId: rawId };
    }
    throw new Error(`TMDB could not map IMDb ID ${rawId}`);
  }
  throw new Error(`Unsupported ID format: ${rawId}`);
}

async function resolveTvShow(rawId, creds) {
  if (rawId.startsWith("tmdb:")) {
    const id = rawId.replace("tmdb:", "");
    try {
      const details = await tmdbGet(`/tv/${id}?append_to_response=external_ids,aggregate_credits`, creds);
      return { tvId: id, imdbId: details.external_ids?.imdb_id || null, showData: details };
    } catch {
      return { tvId: id, imdbId: null, showData: { name: "TV Series", id } };
    }
  }

  if (/^\d+$/.test(rawId)) {
    try {
      const details = await tmdbGet(`/tv/${rawId}?append_to_response=external_ids,aggregate_credits`, creds);
      return { tvId: rawId, imdbId: details.external_ids?.imdb_id || null, showData: details };
    } catch {
      return { tvId: rawId, imdbId: null, showData: { name: "TV Series", id: rawId } };
    }
  }

  if (/^tt\d+$/i.test(rawId)) {
    if (KNOWN_IMDB_TO_TMDB[rawId]) {
      const resolvedTvId = KNOWN_IMDB_TO_TMDB[rawId];
      let details = null;
      try {
        details = await tmdbGet(`/tv/${resolvedTvId}`, creds);
      } catch {
        details = { name: "TV Series", id: resolvedTvId };
      }
      return { tvId: resolvedTvId, imdbId: rawId, showData: details };
    }

    const found = await findByImdb(rawId, creds);
    if (found.id) {
      let details = null;
      try {
        details = await tmdbGet(`/tv/${found.id}`, creds);
      } catch {
        details = { id: found.id };
      }
      return { tvId: found.id, imdbId: rawId, showData: details };
    }

    return { tvId: null, imdbId: rawId, showData: { name: "TV Series" } };
  }

  throw new Error(`Unsupported TV Show ID: ${rawId}`);
}

async function getMovieInfo(rawId, creds) {
  const cacheKey = `movie:${creds.tmdbToken || creds.tmdbKey}:${rawId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (activeRequests.has(cacheKey)) return activeRequests.get(cacheKey);

  const promise = (async () => {
    const { movie, imdbId } = await resolveMovie(rawId, creds);
    const countries = movie.release_dates?.results || [];

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

    if ((!specialCut || !specialCut.runtime) && KNOWN_MOVIE_CUTS[String(movie.id)]) {
      specialCut = KNOWN_MOVIE_CUTS[String(movie.id)];
    }

    const sourceMaterial = extractSourceMaterial(movie.credits?.crew || []);
    let franchise = movie.belongs_to_collection ? movie.belongs_to_collection.name : null;

    // Detect plays, fiction, mythology, folklore or game arcs from movie overview
    const overviewArc = extractStoryArcFromText(movie.overview);
    if (overviewArc && !sourceMaterial.some(s => s.toLowerCase().includes(overviewArc.toLowerCase()))) {
      sourceMaterial.unshift(overviewArc);
    }

    const movieTitle = movie.title || movie.original_title || "";
    const wiki = await fetchWikidataMovieDetails(imdbId, movieTitle, movie.runtime);

    if (wiki) {
      if (!franchise && wiki.franchise) franchise = wiki.franchise;
      if (wiki.basedOn && !sourceMaterial.some(s => s.toLowerCase().includes(wiki.basedOn.toLowerCase()))) {
        sourceMaterial.unshift(wiki.basedOn);
      } else if (wiki.follows && !franchise) {
        franchise = `Sequel to ${wiki.follows}`;
      } else if (wiki.followedBy && !franchise) {
        franchise = `Prequel to ${wiki.followedBy}`;
      }

      if ((!specialCut || !specialCut.runtime) && wiki.specialCut) {
        specialCut = wiki.specialCut;
      }
    }

    const value = {
      type: "movie",
      rawId,
      tmdbId: movie.id,
      title: movieTitle || rawId,
      theatricalRuntime,
      theatrical,
      digital,
      specialCut,
      sourceMaterial,
      franchise,
      wikiUrl: wiki.wikiUrl
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
    // Fast-path intercept for Lanterns (unreleased on TMDB)
    const rawClean = String(seriesRawId).replace("tmdb:", "");
    if (rawClean === "219847" || rawClean === "tt26540674") {
      const known = KNOWN_SERIES_CONTINUITY["219847"];
      return {
        type: "series",
        tvId: "219847",
        season: 1,
        episode: 1,
        title: "Lanterns (In Production)",
        airDate: known.expectedAir,
        runtime: null,
        specialCut: null,
        sourceMaterial: [known.basedOn],
        franchise: known.franchise,
        revivalOf: null,
        wikiUrl: known.wikiUrl
      };
    }

    const { tvId, imdbId, showData } = await resolveTvShow(seriesRawId, creds);

    let epData = null;
    if (tvId) {
      try {
        epData = await tmdbGet(`/tv/${tvId}/season/${season}/episode/${episode}?append_to_response=credits,external_ids`, creds);
      } catch {
        // Episode not indexed yet
      }
    }

    let seasonData = null;
    if (tvId) {
      try {
        seasonData = await tmdbGet(`/tv/${tvId}/season/${season}?append_to_response=credits`, creds);
      } catch {
        // Season not indexed yet
      }
    }

    const airDate = parseDate(epData?.air_date || showData?.first_air_date);
    const airYear = (epData?.air_date || showData?.first_air_date || "").split("-")[0] || null;
    const runtime = formatMinutes(epData?.runtime || (showData?.episode_run_time || [])[0]);

    let specialCut = null;
    const editionPattern = /director|extended|unrated|special edition|alternate|superfan/i;

    if (epData) {
      if (epData.name && editionPattern.test(epData.name)) {
        specialCut = { editionName: epData.name, runtime };
      } else if (epData.overview && editionPattern.test(epData.overview)) {
        const match = epData.overview.match(/(\d+)\s*(?:min|mins|m\b)/i);
        const altRuntime = match ? formatMinutes(parseInt(match[1], 10)) : null;
        specialCut = { editionName: "Extended Cut", runtime: altRuntime };
      }

      if (!specialCut && tvId) {
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
          // No Season 0
        }
      }

      if (!specialCut && creds.tvdbKey) {
        const tvdbMatch = await fetchTvdbSpecialCut(imdbId, epData.name, season, episode, creds.tvdbKey);
        if (tvdbMatch) specialCut = tvdbMatch;
      }
    }

    if (!specialCut && tvId) {
      const manualKey = `${tvId}:${season}:${episode}`;
      if (KNOWN_TV_CUTS[manualKey]) specialCut = KNOWN_TV_CUTS[manualKey];
    }

    // ----------------- Source Material Extraction -----------------
    const sources = [];
    const epImdbId = epData?.external_ids?.imdb_id || null;
    let episodeWikiUrl = null;

    // Check Game of Thrones season-specific book mapping
    const isGameOfThrones = String(tvId) === "1399" || imdbId === "tt0944947";
    if (isGameOfThrones && GOT_SEASON_BOOKS[season]) {
      sources.push(GOT_SEASON_BOOKS[season]);
    }

    // 1. Check curated catalog
    const knownMatch = (tvId ? KNOWN_SERIES_CONTINUITY[String(tvId)] : null) || (imdbId ? KNOWN_SERIES_CONTINUITY[imdbId] : null);
    if (!isGameOfThrones && knownMatch?.basedOn) {
      sources.push(knownMatch.basedOn);
    }

    // 2. Scrape Wikidata directly for episode-specific adaptation (plays/games/DLC/mythology/short stories)
    const epWikiData = await fetchWikidataEpisodeAdaptation(imdbId, season, episode, epImdbId);
    if (epWikiData?.adaptedSource && !sources.includes(epWikiData.adaptedSource)) {
      sources.unshift(epWikiData.adaptedSource);
      if (epWikiData.episodeWikiUrl) episodeWikiUrl = epWikiData.episodeWikiUrl;
    }

    // 3. Check Episode credits & synopsis for specific play/novel/comic/game arc
    if (epData && !isGameOfThrones) {
      const epArc = extractStoryArcFromText(epData.overview);
      if (epArc && !sources.some(s => s.toLowerCase().includes(epArc.toLowerCase()))) {
        sources.push(`Based on "${epArc}"`);
      }
      const epSources = extractSourceMaterial(epData.credits?.crew || []);
      for (const s of epSources) {
        if (!sources.includes(s)) sources.push(s);
      }
    }

    // 4. Check Season synopsis & credits (for shows other than GoT, e.g. Reacher, Percy Jackson)
    if (seasonData && !isGameOfThrones) {
      const seasonArc = extractStoryArcFromText(seasonData.overview);
      if (seasonArc && !sources.some(s => s.toLowerCase().includes(seasonArc.toLowerCase()))) {
        sources.push(seasonArc);
      }
      const seasonSources = extractSourceMaterial(seasonData.credits?.crew || []);
      for (const s of seasonSources) {
        if (!sources.includes(s)) sources.push(s);
      }
    }

    // 5. Check Series overview for stage play, mythology, folklore, or book mentions
    if (showData?.overview && !isGameOfThrones) {
      const seriesOverviewArc = extractStoryArcFromText(showData.overview);
      if (seriesOverviewArc && !sources.some(s => s.toLowerCase().includes(seriesOverviewArc.toLowerCase()))) {
        sources.push(seriesOverviewArc);
      }
    }

    // 6. Fall back to Series-level aggregate credits
    if (sources.length === 0) {
      const seriesSources = extractSourceMaterial(showData?.aggregate_credits?.crew || []);
      for (const s of seriesSources) {
        if (!sources.some(existing => existing.toLowerCase().includes(s.toLowerCase()))) {
          sources.push(s);
        }
      }
    }

    let franchise = knownMatch?.franchise || (isGameOfThrones ? "A Song of Ice and Fire Universe" : null);
    let revivalOf = knownMatch?.revivalOf || null;

    const showTitle = showData?.name || showData?.original_name || "";
    const wiki = await fetchWikidataDetails(imdbId, showTitle, airYear);

    if (wiki) {
      if (!franchise && wiki.franchise) {
        franchise = wiki.franchise.toLowerCase().includes("franchise") || wiki.franchise.toLowerCase().includes("universe")
          ? wiki.franchise
          : `${wiki.franchise} Universe`;
      }
      if (!revivalOf && wiki.revivalOf) {
        revivalOf = wiki.revivalOf;
      }
      if (!isGameOfThrones && wiki.basedOn && !sources.some(s => s.toLowerCase().includes(wiki.basedOn.toLowerCase()))) {
        sources.unshift(wiki.basedOn);
      } else if (wiki.follows && !franchise && !revivalOf) {
        franchise = `Continuation of ${wiki.follows}`;
      } else if (wiki.followedBy && !franchise) {
        franchise = `Prequel to ${wiki.followedBy}`;
      }
    }

    if (/lanterns/i.test(showTitle)) {
      if (!franchise) franchise = "DC Universe";
      if (!sources.some(s => /green lantern/i.test(s))) {
        sources.unshift("Green Lantern by John Broome & Gil Kane (DC Comics)");
      }
    }

    const episodeTitle = epData?.name || (showData?.name ? `${showData.name} (In Production)` : `S${season}E${episode}`);
    const finalWikiUrl = episodeWikiUrl || knownMatch?.wikiUrl || wiki?.wikiUrl || `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(showTitle)}`;

    const value = {
      type: "series",
      tvId,
      season,
      episode,
      title: episodeTitle,
      airDate: airDate || (knownMatch?.expectedAir || "Not announced"),
      runtime,
      specialCut,
      sourceMaterial: [...new Set(sources)].slice(0, 2),
      franchise,
      revivalOf,
      wikiUrl: finalWikiUrl
    };

    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  })();

  activeRequests.set(cacheKey, promise);
  try { return await promise; }
  finally { activeRequests.delete(cacheKey); }
}

function streamMovie(info) {
  const runtimeTheatricalSuffix = info.theatricalRuntime ? ` [Running Time: ${info.theatricalRuntime}]` : "";

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
    const runtime = info.specialCut.runtime ? ` [Running Time: ${info.specialCut.runtime}]` : "";
    lines.push(`✂️ ${name}${runtime}`);
  }

  if (info.revivalOf) {
    lines.push(`🔄 ${info.revivalOf}`);
  }

  if (info.sourceMaterial && info.sourceMaterial.length > 0) {
    lines.push(`📖 Based on: ${info.sourceMaterial.join(", ")}`);
  }

  if (info.franchise) {
    lines.push(`🔗 Part of: ${info.franchise}`);
  }

  return [
    {
      name: `Release Info`,
      title: lines.join("\n"),
      description: lines.join(" | "),
      externalUrl: info.wikiUrl,
      behaviorHints: { notWebReady: true }
    }
  ];
}

function streamEpisode(info) {
  const runtimeSuffix = info.runtime ? ` [Running Time: ${info.runtime}]` : "";
  const airDate = info.airDate ? info.airDate : "Not announced";

  const lines = [
    `📺 Air Date${runtimeSuffix}: ${airDate}`
  ];

  if (info.specialCut) {
    const name = info.specialCut.editionName || "Extended Cut";
    const runtime = info.specialCut.runtime ? ` [Running Time: ${info.specialCut.runtime}]` : "";
    lines.push(`✂️ ${name}${runtime}`);
  }

  if (info.revivalOf) {
    lines.push(`🔄 ${info.revivalOf}`);
  }

  if (info.sourceMaterial && info.sourceMaterial.length > 0) {
    lines.push(`📖 Based on: ${info.sourceMaterial.join(", ")}`);
  }

  if (info.franchise) {
    lines.push(`🔗 Part of: ${info.franchise}`);
  }

  return [
    {
      name: `Release Info`,
      title: lines.join("\n"),
      description: lines.join(" | "),
      externalUrl: info.wikiUrl,
      behaviorHints: { notWebReady: true }
    }
  ];
}

// HTML Configuration UI with TMDB & TVDB Logos
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

        <p>Displays release dates, runtimes (theatrical & extended cuts), adaptations (stage plays, books, comics, video games, folklore, mythology, fiction), validated revivals, and continuity in Nuvio and Stremio. Clicking cards opens Wikipedia.</p>
        
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
  version: "6.4.0",
  defaultRegion: DEFAULT_REGION
}));

function getManifestJson() {
  return {
    id: "com.nuvio.release-info.stream",
    version: "6.4.0",
    name: "Release Info",
    description: "Shows release dates, runtimes (theatrical & extended cuts), episodic adaptations (stage plays, books, comics, video games, mythology, folklore), validated revivals, and franchise continuity for Movies & TV series in Nuvio/Stremio.",
    logo: "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg",
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
    return res.json({
      streams: [{
        name: "⚠️ Release Info",
        title: "TMDB credentials missing. Click here to configure.",
        description: "Missing API token/key.",
        externalUrl: `https://${req.get("host") || "localhost"}/`
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
      return res.json({ streams: streamMovie(info) });
    }

    if (type === "series") {
      const parts = String(id).split(":");
      let seriesRawId;
      let season = 1;
      let episode = 1;

      if (id.startsWith("tmdb:")) {
        seriesRawId = "tmdb:" + parts[1];
        if (parts[2]) season = parseInt(parts[2], 10) || 1;
        if (parts[3]) episode = parseInt(parts[3], 10) || 1;
      } else {
        seriesRawId = parts[0];
        if (parts[1]) season = parseInt(parts[1], 10) || 1;
        if (parts[2]) episode = parseInt(parts[2], 10) || 1;
      }

      const info = await getEpisodeInfo(seriesRawId, season, episode, creds);
      return res.json({ streams: streamEpisode(info) });
    }
  } catch (e) {
    console.error(`[${type}:${id}] ${e.message}`);
    return res.json({
      streams: [{
        name: "⚠️ Release Info",
        title: `Error: ${e.message}`,
        description: e.message,
        externalUrl: "https://en.wikipedia.org/"
      }]
    });
  }
}

app.get("/stream/:type/:id.json", handleStream);
app.get("/:config/stream/:type/:id.json", handleStream);
app.get("/:style/:apiKey/stream/:type/:id.json", handleStream);

app.listen(PORT, () => console.log(`Release Info addon listening on ${PORT}`));
