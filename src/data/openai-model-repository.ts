import { invoke } from "@tauri-apps/api/core";

export interface OpenAiModelOption {
  id: string;
  label: string;
  description: string;
}

export const fallbackOpenAiModels: OpenAiModelOption[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "최고 품질" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "품질·비용 균형" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "빠르고 경제적" },
];

const modelMetadata = new Map(fallbackOpenAiModels.map((model) => [model.id, model]));

export async function listAvailableOpenAiModels(): Promise<OpenAiModelOption[]> {
  const ids = await invoke<string[]>("list_openai_chat_models");
  return ids.map((id) => modelMetadata.get(id) || {
    id,
    label: id.replace(/^gpt-/, "GPT-").replace(/(^|[-.])(\w)/g, (match) => match.toUpperCase()),
    description: "OpenAI 텍스트 모델",
  });
}

export function chooseOpenAiModel(models: OpenAiModelOption[], stored?: string): OpenAiModelOption {
  const saved = stored && models.find((model) => model.id === stored);
  return saved || models.find((model) => model.id === "gpt-5.6-sol") || models[0] || fallbackOpenAiModels[0];
}
