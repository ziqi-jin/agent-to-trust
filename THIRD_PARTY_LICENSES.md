# Third-party licenses

Agent Credit Lab itself is **MIT** (see [LICENSE](./LICENSE)).

Production dependency license distribution (transitive, `npm ci --omit=dev`):

| License | Count |
|---|---|
| MIT | 182 |
| Apache-2.0 | 10 |
| ISC | 10 |
| BSD-3-Clause | 4 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |
| LGPL-3.0-or-later | 1 |

## Notes

- **No GPL / AGPL / SSPL / CC-BY-NC** production dependencies — no copyleft or non-commercial
  license propagates into this project's source.
- `CC-BY-4.0` — `caniuse-lite` (browserslist data), attribution-only, no code impact.
- `LGPL-3.0-or-later` — `@img/sharp-libvips-linux-x64`, a *prebuilt native binary* pulled in
  transitively by `next → sharp`. `sharp` itself is Apache-2.0. The LGPL binary is dynamically
  linked and consumed as an unmodified dependency; this is the standard, widely accepted use
  and does not affect the MIT licensing of this project's own source.

To re-run the scan:

```bash
node -e '...'   # or: npx license-checker --production --start .
```
