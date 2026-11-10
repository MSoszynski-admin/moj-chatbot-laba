import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  type LanguageModel,
} from "ai";
import {
  ANALYSIS_SYSTEM_PROMPT,
  AnalysisSchema,
  interpretModelOutput,
  wrapClientMessage,
  type AnalysisOutcome,
} from "./analysis";
import { applyGuards, type GuardWarning } from "./guards";
import { describeProviderError } from "./provider-errors";

export type AnalyzeResult =
  | (Extract<AnalysisOutcome, { ok: true }> & { warnings: GuardWarning[] })
  | Extract<AnalysisOutcome, { ok: false }>
  | { ok: false; reason: "provider"; message: string };

function withGuards(message: string, outcome: AnalysisOutcome): AnalyzeResult {
  if (!outcome.ok) return outcome;
  const guarded = applyGuards(message, outcome.analysis);
  return { ok: true, analysis: guarded.analysis, warnings: guarded.warnings };
}

/**
 * Wywołuje model w trybie structured output, a potem i tak sprawdza wynik
 * na serwerze. Sam tryb JSON u dostawcy nie wystarcza: model może odmówić,
 * odpowiedź może zostać ucięta, a dostawca może zignorować schemat.
 */
export async function analyzeMessage(
  model: LanguageModel,
  message: string,
): Promise<AnalyzeResult> {
  try {
    const result = await generateText({
      model,
      system: ANALYSIS_SYSTEM_PROMPT,
      // Wiadomość idzie jako dane w znacznikach, nigdy jako instrukcja.
      prompt: wrapClientMessage(message),
      output: Output.object({
        schema: AnalysisSchema,
        name: "analiza_wiadomosci",
        description: "Analiza wiadomości klienta Studio Nova",
      }),
      maxOutputTokens: 1000,
      maxRetries: 1,
    });

    return withGuards(message, interpretModelOutput(result.text, result.finishReason));
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return withGuards(message, interpretModelOutput(error.text, error.finishReason));
    }
    if (NoOutputGeneratedError.isInstance(error)) {
      return withGuards(message, interpretModelOutput(undefined, undefined));
    }
    return { ok: false, reason: "provider", message: describeProviderError(error) };
  }
}
