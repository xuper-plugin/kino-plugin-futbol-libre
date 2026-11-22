# Changelog

## 0.1.7

- Follow the sites' domain moves (Nov 2026): the primary is now `futbollibrego.org` (the old `futbollibregol.org` 301s to it) and backup 1 is now `futbol-libretv.top` (the old `futbollibreliga.online`/`verfutbol.pro` 301 to its home page, dropping the `/api/agenda` path, so backup 1's schedule had gone blank). The agenda primary (`api.wqxag.com/diaries.json`) and the players are unchanged. New hosts declared; the old names stay declared for their redirects.

## 0.1.5

- Home leaves as soon as the first site answers with matches: the backup sites that were still being asked (up to 14 s) kept Kino waiting for them. They are dropped with the call. The plugin asks Kino to drop the requests a call leaves running (`globalThis.__kinoDropPendingFetches = true`, read by Kino 0.9.54 and later; an older Kino ignores it), with a test (`test/dropFetches.test.mjs`).
