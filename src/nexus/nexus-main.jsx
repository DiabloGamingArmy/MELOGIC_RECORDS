import React from "react";
import { createRoot } from "react-dom/client";

import NexusApp from "./NexusApp";
import { NexusAuthProvider } from "./auth/NexusAuthProvider";

import "./styles/nexus.css";

const root = createRoot(
  document.getElementById("nexus-root"),
);

root.render(
  <React.StrictMode>
    <NexusAuthProvider>
      <NexusApp />
    </NexusAuthProvider>
  </React.StrictMode>,
);
