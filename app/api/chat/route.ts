import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { hasSession } from "@/lib/session";
import { CHAT_SYSTEM_PROMPT } from "@/lib/studio-nova";
import { describeProviderError } from "@/lib/provider-errors";
import {
  DEFAULT_AGENT_MODEL,
  IMAGE_MODEL_ID,
  MAX_STEPS,
  TOOL_INSTRUCTIONS,
  createAgentTools,
  type AgentMetadata,
} from "@/lib/agent-tools";

// Wyszukiwanie i generowanie obrazu trwają dłużej niż zwykła odpowiedź.
export const maxDuration = 60;

const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_DATA_URL = 4_000_000; // ok. 3 MB pliku po zakodowaniu base64

export async function POST(req: Request) {
  // 1. Najpierw sesja. Bez niej nie dotykamy modelu.
  if (!(await hasSession())) {
    return new Response("Sesja wygasła. Odśwież stronę i wpisz hasło.", {
      status: 401,
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  // Agent potrzebuje modelu z wyszukiwaniem Google i rozumieniem obrazów.
  // Można go zmienić zmienną OPENROUTER_AGENT_MODEL, bez zmiany kodu.
  const modelId = process.env.OPENROUTER_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;

  if (!apiKey) {
    return new Response(
      "Chatbot nie jest skonfigurowany. Uzupełnij OPENROUTER_API_KEY w pliku .env.local, a potem uruchom serwer ponownie.",
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const validation = await safeValidateUIMessages<UIMessage<AgentMetadata>>({
    messages: body?.messages,
  });

  if (!validation.success) {
    return new Response("Nieprawidłowe dane rozmowy.", { status: 400 });
  }

  const messages = validation.data;

  // Przeglądarka może przysłać tylko wiadomości użytkownika i wcześniejsze
  // odpowiedzi asystenta. Instrukcję systemową ustawia wyłącznie serwer.
  if (messages.some((m) => m.role !== "user" && m.role !== "assistant")) {
    return new Response("Nieprawidłowe dane rozmowy.", { status: 400 });
  }

  // Zdjęcia: tylko jpg, png, webp, tylko jako data URL i z limitem rozmiaru.
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      if (message.role !== "user" || !ALLOWED_IMAGES.includes(part.mediaType)) {
        return new Response("Można dodać tylko zdjęcie jpg, png albo webp.", { status: 400 });
      }
      if (!part.url.startsWith("data:") || part.url.length > MAX_IMAGE_DATA_URL) {
        return new Response("Zdjęcie jest za duże albo ma zły format.", { status: 400 });
      }
    }
  }

  const lastMessage = messages.at(-1);
  const hasContent = lastMessage?.parts.some(
    (part) => (part.type === "text" && part.text.trim() !== "") || part.type === "file",
  );

  if (lastMessage?.role !== "user" || !hasContent) {
    return new Response("Wiadomość nie może być pusta.", { status: 400 });
  }

  const openrouter = createOpenRouter({ apiKey });
  const tools = createAgentTools({
    openrouter,
    imageModel: openrouter.imageModel(IMAGE_MODEL_ID),
  });

  // 2. Model może wykonać kilka kroków: użyć narzędzia, przeczytać wynik, odpowiedzieć.
  const result = streamText({
    model: openrouter.chat(modelId),
    instructions: `${CHAT_SYSTEM_PROMPT}\n\n${TOOL_INSTRUCTIONS}`,
    messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
  });

  let steps = 0;

  // 3. Odpowiedź na żywo, razem ze źródłami i informacją o modelu.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof tools, UIMessage<AgentMetadata>>({
      stream: result.stream,
      tools,
      sendSources: true,
      onError: describeProviderError,
      messageMetadata: ({ part }) => {
        if (part.type === "finish-step") {
          steps += 1;
          return { model: part.response.modelId };
        }
        if (part.type === "finish") {
          return {
            fetchedAt: new Date().toLocaleString("pl-PL", {
              timeZone: "Europe/Warsaw",
              dateStyle: "short",
              timeStyle: "short",
            }),
            // Ostatni krok zakończył się prośbą o narzędzie, czyli zabrakło kroków.
            stoppedAtLimit: steps >= MAX_STEPS && part.finishReason === "tool-calls",
          };
        }
      },
    }),
  });
}
