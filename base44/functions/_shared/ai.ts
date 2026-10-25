// ai.ts — model transport for the Base44 backend.
//
// convex/nebius.ts streamed from Nebius Token Factory; the Base44 runtime's
// InvokeLLM is a managed call with no key to provision and no streaming —
// callers that mirrored tokens mid-flight (the deal's `live` query) get the
// full answer in one write instead. Everything else (prompts, parsing,
// decide letters) is unchanged.

type Client = { integrations: { Core: { InvokeLLM(p: any): Promise<any> } } };

export type ChatResult = {
  content: string;
  error: string | null;
  status: number;
  firstTokenMs: number | null;
  firstLineMs: number | null;
  totalMs: number;
  finish: string;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
};

/** streamChat parity: one completion. `onText` fires once with the answer. */
export async function streamChat(
  base44: Client,
  args: {
    model: string;
    maxTokens?: number;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    onText?: (content: string) => void;
  },
): Promise<ChatResult> {
  const t0 = Date.now();
  const prompt = args.messages.map((m) => m.content).join("\n\n");
  try {
    const res = await base44.integrations.Core.InvokeLLM({ prompt });
    const content = typeof res === "string" ? res : JSON.stringify(res ?? "");
    args.onText?.(content);
    return {
      content,
      error: null,
      status: 200,
      firstTokenMs: null,
      firstLineMs: null,
      totalMs: Date.now() - t0,
      finish: "stop",
      usage: null,
    };
  } catch (err) {
    return {
      content: "",
      error: String((err as Error)?.message ?? err).slice(0, 200),
      status: 0,
      firstTokenMs: null,
      firstLineMs: null,
      totalMs: Date.now() - t0,
      finish: "error",
      usage: null,
    };
  }
}

export type LetterResult = {
  status: number;
  letter: string | null;
  conf: number | null;
  top: { card: string; p: number }[];
  usage: null;
  ms: number;
  error?: string | null;
};

/** chooseLetter parity: the decide pass's one-letter pick with confidence. */
export async function chooseLetter(
  base44: Client,
  args: {
    model: string;
    messages: { role: "system" | "user"; content: string }[];
    letters: string[];
  },
): Promise<LetterResult> {
  const t0 = Date.now();
  const prompt =
    `${args.messages.map((m) => m.content).join("\n\n")}\n\n` +
    `Reply with one JSON object only: {"letter":"<one letter>","p":<0..1 confidence>}.`;
  try {
    const res = await base44.integrations.Core.InvokeLLM({ prompt });
    const text = typeof res === "string" ? res : JSON.stringify(res ?? "");
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as {
      letter?: string;
      p?: number;
    };
    const letter = typeof parsed.letter === "string" ? parsed.letter.trim().toUpperCase() : null;
    const ok = letter !== null && args.letters.includes(letter);
    return {
      status: 200,
      letter: ok ? letter : null,
      conf: typeof parsed.p === "number" ? parsed.p : null,
      top: ok ? [{ card: letter!, p: parsed.p ?? 0 }] : [],
      usage: null,
      ms: Date.now() - t0,
      error: ok ? null : `unreadable: ${text.slice(0, 80)}`,
    };
  } catch (err) {
    return {
      status: 0,
      letter: null,
      conf: null,
      top: [],
      usage: null,
      ms: Date.now() - t0,
      error: String((err as Error)?.message ?? err).slice(0, 200),
    };
  }
}
