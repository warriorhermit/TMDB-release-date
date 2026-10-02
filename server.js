const express = require("express");

const app = express();
const PORT = process.env.PORT || 7000;
const SERVER_TMDB_API_TOKEN = process.env.TMDB_API_TOKEN || "";
const SERVER_TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SERVER_TVDB_API_KEY = process.env.TVDB_API_KEY || "";
const SERVER_GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEFAULT_REGION = (process.env.DEFAULT_REGION || "US").toUpperCase();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 21600000);

const cache = new Map();
const activeRequests = new Map();

// Gemini Circuit Breaker timestamp (disables calls temporarily on 429 rate limit)
let geminiDisabledUntil = 0;

// Known TV show ID translations when TMDB /find endpoint is unindexed or lagging
const KNOWN_IMDB_TO_TMDB = {
  "tt26540674": "219847", // Lanterns (HBO / DC Studios)
  "tt2375692":  "49010",  // Black Sails
  "tt3581920":  "100088", // The Last of Us
  "tt12637874": "106379", // Fallout
  "tt7661390":  "85021",  // Gangs of London
  "tt14261112": "111110"  // Twisted Metal
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

// Curated backup for notable adaptations / continuity / spin-offs / pre-release titles
const KNOWN_SERIES_CONTINUITY = {
  // Twisted Metal (PlayStation Productions)
  "111110": {
    franchise: "Twisted Metal Franchise",
    basedOn: "Video Game: Twisted Metal (PlayStation / Sony Interactive Entertainment)",
    wikiUrl: "https://en.wikipedia.org/wiki/Twisted_Metal_(TV_series)"
  },
  "tt14261112": {
    franchise: "Twisted Metal Franchise",
    basedOn: "Video Game: Twisted Metal (PlayStation / Sony Interactive Entertainment)",
    wikiUrl: "https://en.wikipedia.org/wiki/Twisted_Metal_(TV_series)"
  },

  // Gangs of London (Spin-off of The Getaway video game franchise)
  "85021": {
    franchise: "The Getaway Franchise",
    spinOffOf: "The Getaway (Video Game Series)",
    basedOn: "Video Game: Gangs of London (Sony London Studio)",
    wikiUrl: "https://en.wikipedia.org/wiki/Gangs_of_London_(TV_series)"
  },
  "tt7661390": {
    franchise: "The Getaway Franchise",
    spinOffOf: "The Getaway (Video Game Series)",
    basedOn: "Video Game: Gangs of London (Sony London Studio)",
    wikiUrl: "https://en.wikipedia.org/wiki/Gangs_of_London_(TV_series)"
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
  "94605": {
    franchise: "League of Legends Universe",
    basedOn: "Video Game: League of Legends (Riot Games)",
    wikiUrl: "https://en.wikipedia.org/wiki/Arcane_(TV_series)"
  },
  "tt11126994": {
    franchise: "League of Legends Universe",
    basedOn: "Video Game: League of Legends (Riot Games)",
    wikiUrl: "https://en.wikipedia.org/wiki/Arcane_(TV_series)"
  },
  "71024": {
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
  },

  // Scrubs Revival
  "scrubs": {
    franchise: "Scrubs Universe",
    revivalOf: "Revival of Scrubs (2001–2010)",
    wikiUrl: "https://en.wikipedia.org/wiki/Scrubs_(TV_series)"
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
  let geminiKey = SERVER_GEMINI_API_KEY;

  if (configStr) {
    const decoded = decodeURIComponent(configStr).trim();
    const parts = decoded.split(":");
    const mainTmdb = parts[0] || "";
    if (parts[1]) tvdbKey = parts[1];
    if (parts[2]) geminiKey = parts[2];

    if (mainTmdb.startsWith("eyJ") || mainTmdb.length > 50) {
      tmdbToken = mainTmdb;
      tmdbKey = "";
    } else if (mainTmdb.length > 0) {
      tmdbKey = mainTmdb;
      tmdbToken = "";
    }
  }

  return { tmdbToken, tmdbKey, tvdbKey, geminiKey };
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

// ----------------- Gemini AI Engine (With Fallback) -----------------

async function analyzeMediaWithAI(title, year, overview, mediaType = "series", apiKey) {
  if (!apiKey || !title) return null;

  // Circuit Breaker: Skip if recently rate-limited (HTTP 429)
  if (Date.now() < geminiDisabledUntil) {
    return null;
  }

  const prompt = `
You are a film and television archivist. Analyze the following ${mediaType}:
Title: "${title}"
Release Year: ${year || "Unknown"}
Overview: "${overview || ""}"

Respond ONLY with a JSON object (no markdown, no backticks, no code blocks):
{
  "basedOn": string or null (Format: 'Video Game: Game Title (Developer/Publisher)', 'Novel: Book Title by Author', 'Stage Play: Play Title by Playwright', 'Novella: Title by Author', 'Mythology: Culture Legend of Figure', or null if original fiction),
  "isRealLifeEvent": string or null (Name of real historical event, disaster, war, or true incident ONLY. If fiction, vampires, supernatural, fantasy, or sci-fi, this MUST be null),
  "spinOffOf": string or null (Parent series or game if this is a direct spin-off, e.g. 'The Getaway', 'Breaking Bad', 'The Vampire Diaries', otherwise null),
  "franchise": string or null (Cinematic or universe name if applicable, e.g. 'The Vampire Diaries Universe', 'PlayStation Productions', otherwise null)
}
`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    if (res.status === 429) {
      console.warn(`[Gemini API Rate Limit Reached]: Trip circuit breaker for 5 mins. Falling back to local engines.`);
      geminiDisabledUntil = Date.now() + 300000; // 5 min cool-off
      return null;
    }

    if (!res.ok) {
      console.warn(`[Gemini HTTP ${res.status}]: Falling back to local engines.`);
      return null;
    }

    const data = await res.json();
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) return null;

    return JSON.parse(textResponse.trim());
  } catch (err) {
    console.warn(`[Gemini Exception for ${title}]: ${err.message}. Using fallback engine.`);
    return null;
  }
}

// ----------------- Source Material & Adaptation Classifier -----------------

function formatWikidataAdaptation(binding) {
  if (!binding) return null;

  const work = binding?.workLabel?.value;
  const creator = binding?.creatorLabel?.value;
  const workType = (binding?.workTypeLabel?.value || "").toLowerCase();
  const subject = binding?.subjectLabel?.value;
  const event = binding?.eventLabel?.value;
  const myth = binding?.mythLabel?.value;

  if (work && !work.startsWith("Q")) {
    let prefix = "Based on: ";
    if (/theatre|theater|play|stage|broadway|drama|opera/i.test(workType)) {
      prefix = "Stage Play: ";
    } else if (/novella/i.test(workType)) {
      prefix = "Novella: ";
    } else if (/novel|book|literary/i.test(workType)) {
      prefix = "Novel: ";
    } else if (/myth|legend|folklore|epic poetry|deity|pantheon/i.test(workType)) {
      prefix = "Mythology: ";
    } else if (/video game|game/i.test(workType)) {
      prefix = "Video Game: ";
    } else if (/comic|manga|graphic novel/i.test(workType)) {
      prefix = "Comic: ";
    }
    const creatorStr = (creator && !creator.startsWith("Q")) ? ` by ${creator}` : "";
    return `${prefix}"${work}"${creatorStr}`;
  }

  // Guard against fictional/supernatural tropes being flagged as real events
  const invalidSubjects = /vampire|werewolf|witch|magic|supernatural|zombie|ghost|monster|high school|fiction|superhero/i;
  const realEvent = event || (subject && !invalidSubjects.test(subject) ? subject : null);

  if (realEvent && !realEvent.startsWith("Q")) {
    return `Real-life Event: ${realEvent}`;
  }

  if (myth && !myth.startsWith("Q")) {
    return `Mythology: ${myth}`;
  }

  return null;
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
    SELECT ?workLabel ?creatorLabel ?workTypeLabel ?subjectLabel ?eventLabel ?mythLabel ?article WHERE {
      ${subjectPattern}
      OPTIONAL {
        ?ep wdt:P144 ?work .
        OPTIONAL { ?work rdfs:label ?workLabel filter (lang(?workLabel) = "en") . }
        OPTIONAL { ?work wdt:P31 ?workType . }
        OPTIONAL { { ?work wdt:P50 ?creator . } UNION { ?work wdt:P178 ?creator . } UNION { ?work wdt:P123 ?creator . } }
      }
      OPTIONAL { 
        { ?ep wdt:P921 ?subjItem . } UNION { ?ep wdt:P180 ?subjItem . }
        ?subjItem rdfs:label ?subjectLabel filter (lang(?subjectLabel) = "en") .
      }
      OPTIONAL { 
        ?ep wdt:P793 ?eventItem . 
        ?eventItem rdfs:label ?eventLabel filter (lang(?eventLabel) = "en") .
      }
      OPTIONAL {
        ?ep wdt:P941 ?mythItem .
        ?mythItem rdfs:label ?mythLabel filter (lang(?mythLabel) = "en") .
      }
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
      headers: { "User-Agent": "ReleaseInfoAddon/6.2 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return null;
    const json = await res.json();
    const binding = json?.results?.bindings?.[0];
    const sourceStr = formatWikidataAdaptation(binding);

    if (sourceStr) {
      return {
        adaptedSource: sourceStr,
        episodeWikiUrl: binding?.article?.value || null
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
    return { franchise: null, basedOn: null, follows: null, followedBy: null, spinOffOf: null, specialCut: null, wikiUrl: defaultWikiUrl };
  }

  const query = `
    SELECT ?franchiseLabel ?workLabel ?workTypeLabel ?creatorLabel ?subjectLabel ?eventLabel ?mythLabel ?followsLabel ?followedByLabel ?partOfLabel ?spinOffLabel ?article ?duration ?editionLabel WHERE {
      ?item wdt:P345 "${imdbId}".
      OPTIONAL { ?item wdt:P179 ?franchise. }
      OPTIONAL {
        ?item wdt:P144 ?work .
        OPTIONAL { ?work rdfs:label ?workLabel filter (lang(?workLabel) = "en") . }
        OPTIONAL { ?work wdt:P31 ?workType . }
        OPTIONAL { { ?work wdt:P50 ?creator . } UNION { ?work wdt:P178 ?creator . } UNION { ?work wdt:P123 ?creator . } }
      }
      OPTIONAL { 
        { ?item wdt:P921 ?subjItem . } UNION { ?item wdt:P180 ?subjItem . }
        ?subjItem rdfs:label ?subjectLabel filter (lang(?subjectLabel) = "en") .
      }
      OPTIONAL { 
        ?item wdt:P793 ?eventItem . 
        ?eventItem rdfs:label ?eventLabel filter (lang(?eventLabel) = "en") .
      }
      OPTIONAL {
        ?item wdt:P941 ?mythItem .
        ?mythItem rdfs:label ?mythLabel filter (lang(?mythLabel) = "en") .
      }
      OPTIONAL {
        { ?item wdt:P8345 ?spinItem . } UNION { ?item wdt:P144 ?spinItem . ?spinItem wdt:P31/wdt:P279* wd:Q11424 . }
        ?spinItem rdfs:label ?spinOffLabel filter (lang(?spinOffLabel) = "en") .
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
      headers: { "User-Agent": "ReleaseInfoAddon/6.2 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return { franchise: null, basedOn: null, follows: null, followedBy: null, spinOffOf: null, specialCut: null, wikiUrl: defaultWikiUrl };
    const json = await res.json();
    const bindings = json?.results?.bindings || [];
    if (bindings.length === 0) return { franchise: null, basedOn: null, follows: null, followedBy: null, spinOffOf: null, specialCut: null, wikiUrl: defaultWikiUrl };

    const first = bindings[0];
    const franchise = first?.franchiseLabel?.value;
    const follows = first?.followsLabel?.value;
    const followedBy = first?.followedByLabel?.value;
    const partOf = first?.partOfLabel?.value;
    const spinOff = first?.spinOffLabel?.value;
    const wikiUrl = first?.article?.value || defaultWikiUrl;

    const basedOn = formatWikidataAdaptation(first);

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
      spinOffOf: spinOff && !spinOff.startsWith("Q") ? spinOff : null,
      specialCut,
      wikiUrl
    };
  } catch (err) {
    console.warn(`[Wikidata Movie Error for ${imdbId}]: ${err.message}`);
    return { franchise: null, basedOn: null, follows: null, followedBy: null, spinOffOf: null, specialCut: null, wikiUrl: defaultWikiUrl };
  }
}

async function fetchWikidataDetails(imdbId, fallbackTitle = "") {
  const defaultWikiUrl = fallbackTitle
    ? `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(fallbackTitle)}`
    : "https://en.wikipedia.org/";

  if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
    return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, spinOffOf: null, wikiUrl: defaultWikiUrl };
  }

  const query = `
    SELECT ?franchiseLabel ?workLabel ?workTypeLabel ?creatorLabel ?subjectLabel ?eventLabel ?mythLabel ?followsLabel ?followedByLabel ?partOfLabel ?spinOffLabel ?article
           ?predecessorLabel (YEAR(?origStart) AS ?origStartY) (YEAR(?origEnd) AS ?origEndY) WHERE {
      ?item wdt:P345 "${imdbId}".
      OPTIONAL { ?item wdt:P179 ?franchise. }
      OPTIONAL {
        ?item wdt:P144 ?work .
        OPTIONAL { ?work rdfs:label ?workLabel filter (lang(?workLabel) = "en") . }
        OPTIONAL { ?work wdt:P31 ?workType . }
        OPTIONAL { { ?work wdt:P50 ?creator . } UNION { ?work wdt:P178 ?creator . } UNION { ?work wdt:P123 ?creator . } }
      }
      OPTIONAL { 
        { ?item wdt:P921 ?subjItem . } UNION { ?item wdt:P180 ?subjItem . }
        ?subjItem rdfs:label ?subjectLabel filter (lang(?subjectLabel) = "en") .
      }
      OPTIONAL { 
        ?item wdt:P793 ?eventItem . 
        ?eventItem rdfs:label ?eventLabel filter (lang(?eventLabel) = "en") .
      }
      OPTIONAL {
        ?item wdt:P941 ?mythItem .
        ?mythItem rdfs:label ?mythLabel filter (lang(?mythLabel) = "en") .
      }
      OPTIONAL {
        { ?item wdt:P8345 ?spinItem . } UNION { ?item wdt:P144 ?spinItem . ?spinItem wdt:P31/wdt:P279* wd:Q5398426 . }
        ?spinItem rdfs:label ?spinOffLabel filter (lang(?spinOffLabel) = "en") .
      }
      OPTIONAL { ?item wdt:P155 ?follows. }
      OPTIONAL { ?item wdt:P156 ?followedBy. }
      OPTIONAL { ?item wdt:P361 ?partOf. }
      OPTIONAL {
        { ?item wdt:P155 ?predecessor. } UNION { ?item wdt:P144 ?predecessor. }
        OPTIONAL { ?predecessor wdt:P580 ?origStart. }
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
      headers: { "User-Agent": "ReleaseInfoAddon/6.2 (https://github.com/warriorhermit/TMDB-release-date-v2.0)" }
    });

    if (!res.ok) return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, spinOffOf: null, wikiUrl: defaultWikiUrl };
    const json = await res.json();
    const binding = json?.results?.bindings?.[0];

    const franchise = binding?.franchiseLabel?.value;
    const follows = binding?.followsLabel?.value;
    const followedBy = binding?.followedByLabel?.value;
    const partOf = binding?.partOfLabel?.value;
    const spinOff = binding?.spinOffLabel?.value;
    const wikiUrl = binding?.article?.value || defaultWikiUrl;

    const basedOn = formatWikidataAdaptation(binding);

    let revivalOf = null;
    const predTitle = binding?.predecessorLabel?.value;
    const startY = binding?.origStartY?.value;
    const endY = binding?.origEndY?.value;

    if (predTitle && !predTitle.startsWith("Q")) {
      const yearRange = startY && endY ? ` (${startY}–${endY})` : (startY ? ` (${startY})` : "");
      revivalOf = `Revival of ${predTitle}${yearRange}`;
    }

    return {
      franchise: franchise && !franchise.startsWith("Q") ? franchise : (partOf && !partOf.startsWith("Q") ? partOf : null),
      basedOn,
      follows: follows && !follows.startsWith("Q") ? follows : null,
      followedBy: followedBy && !followedBy.startsWith("Q") ? followedBy : null,
      spinOffOf: spinOff && !spinOff.startsWith("Q") ? spinOff : null,
      revivalOf,
      wikiUrl
    };
  } catch (err) {
    console.warn(`[Wikidata Details Error for ${imdbId}]: ${err.message}`);
    return { franchise: null, basedOn: null, follows: null, followedBy: null, revivalOf: null, spinOffOf: null, wikiUrl: defaultWikiUrl };
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

function extractSourceMaterial(crew = [], keywords = []) {
  const sources = [];

  // 1. Evaluate TMDB Keywords
  const kwList = Array.isArray(keywords) ? keywords.map(k => (k.name || "").toLowerCase()) : [];
  if (kwList.some(k => k.includes("based on true story") || k.includes("based on a true story") || k.includes("real life event") || k.includes("true events"))) {
    sources.push("Based on real-life events");
  } else if (kwList.some(k => k.includes("play adaptation") || k.includes("stage play") || k.includes("theatre play"))) {
    sources.push("Adapted from a Stage Play");
  } else if (kwList.some(k => k.includes("mythology") || k.includes("greek myth") || k.includes("folklore") || k.includes("legend"))) {
    sources.push("Based on Mythology/Folklore");
  }

  // 2. Evaluate Crew Credits
  const adaptationPatterns = [
    { pattern: /theatre play|theater play|stage play|^play$/i, label: "Stage Play" },
    { pattern: /novella/i, label: "Novella" },
    { pattern: /novel/i, label: "Novel" },
    { pattern: /book/i, label: "Book" },
    { pattern: /comic|graphic novel/i, label: "Comic" },
    { pattern: /video game|game/i, label: "Video Game" },
    { pattern: /myth|legend|folklore/i, label: "Mythology" },
    { pattern: /biography|memoir|true story/i, label: "Real-life Events" },
    { pattern: /characters|author|story by/i, label: "Story" }
  ];

  for (const person of crew) {
    const rawJobs = [];
    if (person.job) rawJobs.push(person.job);
    if (Array.isArray(person.jobs)) {
      person.jobs.forEach(j => { if (j.job) rawJobs.push(j.job); });
    }

    for (const jobTitle of rawJobs) {
      for (const entry of adaptationPatterns) {
        if (entry.pattern.test(jobTitle)) {
          sources.push(`${entry.label} by ${person.name}`);
          break;
        }
      }
    }
  }

  return [...new Set(sources)].slice(0, 2);
}

function extractStoryArcFromText(text = "") {
  if (!text) return { arc: null, spinOff: null };

  let spinOff = null;
  const spinMatch = text.match(/(?:spin[- ]?off|spinoff)\s+(?:of|from)\s+(?:the\s+(?:hit\s+|acclaimed\s+)?(?:series|show|film|movie|franchise)\s+)?["'“]?([^"'”.,;]+)["'”]?/i);
  if (spinMatch && spinMatch[1]) {
    spinOff = spinMatch[1].trim();
  }

  // 1. Real events, true accounts, history
  const realMatch = text.match(/(?:based on|inspired by|chronicles|depicts?|dramatiz(?:ing|ation of))\s+(?:the\s+)?(?:true\s+(?:story|events?|account)|real[- ]life\s+(?:story|events?|incident|disaster|mission|case)|actual events?)(?:\s+(?:of|surrounding|involving)\s+["'“]?([^"'”.,;]+)["'”]?)?/i);
  if (realMatch) {
    return { arc: realMatch[1] ? `Real Event: ${realMatch[1].trim()}` : "Based on real-life events", spinOff };
  }

  // 2. Stage plays & Broadway
  const playMatch = text.match(/(?:based on|adapted from)\s+(?:the\s+)?(?:acclaimed\s+|broadway\s+|award[- ]winning\s+)?(?:stage\s+play|theatre\s+play|theater\s+play|play|musical)\s+["'“]([^"'”]+)["'”]/i);
  if (playMatch && playMatch[1]) {
    return { arc: `Stage Play: "${playMatch[1].trim()}"`, spinOff };
  }

  // 3. Novella
  const novellaMatch = text.match(/(?:based on|adapted from)\s+(?:the\s+)?novella\s+["'“]([^"'”]+)["'”]/i);
  if (novellaMatch && novellaMatch[1]) {
    return { arc: `Novella: "${novellaMatch[1].trim()}"`, spinOff };
  }

  // 4. Mythology & Folklore
  const mythMatch = text.match(/(?:based on|adapted from|retelling of|inspired by)\s+(?:the\s+)?([A-Za-z\s]+?)\s+(?:mythology|myth|legend|folklore|epic|folktale)(?:\s+["'“]([^"'”]+)["'”])?/i);
  if (mythMatch) {
    const mythType = mythMatch[1].trim();
    const title = mythMatch[2] ? ` ("${mythMatch[2].trim()}")` : "";
    return { arc: `Mythology: ${mythType} Legend${title}`, spinOff };
  }

  // 5. Video Games (including PlayStation/Nintendo/Xbox titles)
  const vgMatch = text.match(/(?:based on|adapted from|adaptation of|inspired by)?(?:\s+[\w\s&]+)?(?:classic\s+|hit\s+|acclaimed\s+|popular\s+)?(?:video\s+game|playstation(?:\s+game)?|nintendo|xbox|sega)\s+(?:series\s+|franchise\s+)?["'“]?([A-Za-z0-9\s:–-]+?)["'”]?(?:\s+by|\s+from|\.|\,|$)/i);
  if (vgMatch && vgMatch[1] && !/series|show|movie|film/i.test(vgMatch[1].trim())) {
    return { arc: `Video Game: ${vgMatch[1].trim()}`, spinOff };
  }

  // 6. Books / Novels / Comics
  const arcMatch = text.match(/(?:based on|adapted from|adapting)\s+(?:the\s+(?:book|novel|comic|graphic novel)\s+)?["'“]([^"'”]+)["'”]/i);
  return { arc: arcMatch && arcMatch[1] ? arcMatch[1].trim() : null, spinOff };
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
    const movie = await tmdbGet(`/movie/${tmdbId}?append_to_response=credits,release_dates,keywords`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^\d+$/.test(rawId)) {
    const movie = await tmdbGet(`/movie/${rawId}?append_to_response=credits,release_dates,keywords`, creds);
    return { movie, imdbId: movie.imdb_id || null };
  }
  if (/^tt\d+$/i.test(rawId)) {
    const found = await findByImdb(rawId, creds);
    if (found.id) {
      const movie = await tmdbGet(`/movie/${found.id}?append_to_response=credits,release_dates,keywords`, creds);
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
      const details = await tmdbGet(`/tv/${id}?append_to_response=external_ids,aggregate_credits,keywords`, creds);
      return { tvId: id, imdbId: details.external_ids?.imdb_id || null, showData: details };
    } catch {
      return { tvId: id, imdbId: null, showData: { name: "TV Series", id } };
    }
  }

  if (/^\d+$/.test(rawId)) {
    try {
      const details = await tmdbGet(`/tv/${rawId}?append_to_response=external_ids,aggregate_credits,keywords`, creds);
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
        details = await tmdbGet(`/tv/${resolvedTvId}?append_to_response=external_ids,aggregate_credits,keywords`, creds);
      } catch {
        details = { name: "Series", id: resolvedTvId };
      }
      return { tvId: resolvedTvId, imdbId: rawId, showData: details };
    }

    const found = await findByImdb(rawId, creds);
    if (found.id) {
      let details = null;
      try {
        details = await tmdbGet(`/tv/${found.id}?append_to_response=external_ids,aggregate_credits,keywords`, creds);
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

    const movieKeywords = movie.keywords?.keywords || [];
    const sourceMaterial = extractSourceMaterial(movie.credits?.crew || [], movieKeywords);
    let franchise = movie.belongs_to_collection ? movie.belongs_to_collection.name : null;

    let spinOffOf = null;
    const parsedText = extractStoryArcFromText(`${movie.overview || ""} ${movie.tagline || ""}`);
    if (parsedText.spinOff) spinOffOf = parsedText.spinOff;
    if (parsedText.arc && !sourceMaterial.some(s => s.toLowerCase().includes(parsedText.arc.toLowerCase()))) {
      sourceMaterial.unshift(parsedText.arc);
    }

    const movieTitle = movie.title || movie.original_title || "";
    const movieYear = (movie.release_date || "").split("-")[0];

    // 1. Try Gemini AI (if key is present and not circuit-broken)
    if (creds.geminiKey) {
      const aiData = await analyzeMediaWithAI(movieTitle, movieYear, movie.overview, "movie", creds.geminiKey);
      if (aiData) {
        if (!spinOffOf && aiData.spinOffOf) spinOffOf = aiData.spinOffOf;
        if (!franchise && aiData.franchise) franchise = aiData.franchise;
        if (aiData.basedOn && !sourceMaterial.some(s => s.toLowerCase().includes(aiData.basedOn.toLowerCase()))) {
          sourceMaterial.unshift(aiData.basedOn);
        }
        if (aiData.isRealLifeEvent && !sourceMaterial.some(s => s.toLowerCase().includes(aiData.isRealLifeEvent.toLowerCase()))) {
          sourceMaterial.unshift(`Real-life Event: ${aiData.isRealLifeEvent}`);
        }
      }
    }

    // 2. Query Wikidata (Serves as primary or fallback)
    const wiki = await fetchWikidataMovieDetails(imdbId, movieTitle, movie.runtime);
    if (wiki) {
      if (!franchise && wiki.franchise) franchise = wiki.franchise;
      if (!spinOffOf && wiki.spinOffOf) spinOffOf = wiki.spinOffOf;
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
      sourceMaterial: [...new Set(sourceMaterial)].slice(0, 2),
      franchise,
      spinOffOf,
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
        spinOffOf: null,
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

    // ----------------- Individual Episode Source Material Extraction -----------------
    const sources = [];
    const epImdbId = epData?.external_ids?.imdb_id || null;
    let episodeWikiUrl = null;
    let spinOffOf = null;

    // 1. Check curated catalog first (continuity, spin-offs, games)
    const knownMatch = (tvId ? KNOWN_SERIES_CONTINUITY[String(tvId)] : null) || (imdbId ? KNOWN_SERIES_CONTINUITY[imdbId] : null);
    if (knownMatch?.basedOn) {
      sources.push(knownMatch.basedOn);
    }
    if (knownMatch?.spinOffOf) {
      spinOffOf = knownMatch.spinOffOf;
    }

    // 2. Scrape Wikidata directly for episode adaptations (plays, novels, events, myths)
    const epWikiData = await fetchWikidataEpisodeAdaptation(imdbId, season, episode, epImdbId);
    if (epWikiData?.adaptedSource && !sources.includes(epWikiData.adaptedSource)) {
      sources.unshift(epWikiData.adaptedSource);
      if (epWikiData.episodeWikiUrl) episodeWikiUrl = epWikiData.episodeWikiUrl;
    }

    // 3. Check Episode credits & synopsis
    if (epData) {
      const parsedEp = extractStoryArcFromText(epData.overview);
      if (parsedEp.spinOff && !spinOffOf) spinOffOf = parsedEp.spinOff;
      if (parsedEp.arc && !sources.some(s => s.toLowerCase().includes(parsedEp.arc.toLowerCase()))) {
        sources.push(parsedEp.arc);
      }
      const epSources = extractSourceMaterial(epData.credits?.crew || [], []);
      for (const s of epSources) {
        if (!sources.includes(s)) sources.push(s);
      }
    }

    // 4. Check Season synopsis & credits
    if (seasonData) {
      const parsedSeason = extractStoryArcFromText(seasonData.overview);
      if (parsedSeason.spinOff && !spinOffOf) spinOffOf = parsedSeason.spinOff;
      if (parsedSeason.arc && !sources.some(s => s.toLowerCase().includes(parsedSeason.arc.toLowerCase()))) {
        sources.push(parsedSeason.arc);
      }
      const seasonSources = extractSourceMaterial(seasonData.credits?.crew || [], []);
      for (const s of seasonSources) {
        if (!sources.includes(s)) sources.push(s);
      }
    }

    // 5. Check Series overview & series keywords
    const showKeywords = showData?.keywords?.results || [];
    const seriesSources = extractSourceMaterial(showData?.aggregate_credits?.crew || [], showKeywords);
    for (const s of seriesSources) {
      if (!sources.some(existing => existing.toLowerCase().includes(s.toLowerCase()))) {
        sources.push(s);
      }
    }

    if (showData?.overview) {
      const parsedShow = extractStoryArcFromText(showData.overview);
      if (parsedShow.spinOff && !spinOffOf) spinOffOf = parsedShow.spinOff;
      if (parsedShow.arc && !sources.some(s => s.toLowerCase().includes(parsedShow.arc.toLowerCase()))) {
        sources.push(parsedShow.arc);
      }
    }

    let franchise = knownMatch?.franchise || null;
    let revivalOf = knownMatch?.revivalOf || null;
    const showTitle = showData?.name || showData?.original_name || "";
    const showYear = (epData?.air_date || showData?.first_air_date || "").split("-")[0];

    // 6. Gemini AI analysis (Runs if key is present and circuit breaker hasn't tripped)
    if (creds.geminiKey) {
      const aiData = await analyzeMediaWithAI(showTitle, showYear, showData?.overview, "series", creds.geminiKey);
      if (aiData) {
        if (!spinOffOf && aiData.spinOffOf) spinOffOf = aiData.spinOffOf;
        if (!franchise && aiData.franchise) franchise = aiData.franchise;
        if (aiData.basedOn && !sources.some(s => s.toLowerCase().includes(aiData.basedOn.toLowerCase()))) {
          sources.unshift(aiData.basedOn);
        }
        if (aiData.isRealLifeEvent && !sources.some(s => s.toLowerCase().includes(aiData.isRealLifeEvent.toLowerCase()))) {
          sources.unshift(`Real-life Event: ${aiData.isRealLifeEvent}`);
        }
      }
    }

    // 7. Wikidata Details (Runs as primary metadata source and seamless fallback)
    const wiki = await fetchWikidataDetails(imdbId, showTitle);
    if (wiki) {
      if (!franchise && wiki.franchise) {
        franchise = wiki.franchise.toLowerCase().includes("franchise") || wiki.franchise.toLowerCase().includes("universe")
          ? wiki.franchise
          : `${wiki.franchise} Universe`;
      }
      if (!revivalOf && wiki.revivalOf) {
        revivalOf = wiki.revivalOf;
      }
      if (!spinOffOf && wiki.spinOffOf) {
        spinOffOf = wiki.spinOffOf;
      }
      if (wiki.basedOn && !sources.some(s => s.toLowerCase().includes(wiki.basedOn.toLowerCase()))) {
        sources.unshift(wiki.basedOn);
      } else if (wiki.follows && !franchise && !revivalOf) {
        franchise = `Continuation of ${wiki.follows}`;
      } else if (wiki.followedBy && !franchise) {
        franchise = `Prequel to ${wiki.followedBy}`;
      }
    }

    // Heuristic fallbacks for titles containing specific keywords
    if (/lanterns/i.test(showTitle)) {
      if (!franchise) franchise = "DC Universe";
      if (!sources.some(s => /green lantern/i.test(s))) {
        sources.unshift("Green Lantern by John Broome & Gil Kane (DC Comics)");
      }
    }

    if (!revivalOf && /^scrubs/i.test(showTitle) && showTitle.toLowerCase() !== "scrubs (2001)") {
      if (showYear && parseInt(showYear, 10) >= 2024) {
        revivalOf = "Revival of Scrubs (2001–2010)";
        if (!franchise) franchise = "Scrubs Universe";
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
      spinOffOf,
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

  if (info.spinOffOf) {
    lines.push(`🔀 Spin-off of: ${info.spinOffOf}`);
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

  if (info.spinOffOf) {
    lines.push(`🔀 Spin-off of: ${info.spinOffOf}`);
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

// HTML Configuration UI with TMDB, TVDB & Gemini input
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

        <p>Displays release dates, runtimes, episodic & seasonal adaptations (books, plays, real-life events, games), spin-offs, and franchise continuity powered by AI and Wikidata fallbacks.</p>
        
        <label for="tmdb">TheMovieDB API Read Token or API Key (Required)</label>
        <input type="text" id="tmdb" placeholder="eyJhbGciOiJIUzI1NiJ9... or API Key" autocomplete="off" />

        <label for="tvdb">TheTVDB v4 Project API Key (Optional for extra TV cuts)</label>
        <input type="text" id="tvdb" placeholder="e.g. 12345678-abcd-ef01-2345-6789abcdef01" autocomplete="off" />

        <label for="gemini">Google Gemini API Key (Optional for accurate adaptation & spin-off detection)</label>
        <input type="text" id="gemini" placeholder="AIzaSy..." autocomplete="off" />

        <button class="btn-primary" onclick="generateManifest()">Generate Manifest URL</button>
        <div class="result" id="resultBlock">
          <label>Your Custom Manifest URL:</label>
          <div class="manifest-link" id="manifestUrl"></div>
          <button class="btn-copy" id="copyBtn" onclick="copyManifest()">📋 Copy Manifest URL</button>
        </div>

        <div class="attribution-box">
          Metadata provided by <strong>The Movie Database (TMDB)</strong>, <strong>TheTVDB</strong>, <strong>Wikidata</strong>, and <strong>Google Gemini</strong>.
        </div>
      </div>
      <script>
        function generateManifest() {
          const tmdb = document.getElementById("tmdb").value.trim();
          const tvdb = document.getElementById("tvdb").value.trim();
          const gemini = document.getElementById("gemini").value.trim();
          if (!tmdb) return alert("Please enter a valid TMDB Token or Key");

          let configVal = tmdb;
          if (tvdb || gemini) configVal += ":" + tvdb;
          if (gemini) configVal += ":" + gemini;

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
  version: "6.2.0",
  geminiCircuitBreakerActive: Date.now() < geminiDisabledUntil,
  defaultRegion: DEFAULT_REGION
}));

function getManifestJson() {
  return {
    id: "com.nuvio.release-info.stream",
    version: "6.2.0",
    name: "Release Info",
    description: "Shows release dates, runtimes (theatrical & extended cuts), episodic adaptations (books/novellas/plays/mythology/real events), spin-offs, and franchise continuity for Movies & TV series in Nuvio/Stremio.",
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
