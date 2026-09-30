# AION 2 Israel Community Bot v5 — Railway

This version is designed to run 24/7 on Railway.

## Required Railway variables

DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CLIENT_ID=...
NEWS_MINUTES=30
RUN_UPGRADE=false
DATA_DIR=/data

Do NOT commit your bot token.

## Railway setup

1. Push this folder to a GitHub repository.
2. Railway -> New Project -> Deploy from GitHub repo.
3. Choose the repository.
4. Open the service -> Variables.
5. Add the variables above.
6. Deploy.
7. Service Settings -> Healthcheck path should be `/health` (railway.toml already sets it).
8. For persistent news deduplication, add a Railway Volume mounted at `/data`.
9. Set DATA_DIR=/data.
10. Watch deployment logs for:
   - [http] listening...
   - [commands] registered ...
   - [discord] online as ...
   - [news] found=... posted=...

## Discord Developer Portal

Bot -> Privileged Gateway Intents:
- SERVER MEMBERS INTENT: ON
- MESSAGE CONTENT INTENT: ON

OAuth scopes used when inviting:
- bot
- applications.commands

## Notes

- Railway injects PORT automatically.
- The app listens on 0.0.0.0 as required for cloud hosting.
- `/health` returns 200 only after the Discord bot is fully connected.
- News state is stored in DATA_DIR/state.json. Use a Railway Volume at /data if you want it to survive redeploys.
