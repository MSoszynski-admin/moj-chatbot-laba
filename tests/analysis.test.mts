// Testy walidacji analizy Studio Nova (lekcja 2, W2 i W3).
// Bez wywołań prawdziwego modelu: model zastępuje MockLanguageModelV4,
// więc testy nic nie kosztują. Uruchom: npm run test:analysis

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { interpretModelOutput, validateAnalysis } from "../lib/analysis";
import { analyzeMessage } from "../lib/analyze-message";

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

function mockModel(text: string, finish: "stop" | "length" | "content-filter" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: finish, raw: finish },
      usage,
      warnings: [],
    }),
  });
}

const valid = {
  category: "sales",
  priority: "normal",
  draft: "Konsultacja online trwa 45 minut i kosztuje 150 zł brutto.",
  needs_review: false,
};

// 1. Cztery niepoprawne wyniki z materiałów kursu (dane/niepoprawne_wyniki.json)
const invalid: unknown[] = JSON.parse(
  readFileSync(new URL("./niepoprawne_wyniki.json", import.meta.url), "utf8"),
);
const labels = [
  "brak pola draft",
  'needs_review jako tekst "false"',
  "category = marketing",
  "dodatkowe pole send_now",
];

await test("poprawny wynik przechodzi walidację", () => {
  const r = validateAnalysis(valid);
  assert.equal(r.ok, true);
});

for (const [i, example] of invalid.entries()) {
  await test(`odrzucony: ${labels[i]}`, () => {
    const r = validateAnalysis(example);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "schema_mismatch");
      console.log(`        powód: ${r.issues?.join("; ")}`);
    }
  });
}

// 2. Odmowa, ucięcie i błąd formatu (surowa odpowiedź modelu)
await test("odpowiedź ucięta (finishReason=length) jest odrzucona", () => {
  const r = interpretModelOutput(JSON.stringify(valid), "length");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "truncated"]);
});
await test("blokada dostawcy (content-filter) to odmowa", () => {
  const r = interpretModelOutput("", "content-filter");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "refusal"]);
});
await test("zwykły tekst zamiast JSON to odmowa", () => {
  const r = interpretModelOutput("Przykro mi, nie mogę w tym pomóc.", "stop");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "refusal"]);
});
await test("urwany JSON to błąd formatu", () => {
  const r = interpretModelOutput('{"category": "sales", "draft": "Kons', "stop");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "invalid_json"]);
});

// 3. Cała ścieżka przez AI SDK (structured output) z kontrolowanym modelem
await test("SDK: poprawna odpowiedź modelu daje 4 pola", async () => {
  const r = await analyzeMessage(mockModel(JSON.stringify(valid)), "Ile kosztuje konsultacja?");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(Object.keys(r.analysis).sort(), ["category", "draft", "needs_review", "priority"]);
});
await test("SDK: model dokłada send_now, wynik odrzucony", async () => {
  const r = await analyzeMessage(mockModel(JSON.stringify({ ...valid, send_now: true })), "test");
  assert.equal(r.ok, false);
});
await test("SDK: model odmawia zwykłym tekstem", async () => {
  const r = await analyzeMessage(mockModel("Nie mogę tego zrobić."), "test");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "refusal"]);
});
await test("SDK: odpowiedź przerwana limitem tokenów", async () => {
  const r = await analyzeMessage(mockModel('{"category":"sales","priority":"nor', "length"), "test");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "truncated"]);
});
await test("SDK: błąd dostawcy (HTTP 500) nie udaje wyniku", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: "Internal error",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 500,
        isRetryable: false,
      });
    },
  });
  const r = await analyzeMessage(model, "test");
  assert.deepEqual([r.ok, !r.ok && r.reason], [false, "provider"]);
});
await test("SDK: model dostaje instrukcję jako system, wiadomość jako dane", async () => {
  const model = mockModel(JSON.stringify(valid));
  await analyzeMessage(model, "Ile kosztuje konsultacja?");
  const prompt = model.doGenerateCalls[0].prompt;
  assert.equal(prompt[0].role, "system");
  assert.match(String(prompt[0].content), /Studio Nova/);
  assert.equal(prompt.filter((m) => m.role === "system").length, 1);
  assert.equal(prompt.at(-1)?.role, "user");
});

await test("SDK: do modelu idzie JSON Schema (structured output, bez dodatkowych pól)", async () => {
  const model = mockModel(JSON.stringify(valid));
  await analyzeMessage(model, "test");
  const format = model.doGenerateCalls[0].responseFormat as {
    type: string;
    schema?: { additionalProperties?: boolean; required?: string[] };
  };
  assert.equal(format.type, "json");
  assert.equal(format.schema?.additionalProperties, false);
  assert.deepEqual(format.schema?.required?.sort(), ["category", "draft", "needs_review", "priority"]);
});

console.log(`\nWszystkie testy przeszły: ${passed}`);
