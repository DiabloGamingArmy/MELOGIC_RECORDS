MELOGIC NEXUS + VERTIX PROJECT BROWSER v2
============================================

WHAT CHANGED
------------

1. Vertix project browser is now styled like the Studio shell:
   - edge-to-edge layout
   - minimal radii
   - thinner panel chrome
   - fixed application sidebar
   - content area uses the available window instead of floating in a card

2. Sitewide Melogic website header is removed ONLY in Nexus/Tauri:
   - web pages keep normal website navigation
   - desktop creative-app windows receive 100% of the native window

3. App icon system added:
   - same icon files are consumed by Nexus and Vertix
   - no duplicate icon asset directories

4. Nexus launch contract is explicit:
   - app card -> project browser
   - project browser -> selected/new project
   - project -> editor
   Nexus app cards NEVER open an editor directly.


CREATE THESE DIRECTORIES
------------------------

mkdir -p public/assets/app-icons
mkdir -p src/runtime


PLACE YOUR APP ICON PNG FILES HERE
----------------------------------

public/assets/app-icons/vertix.png
public/assets/app-icons/soura.png
public/assets/app-icons/cineara.png
public/assets/app-icons/inkora.png
public/assets/app-icons/lucentra.png
public/assets/app-icons/rundown-pilot.png

Recommended:
- PNG with transparent background
- square canvas (1:1)
- 512x512 or 1024x1024 source
- logo/icon should have breathing room inside the canvas
- do not bake a rounded card background into the PNG unless that is part
  of the actual product icon design


FILES
-----

01_NexusApp.jsx.txt
-> src/nexus/NexusApp.jsx

02_appLauncher.js.txt
-> src/nexus/services/appLauncher.js

03_nexusAppCatalog.css.txt
-> src/nexus/styles/nexusAppCatalog.css

04_applicationRuntime.js.txt
-> src/runtime/applicationRuntime.js

05_applicationSurface.css.txt
-> src/styles/applicationSurface.css

06_vertixProjectBrowser.css.txt
-> src/styles/vertixProjectBrowser.css

07_stageDashboard.js.txt
-> src/stage/app/stageDashboard.js

08_stage.html.txt
-> stage.html

09_studio-project.html.txt
-> studio-project.html


DESKTOP HEADER BEHAVIOR
-----------------------

applicationRuntime.js detects Tauri and adds:

html.melogic-desktop-app

applicationSurface.css then hides:

.nav-shell
.site-footer

This is superior to deleting navShell() from stage.js / studioProject.js
because the public web versions continue to have website navigation.

As additional creative app HTML entries are created, add the same two
pieces to them:

<link rel="stylesheet" href="/src/styles/applicationSurface.css" />

<script type="module" src="/src/runtime/applicationRuntime.js"></script>


TEST
----

Stop:
Control+C

Start:
npx tauri dev

Then:

1. Sign into Nexus.
2. Confirm app icons appear after placing PNGs.
3. Open Vertix.
4. Confirm NO website header appears in the Tauri Vertix window.
5. Confirm Vertix project browser fills the entire window.
6. Confirm the project browser appears BEFORE the editor.
7. Open an existing project.
8. Confirm the Vertix editor loads.
9. Return to a normal web page in Safari and confirm website navigation
   still exists.

The project browser rule should be treated as permanent architecture:
Nexus -> App Project Browser -> Project Editor.
