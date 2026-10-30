import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.chat}>
      <h1 className={styles.title}>Mój chatbot</h1>

      <section className={styles.messages} aria-label="Rozmowa" />

      <div className={styles.composer}>
        <input
          className={styles.input}
          type="text"
          placeholder="Napisz wiadomość"
          aria-label="Wiadomość"
        />
        <button className={styles.send} type="button">
          Wyślij
        </button>
      </div>
    </main>
  );
}
