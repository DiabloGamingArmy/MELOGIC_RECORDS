# A01 licensing permission hotfix

Baseline: `9b065cac4b2a847dbc0db5d555a3fb65d2b282d7`; existing branch
`mct-origami-nodes-visual-feedback-p03`, initially clean.

1. **Exact root cause:** The License Keys route called frontend `can('settingsManage')`,
   which checked only `state.claims.settingsManage === true`. Its owner fallback
   applied only to emailSend. The backend already derived settingsManage from the
   owner role. The denied component emitted adjacent inline `<strong>`/`<span>`
   nodes, directly showing the internal permission ID without spacing.
2. **Why owner failed:** `admin: true`/`adminRole: owner` was enough to display the
   ADMIN/owner identity but not enough for that frontend guard unless an explicit
   true settingsManage claim was also present. Regression uses exactly this legacy
   token shape; no personal UID/email exception or production account edit.
3. **Why settingsManage appeared:** A01 incorrectly reused the Settings capability
   for licensing. It was a source integration error, not a missing product or role seed.
4. **Selected permission:** `licensesManage`, added to the existing code-defined
   admin claim registry and role defaults. Existing admin claim names/conventions
   retained. One shared registry feeds both sides; no parallel role system.
5. **Frontend:** Shared resolver replaces raw-claim-only can(). License Keys
   sidebar/route/component and Users Manage Products use licensesManage. All
   registered permissions resolve consistently with backend role fallback.
6. **Backend:** All eight licensing callables require licensesManage for reads
   and mutations. Current Auth claims, disabled/revoked session checks, active
   admin metadata, verified email, enrolled MFA and mutation step-up remain.
7. **Roles/owner:** Owner inherits all registered capabilities through the canonical
   registry wildcard; admin explicitly includes licensesManage. Restricted roles
   do not acquire licensing via Settings. Existing claim build/strip/reassignment
   includes the new key. Owner still requires authenticated admin authority.
   Firestore roleDefinitions/users.roles/profiles.badges are not admin permissions.
8. **Migration/seed:** No user/role/permission migration or Firestore seed required.
   Owner/admin inherit through role resolution even without a new token boolean.
   No undocumented manual document construction is needed.
9. **Origami product:** Firebase deploy does not provision products/origami.
   An authenticated read-only production check failed (reported status 500), so current
   existence is unverified. Empty catalog explicitly shows No products configured
   and offers + Product with Origami/Beta defaults through the existing trusted,
   transactional setup operation. Permission checks are independent of catalog state.
10. **Error rendering:** Generic permissionState now supplies a human explanation
    in its own paragraph; alert layout forces separate rows. Internal permission
    IDs and arbitrary input are not echoed. Other admin pages use the same fix.
11. **Owner regressions:** Role-only owner frontend guard passes; actual production
    callable handlers pass all eight operations with real Firestore emulator data
    and a test-only Auth/MFA fixture. Owner, admin and specifically authorized support
    grant/revoke/re-grant, generate/redeem and revoke keys successfully.
12. **Restricted identities:** Restricted support, Settings-only staff, ordinary users,
    forged permission without admin, signed-out, disabled and removed admins are
    rejected. All eight production handlers tested directly for denial. Frontend
    policy matches backend for every registered permission and supported role.
13. **License Keys tests:** Legacy owner reaches generation form with Product,
    Edition, Quantity, Redemptions/key, Expiration and Campaign; existing one-time
    display/Copy All/masked list/key-revoke tests pass. Empty catalog setup tested.
14. **Manage Products tests:** Actual existing menu retains other actions; canonical
    owner access opens grant, confirmation, revoke and re-grant controls. Backend
    ownership/auth transitions also pass through the actual callable handlers.
15. **Results:** Frontend/admin permission and UI: 9/9. Firestore rules: 10/10.
    Backend emulator licensing/owner/role suites: 24/24; separate existing desktop
    auth emulator suite: 3/3. Zero skips in these targeted runs. Config check and
    Vite production build pass; existing chunk-size advisory remains. Full Functions:
    126 total, 121 pass, one unchanged pre-existing musicDistribution assertion,
    four emulator-only skips separately exercised above. No Origami native source
    changes; no production UI acceptance or production license issuance claimed.
16. **Redeployment:** Hosting web plus eight licensing Functions and setAdminUserRole.
    The latter must ship so future role demotions strip licensesManage. Exact
    scoped command in [administration guide](../../licensing-administration.md).
    No Firestore rules/index changes or other production components required here.
17. **After deploy:** No bootstrap command or account migration. Refresh the page.
    If no product exists, License Keys → + Product → default Origami/Beta → Save.
    This is the documented, server-authorized setup UI, not a Firestore console edit.
18. **Commit:** Fix/tests/docs committed and pushed; exact hash in delivery response.

No production deploy or data mutation performed. No security rule relaxation,
credential/key disclosure, UID-specific bypass or shipped Auth fixture. The
separate account-Service P0 crash and L02 activation work remain unchanged.
