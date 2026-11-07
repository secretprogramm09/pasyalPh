# Admin account creation setup

The Settings page creates Firebase Authentication users through the Vercel
serverless endpoint at `/api/admins`. The endpoint requires a Firebase Admin
service account and only permits the configured head-admin UID.

## Configure Vercel

In the `pasyalph` Vercel project, add these Production environment variables:

- `HEAD_ADMIN_UID`: the UID of the one existing account that should be allowed
  to create other admins. Use the UID for the head admin, not a Vercel account ID.
- `FIREBASE_SERVICE_ACCOUNT`: the complete JSON contents of a service account
  key for the `pasyalphadmin` Firebase project. Create it in Firebase Console →
  Project settings → Service accounts → Generate new private key. Store this
  only as a Vercel environment variable; never commit the key to the repository
  or share it in chat.
- `CRON_SECRET`: a long, random secret used to authorize Vercel's scheduled
  Trash cleanup. Keep it private and configure it in the same Vercel environment.
- `GROQ_API_KEY`: the secret key for the Pasyal AI sidebar assistant. Create it
  in the [Groq Console](https://console.groq.com/keys), then add it only as a
  Vercel environment variable. Never put it in `index.html`, `firebase.js`, or
  `firebase-config.js`.
- `GROQ_MODEL` (optional): model ID for the assistant. The default is
  `openai/gpt-oss-20b`.

Redeploy the Vercel project after setting the variables.

## Trash retention

Deleted listings move to the `trashListings` database path. Admins can restore
them or permanently delete them from the dashboard Trash page. Vercel runs
`/api/purge-trash` hourly and permanently removes entries at least 30 days old.
The scheduled function uses `FIREBASE_SERVICE_ACCOUNT` and requires
`CRON_SECRET`; configure both in the Vercel Production environment before
deploying. The dashboard also performs a cleanup when it is open as a fallback.

## Pasyal AI sidebar assistant

The sidebar assistant sends signed-in admin questions and a sanitized snapshot
of the dashboard's currently loaded Firebase records to `/api/help-chat`. The
snapshot covers listings, Trash, comments, reports, users, and admin applications;
credential-like fields are removed. That endpoint verifies the Firebase admin
session and calls Groq's Chat Completions API from the server, so the Groq key
stays private. In Vercel, open **Project Settings → Environment Variables**,
add `GROQ_API_KEY` for Production (and Preview/Development if needed), then
redeploy. Without the key, the widget will show that it is not configured.

## Enable newly created admins in Realtime Database

In Firebase Console → Realtime Database → Rules, publish the contents of
`database.rules.json`. It preserves the two existing administrator UIDs and
allows accounts created by the head admin endpoint through the `admin` custom
claim. The rule applies to the entire database, as the existing rules do.

After deployment and rule update, sign in as the head admin and open Dashboard
Settings → Create an admin account. Enter the new admin's name, email, and a
temporary password of at least 12 characters. Share that password with them
securely; the app does not email passwords.

## Receive applications from MIT App Inventor

In the MIT App Inventor screen, add text boxes for name, email, and reason, a
Submit button, a Clock, and a non-visible FirebaseDB component. Set FirebaseDB's
URL to the Realtime Database URL in `firebase-config.js`, set ProjectBucket to
`adminApplications`, and leave FirebaseToken empty. Do not add a database secret
to the mobile app.

On Submit, validate that the three fields are filled, create a unique tag such
as `request_<Clock.SystemTime>_<random number>`, and call `StoreValue` with that
tag and a dictionary containing `name`, `email`, `reason`, `status` set to
`pending`, and `createdAt` set to `Clock.SystemTime`. Clear the form after
submission. Handle FirebaseDB's `FirebaseError` event to show a failure message.
The rules permit public creation of new pending requests only; applicants
cannot read, edit, or delete requests.

The dashboard reads `/adminApplications` and shows each request under **Admin
Applications**. The configured head admin can choose **Create admin** to fill
the account form from the request. Completing account creation marks that
request approved.
