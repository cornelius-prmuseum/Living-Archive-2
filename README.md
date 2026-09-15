# PRMuseum Historical Voice — v5.6

This build separates visitor conversations from AI-to-AI historical discussions.

## Visitor mode
Uses the normal visitor-facing ElevenLabs agents. A visitor can speak or type questions, use the rotating suggested-question pool, and switch historical figures from the right-hand rail.

### Graceful visitor handoffs
Visitor-mode figure changes no longer use ElevenLabs' native `transfer_to_agent`. Clicking another historical figure adds a visible Visitor request such as `I'd like to speak with Ivy Lee.` The outgoing figure gives one short handoff line, then Living Archives closes that ElevenLabs session and opens a new session for the selected figure. Recent transcript context is carried forward with `sendContextualUpdate()`, the incoming figure's normal First Message is suppressed, and the museum transcript remains continuous.

See `ELEVENLABS-VISITOR-HANDOFF-SETUP.txt` for the required ElevenLabs settings.

## AI Discussion mode
Uses two independent direct ElevenLabs sessions at the same time. It requires dedicated Dialogue copies of the historical agents. These dialogue agents should have no first message, no transfer tools, and no client profile-sync tools.

See `AI-DIALOGUE-SETUP.txt` and `.env.example` for the exact setup.

## Suggested question pools
Visitor-mode suggested questions are stored in one editable file:

`lib/agents.ts` (Suggested-question pools section)

Each historical figure has a question pool (currently about 20 questions). The UI displays three at a time only after a conversation starts. Whenever a visitor clicks one, it is added to the transcript as a Visitor message, sent to ElevenLabs, and the suggestions rotate.
