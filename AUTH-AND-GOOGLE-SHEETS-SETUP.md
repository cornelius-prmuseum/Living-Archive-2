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
