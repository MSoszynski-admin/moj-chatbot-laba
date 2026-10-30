import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  APICallError,
  RetryError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { hasSession } from "@/lib/session";

function describeError(error: unknown) {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;

  switch (status) {
    case 401:
      return "OpenRouter odrzucił klucz API. Sprawdź OPENROUTER_API_KEY w pliku .env.local.";
    case 402:
      return "Brak środków na koncie OpenRouter. Doładuj konto lub wybierz darmowy model.";
    case 404:
      return "OpenRouter nie znalazł tego modelu. Sprawdź OPENROUTER_MODEL w pliku .env.local.";
    case 429:
      return "Przekroczono limit zapytań. Poczekaj chwilę i spróbuj ponownie.";
    default:
      return "Nie udało się uzyskać odpowiedzi modelu. Spróbuj ponownie.";
  }
}

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
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: describeError,
    }),
  });
}
