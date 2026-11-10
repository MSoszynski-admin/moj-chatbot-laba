"use client";

import { useState } from "react";
import { Analysis } from "./analysis";
import { Chat } from "./chat";
import styles from "./page.module.css";

type Tab = "chat" | "analysis";

export function Workspace() {
  const [tab, setTab] = useState<Tab>("chat");
  const [logoutFailed, setLogoutFailed] = useState(false);

  async function logout() {
    setLogoutFailed(false);

    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/");
    } catch {
      setLogoutFailed(true);
    }
  }

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Tryb">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat"}
            className={tab === "chat" ? styles.tabActive : styles.tab}
            onClick={() => setTab("chat")}
          >
            Czat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "analysis"}
            className={tab === "analysis" ? styles.tabActive : styles.tab}
            onClick={() => setTab("analysis")}
          >
            Analiza wiadomości
          </button>
        </div>

        {logoutFailed && (
          <p className={styles.toolbarError} role="alert">
            Nie udało się wyjść. Spróbuj ponownie.
          </p>
        )}
        <button className={styles.logout} type="button" onClick={logout}>
          Wyjdź
        </button>
      </div>

      {/* Oba widoki zostają zamontowane, żeby przełączenie nie kasowało rozmowy. */}
      <div className={styles.panel} hidden={tab !== "chat"}>
        <Chat />
      </div>
      <div className={styles.panel} hidden={tab !== "analysis"}>
        <Analysis />
      </div>
    </>
  );
}
