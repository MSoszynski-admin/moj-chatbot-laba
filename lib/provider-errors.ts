import { APICallError, RetryError } from "ai";

/** Czytelny komunikat dla błędu dostawcy modelu (OpenRouter). */
export function describeProviderError(error: unknown) {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;

  switch (status) {
    case 401:
      return "OpenRouter odrzucił klucz API. Sprawdź OPENROUTER_API_KEY w pliku .env.local.";
    case 402:
      return "Brak środków na koncie OpenRouter. Doładuj konto lub wybierz darmowy model.";
    case 403:
      return "OpenRouter nie pozwala użyć tego modelu z tym kluczem. Sprawdź OPENROUTER_MODEL albo dostęp na kluczu LABA.";
    case 404:
      return "OpenRouter nie znalazł tego modelu. Sprawdź OPENROUTER_MODEL w pliku .env.local.";
    case 429:
      return "Przekroczono limit zapytań. Poczekaj chwilę i spróbuj ponownie.";
    default:
      return "Nie udało się uzyskać odpowiedzi modelu. Spróbuj ponownie.";
  }
}
