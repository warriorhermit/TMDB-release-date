# Nuvio TMDB Release Dates Addon v1.1

This addon is specifically intended to enrich Nuvio movie metadata with TMDB theatrical and digital release dates.

## Output

The movie metadata contains:

`Theatrical: 15 May 2026  •  Digital: 29 May 2026`

TMDB release type 3 = Theatrical.
TMDB release type 4 = Digital.

## Important Nuvio setting

After installing the addon in Nuvio, enable:

**Settings → Layout → Detail Page → Prefer meta from external addon**

Nuvio documentation describes this setting as making Nuvio prefer metadata returned by an external metadata addon.

For this addon, the manifest declares only the `meta` resource for movies, so it is intended to act as a metadata enrichment addon and not a stream/catalog provider.

## Install

1. Deploy this project to a Node.js HTTPS host.
2. Set `TMDB_API_TOKEN` (or `TMDB_API_KEY`).
3. Set `DEFAULT_REGION=IN` for India.
4. Start with `npm install && npm start`.
5. Install the public `/manifest.json` URL in Nuvio.

Example:

`https://YOUR-DOMAIN.example/manifest.json`

## Test

Manifest:

`https://YOUR-DOMAIN.example/manifest.json`

Metadata:

`https://YOUR-DOMAIN.example/meta/movie/tt1234567.json`

Replace the IMDb ID with a real movie.

## Region selection

The addon checks the configured country first. If it has no theatrical/digital release entry, it checks US, GB, and then other TMDB countries returned for the movie.

## TMDB credentials

Use your own TMDB API credentials and comply with TMDB's terms and attribution requirements.
