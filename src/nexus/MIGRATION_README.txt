MELOGIC VERTIX — ROUTE + BRAND MIGRATION v1
===============================================

GOAL
----
Canonicalize the former Stage / StageMaker public experience as Vertix
without renaming internal stage-engine data structures yet.

CANONICAL PUBLIC ROUTES
-----------------------
Vertix dashboard:
  /vertix

Vertix project:
  /vertix/project/<PROJECT_ID>

LEGACY ROUTES
-------------
These remain compatibility inputs and route to Vertix:
  /stage.html
  /stage
  /studio/stagemaker
  /studio/stagemaker/project/<PROJECT_ID>

FILES AND DESTINATIONS
----------------------

01_routes.js.txt
-> src/utils/routes.js

02_stageDashboard.js.txt
-> src/stage/app/stageDashboard.js

03_stage.html.txt
-> stage.html

04_legacyBrandingGuard.js.txt
-> src/vertix/branding/legacyBrandingGuard.js

05_siteFooter.js.txt
-> src/components/siteFooter.js

06_firebase.json.txt
-> firebase.json


DIRECTORY TO CREATE
-------------------
mkdir -p src/vertix/branding


WHY INTERNAL "stagemaker" IDS ARE STILL PRESENT
------------------------------------------------
This migration intentionally does NOT rename compatibility-sensitive
identifiers such as:

- Firestore stageProjects
- existing stage-engine JavaScript symbols
- stage CSS class names
- stage.html filename
- internal Resona/site-guidance context IDs using "stagemaker"
- historical localStorage keys

Those are implementation identifiers, not public product branding.

Changing those at the same time as the route migration would unnecessarily
expand the blast radius and could break saved projects, Resona context,
guidance, or persistence.


BRANDING GUARD
--------------
legacyBrandingGuard.js is presentation-only. It catches a narrow list of
known legacy StageMaker display phrases emitted by deeper modules and
changes them to Vertix without mutating IDs, data attributes, or project
data.

It intentionally does NOT do a blind global string replace.


IMPORTANT PROJECT-ID COMPATIBILITY
----------------------------------
The existing stageState project parser still has historical StageMaker
pathname checks. For this first migration, stageProjectRoute() includes a
temporary ?projectId=<id> compatibility parameter.

This means:
  /vertix/project/ABC?projectId=ABC

The visible product route is Vertix immediately. A later cleanup can update
stageState's parser and remove the query parameter after the new route has
been proven stable.


TEST ORDER
----------
1. Stop the running Tauri/Vite process:
   Ctrl+C

2. Ensure port 5173 is clear:
   lsof -i :5173

3. Start Nexus:
   npx tauri dev

4. From Nexus, open Vertix.

5. Confirm the dashboard now says:
   VERTIX
   Vertix Projects
   My Vertix Projects

6. Create/open a project.

7. Confirm the pathname uses:
   /vertix/project/<id>

8. Reload that project window and confirm it still resolves.

9. Browser test:
   http://localhost:5173/vertix

10. Legacy compatibility test:
   http://localhost:5173/studio/stagemaker

   In Vite dev, redirects are not applied by the custom plugin; the legacy
   rewrite remains so the old URL can still load during local development.
   Firebase Hosting will apply the 301 redirects after deployment.


DO NOT DEPLOY IMMEDIATELY
-------------------------
Test locally first. This migration changes public routing and Firebase
Hosting behavior. Once local project creation/open/reload is confirmed,
then deploy Hosting.

Recommended local validation:
  npm run build

If build passes and local Vertix navigation is correct, then deploy when
you are ready.
