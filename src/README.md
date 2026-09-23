# OpenAI for Adobe InDesign

Experimental UXP dialog to connect OpenAI with Adobe InDesign. (UXP Plugin)

## Compatibility
Since InDesign v18.5 and UXP v7.1.

## Documentation

### API Key 

- Insert:	`Click` on key icon (upper right corner)
- Remove: `Alt + Click` on key icon

## Usage
### Development
```
$ npm run dev
```

### Packaging
```
$ npm run package
```

## Contact

Roland Dreger, www.rolanddreger.net

## License

This project is released under a proprietary licence. Please contact roland.dreger@a1.net
for licencing inquiries and term of use.

## Date
Creation date: September 9, 2023  
Last modification: Mai 17, 2024
## Fork: Arena bridge

The panel in `src/` is extended so it can talk to an [Arena bridge](../docs/BRIDGE.md)
instead of `api.openai.com`:

- `lib/config.js` — bridge URL (baked in at build time, overridable from the panel's link button)
- `panel/bridge.js` — long-polling agent link: executes whitelisted commands (`doc.info`,
  `selection.get`, `selection.set`, `frames.list`, `frame.set`, `text.append`, `doc.export`, …)
  against the InDesign DOM and posts the results back
- `panel/create.js` — sends requests to the configured endpoint and, when the bridge answers
  `202 Accepted`, polls the job until the agent replies (no OpenAI key required)

Build: `npm run build` (optionally with `BRIDGE_URL=…`), see `../scripts/build.mjs`.
