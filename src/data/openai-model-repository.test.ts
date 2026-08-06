import { describe, expect, test } from "bun:test";
import { chooseOpenAiModel, fallbackOpenAiModels } from "./openai-model-repository";

describe("OpenAI model selection", () => {
  test("keeps a stored model only when the API exposes it", () => {
    expect(chooseOpenAiModel(fallbackOpenAiModels, "gpt-5.6-luna").id).toBe("gpt-5.6-luna");
  });

  test("replaces an invalid stored model with the preferred available model", () => {
    expect(chooseOpenAiModel(fallbackOpenAiModels, "orbit-test-model").id).toBe("gpt-5.6-sol");
  });
});
