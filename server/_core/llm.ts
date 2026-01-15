import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};
export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;

export type ResponseFormat = "text" | "json_object" | "json_schema";
export type JsonSchema = {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};
export type OutputSchema = JsonSchema["schema"];

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  model?: string;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type InvokeResult = {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// Determine which API to use
type ApiProvider = "openai" | "forge";

function getApiProvider(): ApiProvider {
  // Prefer OpenAI if key is available
  if (ENV.openaiApiKey && ENV.openaiApiKey.trim().length > 0) {
    return "openai";
  }
  // Fall back to Forge if available
  if (ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0) {
    return "forge";
  }
  throw new Error("No LLM API key configured. Set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY");
}

function getApiUrl(provider: ApiProvider): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1/chat/completions";
  }
  // Forge
  return ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";
}

function getApiKey(provider: ApiProvider): string {
  if (provider === "openai") {
    return ENV.openaiApiKey;
  }
  return ENV.forgeApiKey;
}

function getDefaultModel(provider: ApiProvider): string {
  if (provider === "openai") {
    return "gpt-4o-mini"; // Cost-effective for cleanup tasks
  }
  return "gemini-2.5-flash";
}

const normalizeMessage = (msg: Message): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.name) result.name = msg.name;
  if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id;
  return result;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat === "text") return { type: "text" };
    if (explicitFormat === "json_object") return { type: "json_object" };
  }
  const schema = outputSchema || output_schema;
  if (schema) {
    return {
      type: "json_schema",
      json_schema: {
        name: "output",
        schema,
        strict: true,
      },
    };
  }
  return undefined;
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const provider = getApiProvider();
  const apiUrl = getApiUrl(provider);
  const apiKey = getApiKey(provider);
  const defaultModel = getDefaultModel(provider);

  console.log(`[LLM] Using provider: ${provider}`);

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    model,
    maxTokens,
    max_tokens,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model: model || defaultModel,
    messages: messages.map(normalizeMessage),
  };

  const resolvedMaxTokens = maxTokens ?? max_tokens;
  if (resolvedMaxTokens) payload.max_tokens = resolvedMaxTokens;

  if (tools && tools.length > 0) {
    payload.tools = tools;
    const tc = toolChoice || tool_choice;
    if (tc) {
      if (typeof tc === "string") {
        payload.tool_choice = tc;
      } else if ("name" in tc) {
        payload.tool_choice = { type: "function", function: { name: tc.name } };
      } else {
        payload.tool_choice = tc;
      }
    }
  }

  const fmt = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });
  if (fmt) payload.response_format = fmt;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
