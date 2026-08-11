import { doc, getDoc } from "firebase/firestore";

import { db } from "./firebase";

/*
  Central adapter between Nexus and Melogic's Firestore user schema.

  Current assumption:
    collection: users
    document ID: Firebase Auth UID

  If the production website uses a different path, change this file only.
*/

const USER_COLLECTION = "users";

function firstNonEmpty(...values) {
  return (
    values.find(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0,
    )?.trim() ?? null
  );
}

function deriveFirstName(displayName, email) {
  const cleanDisplayName = firstNonEmpty(displayName);

  if (cleanDisplayName) {
    return cleanDisplayName.split(/\s+/)[0];
  }

  const emailName = email?.split("@")[0]?.trim();

  if (emailName) {
    return emailName;
  }

  return "Creator";
}

function normalizeAccountProfile(
  firebaseUser,
  firestoreData = {},
) {
  const nestedProfile =
    firestoreData.profile &&
    typeof firestoreData.profile === "object"
      ? firestoreData.profile
      : {};

  const displayName = firstNonEmpty(
    firestoreData.displayName,
    firestoreData.name,
    nestedProfile.displayName,
    nestedProfile.name,
    firebaseUser.displayName,
  );

  const firstName = firstNonEmpty(
    firestoreData.firstName,
    firestoreData.firstname,
    nestedProfile.firstName,
    nestedProfile.firstname,
    deriveFirstName(displayName, firebaseUser.email),
  );

  const lastName = firstNonEmpty(
    firestoreData.lastName,
    firestoreData.lastname,
    nestedProfile.lastName,
    nestedProfile.lastname,
  );

  const photoURL = firstNonEmpty(
    firestoreData.photoURL,
    firestoreData.photoUrl,
    firestoreData.profilePicture,
    firestoreData.profilePictureUrl,
    firestoreData.avatarURL,
    firestoreData.avatarUrl,
    nestedProfile.photoURL,
    nestedProfile.photoUrl,
    nestedProfile.profilePicture,
    nestedProfile.profilePictureUrl,
    nestedProfile.avatarURL,
    nestedProfile.avatarUrl,
    firebaseUser.photoURL,
  );

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? null,
    emailVerified: Boolean(firebaseUser.emailVerified),

    displayName,
    firstName,
    lastName,
    photoURL,

    data: firestoreData,
  };
}

export async function loadAccountProfile(firebaseUser) {
  if (!firebaseUser) {
    return null;
  }

  if (!db) {
    return normalizeAccountProfile(firebaseUser);
  }

  try {
    const accountRef = doc(
      db,
      USER_COLLECTION,
      firebaseUser.uid,
    );

    const snapshot = await getDoc(accountRef);

    if (!snapshot.exists()) {
      console.warn(
        `[Nexus Account] No Firestore profile found for UID ${firebaseUser.uid}. Falling back to Firebase Auth profile.`,
      );

      return normalizeAccountProfile(firebaseUser);
    }

    return normalizeAccountProfile(
      firebaseUser,
      snapshot.data(),
    );
  } catch (error) {
    console.error(
      "[Nexus Account] Failed to load Firestore profile:",
      error,
    );

    return normalizeAccountProfile(firebaseUser);
  }
}
