# Living Archives login + Google Sheets setup

This version uses Supabase Auth for visitor accounts and a Google Apps Script web app for the live conversation log.

## 1. Create the Supabase project

1. Create a Supabase project.
2. In **Authentication → Providers**, keep **Email** enabled.
3. Decide whether you want email confirmation:
   - **Immediate access:** turn **Confirm email** off.
   - **Confirmed accounts:** leave it on. The Living Archives signup screen will tell the visitor to check their email before logging in.
4. In **Authentication → URL Configuration**, set the Site URL to `https://living-archives.vercel.app/` (or your final Living Archives domain) and add it as an allowed redirect URL.
5. In the Supabase project **Connect** panel, copy:
   - Project URL
   - Publishable key

Add these to Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Signup stores these values in the Supabase user's metadata:

```text
first_name
last_name
marketing_opt_in
```

Passwords are handled by Supabase Auth and are never stored by the Living Archives app.

For a public production launch, configure your own SMTP provider in Supabase if you leave email confirmation/password-recovery emails enabled. Supabase's built-in test mail service is rate limited.

## 2. Create the Google Sheet

Create a new Google Sheet. You can name it anything. Copy the spreadsheet ID from its URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

You do not need to create the header row manually. The Apps Script will create:

1. First Name
2. Last Name
3. Email
4. Conversation Date & Time
5. Conversation Duration
6. ElevenLabs Conversation ID

A row is added as soon as a voice conversation starts. The same row is updated with the final duration when the conversation ends.

## 3. Add the Google Apps Script

In the Google Sheet choose **Extensions → Apps Script**.

Replace the default code with the contents of:

```text
google-apps-script/Code.gs
```

Then open **Project Settings → Script Properties** and add:

```text
SPREADSHEET_ID = your Google Sheet ID
LOG_SECRET = a long random secret of your choice
```

The `LOG_SECRET` should be a long random value. Do not put it in browser code.

## 4. Deploy the Apps Script web app

In Apps Script:

1. Choose **Deploy → New deployment**.
2. Select **Web app**.
3. **Execute as:** Me.
4. **Who has access:** Anyone.
5. Deploy and authorize access to the spreadsheet.
6. Copy the deployed `/exec` URL.

Add these Vercel variables:

```text
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
GOOGLE_SHEETS_WEBHOOK_SECRET=the same value as LOG_SECRET
```

The webhook URL and secret are used only by the Next.js server route. They are not exposed to visitors.

## 5. Existing Vercel variables remain required

Keep all existing ElevenLabs variables from `.env.example`, including your agent IDs and API key.

After adding the four new authentication/logging variables, redeploy the Vercel project.

## 6. Test

1. Open the Living Archives site in a private/incognito window.
2. Create an account.
3. Log in.
4. Start a voice conversation.
5. Confirm that a row immediately appears in the Google Sheet with the user's first name, last name, email, date/time and ElevenLabs Conversation ID.
6. End the conversation.
7. Confirm that **Conversation Duration** updates on the same row.

## Notes

- The Google Sheet log covers normal visitor conversations. AI-to-AI Historical Roundtable sessions use two separate ElevenLabs conversation IDs and are not added to this single-ID visitor log.
- Clicking **Sign out** clears the Supabase session from the browser.
- The ElevenLabs token and transfer-resolution API routes now require a valid Supabase access token, so the login gate cannot be bypassed simply by calling the token endpoint directly.


### Spreadsheet timezone

Google Sheets displays the logged ISO date/time using the spreadsheet's timezone. For New York museum operations, set **File → Settings → Time zone** to **(GMT-05:00) Eastern Time / America-New_York** so the conversation start time appears locally.


## Troubleshooting: login works but the Sheet stays empty

Use this exact order:

1. In Apps Script, open **Project Settings → Script Properties** and verify both properties exist:
   - `SPREADSHEET_ID` = only the ID between `/d/` and `/edit` in the Google Sheet URL.
   - `LOG_SECRET` = exactly the same string as Vercel `GOOGLE_SHEETS_WEBHOOK_SECRET`.
2. Open **Deploy → Manage deployments**. The deployment must be a **Web app**, **Execute as: Me**, **Who has access: Anyone**. A setting that requires a Google login will not work for the Vercel server.
3. Copy the deployed URL ending in `/exec` into Vercel `GOOGLE_SHEETS_WEBHOOK_URL`. Do not use the editor URL, spreadsheet URL, deployment ID alone, or `/dev` URL.
4. After changing Apps Script code, use **Deploy → Manage deployments → Edit → New version → Deploy**. Saving the editor does not update an existing deployed version.
5. Redeploy the Vercel project after changing Vercel environment variables. Make sure the variables are available to the **Production** deployment.
6. With this v5.19.2 Apps Script deployed, open the `/exec` URL in an incognito browser. You should see JSON similar to:

```json
{"ok":true,"service":"PRMuseum Living Archives conversation log","spreadsheetConfigured":true,"secretConfigured":true}
```

If you see a Google sign-in page, an access-denied page, or HTML instead of JSON, the web-app access setting or URL is wrong.

### Where to look for the failure

- **Apps Script → Executions:** starting a Living Archives conversation should create a `doPost` execution.
  - No execution = Vercel is not reaching this deployment (usually URL/access/environment variable).
  - Failed execution = click it to see the exact Google error.
- **Vercel → Project → Logs:** search for `/api/conversation-log`. v5.19.2 logs whether Apps Script returned HTML, invalid JSON, a secret/configuration error, or a Google execution error.


## Personality(ies) column
The Apps Script adds a seventh `Personality(ies)` column and updates it when the visitor successfully transfers to another historical figure.

## Museum Staff and Educator access whitelists

Access is assigned after Supabase login using the signed-in email address. Add these server-only Vercel environment variables:

```text
PRMUSEUM_MUSEUM_STAFF_EMAILS=staff1@prmuseum.org,staff2@prmuseum.org
PRMUSEUM_EDUCATOR_EMAILS=teacher@example.edu,professor@example.edu
```

Email matching is case-insensitive. Museum Staff takes precedence if an address appears in both lists.

### Current access behavior

- **Standard:** Edward Bernays, Ivy Lee, Walter Lippmann, Arthur W. Page.
- **Educator:** currently the same persona set as Standard, but with an independently configurable conversation limit. You can later change `PRMUSEUM_EDUCATOR_ENABLED_AGENTS` without changing code.
- **Museum Staff:** Standard figures plus Inez Y. Kaiser, Marilyn Laurie, Doris Fleischman, Museum Docent, and the Historic Roundtable.

The app enforces these permissions on the server token/transfer routes as well as in the interface.

### Role-specific conversation limits

Set values in seconds:

```text
PRMUSEUM_STANDARD_SESSION_SECONDS=3600
PRMUSEUM_EDUCATOR_SESSION_SECONDS=5400
PRMUSEUM_MUSEUM_STAFF_SESSION_SECONDS=7200
```

If a role-specific value is omitted, it falls back to the Standard limit. `NEXT_PUBLIC_SESSION_SECONDS` remains a legacy fallback for the Standard limit.

### Museum Staff personas

Configure the additional persona IDs:

```text
ELEVENLABS_AGENT_INEZ_KAISER=
ELEVENLABS_AGENT_MARILYN_LAURIE=
ELEVENLABS_AGENT_DORIS_FLEISCHMAN=
ELEVENLABS_AGENT_MUSEUM_DOCENT=
```

If your password-protected preview used separate ElevenLabs copies for the original four figures, you can preserve that preview transfer/tool setup by setting the optional `ELEVENLABS_MUSEUM_STAFF_AGENT_*` variables from `.env.example`. When those are absent, Museum Staff falls back to the standard agent ID for that figure.

### Historic Roundtable

The Historic Roundtable uses the existing two-independent-session implementation and is only returned to Museum Staff accounts. Keep:

```text
PRMUSEUM_AI_DIALOGUE_ENABLED=true
```

Then configure at least two dialogue-agent IDs. Museum Docent is intentionally excluded from the Roundtable speaker list. The staff-specific dialogue variables can point to your existing preview dialogue copies; otherwise the app falls back to the normal `ELEVENLABS_DIALOGUE_AGENT_*` IDs.
