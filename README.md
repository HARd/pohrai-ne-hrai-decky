# POHRAI/NE HRAI for Decky Loader

Decky Loader plugin prototype that marks Ukrainian and hostile developers directly in the Steam Deck interface.

The initial database was extracted from the authorized Chrome extension package version `1.6.5.7`.

## Development

```sh
pnpm install
pnpm run build
```

`npm install` / `npm run build` also works locally. The template documentation prefers `pnpm` for Decky plugin store submissions.

## Manual Test On Steam Deck

1. Build the frontend.
2. Copy this directory to the Decky plugins folder as `pohrai-ne-hrai`.
3. Restart Decky Loader or Steam.
4. Open Gaming Mode and check Library, Store, search, and wishlist cards.

The Decky panel is for settings and database search. The main feature is the injected overlay/badge directly on Steam UI cards.

## Install From URL

Create a GitHub repository, push this project, then publish a tag:

```sh
git tag v0.1.0
git push origin main --tags
```

The release workflow uploads `pohrai-ne-hrai.zip`. After the GitHub Release is created, install it in Decky:

```text
https://github.com/OWNER/REPO/releases/latest/download/pohrai-ne-hrai.zip
```

In Decky Loader, enable developer features, open Developer settings, choose Install Plugin from URL, and paste that URL.

The plugin uses:

- `src/index.tsx` for the Decky panel and plugin lifecycle.
- `src/injector.ts` for DOM scanning and visual marks in Steam UI.
- `main.py` for Steam appdetails lookup, settings, and cache.
- `data/developers.json` for the developer/publisher lists.
