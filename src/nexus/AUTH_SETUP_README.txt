MELOGIC NEXUS — AUTH v0.1 SETUP
================================

WHAT THIS BUILD ADDS
--------------------
- Firebase email/password login
- Persisted desktop login session
- Firebase auth-state observation
- Firestore account/profile retrieval
- Dynamic first-name greeting
- Dynamic time-of-day greeting
- Profile-picture avatar with initials fallback
- Top-right account dropdown
- Sign out
- Password-reset request
- Loading screens and auth error states

EXPECTED FILE LOCATIONS
-----------------------

01_firebase.js.txt
-> src/nexus/services/firebase.js

02_account.js.txt
-> src/nexus/services/account.js

03_NexusAuthProvider.jsx.txt
-> src/nexus/auth/NexusAuthProvider.jsx

04_LoginPage.jsx.txt
-> src/nexus/pages/LoginPage.jsx

05_AccountAvatar.jsx.txt
-> src/nexus/components/AccountAvatar.jsx

06_NexusLoadingScreen.jsx.txt
-> src/nexus/components/NexusLoadingScreen.jsx

07_greeting.js.txt
-> src/nexus/utils/greeting.js

08_NexusApp.jsx.txt
-> src/nexus/NexusApp.jsx

09_nexus-main.jsx.txt
-> src/nexus/nexus-main.jsx

10_nexus.css.txt
-> src/nexus/styles/nexus.css


CREATE DIRECTORIES IF THEY DO NOT EXIST
---------------------------------------

mkdir -p src/nexus/auth
mkdir -p src/nexus/components
mkdir -p src/nexus/pages
mkdir -p src/nexus/services
mkdir -p src/nexus/styles
mkdir -p src/nexus/utils


FIREBASE PACKAGE
----------------

Verify:

npm ls firebase

If missing:

npm install firebase


FIREBASE PROJECT
----------------

Nexus must use the SAME Firebase project as the main Melogic website.
Do not create a separate Firebase project.

This implementation expects these Vite environment variables:

VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID

If your existing Melogic site already has a Firebase initialization module,
you may later change src/nexus/services/firebase.js to import/reuse it instead.


FIRESTORE PROFILE ASSUMPTION
----------------------------

Current assumed profile location:

users/{firebaseAuthUid}

If your production Melogic schema uses something else, edit ONLY:

src/nexus/services/account.js

The adapter currently recognizes common profile fields including:

firstName
firstname
lastName
lastname
displayName
name
photoURL
photoUrl
profilePicture
profilePictureUrl
avatarURL
avatarUrl

It also checks those fields under a nested `profile` object.

If none exist, Nexus falls back to Firebase Auth displayName/photoURL/email.


EXPECTED APPLICATION FLOW
-------------------------

Nexus starts
    ↓
Firebase checks for a persisted session
    ↓
Signed out?
    → Login page

Signed in?
    ↓
Firebase UID resolved
    ↓
Firestore profile loaded
    ↓
Nexus home

Examples:

Good afternoon, Gino.

Top-right:
[user profile photo]

Account menu:
Display name
Email
Account settings
Sign out


IMPORTANT SECURITY NOTE
-----------------------

Firebase web configuration is not a Firebase Admin credential.

Do NOT put:
- service-account JSON
- Firebase Admin private keys
- server private keys
- privileged backend secrets

inside Nexus frontend code or Vite environment variables.

Firestore access must remain protected by the same authentication/security
rules used by the rest of Melogic.


FIRST TEST
----------

After files are installed:

npx tauri dev

Expected behavior:

1. Nexus displays a startup/loading screen.
2. If no persisted session exists, login UI appears.
3. Enter an existing Melogic email/password account.
4. Firebase authenticates the user.
5. Nexus loads users/{uid}.
6. The dashboard appears.
7. The greeting and avatar come from real account data.
8. Restart Nexus and confirm the session persists.
9. Use the top-right account menu to sign out.


IMPORTANT NEXT VALIDATION
-------------------------

Before calling this production-ready, compare account.js against the REAL
Melogic Firestore user schema.

The current adapter is intentionally isolated so that schema corrections do
not require rewriting the auth provider or UI.
