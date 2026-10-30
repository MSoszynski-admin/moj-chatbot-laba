import { Suspense } from "react";
import { hasSession } from "@/lib/session";
import { Chat } from "./chat";
import { LoginForm } from "./login-form";
import styles from "./page.module.css";

async function SessionGate() {
  return (await hasSession()) ? <Chat /> : <LoginForm />;
}

export default function Home() {
  return (
    <main className={styles.chat}>
      <h1 className={styles.title}>Mój chatbot</h1>

      <Suspense fallback={<p className={styles.waiting}>Ładowanie…</p>}>
        <SessionGate />
      </Suspense>
    </main>
  );
}
