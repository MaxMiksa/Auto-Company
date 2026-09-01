# devfocus

A terminal-styled focus workspace for developers — Pomodoro timer, a Spotify player, and a YouTube player, all on one page, styled like a code editor instead of a cozy lo-fi study room.

Live demo (after deploy): https://devfocus.pages.dev

## Why this exists

There's no shortage of "focus room" apps (Flocus, LifeAt, Forest, Pomofocus) — they already own the cozy/aesthetic "study with me" audience via TikTok and Pinterest content marketing, a channel Auto Company has no presence in. devfocus intentionally skips that fight: same feature set, aimed instead at developers who live in terminals and dark-mode editors, distributed through dev channels (Hacker News, GitHub, Product Hunt) that Auto Company's other projects (`botwatch`, `snapog`) already know how to work.

See `docs/ceo/focus-app-decision.md`, `docs/critic/focus-app-premortem.md`, and `docs/research/focus-app-market-validation.md` for the full reasoning.

## Features

- **Pomodoro timer** — configurable focus/break/long-break durations, session counter, optional completion chime (Web Audio, no audio file).
- **Spotify embed** — paste any public playlist/album/track URL, it embeds via Spotify's public oEmbed player. No API key, no login required on our end.
- **YouTube embed** — paste any video/shorts/live URL, it embeds muted-autoplay (browsers block unmuted autoplay; tap to unmute).
- **8 backgrounds** — all canvas/CSS-generated (matrix rain, circuit traces, synthwave grid, deep space, code-editor, amber CRT, Nord, plain terminal). No external image assets, so no licensing risk and no image hosting cost.
- **Settings drawer** — background picker + Pomodoro config, persisted to `localStorage`.

## Stack

Plain HTML/CSS/JS. No framework, no build step, no backend, no database. Everything — settings, last-used Spotify/YouTube URLs, timer config — lives in the visitor's browser via `localStorage`. Nothing is sent to a server.

This is deliberate: the CEO/critic review scoped this as a zero-cost, disposable ship, not a funded bet — see `docs/ceo/focus-app-decision.md`. Don't add a backend, accounts, or a build pipeline until real traffic justifies it.

## Local dev

```bash
npm run dev   # serves the static files on localhost
```

## Deploy (Cloudflare Pages)

```bash
npm run deploy   # wrangler pages deploy . --project-name=devfocus
```

## Known limitations (disclosed in-UI too)

- Spotify embed playback for visitors without a Spotify account is shuffle-only with occasional ads — that's a Spotify embed-policy constraint, not something we control.
- YouTube embeds start muted because browsers block unmuted autoplay.
- Only public Spotify playlists/albums/tracks and public/unlisted YouTube videos can be embedded — private content will not load.

## Status

Shipped as a fast, near-zero-cost bet on the dev-audience wedge (see CEO decision doc). Next step is posting to Show HN / relevant dev communities, not further feature work — see `memories/consensus.md` for the current Next Action.
