# AudioLift
Free, private video-to-audio extractor. All conversion runs in the browser via FFmpeg WebAssembly (single-threaded `@ffmpeg/core`, no server, no database).

## Develop / build / deploy
`npm install` → `npm run dev` → `npm run build`. `predev`/`prebuild` copy the FFmpeg core into `public/ffmpeg/` (self-hosted, immutable-cached via `vercel.json`). Deploy to Vercel as a Vite project; no COOP/COEP headers are needed, so ad scripts keep working.

## Privacy architecture
Video is mounted lazily with WORKERFS (never copied to memory), audio is held as a Blob, object URLs are revoked on reset/unmount, FFmpeg virtual files are deleted after every job, Cancel terminates the worker.

## Ads
Set `VITE_AD_PROVIDER=adsense`, `VITE_AD_PUBLISHER_ID` and slot IDs (see `.env.example`). Without them nothing loads. Replace `audiolift.example` in `index.html`, `robots.txt`, `sitemap.xml`.

## Limits
Very large files can exhaust memory on phones. Video without preview support can still be converted. Not yet implemented: analytics/consent, dark mode, stream-copy shortcut, automated tests.
