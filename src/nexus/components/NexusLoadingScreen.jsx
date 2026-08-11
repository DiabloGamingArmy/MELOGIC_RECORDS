export default function NexusLoadingScreen({
  message = "Starting Nexus…",
}) {
  return (
    <main className="nexus-loading-screen">
      <div
        className="nexus-loading-mark"
        aria-hidden="true"
      >
        M
      </div>

      <div className="nexus-loading-copy">
        <span className="nexus-loading-title">
          Melogic Nexus
        </span>

        <span className="nexus-loading-message">
          {message}
        </span>
      </div>

      <div
        className="nexus-loading-track"
        aria-hidden="true"
      >
        <span />
      </div>
    </main>
  );
}
