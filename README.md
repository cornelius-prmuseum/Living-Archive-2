# PRMuseum Historical Voice App — Multi-Agent v4.4

A Next.js/Vercel frontend for PRMuseum historical voice agents powered by ElevenLabs.

## What changed in v4.4

- The separate subtitle box has been replaced by an **always-visible, scrollable live transcript**.
- Visitor speech/text appears in the transcript normally.
- Agent text grows **word-by-word from ElevenLabs audio-alignment timing**, so the transcript follows the words being spoken rather than jumping immediately to the completed LLM response.
- The transcript automatically scrolls to the current line and remains available after the conversation ends.
- Added an optional **AI-to-AI dialogue mode**. Two enabled historical figures can alternate voice responses in the same ElevenLabs conversation.
- AI dialogue is controlled entirely from the backend with `PRMUSEUM_AI_DIALOGUE_ENABLED` and is OFF by default.
- AI dialogue has a server-side maximum-turn safety limit (`PRMUSEUM_AI_DIALOGUE_MAX_TURNS`, default 6).

Existing features remain:

- Edward Bernays, Ivy Lee, Walter Lippmann, and Arthur W. Page
- Right-side agent selector
- Voice and typed questions
- Three suggested questions per agent
- Transfer-event profile synchronization
- Server-side agent enable/disable list
- 10-minute session timer
- Server-side WebRTC token generation

## Environment variables

```env
ELEVENLABS_API_KEY=...

ELEVENLABS_AGENT_BERNAYS=agent_...
ELEVENLABS_AGENT_IVY_LEE=agent_...
ELEVENLABS_AGENT_LIPPMANN=agent_...
ELEVENLABS_AGENT_ARTHUR_PAGE=agent_...

PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page

# Optional AI-to-AI feature. Keep false to hide/disable it completely.
PRMUSEUM_AI_DIALOGUE_ENABLED=false
PRMUSEUM_AI_DIALOGUE_MAX_TURNS=6

NEXT_PUBLIC_DEFAULT_AGENT=bernays
NEXT_PUBLIC_SESSION_SECONDS=600
```

After changing Vercel environment variables, redeploy Production.

## Full live transcript

The live transcript uses ElevenLabs `onAudioAlignment` character timing. The current agent line is progressively filled as the audio is spoken. When that voice turn ends, the completed agent response is committed to the transcript and the next turn begins below it.

For every agent that can start a call, enable the `audio` client event in ElevenLabs under **Advanced → Client events**.

The transcript falls back to the completed agent response if audio alignment is unavailable.

## AI-to-AI dialogue mode

This is an **orchestrated alternating dialogue**, not two simultaneous audio streams.

When enabled in Vercel, a visitor can:

1. Begin a normal voice conversation with one historical figure.
2. Choose a second enabled historical figure.
3. Enter a discussion topic.
4. Press **Start dialogue**.

The app mutes the visitor microphone, asks the current figure to make the opening statement, then uses the existing ElevenLabs `transfer_to_agent` flow to alternate the same conversation between the two figures. ElevenLabs preserves the transcript/context across transfers, so the receiving figure can respond to the prior figure's remarks.

Only one voice speaks at a time. This avoids audio feedback and makes the transcript/profile identity much easier to follow.

The visitor can press **Stop AI dialogue** at any point; the app restores the microphone to its prior state and the normal visitor conversation can continue.

### Backend switch

To enable:

```env
PRMUSEUM_AI_DIALOGUE_ENABLED=true
```

To remove the feature from the UI:

```env
PRMUSEUM_AI_DIALOGUE_ENABLED=false
```

Optional turn limit:

```env
PRMUSEUM_AI_DIALOGUE_MAX_TURNS=6
```

The app clamps this value between 2 and 12 turns to prevent an accidental runaway autonomous conversation.

### ElevenLabs configuration for AI dialogue

No additional API-key scope is required beyond what the existing app already uses.

The selected agents must already be able to transfer to one another through your normal `transfer_to_agent` configuration. **Do not rewrite otherwise-working transfer rules just for AI dialogue.** The app sends explicit internal transfer requests using the same pathway as the right-side agent selector.

For the existing transfer-event profile synchronization, keep these client events enabled:

```text
agent_tool_request
agent_tool_response
```

For the word-timed live transcript, also enable:

```text
audio
```

## Profile synchronization

v4.4 retains v4.3's transfer-event profile sync. The portrait/name stays on the current figure until ElevenLabs reports a successful `transfer_to_agent` system-tool response, then the app switches to the receiving figure.

The server reads the source agent's transfer configuration through `/api/resolve-transfer`, so the ElevenLabs API key should have Conversational AI / Agents **Read** and **Write**.

## Agent availability

Use:

```env
PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page
```

Remove a slug to hide/disable that agent without deleting its Agent ID.

## Timer

The frontend defaults to 600 seconds (10 minutes):

```env
NEXT_PUBLIC_SESSION_SECONDS=600
```

Also make sure each ElevenLabs agent's own maximum conversation duration is at least 600 seconds.

## WordPress

See `wordpress-embed.html`. The iframe must include:

```html
allow="microphone; autoplay"
```

## Files you will edit most often

```text
lib/agents.ts                       Names, bios, portraits, suggested questions
lib/serverAgents.ts                 Server Agent IDs, availability, backend feature flags
components/AgentExperience.tsx      Conversation UI, transcript, transfers, AI dialogue, timer
app/globals.css                     Styling
```
