
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [checking, setChecking] = useState(true);
  const [canReset, setCanReset] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    // Patikriname, ar puslapis atidarytas iš atkūrimo laiško.
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );

    const searchParams = new URLSearchParams(window.location.search);

    const recoveryUrl =
      hashParams.get("type") === "recovery" ||
      searchParams.get("type") === "recovery";

    // Supabase informuoja, kai atkūrimo nuoroda sėkmingai patvirtinta.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;

      if (event === "PASSWORD_RECOVERY" && session) {
        setCanReset(true);
        setChecking(false);
      }
    });

    // Papildomai patikriname, ar atkūrimo nuoroda sukūrė sesiją.
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;

      if (error) {
        setError(error.message);
      }

      if (recoveryUrl && data.session) {
        setCanReset(true);
      }

      setChecking(false);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (password.length < 8) {
      setError("Slaptažodį turi sudaryti bent 8 simboliai.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Slaptažodžiai nesutampa.");
      return;
    }

    setSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) throw updateError;

      // Atjungiame visas paskyros sesijas, įskaitant seną atkūrimo sesiją.
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "global",
      });

      if (signOutError) {
        throw new Error(
          "Slaptažodis pakeistas, bet nepavyko atjungti visų sesijų. " +
          signOutError.message
        );
      }

      setCanReset(false);
      setPassword("");
      setConfirmPassword("");

      setSuccess(
        "Slaptažodis pakeistas! Visos ankstesnės sesijos atjungtos. " +
        "Dabar gali prisijungti prie administravimo su nauju slaptažodžiu."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nepavyko pakeisti slaptažodžio. Pabandyk dar kartą."
      );
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <main className="reset-page">
        Tikrinama atkūrimo nuoroda...
        <ResetStyles />
      </main>
    );
  }

  return (
    <main className="reset-page">
      <section className="reset-card">
        <p className="reset-eyebrow">GUDRUTĖS DĖŽUTĖS</p>

        <h1>Naujas slaptažodis</h1>

        {success ? (
          <>
            <p className="reset-success">{success}</p>
            <a className="reset-button" href="/admin">
              Eiti į administravimą
            </a>
          </>
        ) : canReset ? (
          <>
            <p>Įrašyk naują administratoriaus slaptažodį.</p>

            <form onSubmit={handleSubmit}>
              <label htmlFor="new-password">Naujas slaptažodis</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <label htmlFor="confirm-password">
                Pakartok slaptažodį
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <button type="submit" disabled={saving}>
                {saving ? "Saugoma..." : "Pakeisti slaptažodį"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="reset-error">
              Atkūrimo nuoroda netinkama arba nebegalioja.
              Grįžk į prisijungimo puslapį ir paprašyk naujos nuorodos.
            </p>
            <a className="reset-button" href="/admin">
              Grįžti į prisijungimą
            </a>
          </>
        )}

        {error && <p className="reset-error">{error}</p>}
      </section>

      <ResetStyles />
    </main>
  );
}

function ResetStyles() {
  return (
    <style jsx global>{`
      .reset-page {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 20px;
        box-sizing: border-box;
        background: #f7f5f1;
        color: #292722;
        font-family: Arial, sans-serif;
      }
      .reset-card {
        width: 100%;
        max-width: 430px;
        box-sizing: border-box;
        padding: 35px;
        background: white;
        border-radius: 17px;
        box-shadow: 0 8px 35px #0000000d;
      }
      .reset-eyebrow {
        letter-spacing: 3px;
        font-size: 11px;
        color: #897c68;
      }
      .reset-card h1 {
        font-size: 27px;
        margin: 12px 0;
      }
      .reset-card form {
        display: grid;
        gap: 12px;
      }
      .reset-card label {
        font-weight: 600;
        font-size: 14px;
      }
      .reset-card input {
        width: 100%;
        box-sizing: border-box;
        padding: 13px;
        border: 1px solid #d8d3ca;
        border-radius: 9px;
        font-size: 15px;
      }
      .reset-card button,
      .reset-button {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 14px;
        margin-top: 12px;
        border: 0;
        border-radius: 9px;
        background: #292722;
        color: white;
        text-align: center;
        text-decoration: none;
        font-size: 15px;
        cursor: pointer;
      }
      .reset-card button:disabled {
        opacity: .6;
        cursor: wait;
      }
      .reset-error {
        padding: 12px;
        border-radius: 8px;
        background: #fae9e7;
        color: #922d26;
      }
      .reset-success {
        padding: 12px;
        border-radius: 8px;
        background: #e8f4ec;
        color: #24663e;
        line-height: 1.5;
      }
    `}</style>
  );
}
