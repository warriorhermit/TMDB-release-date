# Release Dates v3.4.0

A stream addon for Nuvio and Stremio that displays theatrical and digital movie release dates directly in the streams list[span_3](start_span)[span_3](end_span).

## Features
- **Single Card View:** Combines theatrical and digital release dates into one clean tab.
- **US Priority:** Defaults to US release dates with automatic fallbacks (GB, IN, and earliest international dates)[span_4](start_span)[span_4](end_span).
- **CORS Enabled:** Fully accessible for both native applications and web-based media players.
- **Custom Token Web UI:** Configure and generate unique manifest URLs with your own TMDB API token/key right from the landing page.
- **Multi-ID Support:** Resolves IMDb IDs (`tt...`) as well as native Nuvio TMDB IDs (`tmdb:...` and numeric IDs).

## Deployment

### Deploy on Render
1. Create a **New Web Service** connected to your GitHub repository.
2. Build Command: `npm install`[span_5](start_span)[span_5](end_span)
3. Start Command: `npm start`[span_6](start_span)[span_6](end_span)
4. *(Optional)* Add Environment Variables under the **Environment** tab:
   - `DEFAULT_REGION` = `US`[span_7](start_span)[span_7](end_span)
   - `TMDB_API_TOKEN` = `your_tmdb_read_access_token`[span_8](start_span)[span_8](end_span)
   - `CACHE_TTL_MS` = `21600000`[span_9](start_span)[span_9](end_span)

### Run with Docker
```bash
docker build -t release-dates-addon .
docker run -p 7000:7000 -e TMDB_API_TOKEN="your_token_here" release-dates-addon
