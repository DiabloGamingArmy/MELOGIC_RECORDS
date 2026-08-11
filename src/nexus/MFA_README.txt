MELOGIC NEXUS — MFA / TOTP PATCH
=================================

This patch handles Firebase Authentication error:

auth/multi-factor-auth-required

It adds the Firebase MultiFactorResolver flow for enrolled TOTP
(authenticator-app) factors.

FILES
-----

01_NexusAuthProvider_MFA.jsx.txt
-> Replace:
   src/nexus/auth/NexusAuthProvider.jsx

02_LoginPage_MFA.jsx.txt
-> Replace:
   src/nexus/pages/LoginPage.jsx

03_nexus_mfa_css_patch.txt
-> APPEND to:
   src/nexus/styles/nexus.css


BEHAVIOR
--------

1. User enters email/password.
2. Firebase accepts primary credentials.
3. If MFA is required, Firebase throws:
      auth/multi-factor-auth-required
4. Nexus creates a MultiFactorResolver.
5. Login UI changes to:
      Verify it's you
      Verification code [______]
6. User enters current authenticator TOTP.
7. Nexus creates a TOTP MFA assertion.
8. Firebase resolver completes sign-in.
9. Existing auth observer continues into:
      account profile -> dashboard


SUPPORTED IN THIS PATCH
-----------------------

- TOTP / authenticator-app MFA
- Multiple enrolled TOTP factors
- Invalid/expired verification-code errors
- Back/cancel to primary login
- one-time-code autocomplete hint
- Numeric sanitization
- No local storage of the OTP

NOT YET IMPLEMENTED
-------------------

- SMS / phone MFA challenge sending
- MFA enrollment inside Nexus
- recovery-factor management

If resolver.hints reports PhoneMultiFactorGenerator rather than TOTP,
this patch intentionally shows an unsupported-factor error rather than
attempting an incomplete phone verification flow.


TEST
----

Restart Nexus:

npx tauri dev

Then:

1. Enter your existing Melogic email/password.
2. Instead of seeing auth/multi-factor-auth-required as an error,
   the login panel should change to "Verify it's you".
3. Enter the current code from your authenticator.
4. Click "Verify and continue".
5. The authenticated Nexus dashboard should load.
