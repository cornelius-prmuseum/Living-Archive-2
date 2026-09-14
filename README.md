# PRMuseum Historical Voice App — Multi-Agent v4

A Next.js/Vercel frontend for PRMuseum historical voice agents powered by ElevenLabs.

## Included in this version

- Edward Bernays, Ivy Lee, Walter Lippmann, and Arthur W. Page
- Right-side agent selector with portraits and active-agent state
- Voice questions and typed questions in the same live conversation
- Three clickable recommended questions for every historical figure
- Speech-synchronized progressive subtitles using ElevenLabs audio alignment timing
- Active-profile synchronization using ElevenLabs `system__current_agent_id` plus the `syncActiveAgent` client tool
- Server-side enable/disable list for agents
- 10-minute frontend session timer with graceful wrap-up
- Server-side WebRTC conversation-token route
- Transcript with the historical figure attached to each agent response

## Environment variables

```env
ELEVENLABS_API_KEY=...

ELEVENLABS_AGENT_BERNAYS=agent_...
ELEVENLABS_AGENT_IVY_LEE=agent_...
ELEVENLABS_AGENT_LIPPMANN=agent_...
ELEVENLABS_AGENT_ARTHUR_PAGE=agent_...

PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page

NEXT_PUBLIC_DEFAULT_AGENT=bernays
NEXT_PUBLIC_SESSION_SECONDS=600
```

`PRMUSEUM_ENABLED_AGENTS` is the backend availability switch. To hide an agent, remove its slug and redeploy Vercel. The Agent ID can stay in Vercel.

Examples:

```env
# All four
PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page

# Hide Lippmann
PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,arthur-page

# Only Bernays and Page
PRMUSEUM_ENABLED_AGENTS=bernays,arthur-page
```

An agent appears only when it is both listed in `PRMUSEUM_ENABLED_AGENTS` and has a matching `ELEVENLABS_AGENT_*` value.

## Ten-minute timer

The app defaults to 600 seconds. If your existing Vercel project still has:

```env
NEXT_PUBLIC_SESSION_SECONDS=300
```

change it to:

```env
NEXT_PUBLIC_SESSION_SECONDS=600
```

The frontend warns the agent at about 45 seconds remaining and requests a brief closing response near 20 seconds remaining.

Also set **Max conversation duration** to at least 600 seconds on every ElevenLabs agent. Transfer destinations use their own agent configuration for max duration.

## Arthur W. Page

Add this Vercel variable:

```env
ELEVENLABS_AGENT_ARTHUR_PAGE=agent_...
```

The included `public/portraits/arthur-page.svg` is a placeholder. Replace it with a museum-approved portrait when ready.

## Agent-transfer UI synchronization

ElevenLabs now exposes a system dynamic variable named:

```text
system__current_agent_id
```

It is automatically updated after an agent-to-agent transfer. The v4 app uses a client tool named:

```text
syncActiveAgent
```

with the parameter:

```text
agent_id
```

Configure that parameter from the ElevenLabs dynamic variable `system__current_agent_id` (or `{{system__current_agent_id}}` where template syntax is requested). The browser then calls `/api/resolve-agent`, and the server maps the actual ElevenLabs Agent ID to the matching PRMuseum profile using the existing Vercel `ELEVENLABS_AGENT_*` environment variables.

This is more reliable than asking the LLM to choose a PRMuseum slug. The receiving agent should call `syncActiveAgent` immediately after it becomes active and before its first substantive spoken response.

There is no extra API-key scope needed for this. Keep `convai_write`, which is already required by the WebRTC token endpoint.

See `ELEVENLABS-MULTI-AGENT-SETUP.txt` for the exact configuration.

## Typed questions

`sendUserMessage()` is used so typed text is handled as an actual visitor turn inside the same voice conversation. A recommended-question button uses the same path. If a question is clicked before the session starts, the app starts the voice session and then submits that question.

## Subtitles

The v4 app uses the React SDK `onAudioAlignment` callback. ElevenLabs supplies character-level timing (`chars`, `char_start_times_ms`, and `char_durations_ms`) with agent speech. The UI groups those timings into progressive text runs so the caption grows while the words are actually being spoken rather than jumping to the complete response.

For every agent that can begin a conversation, enable the **audio** client event under the agent's **Advanced → Client events** settings. Transfers inherit the parent agent's client-event configuration, but keeping this enabled consistently on every agent ensures captions work regardless of which figure starts the session.

If alignment is unavailable, the app falls back to displaying the completed agent-response text.

No extra API-key permission is required for audio alignment.

## Vercel deployment

Your repository root must contain `package.json` and `app/` directly:

```text
repo-root/
├── app/
├── components/
├── lib/
├── public/
├── package.json
└── ...
```

After changing any Vercel environment variable, redeploy the Production deployment.

## WordPress

See `wordpress-embed.html`. The iframe must include:

```html
allow="microphone; autoplay"
```

## Files you will edit most often

```text
lib/agents.ts                       Names, bios, portraits, suggested questions
lib/serverAgents.ts                 Server-side Agent ID, identity resolution, and availability logic
components/AgentExperience.tsx      Main UI, audio-aligned subtitles, identity sync, transfers, timer
app/globals.css                     Styling
ELEVENLABS-MULTI-AGENT-SETUP.txt    ElevenLabs setup instructions
```
