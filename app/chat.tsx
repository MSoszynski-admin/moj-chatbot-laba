"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

function messageText(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function Chat() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const messagesRef = useRef<HTMLElement>(null);

  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const isWaiting =
    isBusy &&
    !(lastMessage?.role === "assistant" && messageText(lastMessage));
  const canSend = input.trim() !== "" && !isBusy;

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages, isWaiting, error]);

  return (
    <>
      <section
        ref={messagesRef}
        className={styles.messages}
        aria-label="Rozmowa"
        aria-live="polite"
      >
        {messages.map((message) => {
          const text = messageText(message);
          if (!text) return null;

          return (
            <p
              key={message.id}
              className={
                message.role === "user" ? styles.user : styles.assistant
              }
            >
              {text}
            </p>
          );
        })}

        {isWaiting && <p className={styles.waiting}>Czekam na odpowiedź…</p>}

        {error && (
          <p className={styles.error} role="alert">
            {error instanceof TypeError
              ? "Brak połączenia z serwerem. Sprawdź, czy aplikacja działa, i spróbuj ponownie."
              : error.message}
          </p>
        )}
      </section>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;

          sendMessage({ text: input.trim() });
          setInput("");
        }}
      >
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Napisz wiadomość"
          aria-label="Wiadomość"
        />
        <button className={styles.send} type="submit" disabled={!canSend}>
          Wyślij
        </button>
      </form>
    </>
  );
}
