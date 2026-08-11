VERTIX PROJECT BROWSER — CONCEPT v3
==================================

FILES
-----

01_stageDashboard.js.txt
-> src/stage/app/stageDashboard.js

02_vertixProjectBrowser.css.txt
-> src/styles/vertixProjectBrowser.css


DESIGN CHANGES
--------------

The previous browser was visually noisy because every section used large
cards, metadata chips, strong borders, and equal visual weight.

This version changes hierarchy:

PRIMARY
  My Projects

SECONDARY
  Templates

TERTIARY
  Recent

Project cards now behave like files:
- thumbnail
- title
- type
- last activity / ownership
- overflow menu indicator

Removed from default card presentation:
- private badge
- share-ready badge
- large status chips
- repeated card metadata blocks

The top "Share status / Collaborators / Exports" dashboard strip has also
been removed. Those belong in project settings or contextual UI, not the
project browser's main hierarchy.

Sidebar:
- quieter
- narrower
- fixed application identity
- New Project remains prominent
- no large Share + Export informational card

Templates:
- compact strip instead of full dashboard cards
- intentionally secondary to the user's actual projects

Recent:
- compact and low-weight


NO BACKEND CHANGE
-----------------

This pass only changes render markup and CSS.
Existing data-stage-* event hooks remain on:
- New Project
- template creation
- project opening
- retry

Project creation/open behavior should continue using the existing stage.js
event system.


TEST
----

Restart or allow Vite hot reload.

Then:
1. Open Nexus
2. Open Vertix
3. Confirm My Projects is the first major section
4. Open an existing project
5. Create a project
6. Create from a template

If all three flows work, the browser redesign is behaviorally safe.
