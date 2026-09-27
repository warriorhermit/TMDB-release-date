# Release Dates v3.5.1

A stream addon for Nuvio and Stremio that displays theatrical and digital movie release dates alongside running times (including Director's Cuts, Extended Editions, and alternate cuts when available) in a single clean stream tab.

## Features
- **Single Card View:** Combines theatrical and digital release information into one unified stream card.
- **Theatrical Runtime & Date:** Displays theatrical release date and running time (e.g. `🎬 Theatrical [2h 28m]: 18 Jul 2023 (US)`).
- **Alternate Edition Detection:** Automatically scans TMDB release notes for Director's Cuts, Extended Editions, and Unrated cuts.
- **Alternate Runtime Only:** Detects and appends the running time for special editions without cluttering the card with extra release dates (e.g. `✂️ Extended Edition: 3h 28m`).
- **US Market Priority:** Prioritizes US release data first, automatically falling back to GB, IN, or the earliest international dates if US data is missing.
- **Full Nuvio & Stremio Compatibility:** Includes global CORS headers and dual-prefix routing (`tt...` IMDb IDs and `tmdb:...` IDs).
- **Web Token Configuration:** Generate custom manifest URLs using your own TMDB API Token or Key directly from the root landing page (`/`).

## Display Preview

### Standard Movie (No alternate editions found)
```text
🎬 Theatrical [2h 15m]: 18 Jul 2023 (US)
💻 Digital: 15 Sep 2023 (US)
