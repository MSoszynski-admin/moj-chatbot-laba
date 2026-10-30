import {
  getClientKey,
  getRetryAfterSeconds,
  recordFailedLogin,
} from "@/lib/login-limit";
import {
  createSession,
  isAuthConfigured,
  isPasswordCorrect,
} from "@/lib/session";

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return new Response(
      "Logowanie nie jest skonfigurowane. Uzupełnij CHAT_PASSWORD i SESSION_SECRET w pliku .env.local, a potem uruchom serwer ponownie.",
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;

  if (typeof password !== "string" || password === "") {
    return new Response("Wpisz hasło.", { status: 400 });
  }

  // Od tego miejsca kod jest synchroniczny, więc równoległe próby nie ominą limitu.
  const client = getClientKey(req);
  const retryAfter = getRetryAfterSeconds(client);

  if (retryAfter > 0) {
    return new Response("Zbyt wiele prób. Poczekaj chwilę i spróbuj ponownie.", {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  if (!isPasswordCorrect(password)) {
    recordFailedLogin(client);
    return new Response("Nieprawidłowe hasło.", { status: 401 });
  }

  await createSession();
  return new Response(null, { status: 204 });
}
