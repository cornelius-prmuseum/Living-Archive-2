# PRMuseum Historical Voice App — Multi-Agent v4.5

A Next.js/Vercel frontend for PRMuseum historical voice agents powered by ElevenLabs.

## What changed in v4.5

- Keeps the full, scrollable **live transcript** from v4.4.
- Agent responses grow word-by-word from ElevenLabs audio-alignment timing.
- Replaces the incorrect transfer-based AI dialogue experiment with **two independent ElevenLabs voice sessions**.
- AI dialogue never calls `transfer_to_agent`; transfers remain reserved for genuine visitor-requested handoffs.
- The next AI is prompted only after the current voice has finished speaking.
- During AI dialogue, the large portrait follows the conversation instance that is **actually speaking**.
- The hidden secondary session starts with its microphone muted and output volume at zero while it initializes.
- The 10-minute timer will stop dialogue mode between turns rather than cutting off a secondary speaker.

Existing features remain:

- Edward Bernays, Ivy Lee, Walter Lippmann, and Arthur W. Page
- Right-side agent selector
- Voice and typed questions
- Three suggested questions per agent
- Normal visitor-requested agent transfers
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

The current spoken response grows directly inside a scrollable transcript using ElevenLabs `onAudioAlignment`. When that voice turn ends, its completed text becomes a permanent transcript entry.

Enable the `audio` client event for every agent that can participate.

## AI-to-AI dialogue mode

AI dialogue uses **two independent conversations**:

```text
Primary agent session                  Secondary agent session
        |                                      |
        | speaks                               |
        |------ completed response ----------->|
        |                                      | speaks
        |<----- completed response ------------|
        | speaks                               |
```

The visitor starts with the currently connected figure, chooses a second enabled figure and a topic, then presses **Start dialogue**. The app mutes both microphones, starts the second private voice session, and alternates completed text between the two sessions with `sendUserMessage()`.

There is **no `transfer_to_agent` call during AI dialogue**. This avoids interrupting a speaker and avoids using the transfer system as a turn-taking mechanism.

### Concurrency requirement

The ElevenLabs workspace must support at least **2 concurrent conversations** while AI dialogue is running. Normal visitor mode still uses only one.

### Backend switch

Enable:

```env
PRMUSEUM_AI_DIALOGUE_ENABLED=true
```

Disable/remove the feature:

```env
PRMUSEUM_AI_DIALOGUE_ENABLED=false
```

Maximum turns:

```env
PRMUSEUM_AI_DIALOGUE_MAX_TURNS=6
```

The value is clamped between 2 and 12.

### ElevenLabs configuration

No special transfer rules are needed for AI dialogue. Keep whatever transfer rules already work for normal visitor-requested handoffs.

For live word-timed transcription, keep the `audio` client event enabled. For normal transfer-event profile synchronization, keep `agent_tool_request` and `agent_tool_response` enabled.

The hidden secondary dialogue conversation starts muted and with output volume zero, waits until it has remained silent, and only becomes audible immediately before its first relayed dialogue response.

## Profile synchronization

Normal visitor mode keeps v4.3's successful-transfer-event profile sync. AI dialogue uses a stronger rule: the portrait changes when the corresponding independent conversation reports `isSpeaking=true`.

## Agent availability

```env
PRMUSEUM_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page
```

Remove a slug to hide/disable that agent without deleting its Agent ID.

## Timer

```env
NEXT_PUBLIC_SESSION_SECONDS=600
```

Also make sure each ElevenLabs agent's own maximum conversation duration is at least 600 seconds.

## WordPress

See `wordpress-embed.html`. The iframe must include:

```html
allow="microphone; autoplay"
```

## Main files

```text
lib/agents.ts                          Names, bios, portraits, suggested questions
lib/serverAgents.ts                    Agent IDs, availability, backend flags
components/AgentExperience.tsx         Primary conversation/UI/orchestrator
components/SecondaryDialogueSession.tsx Independent second ElevenLabs session
app/globals.css                        Styling
```


## AI dialogue first-message requirement
Enable **Security → Overrides → First message** on every ElevenLabs agent that may be used as the second AI-dialogue participant. The app overrides that secondary session greeting to blank so the two voices never begin by talking over one another.
