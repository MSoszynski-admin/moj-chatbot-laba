// Testy narzędzi agenta (lekcja 3, Zadanie 3).
// Bez prawdziwych modeli i bez internetu: model, obrazy i NBP są zastąpione atrapami.
// Uruchom: npm run test:tools

import assert from "node:assert/strict";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount } from "ai";
import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import {
  CONSULTATION_PRICE_PLN,
  createAgentTools,
  createImage,
  fetchNbpRate,
  warsawNow,
} from "../lib/agent-tools";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`OK    ${name}`);
  } catch (error) {
    console.log(`BŁĄD  ${name}`);
    throw error;
  }
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

const nbpOk: typeof fetch = async () =>
  new Response(
    JSON.stringify({ code: "EUR", rates: [{ no: "228/A/NBP/2026", effectiveDate: "2026-11-24", mid: 4.25 }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const nbp404: typeof fetch = async () => new Response("Not Found", { status: 404 });
const nbpDown: typeof fetch = async () => {
  throw new TypeError("fetch failed");
};

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageOk() {
  return new MockImageModelV4({
    modelId: "google/gemini-3.1-flash-image-preview",
    doGenerate: async () => ({
      images: [PNG_1PX],
      warnings: [],
      response: { timestamp: new Date(), modelId: "google/gemini-3.1-flash-image-preview", headers: {} },
    }),
  });
}
function imageDown() {
  return new MockImageModelV4({
    doGenerate: async () => {
      throw new Error("model unavailable");
    },
  });
}

// Model, który w kolejnych krokach odtwarza zaplanowane odpowiedzi.
function scriptedModel(steps: Array<{ toolName: string; input: unknown } | { text: string }>) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      if ("text" in step) {
        return {
          content: [{ type: "text", text: step.text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      }
      return {
        content: [
          { type: "tool-call", toolCallId: `call-${i}`, toolName: step.toolName, input: JSON.stringify(step.input) },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      };
    },
  });
}

const openrouter = createOpenRouter({ apiKey: "test-bez-sieci" });

// Model wyszukiwania: zwraca streszczenie i źródło (albo nic, albo błąd).
function searchModel(mode: "ok" | "noSources" | "down" = "ok") {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (mode === "down") throw new Error("search down");
      return {
        content: [
          { type: "text", text: "W sobotę w Krakowie 3 st. C, pochmurno." },
          ...(mode === "ok"
            ? [{ type: "source" as const, sourceType: "url" as const, id: "s1", url: "https://pogoda.example/krakow", title: "Pogoda Kraków" }]
            : []),
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
}

// 1. Narzędzia osobno
await test("NBP: poprawna odpowiedź daje kurs i datę tabeli", async () => {
  const r = await fetchNbpRate("EUR", nbpOk);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.kurs, 4.25);
    assert.equal(r.dataTabeli, "2026-11-24");
    assert.match(r.zrodlo, /api\.nbp\.pl/);
  }
});
await test("NBP: nieznana waluta (404) daje komunikat, nie wyjątek", async () => {
  const r = await fetchNbpRate("XYZ", nbp404);
  assert.deepEqual([r.ok, !r.ok && /nie publikuje/.test(r.blad)], [false, true]);
});
await test("NBP: brak sieci daje komunikat, nie wyjątek", async () => {
  const r = await fetchNbpRate("EUR", nbpDown);
  assert.equal(r.ok, false);
});
await test("cenaWWalucie: 150 zł po 4,25 = 35,29 EUR", async () => {
  const tools = createAgentTools({ openrouter, searchModel: searchModel(), imageModel: imageOk(), fetchImpl: nbpOk });
  const out = (await tools.cenaWWalucie.execute!({ waluta: "eur" }, { toolCallId: "t", messages: [], context: {} } as never)) as Record<
    string,
    unknown
  >;
  assert.equal(out.kwotaPln, CONSULTATION_PRICE_PLN);
  assert.equal(out.kwotaWWalucie, Math.round((150 / 4.25) * 100) / 100);
  assert.equal(out.waluta, "EUR");
});
await test("aktualnyCzas: data w strefie Europe/Warsaw", () => {
  const r = warsawNow(new Date("2026-11-24T23:30:00Z"));
  assert.equal(r.dzienTygodnia, "środa"); // w Polsce jest już 25.11, 00:30
  assert.equal(r.godzina, "00:30");
});
await test("generujObraz: obraz jako data URL i model z odpowiedzi API", async () => {
  const r = await createImage(imageOk(), "logo kawiarni");
  assert.match(r.image ?? "", /^data:image\/png;base64,/);
  assert.equal(r.model, "google/gemini-3.1-flash-image-preview");
});
await test("generujObraz: awaria modelu daje polski komunikat", async () => {
  const r = await createImage(imageDown(), "logo kawiarni");
  assert.equal(r.image, undefined);
  assert.match(r.error ?? "", /Nie udało się wygenerować obrazu/);
});
await test("generujObraz: do modelu wraca krótki tekst, nie plik", async () => {
  const tools = createAgentTools({ openrouter, searchModel: searchModel(), imageModel: imageOk() });
  const output = await createImage(imageOk(), "x");
  const forModel = await tools.generujObraz.toModelOutput!({ toolCallId: "t", input: { opis: "x" }, output });
  assert.deepEqual(forModel, { type: "text", value: "obraz wygenerowany i pokazany użytkownikowi" });
});

// 2. Agent: wybór narzędzia i obsługa błędu w jednej pętli
async function runAgent(model: MockLanguageModelV4, fetchImpl: typeof fetch, image = imageOk(), search = searchModel()) {
  const tools = createAgentTools({ openrouter, searchModel: search, imageModel: image, fetchImpl });
  return generateText({ model, tools, prompt: "test", stopWhen: isStepCount(5) });
}

await test("agent: pytanie o cenę w euro uruchamia cenaWWalucie i kończy odpowiedzią", async () => {
  const r = await runAgent(
    scriptedModel([{ toolName: "cenaWWalucie", input: { waluta: "EUR" } }, { text: "To ok. 35,29 EUR." }]),
    nbpOk,
  );
  const calls = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  assert.deepEqual(calls, ["cenaWWalucie"]);
  assert.equal(r.text, "To ok. 35,29 EUR.");
});
await test("agent: prośba o grafikę uruchamia generujObraz", async () => {
  const r = await runAgent(
    scriptedModel([{ toolName: "generujObraz", input: { opis: "plakat" } }, { text: "Gotowe." }]),
    nbpOk,
  );
  const results = r.steps.flatMap((s) => s.toolResults);
  assert.equal(results[0]?.toolName, "generujObraz");
  assert.match((results[0]?.output as { image?: string }).image ?? "", /^data:image/);
});
await test("agent: zwykłe pytanie nie uruchamia żadnego narzędzia", async () => {
  const r = await runAgent(scriptedModel([{ text: "Dzień dobry!" }]), nbpOk);
  assert.equal(r.steps.flatMap((s) => s.toolCalls).length, 0);
});
await test("agent: NBP nie działa, błąd wraca do modelu i rozmowa trwa dalej", async () => {
  const model = scriptedModel([
    { toolName: "cenaWWalucie", input: { waluta: "EUR" } },
    { text: "Nie udało się pobrać kursu z NBP." },
  ]);
  const r = await runAgent(model, nbpDown);
  const out = r.steps.flatMap((s) => s.toolResults)[0]?.output as { blad?: string };
  assert.match(out.blad ?? "", /Nie udało się pobrać kursu/);
  // drugi krok modelu dostał wynik narzędzia z błędem
  const secondPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
  assert.match(secondPrompt, /Nie udało się pobrać kursu/);
  assert.equal(r.text, "Nie udało się pobrać kursu z NBP.");
});
await test("agent: model obrazów nie działa, agent dostaje komunikat zamiast wyjątku", async () => {
  const r = await runAgent(
    scriptedModel([{ toolName: "generujObraz", input: { opis: "plakat" } }, { text: "Obraz się nie udał." }]),
    nbpOk,
    imageDown(),
  );
  const out = r.steps.flatMap((s) => s.toolResults)[0]?.output as { error?: string };
  assert.match(out.error ?? "", /Nie udało się wygenerować obrazu/);
});
await test("agent: limit 5 kroków zatrzymuje pętlę", async () => {
  const model = scriptedModel([{ toolName: "aktualnyCzas", input: {} }]); // model w kółko woła narzędzie
  const r = await runAgent(model, nbpOk);
  assert.equal(r.steps.length, 5);
});
await test("agent: cztery narzędzia w jednym zestawie", () => {
  const tools = createAgentTools({ openrouter, searchModel: searchModel(), imageModel: imageOk() });
  assert.deepEqual(Object.keys(tools).sort(), ["aktualnyCzas", "cenaWWalucie", "generujObraz", "wyszukiwanie"]);
});
await test("agent: wyszukiwanie i obraz w jednym zadaniu, źródła zostają w wyniku", async () => {
  const r = await runAgent(
    scriptedModel([
      { toolName: "wyszukiwanie", input: { zapytanie: "pogoda Kraków sobota" } },
      { toolName: "generujObraz", input: { opis: "spacer w pochmurny dzień" } },
      { text: "Gotowe." },
    ]),
    nbpOk,
  );
  const results = r.steps.flatMap((s) => s.toolResults);
  assert.deepEqual(results.map((x) => x.toolName), ["wyszukiwanie", "generujObraz"]);
  const search = results[0]?.output as { zrodla?: { url: string }[] };
  assert.equal(search.zrodla?.[0]?.url, "https://pogoda.example/krakow");
});
await test("wyszukiwanie: brak źródeł daje błąd zamiast faktów bez źródła", async () => {
  const r = await runAgent(
    scriptedModel([{ toolName: "wyszukiwanie", input: { zapytanie: "x x" } }, { text: "Brak danych." }]),
    nbpOk,
    imageOk(),
    searchModel("noSources"),
  );
  const out = r.steps.flatMap((s) => s.toolResults)[0]?.output as { blad?: string };
  assert.match(out.blad ?? "", /nie zwróciła źródeł/);
});
await test("wyszukiwanie: awaria wyszukiwarki daje komunikat", async () => {
  const r = await runAgent(
    scriptedModel([{ toolName: "wyszukiwanie", input: { zapytanie: "x x" } }, { text: "Nie działa." }]),
    nbpOk,
    imageOk(),
    searchModel("down"),
  );
  const out = r.steps.flatMap((s) => s.toolResults)[0]?.output as { blad?: string };
  assert.match(out.blad ?? "", /chwilowo niedostępne/);
});

console.log(`\nWszystkie testy przeszły: ${passed}`);
