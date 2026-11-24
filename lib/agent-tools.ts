// Narzędzia agenta Studio Nova (lekcja 3 LABA, Zadanie 3).
// Model sam wybiera narzędzie na podstawie opisu (description).
// Każde narzędzie kończy się albo wynikiem, albo czytelnym komunikatem błędu,
// więc awaria jednego narzędzia nie wywraca całej rozmowy.

import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { generateImage, generateText, isStepCount, tool, type ImageModel, type LanguageModel } from "ai";
import { z } from "zod";

export const MAX_STEPS = 5;
export const MAX_IMAGE_PROMPT = 500;

/** Model rozmowy agenta. Wyszukiwanie Google ("native") działa z modelami Gemini. */
export const DEFAULT_AGENT_MODEL = "google/gemini-3.8-flash";
/** Nano Banana 2. */
export const IMAGE_MODEL_ID = "google/gemini-3.1-flash-image-preview";

/** Wynik generowania obrazu, w tej postaci trafia do przeglądarki. */
export type ImageResult = {
  image?: string; // "data:image/png;base64,..."
  model?: string; // identyfikator modelu z odpowiedzi API, nie wpisany na sztywno
  error?: string; // komunikat po polsku
};

/** Informacje o odpowiedzi dosyłane przez serwer do przeglądarki. */
export type AgentMetadata = {
  model?: string; // model, który faktycznie odpowiedział (z odpowiedzi API)
  fetchedAt?: string; // data i godzina odpowiedzi, pokazywana przy źródłach
  stoppedAtLimit?: boolean; // agent doszedł do limitu kroków
};

/** Cena konsultacji z informacji firmy (Studio Nova, lekcja 2). */
export const CONSULTATION_PRICE_PLN = 150;
const NBP_TIMEOUT_MS = 8000;

/** Tekst błędu do pokazania w rozmowie, bez szczegółów technicznych. */
function friendly(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") return "serwis nie odpowiedział w czasie";
  return "serwis jest chwilowo niedostępny";
}

export async function createImage(
  model: ImageModel,
  prompt: string,
): Promise<ImageResult> {
  try {
    const result = await generateImage({ model, prompt });
    return {
      image: `data:${result.image.mediaType};base64,${result.image.base64}`,
      model: result.calls[0]?.response.modelId,
    };
  } catch {
    return {
      error:
        "Nie udało się wygenerować obrazu. Model obrazów może być teraz niedostępny, spróbuj za chwilę.",
    };
  }
}

/** Kurs średni NBP (tabela A) dla waluty. Zwraca dane albo komunikat błędu. */
export async function fetchNbpRate(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; waluta: string; kurs: number; dataTabeli: string; tabela: string; zrodlo: string }
  | { ok: false; blad: string }
> {
  const url = `https://api.nbp.pl/api/exchangerates/rates/a/${code.toLowerCase()}/?format=json`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(NBP_TIMEOUT_MS) });
    if (response.status === 404) {
      return { ok: false, blad: `NBP nie publikuje kursu waluty ${code} w tabeli A.` };
    }
    if (!response.ok) {
      return { ok: false, blad: `NBP zwrócił błąd (HTTP ${response.status}).` };
    }
    const data = (await response.json()) as {
      code?: string;
      rates?: { no?: string; effectiveDate?: string; mid?: number }[];
    };
    const rate = data.rates?.[0];
    if (!rate || typeof rate.mid !== "number" || !rate.effectiveDate) {
      return { ok: false, blad: "NBP zwrócił dane w nieoczekiwanym formacie." };
    }
    return {
      ok: true,
      waluta: data.code ?? code,
      kurs: rate.mid,
      dataTabeli: rate.effectiveDate,
      tabela: rate.no ?? "",
      zrodlo: url,
    };
  } catch (error) {
    return { ok: false, blad: `Nie udało się pobrać kursu z NBP: ${friendly(error)}.` };
  }
}

/** Bieżąca data i godzina w Polsce. */
export function warsawNow(now = new Date()) {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", ...options }).format(now);
  return {
    data: format({ year: "numeric", month: "long", day: "numeric" }),
    dzienTygodnia: format({ weekday: "long" }),
    godzina: format({ hour: "2-digit", minute: "2-digit" }),
    strefa: "Europe/Warsaw",
  };
}

/** Zestaw narzędzi agenta. Provider i model obrazów podajemy z zewnątrz (łatwo testować). */
export function createAgentTools(options: {
  openrouter: Pick<OpenRouterProvider, "tools">;
  searchModel: LanguageModel;
  imageModel: ImageModel;
  fetchImpl?: typeof fetch;
}) {
  const { openrouter, searchModel, imageModel, fetchImpl = fetch } = options;

  return {
    // 1. Wyszukiwanie w internecie. Osobne wywołanie modelu z wyszukiwaniem Google
    //    (OpenRouter webSearch). Źródła wracają w wyniku narzędzia, więc są widoczne
    //    także wtedy, gdy w tym samym zadaniu agent używa innych narzędzi.
    wyszukiwanie: tool({
      description:
        "Wyszukuje aktualne informacje w internecie (Google) i zwraca streszczenie ze źródłami. Użyj przy pytaniach " +
        "o bieżące wydarzenia, pogodę, prognozy, ceny rynkowe, nowości i fakty, których nie jesteś pewien.",
      inputSchema: z.object({
        zapytanie: z.string().min(2).max(300).describe("Pytanie lub fraza do wyszukania, po polsku albo angielsku"),
      }),
      execute: async ({ zapytanie }) => {
        try {
          const result = await generateText({
            model: searchModel,
            tools: { web: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }) },
            stopWhen: isStepCount(2),
            instructions:
              "Wyszukaj informacje w internecie i streść je po polsku w 3-6 zdaniach. Podawaj tylko fakty ze źródeł, z datami.",
            prompt: zapytanie,
          });
          const seen = new Set<string>();
          const zrodla = result.sources
            .filter((s) => s.sourceType === "url" && !seen.has(s.url) && seen.add(s.url))
            .map((s) => ({ tytul: (s as { title?: string }).title ?? "", url: (s as { url: string }).url }));
          if (zrodla.length === 0) {
            return { blad: "Wyszukiwarka nie zwróciła źródeł. Nie podawaj faktów bez źródła." };
          }
          return { streszczenie: result.text, zrodla, pobrano: new Date().toISOString() };
        } catch {
          return { blad: "Wyszukiwanie w internecie jest chwilowo niedostępne." };
        }
      },
    }),

    // 2. Generowanie obrazu (Nano Banana 2).
    generujObraz: tool({
      description:
        "Generuje obraz na podstawie opisu. Użyj, gdy użytkownik prosi o grafikę, plakat, logo, ilustrację, " +
        "baner lub zdjęcie do posta. Obraz zobaczy użytkownik w rozmowie, nie wklejaj go do odpowiedzi.",
      inputSchema: z.object({
        opis: z
          .string()
          .min(1)
          .max(MAX_IMAGE_PROMPT)
          .describe("Dokładny opis obrazu: co jest na obrazie, styl, kolory, format"),
      }),
      execute: async ({ opis }) => createImage(imageModel, opis),
      // Do przeglądarki idzie cały obraz, a do modelu tylko krótki tekst (bez pliku).
      toModelOutput: ({ output }) => ({
        type: "text",
        value: output.error ? `Błąd: ${output.error}` : "obraz wygenerowany i pokazany użytkownikowi",
      }),
    }),

    // 3. Własne narzędzie: cena konsultacji w walucie obcej po kursie NBP.
    cenaWWalucie: tool({
      description:
        "Przelicza cenę konsultacji Studio Nova (150 zł brutto) albo podaną kwotę w złotych na walutę obcą " +
        "według średniego kursu NBP z tabeli A. Użyj, gdy klient pyta o cenę w euro, dolarach lub innej walucie " +
        "albo o aktualny kurs waluty. Nie podawaj kursu z pamięci.",
      inputSchema: z.object({
        waluta: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .describe("Trzyliterowy kod waluty ISO 4217, np. EUR, USD, GBP"),
        kwotaPln: z
          .number()
          .positive()
          .max(1_000_000)
          .optional()
          .describe("Kwota w złotych do przeliczenia. Domyślnie cena konsultacji 150 zł."),
      }),
      execute: async ({ waluta, kwotaPln }) => {
        const code = waluta.toUpperCase();
        const pln = kwotaPln ?? CONSULTATION_PRICE_PLN;
        const rate = await fetchNbpRate(code, fetchImpl);
        if (!rate.ok) return { blad: rate.blad };
        return {
          kwotaPln: pln,
          waluta: rate.waluta,
          kursSredniNbp: rate.kurs,
          kwotaWWalucie: Math.round((pln / rate.kurs) * 100) / 100,
          dataTabeliNbp: rate.dataTabeli,
          tabelaNbp: rate.tabela,
          zrodlo: rate.zrodlo,
          uwaga: "Przeliczenie orientacyjne po kursie średnim NBP. Rozliczenie następuje w złotych.",
        };
      },
    }),

    // 4. Własne narzędzie: bieżąca data i godzina.
    aktualnyCzas: tool({
      description:
        "Zwraca dzisiejszą datę, dzień tygodnia i godzinę w Polsce (Europe/Warsaw). Użyj, gdy odpowiedź zależy " +
        "od bieżącej daty: „dziś”, „jutro”, „za ile dni”, „który dziś dzień”. Nie zgaduj daty z pamięci.",
      inputSchema: z.object({}),
      execute: async () => warsawNow(),
    }),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;

export const TOOL_INSTRUCTIONS = `Format odpowiedzi:
- Format szkicu (kategoria, szkic, do sprawdzenia) stosuj tylko wtedy, gdy użytkownik wkleja wiadomość od klienta.
- Na pytania pracownika, prośby o grafikę i pytania o zdjęcie odpowiadaj wprost, zwykłym tekstem.
- Nie używaj Markdown (bez gwiazdek i nagłówków). Źródła z wyszukiwania aplikacja pokazuje pod odpowiedzią. Przy kursie NBP podaj datę i numer tabeli.

Masz narzędzia. Wybieraj je sam, zgodnie z pytaniem:
- wyszukiwanie: aktualne wydarzenia, pogoda, ceny rynkowe, daty i fakty, których nie jesteś pewien.
  Opieraj odpowiedź wyłącznie na wyniku wyszukiwania. Nie podawaj nazw stron ani faktów, których nie ma w wyniku.
- generujObraz: gdy użytkownik prosi o grafikę, plakat, logo lub ilustrację.
- cenaWWalucie: cena konsultacji lub kwota w złotych w walucie obcej, kurs waluty.
- aktualnyCzas: pytania zależne od dzisiejszej daty.
Na zwykłe pytania, szkice wiadomości i powitania odpowiadaj bez narzędzi.
Gdy użytkownik doda zdjęcie, odpowiedz na jego temat na podstawie tego, co widać.
Przy zadaniu złożonym najpierw zbierz informacje, potem twórz.
Gdy narzędzie zwróci błąd, powiedz o tym wprost i zaproponuj, co można zrobić. Nie udawaj wyniku.`;
