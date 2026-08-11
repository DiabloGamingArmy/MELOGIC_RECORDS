import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import { app } from "../../firebase/firebaseConfig.js";

// Nexus reuses the existing Melogic Firebase application.
export const firebaseApp = app;

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export const firebaseConfigurationReady = true;
export const firebaseConfigurationError = null;

// Keep the user signed in between Nexus launches.
export const firebasePersistenceReady = setPersistence(
  auth,
  browserLocalPersistence,
).catch((error) => {
  console.error(
    "[Nexus Auth] Failed to enable Firebase local persistence:",
    error,
  );
});