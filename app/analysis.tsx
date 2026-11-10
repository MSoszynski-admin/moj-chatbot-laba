"use client";

import { useState } from "react";
import styles from "./page.module.css";

type AnalysisResult = {
  category: "sales" | "support" | "billing" | "unknown";
  priority: "normal" | "high";
  draft: string;
  needs_review: boolean;
};

type ApiResponse =
  | {
      ok: true;
      analysis: AnalysisResult;
      warnings?: { code: string; message: string }[];
    }
  | { ok: false; reason: string; message: string; issues?: string[] };

const CATEGORY_LABELS: Record<AnalysisResult["category"], string> = {
  sales: "sales (oferta i cena)",
  support: "support (problem techniczny)",
  billing: "billing (płatność lub zwrot)",
  unknown: "unknown (brak rozpoznanej sprawy)",
};

export function Analysis() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canAnalyze = message.trim() !== "" && !isPending;

  async function analyze() {
    setIsPending(true);
    setResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = (await response.json().catch(() => null)) as ApiResponse | null;

      setResult(
        data && typeof data === "object" && "ok" in data
          ? data
          : { ok: false, reason: "http", message: `Serwer zwrócił nieoczekiwaną odpowiedź (HTTP ${response.status}).` },
      );
    } catch {
      setResult({
        ok: false,
        reason: "network",
        message: "Brak połączenia z serwerem. Sprawdź, czy aplikacja działa, i spróbuj ponownie.",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={styles.analysis}>
      <form
        className={styles.analysisForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (canAnalyze) analyze();
        }}
      >
        <label className={styles.label} htmlFor="client-message">
          Wiadomość klienta do analizy
        </label>
        <textarea
          id="client-message"
          className={styles.textarea}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Wklej wiadomość klienta Studio Nova"
          rows={5}
          maxLength={4000}
        />
        <button className={styles.send} type="submit" disabled={!canAnalyze}>
          {isPending ? "Analizuję…" : "Analizuj"}
        </button>
      </form>

      {result?.ok === true && (
        <section className={styles.result} aria-label="Wynik analizy">
          <dl className={styles.fields}>
            <dt>category</dt>
            <dd>{CATEGORY_LABELS[result.analysis.category]}</dd>
            <dt>priority</dt>
            <dd>{result.analysis.priority}</dd>
            <dt>needs_review</dt>
            <dd>
              {result.analysis.needs_review
                ? "true (wymaga decyzji pracownika)"
                : "false"}
            </dd>
            <dt>draft</dt>
            <dd className={styles.draft}>{result.analysis.draft}</dd>
          </dl>
          {result.warnings && result.warnings.length > 0 && (
            <ul className={styles.warnings} aria-label="Ostrzeżenia serwera">
              {result.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}
          <p className={styles.notice}>
            To tylko szkic. Aplikacja niczego nie wysyła, nie rezerwuje i nie
            potwierdza płatności.
          </p>
        </section>
      )}

      {result?.ok === false && (
        <div className={styles.error} role="alert">
          <p>{result.message}</p>
          {result.issues && result.issues.length > 0 && (
            <ul className={styles.issues}>
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
