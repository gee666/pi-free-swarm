# Project file previews

Click a recognized file reference in the swarm UI to open its preview overlay. Text, Markdown and code use bounded pages. Raster images use an image preview. SVG and HTML remain text/code, not executable documents.

Only files resolving inside the current project are available. Project-relative paths and absolute paths inside the project work. Traversal and symlinks escaping the real project root are rejected. This adds no file-reading tool to workers or Watcher.

Text pages contain at most 64KiB of UTF-8 source. Continuation uses returned byte offsets and a file version. A known source change returns HTTP409 and requires restarting from the first page. The UI shows partial/completeness information rather than silently cutting a file. Large User messages remain accepted without a body cap; paging affects only preview reads.

PNG, JPEG, GIF, WebP, AVIF, BMP and ICO files are supported up to 16MiB encoded size. Images are served as raw bytes with no-store, nosniff, same-origin resource policy and a sandbox policy. Larger images and non-UTF-8 binary files should be opened externally.

The browser API is:

- GET `/api/swarms/:swarmId/files/preview?path=...&offset=0&version=...` for metadata and text pages.
- GET `/api/swarms/:swarmId/files/content?path=...&version=...` for the image URL returned by metadata.

File contents are fetched only on explicit preview actions. They are not copied into swarm settings, agent sessions or a persistent file cache.

## Recognized references

Qualified paths in prose, such as `src/main.ts:12`, become preview links. Quote paths with spaces or format them as inline code, for example `"docs/my notes.md"` or `README.md`. Ordinary bare words are not treated as paths.

Explicit Markdown file links also support extensionless files: `[config](.env)`, `[script](scripts/run)` and `[notes](docs/my%20notes.md)`. Local link targets inside a previewed Markdown file resolve relative to that file. Paths in ordinary message text are project-relative. Every target still passes the server's project-root checks.

Markdown supports headings, paragraphs, lists, emphasis, links and fenced code, not full GFM or raw HTML. File-image references open the image preview rather than loading arbitrary remote content. Highlighting covers JavaScript, TypeScript, JSON, Python, shell, CSS, HTML/XML, YAML and SQL; other code remains readable plain text. It never guesses a language by scanning every grammar.
