# PRMuseum Historical Voice — v5

This build separates visitor conversations from AI-to-AI historical discussions.

## Visitor mode
Uses the existing visitor-facing ElevenLabs agents and the normal React conversation provider.

## AI Discussion mode
Uses two independent direct ElevenLabs sessions at the same time. It requires dedicated Dialogue copies of the historical agents. These dialogue agents should have no first message, no transfer tools, and no client profile-sync tools.

See `AI-DIALOGUE-SETUP.txt` and `.env.example` for the exact setup.

## Suggested question pools
Visitor-mode suggested questions are stored in one editable file:

`lib/suggestedQuestions.ts`

Each historical figure has a question pool (currently about 20 questions). The UI displays three at a time. Whenever a visitor clicks a suggested question, it is added to the transcript as a Visitor message, sent to ElevenLabs, and the three suggestions rotate to a new group. Add, remove, or rewrite strings in that file to maintain the question library.

## Portrait-click transfers
Before a conversation begins, clicking a historical figure simply selects that figure. During a live visitor conversation, clicking a different figure now creates a visible visitor request such as `I'd like to speak with Ivy Lee.` and sends that exact text to the active ElevenLabs agent. The normal ElevenLabs `transfer_to_agent` rules decide whether to transfer. The displayed portrait changes only after the transfer succeeds.
