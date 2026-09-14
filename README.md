# PRMuseum Historical Voice App — Multi-Agent v3

A Next.js/Vercel frontend for PRMuseum historical voice agents powered by ElevenLabs.

## Included in this version

- Edward Bernays, Ivy Lee, Walter Lippmann, and Arthur W. Page
- Right-side agent selector with portraits and active-agent state
- Voice questions and typed questions in the same live conversation
- Three clickable recommended questions for every historical figure
- Live on-screen subtitles based on incoming ElevenLabs agent-response text
- UI synchronization after agent-to-agent transfers through the `setActiveAgent` client tool
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

ElevenLabs preserves conversation history across `transfer_to_agent`, but individual transcript messages do not expose the active `agent_id` to the browser. For that reason, every historical agent must have the same client tool:

```text
setActiveAgent
```

with a required string parameter:

```text
agent_slug
```

Valid values are:

```text
bernays
ivy-lee
lippmann
arthur-page
```

The receiving agent should call `setActiveAgent` with **its own** slug immediately after it becomes active and before its first substantive response. This keeps the main portrait, name, status, recommended questions, transcript speaker attribution, and URL synchronized even when the visitor asks verbally or by typed question to switch agents.

See `ELEVENLABS-MULTI-AGENT-SETUP.txt` for the exact prompt block and transfer setup.

## Typed questions

`sendUserMessage()` is used so typed text is handled as an actual visitor turn inside the same voice conversation. A recommended-question button uses the same path. If a question is clicked before the session starts, the app starts the voice session and then submits that question.

## Subtitles

Incoming ElevenLabs agent-response text is displayed in a subtitle panel while the agent is speaking and briefly after the response ends. The full transcript remains available separately.

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
lib/serverAgents.ts                 Server-side agent ID and availability logic
components/AgentExperience.tsx      Main UI, text input, subtitles, transfers, timer
app/globals.css                     Styling
ELEVENLABS-MULTI-AGENT-SETUP.txt    ElevenLabs setup instructions
```
