# Changelog

## 0.1.5

- Home leaves as soon as the first site answers with matches: the backup sites that were still being asked (up to 14 s) kept Kino waiting for them. They are dropped with the call. The plugin asks Kino to drop the requests a call leaves running (`globalThis.__kinoDropPendingFetches = true`, read by Kino 0.9.54 and later; an older Kino ignores it), with a test (`test/dropFetches.test.mjs`).
