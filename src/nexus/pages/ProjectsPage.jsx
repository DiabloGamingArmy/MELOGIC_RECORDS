import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getProjectRegistry,
  setProjectFavorite,
  subscribeProjectRegistry,
} from "../services/projectRegistry";

import "../styles/nexusProjects.css";

const FILTERS = [
  { id: "all", label: "All Projects" },
  { id: "favorites", label: "Favorites" },
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
];

const SORT_OPTIONS = [
  { id: "recent", label: "Recently modified" },
  { id: "name", label: "Name" },
  { id: "application", label: "Application" },
];

function getProjectTime(project) {
  const value = project.modifiedAt || project.createdAt;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getCloudLabel(project) {
  if (!project.cloud?.enabled) return "Local";

  switch (project.cloud.state) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing";
    case "conflict":
      return "Conflict";
    case "error":
      return "Sync error";
    default:
      return "Cloud";
  }
}

function ProjectThumbnail({ project, app }) {
  const [failed, setFailed] = useState(false);
  const thumbnail = project.thumbnailPath;

  if (thumbnail && !failed) {
    return (
      <div className="nexus-project-thumbnail">
        <img
          src={thumbnail}
          alt=""
          draggable="false"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="nexus-project-thumbnail nexus-project-thumbnail-fallback">
      {app?.icon ? (
        <img
          src={app.icon}
          alt=""
          draggable="false"
        />
      ) : (
        <span>
          {project.applicationName?.charAt(0)?.toUpperCase() || "M"}
        </span>
      )}
    </div>
  );
}

export default function ProjectsPage({
  apps,
  onOpenApplication,
}) {
  const [projects, setProjects] =
    useState(() => getProjectRegistry());

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [applicationFilter, setApplicationFilter] =
    useState("all");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    setProjects(getProjectRegistry());

    return subscribeProjectRegistry((nextProjects) => {
      setProjects(nextProjects);
    });
  }, []);

  const applicationsWithProjects = useMemo(() => {
    const ids = new Set(
      projects.map((project) => project.applicationId),
    );

    return apps.filter((app) => ids.has(app.id));
  }, [apps, projects]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const result = projects.filter((project) => {
      if (filter === "favorites" && !project.favorite) {
        return false;
      }

      if (filter === "local" && project.cloud?.enabled) {
        return false;
      }

      if (filter === "cloud" && !project.cloud?.enabled) {
        return false;
      }

      if (
        applicationFilter !== "all" &&
        project.applicationId !== applicationFilter
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      return [
        project.name,
        project.applicationName,
        project.projectPath,
        ...(project.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

    result.sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }

      if (sort === "application") {
        const byApp = a.applicationName.localeCompare(
          b.applicationName,
        );

        return byApp || a.name.localeCompare(b.name);
      }

      return getProjectTime(b) - getProjectTime(a);
    });

    return result;
  }, [
    projects,
    query,
    filter,
    applicationFilter,
    sort,
  ]);

  const favoriteCount = projects.filter(
    (project) => project.favorite,
  ).length;

  const cloudCount = projects.filter(
    (project) => project.cloud?.enabled,
  ).length;

  const handleFavorite = (event, project) => {
    event.stopPropagation();

    try {
      setProjectFavorite(project.id, !project.favorite);
    } catch (error) {
      console.error(
        "[Nexus Projects] Could not update favorite:",
        error,
      );
    }
  };

  const handleOpen = (project) => {
    const app = apps.find(
      (candidate) => candidate.id === project.applicationId,
    );

    if (!app) return;
    onOpenApplication(app);
  };

  return (
    <section className="nexus-projects-page">
      <div className="nexus-projects-heading">
        <div>
          <p className="nexus-section-label">
            Workspace
          </p>

          <h2>Projects</h2>

          <p>
            One place for projects across the Melogic creative suite.
          </p>
        </div>

        <div className="nexus-projects-summary">
          <div>
            <strong>{projects.length}</strong>
            <span>Total</span>
          </div>

          <div>
            <strong>{favoriteCount}</strong>
            <span>Favorites</span>
          </div>

          <div>
            <strong>{cloudCount}</strong>
            <span>Cloud</span>
          </div>
        </div>
      </div>

      <div className="nexus-projects-toolbar">
        <label className="nexus-projects-search">
          <span aria-hidden="true">⌕</span>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
          />
        </label>

        <select
          value={applicationFilter}
          onChange={(event) =>
            setApplicationFilter(event.target.value)
          }
          aria-label="Filter by application"
        >
          <option value="all">All applications</option>

          {applicationsWithProjects.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Sort projects"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className="nexus-projects-filterbar"
        role="tablist"
        aria-label="Project filters"
      >
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={
              filter === item.id
                ? "nexus-project-filter-active"
                : ""
            }
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visibleProjects.length > 0 ? (
        <div className="nexus-project-grid">
          {visibleProjects.map((project) => {
            const app = apps.find(
              (candidate) =>
                candidate.id === project.applicationId,
            );

            const legacy =
              project.metadata?.source ===
              "legacy-nexus-placeholder";

            return (
              <article
                className="nexus-project-card"
                key={project.id}
              >
                <ProjectThumbnail
                  project={project}
                  app={app}
                />

                <div className="nexus-project-card-body">
                  <div className="nexus-project-card-title-row">
                    <div>
                      <span className="nexus-project-app-name">
                        {project.applicationName}
                      </span>

                      <h3>{project.name}</h3>
                    </div>

                    <button
                      className={`nexus-project-favorite ${
                        project.favorite
                          ? "nexus-project-favorite-active"
                          : ""
                      }`}
                      type="button"
                      aria-label={
                        project.favorite
                          ? `Remove ${project.name} from favorites`
                          : `Add ${project.name} to favorites`
                      }
                      aria-pressed={project.favorite}
                      onClick={(event) =>
                        handleFavorite(event, project)
                      }
                    >
                      {project.favorite ? "★" : "☆"}
                    </button>
                  </div>

                  <div className="nexus-project-meta">
                    <span>{project.modifiedLabel}</span>

                    <span
                      className={`nexus-project-storage nexus-project-storage-${project.cloud?.state || "local"}`}
                    >
                      {getCloudLabel(project)}
                    </span>

                    {legacy ? (
                      <span className="nexus-project-demo-badge">
                        Placeholder
                      </span>
                    ) : null}
                  </div>

                  <div
                    className="nexus-project-path"
                    title={
                      project.projectPath ||
                      "Project path not registered yet"
                    }
                  >
                    {project.projectPath ||
                      "Project location will appear after discovery"}
                  </div>

                  <div className="nexus-project-card-footer">
                    <div className="nexus-project-tags">
                      {(project.tags || [])
                        .slice(0, 3)
                        .map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                    </div>

                    <button
                      type="button"
                      disabled={
                        !app || app.action === "Unavailable"
                      }
                      onClick={() => handleOpen(project)}
                    >
                      {app?.action === "Unavailable"
                        ? "Unavailable"
                        : `Open ${project.applicationName}`}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="nexus-projects-empty">
          <div
            className="nexus-projects-empty-icon"
            aria-hidden="true"
          >
            ◇
          </div>

          <h3>
            {projects.length === 0
              ? "No projects yet"
              : "No matching projects"}
          </h3>

          <p>
            {projects.length === 0
              ? "Projects created in Melogic applications will appear here."
              : "Try changing your search or project filters."}
          </p>

          {query ||
          filter !== "all" ||
          applicationFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
                setApplicationFilter("all");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
