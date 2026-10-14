export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Completion {
  content: string;
  usage: Usage;
  model: string;
}

export type StreamEvent = { type: 'delta'; text: string } | { type: 'done'; usage: Usage; model: string };

// The rest of the app depends only on this interface, so providers are swappable (and fakeable in tests).
export interface LLMProvider {
  complete(messages: ChatTurn[], signal?: AbortSignal, opts?: { maxTokens?: number }): Promise<Completion>;
  stream(messages: ChatTurn[], signal?: AbortSignal): AsyncGenerator<StreamEvent>;
}
