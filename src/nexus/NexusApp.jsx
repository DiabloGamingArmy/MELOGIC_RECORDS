import { useState } from "react";

import { useNexusAuth } from "./auth/NexusAuthProvider";
import AccountAvatar from "./components/AccountAvatar";
import NexusLoadingScreen from "./components/NexusLoadingScreen";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import { launchMelogicApp } from "./services/appLauncher";
import { getRecentProjects } from "./services/projectRegistry";
import "./styles/nexusAppCatalog.css";
import { getTimeGreeting } from "./utils/greeting";

const APP_ICON_ROOT = "/assets/app-icons";

const navigationItems = [
  "Home",
  "Apps",
  "Projects",
  "Library",
  "Downloads",
];

const apps = [
  {
    id: "vertix",
    name: "Vertix",
    category: "3D & Animation",
    status: "Beta",
    version: "v0.0",
    action: "Open",
    accent: "V",
    icon: `${APP_ICON_ROOT}/vertix.png`,
  },
  {
    id: "soura",
    name: "Soura",
    category: "Audio Production",
    status: "Available",
    version: "Web",
    action: "Open",
    accent: "S",
    icon: `${APP_ICON_ROOT}/soura.png`,
  },
  {
    id: "cineara",
    name: "Cineara",
    category: "Video Editing",
    status: "Coming Soon",
    version: "—",
    action: "Unavailable",
    accent: "C",
    icon: `${APP_ICON_ROOT}/cineara.png`,
  },
  {
    id: "inkora",
    name: "Inkora",
    category: "Graphics & Artwork",
    status: "Coming Soon",
    version: "—",
    action: "Unavailable",
    accent: "I",
    icon: `${APP_ICON_ROOT}/inkora.png`,
  },
  {
    id: "lucentra",
    name: "Lucentra",
    category: "Live Performance",
    status: "Coming Soon",
    version: "—",
    action: "Unavailable",
    accent: "L",
    icon: `${APP_ICON_ROOT}/lucentra.png`,
  },
  {
    id: "rundown-pilot",
    name: "Rundown Pilot",
    category: "Show Control",
    status: "Coming Soon",
    version: "—",
    action: "Unavailable",
    accent: "R",
    icon: `${APP_ICON_ROOT}/rundown-pilot.png`,
  },
];

function AppIcon({
  app,
  className = "",
  fallbackClassName = "",
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`nexus-product-icon ${className}`.trim()}
      aria-hidden="true"
    >
      {!failed ? (
        <img
          src={app.icon}
          alt=""
          draggable="false"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={`nexus-product-icon-fallback ${fallbackClassName}`.trim()}
        >
          {app.accent}
        </span>
      )}
    </span>
  );
}

export default function NexusApp() {
  const {
    account,
    authLoading,
    accountLoading,
    isAuthenticated,
    logout,
  } = useNexusAuth();

  const [activeNav, setActiveNav] =
    useState("Home");

  const [accountMenuOpen, setAccountMenuOpen] =
    useState(false);

  const [appSearch, setAppSearch] =
    useState("");

  const [launchingApp, setLaunchingApp] =
    useState(null);

  const [launchError, setLaunchError] =
    useState(null);

  if (authLoading) {
    return (
      <NexusLoadingScreen message="Checking your Melogic session…" />
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (accountLoading || !account) {
    return (
      <NexusLoadingScreen message="Loading your Melogic account…" />
    );
  }

  const firstName =
    account.firstName || "Creator";

  const greeting = getTimeGreeting();

  const recentProjects = getRecentProjects({ limit: 8 });

  const normalizedAppSearch =
    appSearch.trim().toLowerCase();

  const filteredApps = normalizedAppSearch
    ? apps.filter((app) =>
        [
          app.name,
          app.category,
          app.status,
          app.version,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedAppSearch),
      )
    : apps;

  const handleLogout = async () => {
    setAccountMenuOpen(false);

    try {
      await logout();
    } catch (error) {
      console.error(
        "[Nexus] Logout failed:",
        error,
      );
    }
  };

  const handleLaunchApp = async (app) => {
    if (app.action === "Unavailable") {
      return;
    }

    setLaunchError(null);
    setLaunchingApp(app.id);

    try {
      /*
        Global Nexus rule:
        launchMelogicApp() always opens an application's project browser.
        A project browser is responsible for creating/opening the actual
        editor workspace after a project is selected.
      */
      await launchMelogicApp(app.id);
    } catch (error) {
      console.error(
        `[Nexus] Failed to launch ${app.name}:`,
        error,
      );

      setLaunchError(
        error?.message ||
          `Nexus could not launch ${app.name}.`,
      );
    } finally {
      setLaunchingApp(null);
    }
  };

  return (
    <div className="nexus-app">
      <aside className="nexus-sidebar">
        <div className="nexus-brand">
          <div
            className="nexus-brand-mark"
            aria-hidden="true"
          >
            M
          </div>

          <div className="nexus-brand-copy">
            <span className="nexus-brand-company">
              Melogic
            </span>

            <span className="nexus-brand-product">
              Nexus
            </span>
          </div>
        </div>

        <nav
          className="nexus-nav"
          aria-label="Nexus navigation"
        >
          {navigationItems.map((item) => {
            const active = activeNav === item;

            return (
              <button
                key={item}
                className={`nexus-nav-item ${
                  active
                    ? "nexus-nav-item-active"
                    : ""
                }`}
                type="button"
                aria-current={
                  active ? "page" : undefined
                }
                onClick={() =>
                  setActiveNav(item)
                }
              >
                <span className="nexus-nav-label">
                  {item}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="nexus-sidebar-footer">
          <button
            className={`nexus-nav-item ${
              activeNav === "Settings"
                ? "nexus-nav-item-active"
                : ""
            }`}
            type="button"
            aria-current={
              activeNav === "Settings"
                ? "page"
                : undefined
            }
            onClick={() =>
              setActiveNav("Settings")
            }
          >
            <span className="nexus-nav-label">
              Settings
            </span>
          </button>

          <div className="nexus-runtime-status">
            <span
              className="nexus-status-light"
              aria-hidden="true"
            />

            <div>
              <span className="nexus-runtime-label">
                Runtime
              </span>

              <span className="nexus-runtime-value">
                Nexus Desktop
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="nexus-main">
        <header className="nexus-topbar">
          <div className="nexus-topbar-greeting">
            <p className="nexus-overline">
              Melogic Studio
            </p>

            <h1>
              {greeting}, {firstName}.
            </h1>
          </div>

          <div className="nexus-topbar-actions">
            <label className="nexus-search">
              <span
                className="nexus-search-icon"
                aria-hidden="true"
              >
                ⌕
              </span>

              <input
                type="search"
                value={appSearch}
                onChange={(event) =>
                  setAppSearch(event.target.value)
                }
                placeholder="Search apps, projects, or resources…"
                aria-label="Search Nexus applications"
              />
            </label>

            <div className="nexus-account-area">
              <div className="nexus-system-status">
                <span
                  className="nexus-status-light"
                  aria-hidden="true"
                />
                Nexus Ready
              </div>

              <div className="nexus-account-menu-container">
                <button
                  className="nexus-account-button"
                  type="button"
                  aria-label="Open account menu"
                  aria-expanded={accountMenuOpen}
                  onClick={() =>
                    setAccountMenuOpen((open) => !open)
                  }
                >
                  <AccountAvatar account={account} />
                </button>

                {accountMenuOpen ? (
                  <div className="nexus-account-menu">
                    <div className="nexus-account-menu-profile">
                      <AccountAvatar
                        account={account}
                        size="large"
                      />

                      <div>
                        <strong>
                          {account.displayName ||
                            firstName}
                        </strong>

                        <span>
                          {account.email}
                        </span>
                      </div>
                    </div>

                    <div className="nexus-account-menu-divider" />

                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setActiveNav("Settings");
                      }}
                    >
                      Account settings
                    </button>

                    <button
                      className="nexus-account-menu-signout"
                      type="button"
                      onClick={handleLogout}
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {activeNav === "Projects" ? (
          <ProjectsPage
            apps={apps}
            onOpenApplication={handleLaunchApp}
          />
        ) : (
          <>
        <section className="nexus-hero">
          <div className="nexus-hero-content">
            <p className="nexus-section-label">
              The Creative Suite
            </p>

            <h2>
              Everything you need
              <br />
              to make what’s next.
            </h2>

            <p className="nexus-hero-description">
              Powerful tools. A unified workflow.
              Built for creators.
            </p>
          </div>
        </section>

        <section className="nexus-section nexus-applications-section">
          <div className="nexus-section-heading">
            <div>
              <p className="nexus-section-label">
                Applications
              </p>

              <h3>Your Creative Suite</h3>
            </div>

            <button
              className="nexus-text-button"
              type="button"
              onClick={() =>
                setActiveNav("Projects")
              }
            >
              View all
            </button>
          </div>

          {launchError ? (
            <div
              className="nexus-launch-error"
              role="alert"
            >
              {launchError}
            </div>
          ) : null}

          <div className="nexus-app-grid">
            {filteredApps.map((app) => {
              const unavailable =
                app.action === "Unavailable";

              return (
                <article
                  className={`nexus-app-card ${
                    unavailable
                      ? "nexus-app-card-disabled"
                      : ""
                  }`}
                  key={app.id}
                >
                  <div className="nexus-app-card-top">
                    <AppIcon
                      app={app}
                      className="nexus-app-icon"
                    />

                    <span className="nexus-app-status">
                      {app.status}
                    </span>
                  </div>

                  <div className="nexus-app-card-copy">
                    <h4>{app.name}</h4>
                    <p>{app.category}</p>

                    {!unavailable ? (
                      <span className="nexus-app-launch-target">
                        Opens project browser
                      </span>
                    ) : null}
                  </div>

                  <div className="nexus-app-card-footer">
                    <span className="nexus-app-version">
                      {app.version}
                    </span>

                    <button
                      type="button"
                      disabled={
                        unavailable ||
                        launchingApp === app.id
                      }
                      onClick={() =>
                        handleLaunchApp(app)
                      }
                    >
                      {launchingApp === app.id
                        ? "Opening…"
                        : app.action}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredApps.length === 0 ? (
            <div className="nexus-search-empty">
              No Melogic applications match “{appSearch}”.
            </div>
          ) : null}
        </section>

        <section className="nexus-section nexus-workspace-section">
          <div className="nexus-section-heading">
            <div>
              <p className="nexus-section-label">
                Workspace
              </p>

              <h3>Recent Projects</h3>
            </div>
          </div>

          <div className="nexus-recent-list">
            {recentProjects.map((project) => {
              const app =
                apps.find(
                  (candidate) =>
                    candidate.id === project.applicationId,
                ) || apps[0];

              return (
                <button
                  className="nexus-recent-row"
                  type="button"
                  key={project.id}
                >
                  <AppIcon
                    app={app}
                    className="nexus-recent-icon"
                  />

                  <div className="nexus-recent-copy">
                    <span className="nexus-recent-name">
                      {project.name}
                    </span>

                    <span className="nexus-recent-meta">
                      {project.applicationName} · {project.modifiedLabel}
                    </span>
                  </div>

                  <span
                    className="nexus-recent-arrow"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </button>
              );
            })}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
