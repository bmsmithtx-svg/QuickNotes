import { normalizeVector } from "./vector-utils";

export type EmbeddingErrorCode =
  | "authentication"
  | "missing_api_key"
  | "rate_limit"
  | "model_unavailable"
  | "malformed_response"
  | "request_failed";

export class EmbeddingServiceError extends Error {
  constructor(
    message: string,
    readonly code: EmbeddingErrorCode,
    readonly status?: number
  ) {
    super(message);
    this.name = "EmbeddingServiceError";
  }
}

export type EmbeddingClientResponse = {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  model?: string;
};

export type EmbeddingClient = {
  createEmbeddings(input: string[], model: string): Promise<EmbeddingClientResponse>;
};

export type EmbeddingServiceOptions = {
  model: string;
  batchSize?: number;
  client: EmbeddingClient;
};

export class EmbeddingService {
  readonly model: string;
  private readonly batchSize: number;
  private readonly client: EmbeddingClient;

  constructor({ model, batchSize = 64, client }: EmbeddingServiceOptions) {
    this.model = model;
    this.batchSize = Math.max(1, Math.trunc(batchSize));
    this.client = client;
  }

  async embedTexts(texts: string[]) {
    if (texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      const response = await this.client.createEmbeddings(batch, this.model);
      const batchEmbeddings = validateEmbeddingResponse(response, batch.length);
      embeddings.push(...batchEmbeddings.map(normalizeVector));
    }

    const dimensions = embeddings[0]?.length;

    if (!dimensions) {
      throw new EmbeddingServiceError("OpenAI returned no embeddings.", "malformed_response");
    }

    for (const embedding of embeddings) {
      if (embedding.length !== dimensions) {
        throw new EmbeddingServiceError(
          `OpenAI returned inconsistent embedding dimensions for model ${this.model}.`,
          "malformed_response"
        );
      }
    }

    return embeddings;
  }
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) {
      throw new EmbeddingServiceError("OPENAI_API_KEY is required for embeddings.", "missing_api_key");
    }
  }

  async createEmbeddings(input: string[], model: string): Promise<EmbeddingClientResponse> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input,
        model,
        encoding_format: "float"
      })
    });

    if (!response.ok) {
      throw await toEmbeddingServiceError(response, model);
    }

    const payload = (await response.json()) as unknown;

    if (!isEmbeddingClientResponse(payload)) {
      throw new EmbeddingServiceError("OpenAI returned a malformed embeddings response.", "malformed_response");
    }

    return payload;
  }
}

export function createOpenAIEmbeddingService({
  apiKey,
  model,
  batchSize
}: {
  apiKey: string;
  model: string;
  batchSize?: number;
}) {
  return new EmbeddingService({
    model,
    batchSize,
    client: new OpenAIEmbeddingClient(apiKey)
  });
}

function validateEmbeddingResponse(response: EmbeddingClientResponse, expectedCount: number) {
  if (!Array.isArray(response.data) || response.data.length !== expectedCount) {
    throw new EmbeddingServiceError("OpenAI returned the wrong number of embeddings.", "malformed_response");
  }

  return [...response.data]
    .sort((left, right) => left.index - right.index)
    .map((item, expectedIndex) => {
      if (item.index !== expectedIndex) {
        throw new EmbeddingServiceError("OpenAI returned embeddings with unexpected indexes.", "malformed_response");
      }

      if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
        throw new EmbeddingServiceError("OpenAI returned an empty embedding vector.", "malformed_response");
      }

      for (const value of item.embedding) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new EmbeddingServiceError("OpenAI returned a non-numeric embedding value.", "malformed_response");
        }
      }

      return item.embedding;
    });
}

async function toEmbeddingServiceError(response: Response, model: string) {
  const status = response.status;
  const message = await readSafeErrorMessage(response);

  if (status === 401 || status === 403) {
    return new EmbeddingServiceError(
      "OpenAI rejected the embedding request. Check OPENAI_API_KEY permissions and billing access.",
      "authentication",
      status
    );
  }

  if (status === 429) {
    return new EmbeddingServiceError(
      "OpenAI rate-limited the embedding request. Retry later or reduce batch size.",
      "rate_limit",
      status
    );
  }

  if (status === 400 || status === 404) {
    return new EmbeddingServiceError(
      `OpenAI could not use embedding model ${model}. Check OPENAI_EMBEDDING_MODEL. ${message}`,
      "model_unavailable",
      status
    );
  }

  return new EmbeddingServiceError(
    `OpenAI embedding request failed with HTTP ${status}. ${message}`,
    "request_failed",
    status
  );
}

async function readSafeErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    const message = payload.error?.message;

    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

function isEmbeddingClientResponse(payload: unknown): payload is EmbeddingClientResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const maybeResponse = payload as { data?: unknown };

  return Array.isArray(maybeResponse.data);
}
