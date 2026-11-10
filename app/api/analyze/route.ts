import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { analyzeMessage } from "@/lib/analyze-message";
import { hasSession } from "@/lib/session";

// Przeglądarka może przysłać tylko treść wiadomości. Każde inne pole
// (np. send_now, role, system) kończy się odrzuceniem żądania.
const RequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(4000),
});

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return json(
      { ok: false, reason: "session", message: "Sesja wygasła. Odśwież stronę i wpisz hasło." },
      401,
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    return json(
      {
        ok: false,
        reason: "config",
        message: "Analiza nie jest skonfigurowana. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL.",
      },
      503,
    );
  }

  const body = await req.json().catch(() => null);
  const request = RequestSchema.safeParse(body);
  if (!request.success) {
    return json(
      {
        ok: false,
        reason: "bad_request",
        message: "Nieprawidłowe dane. Wyślij tylko treść wiadomości (1 do 4000 znaków).",
      },
      400,
    );
  }

  const openrouter = createOpenRouter({ apiKey });
  const result = await analyzeMessage(openrouter.chat(model), request.data.message);

  if (result.ok) return json(result, 200);
  return json(result, result.reason === "provider" ? 502 : 422);
}
