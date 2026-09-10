# PRMuseum Historical Voice App

A reusable Next.js / Vercel frontend for PRMuseum historical voice experiences powered by ElevenLabs Agents.

It is designed to reproduce the *behavior* of the Ask Bernays standalone app without depending on its private source code. One deployment can serve several historical figures using a query parameter:

- `/?agent=bernays`
- `/?agent=ivy-lee`
- `/?agent=lippmann`

Add `&ref=...` to provide a return destination after the conversation.

## What is included

- Next.js App Router + TypeScript
- ElevenLabs React SDK using WebRTC
- Server-side conversation-token endpoint so the ElevenLabs API key is never exposed in the browser
- Multiple historical figures from one deployment
- Microphone permission flow
- Listening / speaking state
- Mute and manual end controls
- Optional live transcript panel
- Five-minute default session timer
- Graceful close logic intended to prevent mid-sentence cutoff
- WordPress iframe example
- Responsive desktop/mobile styling

## 1. Create your ElevenLabs agents

Create or reuse your existing Bernays, Ivy Lee, and Walter Lippmann agents in ElevenLabs.

For each private agent, copy its Agent ID. The ID looks like `agent_...`.

The application does not place those IDs in the public browser bundle. They are mapped on the server.

## 2. Configure the environment variables

Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

Fill in:

```env
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_BERNAYS=agent_...
ELEVENLABS_AGENT_IVY_LEE=agent_...
ELEVENLABS_AGENT_LIPPMANN=agent_...
NEXT_PUBLIC_DEFAULT_AGENT=bernays
NEXT_PUBLIC_SESSION_SECONDS=300
```

Do not expose `ELEVENLABS_API_KEY` with a `NEXT_PUBLIC_` prefix.

## 3. Add the session-ending instructions to each agent

Copy the relevant text from `ELEVENLABS-PROMPT-ADDON.txt` into the agent's system prompt.

The browser does two things near the deadline:

1. At about 45 seconds remaining it sends a **contextual update** telling the agent to shorten its next responses. This does not itself trigger speech.
2. At about 20 seconds remaining, once the agent is not already speaking, it mutes the visitor and sends an internal closing message that triggers a brief final response. The frontend waits for that response to finish before disconnecting.

There is an 18-second failsafe after the closing prompt. This trades an exact hard five-minute cutoff for a much lower chance of cutting the character off mid-sentence.

## 4. Install and run locally

Node.js 20.9+ is recommended for modern Next.js.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/?agent=bernays
```

Your browser should ask for microphone permission when you press **Begin Conversation**.

## 5. Deploy to Vercel

**Important:** the repository root that Vercel builds must contain `package.json` and the `app/` directory directly. The correct shape is:

```text
repo-root/
├── package.json
├── app/
│   ├── page.tsx
│   └── layout.tsx
├── components/
├── lib/
└── public/
```

Do **not** leave the project one level deeper as `repo-root/prmuseum-historical-voice-app/app/...` unless you set Vercel **Settings → Build and Deployment → Root Directory** to `prmuseum-historical-voice-app`.

Push the project root to GitHub and import the repository into Vercel. In the Vercel project settings, add the same environment variables listed above, then redeploy.

Your URL will look similar to:

```text
https://your-project.vercel.app/?agent=bernays
```

## 6. Embed in WordPress / Divi

See `wordpress-embed.html`.

The key iframe requirement is:

```html
allow="microphone; autoplay"
```

Example:

```html
<iframe
  src="https://YOUR-APP.vercel.app/?agent=bernays&ref=https%3A%2F%2Fthemuseumofstg.wpengine.com%2Fask-bernays%2F"
  allow="microphone; autoplay"
  style="width:100%;height:850px;border:0;"
></iframe>
```

In Divi, place the snippet in a **Code** module rather than a Text module.

## 7. Replace the placeholder portraits

The included SVG portraits are deliberately generic placeholders and do not copy assets from the existing Ask Bernays app.

Replace these files with museum-approved images while keeping the same filenames, or update `lib/agents.ts`:

```text
public/portraits/bernays.svg
public/portraits/ivy-lee.svg
public/portraits/lippmann.svg
```

JPG, PNG, WebP, and SVG can all be used from the public folder.

## Adding another historical figure

Add the slug to `AgentSlug` and `AGENTS` in `lib/agents.ts`, then add a matching environment-variable mapping in `app/api/token/route.ts`.

For example, for George Creel:

```env
ELEVENLABS_AGENT_CREEL=agent_...
```

Then expose it as:

```text
/?agent=creel
```

## How the graceful timer works

The important implementation is in `components/AgentExperience.tsx`.

- The visible timer begins once the ElevenLabs session connects.
- At 45 seconds remaining, `sendContextualUpdate()` tells the agent to begin wrapping up without interrupting the current turn.
- At 20 seconds remaining, the app waits until `isSpeaking` is false.
- It mutes the user's microphone and uses `sendUserMessage()` to trigger a short final response.
- That internal control message is filtered out of the UI transcript.
- After an agent response is observed and `isSpeaking` becomes false, the app calls `endSession()`.
- An 18-second failsafe handles unusual network or model failures.

This is intentionally different from relying solely on an ElevenLabs hard conversation-duration limit, because a hard duration limit can end while audio is still being played.

## Production notes

Before public launch, consider:

- Adding rate limiting to `/api/token` so a public page cannot generate unlimited paid sessions.
- Adding a bot challenge if abuse becomes a problem.
- Deciding whether transcripts should be displayed at all on a museum kiosk.
- Reviewing ElevenLabs retention / privacy settings for your workspace.
- Testing Safari/iOS and the actual WordPress iframe, because microphone permissions are more restrictive there than in a direct top-level tab.
- Keeping the historical/AI disclosure in the surrounding museum page or app UI according to your institutional policy.

## Files to edit most often

```text
lib/agents.ts                  Names, dates, text, portrait paths
app/globals.css                Visual design
components/AgentExperience.tsx UI and timer behavior
app/api/token/route.ts         Private ElevenLabs Agent ID mapping
wordpress-embed.html           WordPress embed
.env.local                     Local secrets (never commit)
```

## Multi-agent sidebar and live transfers

This version includes a right-hand historical-figure selector. Before a call,
selecting a figure changes which agent token is requested. During a live call,
selecting a different figure sends an internal transfer request to the current
agent; the current ElevenLabs agent must have the built-in `transfer_to_agent`
system tool configured for the destination.

The page also registers a client tool named `setActiveAgent`. Add that exact
client tool to every ElevenLabs historical agent so an agent-driven transfer
can update the main portrait, title, status, URL and transcript attribution.
See `ELEVENLABS-MULTI-AGENT-SETUP.txt` for the exact dashboard and prompt setup.
