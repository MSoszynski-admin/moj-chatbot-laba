"use client";

import { useState } from "react";
import styles from "./page.module.css";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function login() {
    setError("");
    setIsPending(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        window.location.assign("/");
        return;
      }

      setError(await response.text());
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    }

    setIsPending(false);
  }

  return (
    <form
      className={styles.login}
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== "" && !isPending) login();
      }}
    >
      <h2 className={styles.loginTitle}>Wpisz hasło</h2>

      <div className={styles.composer}>
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-label="Hasło"
        />
        <button
          className={styles.send}
          type="submit"
          disabled={password === "" || isPending}
        >
          Wejdź
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
