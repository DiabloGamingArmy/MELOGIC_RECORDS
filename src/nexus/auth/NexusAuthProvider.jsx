import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getMultiFactorResolver,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
} from "firebase/auth";

import {
  auth,
  firebaseConfigurationError,
  firebaseConfigurationReady,
  firebasePersistenceReady,
} from "../services/firebase";

import { loadAccountProfile } from "../services/account";

const NexusAuthContext = createContext(null);

function normalizeFirebaseAuthError(error) {
  const code = error?.code ?? "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password is incorrect.";

    case "auth/invalid-email":
      return "Enter a valid email address.";

    case "auth/user-disabled":
      return "This Melogic account has been disabled.";

    case "auth/too-many-requests":
      return "Too many sign-in attempts. Try again later.";

    case "auth/network-request-failed":
      return "Nexus could not reach Firebase. Check your network connection.";

    case "auth/missing-password":
      return "Enter your password.";

    case "auth/invalid-verification-code":
      return "That verification code is invalid. Try the newest code from your authenticator.";

    case "auth/code-expired":
      return "That verification code expired. Enter the newest code from your authenticator.";

    default:
      return (
        error?.message ||
        "Nexus could not complete authentication."
      );
  }
}

function describeFactor(hint, index) {
  const displayName =
    typeof hint?.displayName === "string" &&
    hint.displayName.trim()
      ? hint.displayName.trim()
      : null;

  return {
    index,
    uid: hint?.uid ?? null,
    factorId: hint?.factorId ?? null,
    displayName:
      displayName || `Authenticator ${index + 1}`,
  };
}

export function NexusAuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] =
    useState(null);

  const [account, setAccount] = useState(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [accountLoading, setAccountLoading] =
    useState(false);

  const [authError, setAuthError] = useState(
    firebaseConfigurationReady
      ? null
      : firebaseConfigurationError,
  );

  /*
    MFA state intentionally lives only in memory.

    The MultiFactorResolver represents an in-progress sign-in attempt.
    It should not be persisted to localStorage or disk.
  */
  const [mfaResolver, setMfaResolver] =
    useState(null);

  const [mfaFactors, setMfaFactors] =
    useState([]);

  const [mfaEmail, setMfaEmail] =
    useState(null);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return undefined;
    }

    let alive = true;
    let unsubscribe;

    const startAuthObserver = async () => {
      await firebasePersistenceReady;

      if (!alive) {
        return;
      }

      unsubscribe = onAuthStateChanged(
        auth,
        async (user) => {
          if (!alive) {
            return;
          }

          setFirebaseUser(user);
          setAuthError(null);

          if (!user) {
            setAccount(null);
            setAccountLoading(false);
            setAuthLoading(false);
            return;
          }

          /*
            A completed sign-in invalidates any pending MFA challenge.
          */
          setMfaResolver(null);
          setMfaFactors([]);
          setMfaEmail(null);

          setAccountLoading(true);

          const profile =
            await loadAccountProfile(user);

          if (!alive) {
            return;
          }

          setAccount(profile);
          setAccountLoading(false);
          setAuthLoading(false);
        },
        (error) => {
          if (!alive) {
            return;
          }

          console.error(
            "[Nexus Auth] Auth observer failed:",
            error,
          );

          setAuthError(
            normalizeFirebaseAuthError(error),
          );

          setAccount(null);
          setFirebaseUser(null);
          setAccountLoading(false);
          setAuthLoading(false);
        },
      );
    };

    startAuthObserver();

    return () => {
      alive = false;

      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const login = useCallback(
    async ({ email, password }) => {
      if (!auth) {
        throw new Error(
          firebaseConfigurationError ||
            "Firebase is not configured.",
        );
      }

      setAuthError(null);

      /*
        Clear an abandoned challenge before beginning
        a fresh primary-factor login.
      */
      setMfaResolver(null);
      setMfaFactors([]);
      setMfaEmail(null);

      try {
        await firebasePersistenceReady;

        const credential =
          await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );

        return {
          credential,
          mfaRequired: false,
        };
      } catch (error) {
        if (
          error?.code ===
          "auth/multi-factor-auth-required"
        ) {
          const resolver =
            getMultiFactorResolver(auth, error);

          const factors = resolver.hints.map(
            (hint, index) =>
              describeFactor(hint, index),
          );

          setMfaResolver(resolver);
          setMfaFactors(factors);
          setMfaEmail(email.trim());

          /*
            This is not a failed login. The first factor was
            accepted and Firebase is asking for the enrolled MFA factor.
          */
          return {
            credential: null,
            mfaRequired: true,
            factors,
          };
        }

        const normalized =
          normalizeFirebaseAuthError(error);

        setAuthError(normalized);

        throw new Error(normalized);
      }
    },
    [],
  );

  const completeTotpMfa = useCallback(
    async ({
      verificationCode,
      factorIndex = 0,
    }) => {
      if (!mfaResolver) {
        throw new Error(
          "There is no active two-factor authentication challenge. Sign in again.",
        );
      }

      const code =
        verificationCode.trim();

      if (!code) {
        throw new Error(
          "Enter the verification code from your authenticator app.",
        );
      }

      const hint =
        mfaResolver.hints[factorIndex];

      if (!hint) {
        throw new Error(
          "That authentication factor is no longer available. Sign in again.",
        );
      }

      if (
        hint.factorId !==
        TotpMultiFactorGenerator.FACTOR_ID
      ) {
        throw new Error(
          "This Nexus build currently supports authenticator-app TOTP codes for two-factor sign-in. This account is requesting a different MFA method.",
        );
      }

      setAuthError(null);

      try {
        const assertion =
          TotpMultiFactorGenerator.assertionForSignIn(
            hint.uid,
            code,
          );

        const credential =
          await mfaResolver.resolveSignIn(
            assertion,
          );

        setMfaResolver(null);
        setMfaFactors([]);
        setMfaEmail(null);

        return credential;
      } catch (error) {
        const normalized =
          normalizeFirebaseAuthError(error);

        setAuthError(normalized);

        throw new Error(normalized);
      }
    },
    [mfaResolver],
  );

  const cancelMfa = useCallback(() => {
    setMfaResolver(null);
    setMfaFactors([]);
    setMfaEmail(null);
    setAuthError(null);
  }, []);

  const logout = useCallback(async () => {
    if (!auth) {
      return;
    }

    setAuthError(null);
    cancelMfa();

    try {
      await signOut(auth);
    } catch (error) {
      const normalized =
        normalizeFirebaseAuthError(error);

      setAuthError(normalized);

      throw new Error(normalized);
    }
  }, [cancelMfa]);

  const resetPassword = useCallback(
    async (email) => {
      if (!auth) {
        throw new Error(
          firebaseConfigurationError ||
            "Firebase is not configured.",
        );
      }

      const trimmedEmail = email.trim();

      if (!trimmedEmail) {
        throw new Error(
          "Enter your email address first.",
        );
      }

      try {
        await sendPasswordResetEmail(
          auth,
          trimmedEmail,
        );
      } catch (error) {
        throw new Error(
          normalizeFirebaseAuthError(error),
        );
      }
    },
    [],
  );

  const refreshAccount =
    useCallback(async () => {
      if (!firebaseUser) {
        setAccount(null);
        return null;
      }

      setAccountLoading(true);

      try {
        const profile =
          await loadAccountProfile(
            firebaseUser,
          );

        setAccount(profile);

        return profile;
      } finally {
        setAccountLoading(false);
      }
    }, [firebaseUser]);

  const value = useMemo(
    () => ({
      firebaseUser,
      account,

      isAuthenticated:
        Boolean(firebaseUser),

      authLoading,
      accountLoading,
      authError,

      firebaseConfigurationReady,

      /*
        MFA
      */
      mfaRequired:
        Boolean(mfaResolver),
      mfaFactors,
      mfaEmail,

      login,
      completeTotpMfa,
      cancelMfa,

      logout,
      resetPassword,
      refreshAccount,
    }),
    [
      firebaseUser,
      account,
      authLoading,
      accountLoading,
      authError,
      mfaResolver,
      mfaFactors,
      mfaEmail,
      login,
      completeTotpMfa,
      cancelMfa,
      logout,
      resetPassword,
      refreshAccount,
    ],
  );

  return (
    <NexusAuthContext.Provider value={value}>
      {children}
    </NexusAuthContext.Provider>
  );
}

export function useNexusAuth() {
  const context =
    useContext(NexusAuthContext);

  if (!context) {
    throw new Error(
      "useNexusAuth must be used inside NexusAuthProvider.",
    );
  }

  return context;
}
