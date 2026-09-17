# Third-party licenses

Agent to Trust (A2T) itself is **MIT** (see [LICENSE](./LICENSE)).

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

To re-run the scan across all installed production dependencies:

```bash
node -e '
const fs=require("fs"),path=require("path");const counts={};const risky=[];
(function walk(d,dep){if(dep>5)return;let es=[];try{es=fs.readdirSync(d)}catch(e){return}
 for(const e of es){if(e.startsWith("."))continue;const p=path.join(d,e);
  if(e.startsWith("@")){walk(p,dep+1);continue}
  const pj=path.join(p,"package.json");
  if(fs.existsSync(pj)){try{const j=JSON.parse(fs.readFileSync(pj,"utf8"));
   let l=j.license||j.licenses||"UNKNOWN";if(typeof l!=="string")l=JSON.stringify(l);
   counts[l]=(counts[l]||0)+1;
   if(/GPL|AGPL|SSPL|CC-BY-NC|UNKNOWN|UNLICENSED/i.test(l))risky.push(j.name+"@"+j.version+" -> "+l);
  }catch(e){}}}})("node_modules",0);
console.log(counts);console.log("review:",risky);
'
```

Or, for a summarized view of declared direct dependencies:

```bash
npx license-checker --production --summary
```
