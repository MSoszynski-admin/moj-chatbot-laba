import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { hasSession } from "@/lib/session";
import { CHAT_SYSTEM_PROMPT } from "@/lib/studio-nova";
import { describeProviderError } from "@/lib/provider-errors";

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return new Response("Sesja wygasła. Odśwież stronę i wpisz hasło.", {
      status: 401,
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return new Response(
      "Chatbot nie jest skonfigurowany. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a potem uruchom serwer ponownie.",
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const validation = await safeValidateUIMessages({ messages: body?.messages });

  if (!validation.success) {
    return new Response("Nieprawidłowe dane rozmowy.", { status: 400 });
  }

  const messages = validation.data;
  const lastMessage = messages.at(-1);
  const hasText = lastMessage?.parts.some(
    (part) => part.type === "text" && part.text.trim() !== "",
  );

  if (lastMessage?.role !== "user" || !hasText) {
    return new Response("Wiadomość nie może być pusta.", { status: 400 });
  }

  const openrouter = createOpenRouter({ apiKey });

  const result = streamText({
    model: openrouter.chat(model),
    // Instrukcja firmy jest ustawiana tylko tutaj, na serwerze.
    system: CHAT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: describeProviderError,
    }),
  });
}
