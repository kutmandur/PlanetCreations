# Stream Management

## Data flow

- `liveSessions/{uid}` is the server-authoritative logical stream session. It can contain one Twitch output, one YouTube output, or both for a simulcast, but it always points to one active creation. Firestore rules deny every direct client read and write, including the owner and admins.
- `liveChannelClaims/{platform-channel-hash}` atomically enforces one active PlanetCreations session per Twitch/YouTube channel. Different people and platform channels can be live concurrently, while modified clients cannot claim a channel already in use.
- Callable functions verify authentication, ownership, non-collaboration creations, game compatibility, the platform's live state, the session ID, and the current selection revision before changing live state.
- A compact session projection is written to every registered desktop client's existing `clientInstallQueues/{uid}/clients/{clientId}` document. This reuses the QR synchronization listener instead of adding another Firestore listener per device.
- The main Electron window mirrors that projection through local storage and `BroadcastChannel` to the overlay and Stream Management windows.
- Manual selection locks automatic switching for the rest of the session. Title matching still runs and can create a switch suggestion.

## Platform behavior

- Twitch `channel.update` and `stream.offline` events are received through the signed EventSub webhook. A five-minute scheduled verification remains the fallback.
- YouTube metadata is checked only for active sessions by the same scheduled verification.
- A Twitch category change starts a two-minute grace period. If the original game category is not restored, only PlanetCreations live mode ends; the actual stream is never stopped.
- In a simulcast, an OBS/Streamlabs stop event ends the whole logical session and both outputs. A platform API offline event removes only that platform while the other output is still live.
- The Discord service also joins the active Twitch/YouTube chats when the respective bot credentials are configured. It answers `!creation` with the server-selected creation, `!builder` with the authenticated streamer's PlanetCreations profile, and `!community` with an owned community whose saved Twitch/YouTube channel matches the active broadcaster. Builder and community data are prefetched once and cached for the whole logical stream; creation data continues to follow live creation switches. A missing or mismatched community link stays silent.

## Required deployment configuration

Set the new Functions secret before deploying the Functions code:

```powershell
firebase functions:secrets:set TWITCH_EVENTSUB_SECRET
```

Use a long random value. `TWITCH_EVENTSUB_CALLBACK_URL` normally stays empty because the production default points to the `us-central1` function.

The chat adapters are optional. Their setup credentials belong in the ignored local `discord-bot/.env.stream-bots`; see `discord-bot/.env.example`. Never commit actual credentials or OAuth refresh tokens. The Twitch bot token must come from the Authorization Code Grant with `chat:read` and `chat:edit`. The YouTube bot uses a Brand Channel authorization with `youtube.force-ssl`. Both setup flows validate the bot identity and persist refresh tokens and client credentials in the Firestore-rules-denied `privateOAuthCredentials/streamChatBot` document. The production bot loads them through its Admin SDK connection, so GitHub and browser clients never receive them.
