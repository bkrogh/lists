# Lists

Google Keep–style checklists that run entirely in the browser. Data is stored in `localStorage` only — nothing leaves the device.

## Features

- **Multiple lists**: open the ☰ menu to switch lists, add a new list, delete one (with undo) or drag lists into a different order.
- Checklist with a **ticked items** section below; ticking an item moves it down (ticking a parent ticks its sub-items). Ticked items keep their place in the tree, so unticking puts a sub-item back under its parent.
- Ticked items **delete themselves 5 hours** after being ticked (countdown shown per item). Use the clock button to change the time per list, or to have ticked items **untick themselves** instead (handy for lists you repeat).
- **Import Markdown** lists (e.g. from ChatGPT) via the *Import* button (into the current list or as a new list), or just paste a multi-line list into any item / the "List item" row. `## Headings` and `**Bold:**` lines become parent items, `[x]` items arrive ticked, a `# Title` fills in the list title.
- **Drag and drop** by the ⠿ handle (works on touch). Drag into the ticked section to tick, or back out to untick.
- **Indent** an item with the indent button at the end of its row (on touch screens it shows on the item you are editing), or with Tab.
- *Copy* exports the list as Markdown (a handy backup).
- Undo for deletes and imports. Syncs between open tabs.

### Keyboard

| Key | Action |
| --- | --- |
| Enter | New item below (splits at the cursor) |
| Backspace at start | Outdent, then merge with the item above |
| Tab / Shift+Tab | Indent / outdent |
| Alt+↑ / Alt+↓ | Move item |
| Ctrl/Cmd+Enter | Tick item |
| ↑ / ↓ at start/end | Jump between items |

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```

## Host for free

The build is a static folder (`dist/`) with relative paths, so any static host works.

- **GitHub Pages**: push to a GitHub repo on `main`, then in *Settings → Pages* set *Source* to **GitHub Actions**. `.github/workflows/deploy.yml` tests, builds and deploys on every push.
- **Netlify / Cloudflare Pages / Vercel**: build command `npm run build`, output directory `dist`.

Note that `localStorage` is per browser and per site address — lists don't sync between devices, and clearing site data erases them. Use *Copy* to keep a backup.
