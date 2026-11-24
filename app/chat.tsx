"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai";
import { useEffect, useRef, useState } from "react";
import type { AgentMetadata, ImageResult } from "@/lib/agent-tools";
import styles from "./page.module.css";

type AgentMessage = UIMessage<AgentMetadata>;

// Etykiety narzędzi pokazywane nad odpowiedzią.
const TOOL_LABELS: Record<string, string> = {
  wyszukiwanie: "🔎 wyszukiwanie",
  generujObraz: "🎨 generujObraz",
  cenaWWalucie: "💱 cenaWWalucie",
  aktualnyCzas: "🕒 aktualnyCzas",
};

const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1600; // zdjęcie zmniejszamy w przeglądarce, żeby zmieściło się w limicie serwera

// Wygenerowanych obrazów nie odsyłamy z powrotem na serwer: są duże,
// a modelowi wystarczy informacja, że obraz powstał.
const transport = new DefaultChatTransport<AgentMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: {
      messages: messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "tool-generujObraz" && part.state === "output-available"
            ? { ...part, output: { model: (part.output as ImageResult).model } }
            : part,
        ),
      })),
    },
  }),
});

function usedTools(message: AgentMessage): string[] {
  const names: string[] = [];
  for (const part of message.parts) {
    // Wyszukiwanie wykonuje OpenRouter, więc rozpoznajemy je po źródłach.
    const name = isToolUIPart(part)
      ? getToolName(part)
      : part.type === "source-url"
        ? "wyszukiwanie"
        : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function Picture({ result }: { result: ImageResult }) {
  if (result.error) return <p className={styles.error}>{result.error}</p>;
  if (!result.image) return null;
  return (
    <figure className={styles.picture}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={result.image} alt="Wygenerowany obraz" />
      <figcaption className={styles.small}>
        model: {result.model ?? "nieznany"} ·{" "}
        <a href={result.image} download="obraz.png">
          Pobierz
        </a>
      </figcaption>
    </figure>
  );
}

function Message({ message }: { message: AgentMessage }) {
  const isAssistant = message.role === "assistant";
  const tools = isAssistant ? usedTools(message) : [];
  // Źródła: z narzędzia wyszukiwania oraz (gdyby model sam szukał) z części source-url.
  const sources = [
    ...message.parts.flatMap((part) =>
      part.type === "tool-wyszukiwanie" && part.state === "output-available"
        ? ((part.output as { zrodla?: { tytul: string; url: string }[] }).zrodla ?? []).map((z) => ({
            sourceId: z.url,
            url: z.url,
            title: z.tytul,
          }))
        : [],
    ),
    ...message.parts
      .filter((part) => part.type === "source-url")
      .map((part) => ({ sourceId: part.sourceId, url: part.url, title: part.title })),
  ];
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => !seen.has(s.url) && seen.add(s.url));

  return (
    <div className={isAssistant ? styles.assistant : styles.user}>
      {tools.length > 0 && (
        <div className={styles.labels}>
          {tools.map((name) => (
            <span key={name} className={styles.label}>
              {TOOL_LABELS[name] ?? `🛠️ ${name}`}
            </span>
          ))}
        </div>
      )}

      {message.parts.map((part, index) => {
        if (part.type === "text") return <span key={index}>{part.text}</span>;
        if (part.type === "file" && part.mediaType.startsWith("image/")) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={index} className={styles.thumb} src={part.url} alt={part.filename ?? "Wysłane zdjęcie"} />
          );
        }
        if (part.type === "tool-generujObraz") {
          if (part.state === "output-available") {
            return <Picture key={index} result={part.output as ImageResult} />;
          }
          if (part.state === "output-error") {
            return (
              <p key={index} className={styles.error}>
                Nie udało się wygenerować obrazu.
              </p>
            );
          }
          return (
            <p key={index} className={styles.small}>
              Generuję obraz…
            </p>
          );
        }
        if (isToolUIPart(part) && part.state === "output-error") {
          return (
            <p key={index} className={styles.error}>
              Narzędzie {getToolName(part)} nie zadziałało.
            </p>
          );
        }
        return null;
      })}

      {message.metadata?.stoppedAtLimit && (
        <p className={styles.small}>Przerwałem po 5 krokach.</p>
      )}

      {uniqueSources.length > 0 && (
        <div className={styles.sources}>
          <strong>Źródła</strong>
          <ul>
            {uniqueSources.map((source) => (
              <li key={source.sourceId}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
          {message.metadata?.fetchedAt && (
            <span className={styles.small}>pobrano: {message.metadata.fetchedAt}</span>
          )}
        </div>
      )}

      {isAssistant && message.metadata?.model && (
        <div className={styles.small}>model: {message.metadata.model}</div>
      )}
    </div>
  );
}

/** Zmniejsza zdjęcie do MAX_SIDE i zapisuje jako JPEG (data URL). */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

export function Chat() {
  const { messages, sendMessage, status, error } = useChat<AgentMessage>({ transport });
  const [input, setInput] = useState("");
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoError, setPhotoError] = useState("");
  const messagesRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isBusy = status === "submitted" || status === "streaming";
  const text = input.trim();
  const canSend = (text !== "" || photo !== null) && !isBusy;

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages, status, error]);

  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoError("");
    // Zły format albo za duży plik: komunikat od razu, bez wysyłania na serwer.
    if (!ALLOWED_IMAGES.includes(file.type)) {
      setPhotoError("Ten plik nie jest zdjęciem. Dodaj plik jpg, png albo webp.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPhotoError("Zdjęcie jest za duże. Limit to 10 MB.");
      return;
    }
    try {
      const url = await shrinkImage(file);
      setPhoto({ type: "file", mediaType: "image/jpeg", filename: file.name, url });
    } catch {
      setPhotoError("Nie udało się wczytać zdjęcia.");
    }
  }

  return (
    <>
      <section
        ref={messagesRef}
        className={styles.messages}
        aria-label="Rozmowa"
        aria-live="polite"
      >
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {status === "submitted" && <p className={styles.waiting}>Czekam na odpowiedź…</p>}

        {error && (
          <p className={styles.error} role="alert">
            {error instanceof TypeError
              ? "Brak połączenia z serwerem. Sprawdź, czy aplikacja działa, i spróbuj ponownie."
              : error.message}
          </p>
        )}
      </section>

      {photo && (
        <div className={styles.attachment}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.thumb} src={photo.url} alt="Wybrane zdjęcie" />
          <span className={styles.small}>{photo.filename}</span>
          <button type="button" className={styles.ghost} onClick={() => setPhoto(null)}>
            Usuń
          </button>
        </div>
      )}
      {photoError && (
        <p className={styles.error} role="alert">
          {photoError}
        </p>
      )}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          sendMessage({
            text: text || "Co widzisz na tym zdjęciu? Opisz w trzech punktach.",
            files: photo ? [photo] : undefined,
          });
          setInput("");
          setPhoto(null);
        }}
      >
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Napisz wiadomość, poproś o grafikę albo dodaj zdjęcie"
          aria-label="Wiadomość"
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={choosePhoto}
          hidden
          aria-label="Zdjęcie"
        />
        <button
          type="button"
          className={styles.ghost}
          onClick={() => fileInput.current?.click()}
          disabled={isBusy}
        >
          Dodaj zdjęcie
        </button>
        <button className={styles.send} type="submit" disabled={!canSend}>
          Wyślij
        </button>
      </form>
    </>
  );
}
