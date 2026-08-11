import { useEffect, useRef, useState } from "react";

import { useNexusAuth } from "../auth/NexusAuthProvider";

export default function LoginPage() {
  const {
    login,
    completeTotpMfa,
    cancelMfa,
    resetPassword,
    authError,
    firebaseConfigurationReady,
    mfaRequired,
    mfaFactors,
    mfaEmail,
  } = useNexusAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] =
    useState("");

  const [verificationCode, setVerificationCode] =
    useState("");

  const [selectedFactorIndex, setSelectedFactorIndex] =
    useState(0);

  const [submitting, setSubmitting] =
    useState(false);

  const [localError, setLocalError] =
    useState(null);

  const [notice, setNotice] =
    useState(null);

  const mfaInputRef = useRef(null);

  useEffect(() => {
    if (!mfaRequired) {
      setVerificationCode("");
      setSelectedFactorIndex(0);
      return;
    }

    const timer = window.setTimeout(() => {
      mfaInputRef.current?.focus();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [mfaRequired]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setLocalError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setLocalError(
        "Enter your email and password.",
      );
      return;
    }

    setSubmitting(true);

    try {
      const result = await login({
        email,
        password,
      });

      if (result?.mfaRequired) {
        setNotice(null);
      }
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (event) => {
    event.preventDefault();

    setLocalError(null);
    setNotice(null);

    const code =
      verificationCode
        .replace(/\s+/g, "")
        .trim();

    if (!code) {
      setLocalError(
        "Enter your verification code.",
      );
      return;
    }

    setSubmitting(true);

    try {
      await completeTotpMfa({
        verificationCode: code,
        factorIndex: selectedFactorIndex,
      });
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    setLocalError(null);
    setNotice(null);

    try {
      await resetPassword(email);

      setNotice(
        "Password reset email sent. Check your inbox.",
      );
    } catch (error) {
      setLocalError(error.message);
    }
  };

  const handleBackToPassword = () => {
    cancelMfa();

    setVerificationCode("");
    setLocalError(null);
    setNotice(null);
  };

  const visibleError =
    localError || authError;

  return (
    <main className="nexus-auth-screen">
      <section className="nexus-auth-visual">
        <div className="nexus-auth-visual-inner">
          <div
            className="nexus-auth-energy-mark"
            aria-hidden="true"
          >
            <span>M</span>
          </div>

          <p className="nexus-section-label">
            Melogic Studio
          </p>

          <h1>
            Your creative suite,
            <br />
            on your desktop.
          </h1>

          <p className="nexus-auth-visual-copy">
            Nexus connects your Melogic account,
            applications, projects, and local
            workstation capabilities.
          </p>
        </div>
      </section>

      <section className="nexus-auth-panel">
        <div className="nexus-auth-card">
          <div className="nexus-auth-brand">
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

          {!mfaRequired ? (
            <>
              <div className="nexus-auth-heading">
                <p className="nexus-section-label">
                  Account
                </p>

                <h2>Sign in to Nexus</h2>

                <p>
                  Use the same Melogic account you
                  use on melogicrecords.studio.
                </p>
              </div>

              {!firebaseConfigurationReady ? (
                <div className="nexus-auth-message nexus-auth-message-error">
                  Nexus cannot initialize Firebase
                  because its Firebase
                  configuration is unavailable.
                </div>
              ) : null}

              {visibleError ? (
                <div
                  className="nexus-auth-message nexus-auth-message-error"
                  role="alert"
                >
                  {visibleError}
                </div>
              ) : null}

              {notice ? (
                <div
                  className="nexus-auth-message nexus-auth-message-success"
                  role="status"
                >
                  {notice}
                </div>
              ) : null}

              <form
                className="nexus-auth-form"
                onSubmit={handleSubmit}
              >
                <label className="nexus-auth-field">
                  <span>Email</span>

                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    disabled={
                      submitting ||
                      !firebaseConfigurationReady
                    }
                    onChange={(event) =>
                      setEmail(
                        event.target.value,
                      )
                    }
                    placeholder="you@example.com"
                  />
                </label>

                <label className="nexus-auth-field">
                  <span>Password</span>

                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    disabled={
                      submitting ||
                      !firebaseConfigurationReady
                    }
                    onChange={(event) =>
                      setPassword(
                        event.target.value,
                      )
                    }
                    placeholder="Enter your password"
                  />
                </label>

                <div className="nexus-auth-options">
                  <span>
                    Your session stays signed in on
                    this device.
                  </span>

                  <button
                    className="nexus-auth-link"
                    type="button"
                    disabled={submitting}
                    onClick={
                      handleResetPassword
                    }
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  className="nexus-auth-submit"
                  type="submit"
                  disabled={
                    submitting ||
                    !firebaseConfigurationReady
                  }
                >
                  {submitting
                    ? "Signing in…"
                    : "Sign in to Nexus"}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="nexus-auth-heading">
                <p className="nexus-section-label">
                  Two-factor authentication
                </p>

                <h2>Verify it’s you</h2>

                <p>
                  Enter the current code from the
                  authenticator app connected to
                  {mfaEmail
                    ? ` ${mfaEmail}`
                    : " your Melogic account"}
                  .
                </p>
              </div>

              {visibleError ? (
                <div
                  className="nexus-auth-message nexus-auth-message-error"
                  role="alert"
                >
                  {visibleError}
                </div>
              ) : null}

              <form
                className="nexus-auth-form nexus-mfa-form"
                onSubmit={handleMfaSubmit}
              >
                {mfaFactors.length > 1 ? (
                  <label className="nexus-auth-field">
                    <span>
                      Authentication method
                    </span>

                    <select
                      className="nexus-auth-select"
                      value={selectedFactorIndex}
                      disabled={submitting}
                      onChange={(event) =>
                        setSelectedFactorIndex(
                          Number(
                            event.target.value,
                          ),
                        )
                      }
                    >
                      {mfaFactors.map(
                        (factor) => (
                          <option
                            key={
                              factor.uid ||
                              factor.index
                            }
                            value={factor.index}
                          >
                            {
                              factor.displayName
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ) : null}

                <label className="nexus-auth-field">
                  <span>
                    Verification code
                  </span>

                  <input
                    ref={mfaInputRef}
                    className="nexus-mfa-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={verificationCode}
                    disabled={submitting}
                    onChange={(event) =>
                      setVerificationCode(
                        event.target.value
                          .replace(
                            /[^0-9]/g,
                            "",
                          )
                          .slice(0, 8),
                      )
                    }
                    placeholder="000000"
                    aria-label="Two-factor authentication code"
                  />
                </label>

                <div className="nexus-mfa-hint">
                  <span className="nexus-mfa-shield">
                    ✓
                  </span>

                  <span>
                    Codes are verified directly
                    with Firebase Authentication.
                    Nexus never stores your
                    one-time code.
                  </span>
                </div>

                <button
                  className="nexus-auth-submit"
                  type="submit"
                  disabled={
                    submitting ||
                    !verificationCode.trim()
                  }
                >
                  {submitting
                    ? "Verifying…"
                    : "Verify and continue"}
                </button>

                <button
                  className="nexus-auth-secondary"
                  type="button"
                  disabled={submitting}
                  onClick={handleBackToPassword}
                >
                  Back to sign in
                </button>
              </form>
            </>
          )}

          <div className="nexus-auth-footer">
            <span>Melogic Nexus</span>

            <span>
              {mfaRequired
                ? "Secure verification"
                : "Desktop Preview"}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
