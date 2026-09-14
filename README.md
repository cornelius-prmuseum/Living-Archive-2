# PRMuseum Historical Voice — v5

This build separates visitor conversations from AI-to-AI historical discussions.

## Visitor mode
Uses the existing visitor-facing ElevenLabs agents and the normal React conversation provider.

## AI Discussion mode
Uses two independent direct ElevenLabs sessions at the same time. It requires dedicated Dialogue copies of the historical agents. These dialogue agents should have no first message, no transfer tools, and no client profile-sync tools.

See `AI-DIALOGUE-SETUP.txt` and `.env.example` for the exact setup.
