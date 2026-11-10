# Living Archives role access setup

The login remains Supabase email/password. The app assigns access from the authenticated email address on the server.

## 1. Whitelists

Add these Vercel environment variables:

```text
PRMUSEUM_MUSEUM_STAFF_EMAILS=person1@prmuseum.org,person2@prmuseum.org
PRMUSEUM_EDUCATOR_EMAILS=teacher@example.edu
```

Addresses can be separated by commas, semicolons, or new lines. Matching is case-insensitive. Museum Staff takes precedence if the same email appears in both lists.

## 2. Conversation limits

Set maximum visitor-conversation time in seconds:

```text
PRMUSEUM_STANDARD_SESSION_SECONDS=3600
PRMUSEUM_EDUCATOR_SESSION_SECONDS=5400
PRMUSEUM_MUSEUM_STAFF_SESSION_SECONDS=7200
```

The UI receives the signed-in user's limit from the server. Standard users cannot change their browser state to obtain the Staff limit.

## 3. Museum Staff persona access

Museum Staff defaults to:

```text
bernays,ivy-lee,lippmann,arthur-page,inez-kaiser,marilyn-laurie,doris-fleischman,museum-docent
```

Set the additional agent IDs:

```text
ELEVENLABS_AGENT_INEZ_KAISER=
ELEVENLABS_AGENT_MARILYN_LAURIE=
ELEVENLABS_AGENT_DORIS_FLEISCHMAN=
ELEVENLABS_AGENT_MUSEUM_DOCENT=
```

If the password-protected preview has separate ElevenLabs copies of the original four agents, use the optional staff-specific variables:

```text
ELEVENLABS_MUSEUM_STAFF_AGENT_BERNAYS=
ELEVENLABS_MUSEUM_STAFF_AGENT_IVY_LEE=
ELEVENLABS_MUSEUM_STAFF_AGENT_LIPPMANN=
ELEVENLABS_MUSEUM_STAFF_AGENT_ARTHUR_PAGE=
ELEVENLABS_MUSEUM_STAFF_AGENT_INEZ_KAISER=
ELEVENLABS_MUSEUM_STAFF_AGENT_MARILYN_LAURIE=
ELEVENLABS_MUSEUM_STAFF_AGENT_DORIS_FLEISCHMAN=
ELEVENLABS_MUSEUM_STAFF_AGENT_MUSEUM_DOCENT=
```

When a staff-specific ID is blank, the app falls back to the matching normal agent ID.

## 4. Educator persona access

For now, Educators default to the same four personas as Standard users. This can be expanded later without a code change:

```text
PRMUSEUM_EDUCATOR_ENABLED_AGENTS=bernays,ivy-lee,lippmann,arthur-page
```

## 5. Historic Roundtable

The Roundtable is only returned to Museum Staff accounts. Standard and Educator accounts do not see the button and cannot obtain dialogue tokens.

Enable the feature:

```text
PRMUSEUM_AI_DIALOGUE_ENABLED=true
PRMUSEUM_AI_DIALOGUE_MAX_TURNS=6
```

Then configure dedicated dialogue agents. Museum Docent is intentionally excluded from the Roundtable speaker list.

```text
ELEVENLABS_DIALOGUE_AGENT_BERNAYS=
ELEVENLABS_DIALOGUE_AGENT_IVY_LEE=
ELEVENLABS_DIALOGUE_AGENT_LIPPMANN=
ELEVENLABS_DIALOGUE_AGENT_ARTHUR_PAGE=
ELEVENLABS_DIALOGUE_AGENT_INEZ_KAISER=
ELEVENLABS_DIALOGUE_AGENT_MARILYN_LAURIE=
ELEVENLABS_DIALOGUE_AGENT_DORIS_FLEISCHMAN=
```

To use the exact dialogue copies from the password-protected preview, put those IDs in the corresponding `ELEVENLABS_MUSEUM_STAFF_DIALOGUE_AGENT_*` variables listed in `.env.example`.

## 6. Security behavior

The interface is not the only gate. `/api/token`, `/api/resolve-agent`, and `/api/resolve-transfer` all validate the signed-in Supabase user and the server-derived role before allowing access. A Standard user manually requesting a Staff-only slug receives an authorization error.
