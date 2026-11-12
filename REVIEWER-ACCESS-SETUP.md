# Living Archives Reviewer Access

This version supports a private review URL that bypasses Supabase login while keeping reviewer access separate from Museum Staff privileges.

## 1. Create a reviewer key

Generate a long random secret (at least 24 characters; 40+ recommended) and add it to Vercel:

```text
PRMUSEUM_REVIEWER_ACCESS_KEY=your-long-random-review-key
```

Optional reviewer-session lifetime:

```text
PRMUSEUM_REVIEWER_SESSION_HOURS=12
```

Redeploy after adding/changing the variable.

## 2. Share the reviewer URL

Use this format:

```text
https://living-archives.vercel.app/review#your-long-random-review-key
```

The key is placed after `#`, so browsers do not send it in the initial URL request. The review page immediately removes it from the visible address, sends it to the same-origin reviewer-session endpoint, receives a secure HttpOnly cookie, and redirects to `/`.

## 3. Reviewer permissions

Reviewers receive the **Standard** access profile by default:

- normal public personalities only
- standard conversation-duration limit
- no Museum Staff-only personalities
- no Historic Roundtable

The server enforces these restrictions; the reviewer cookie is not just a visual login bypass.

## 4. Conversation log

Reviewer conversations use the normal Google Sheets logger. The row will show:

```text
First Name: Reviewer
Last Name: [blank]
Email: [blank]
```

Date/time, duration, ElevenLabs Conversation ID, and Personality(ies) continue to log normally.

## 5. Revoke reviewer access

Change `PRMUSEUM_REVIEWER_ACCESS_KEY` in Vercel and redeploy. Existing reviewer cookies are signed from the old key and become invalid automatically.

The reviewer can also click **Exit reviewer** to clear the reviewer cookie on that browser.
