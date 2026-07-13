import { NextResponse } from "next/server";

import { getAnswerRuntimeConfig } from "@/lib/server/answer-config";
import {
  AnswerGenerationError,
  OpenAIResponsesAnswerClient,
  generateCitationBackedAnswer,
  parseAnswerRequestPayload
} from "@/lib/server/answer-service";
import { getPrisma } from "@/lib/server/db";
import { getEmbeddingRuntimeConfig } from "@/lib/server/embedding-config";
import { EmbeddingServiceError, createOpenAIEmbeddingService } from "@/lib/server/embedding-service";
import { hasStoredEmbeddings } from "@/lib/server/embedding-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseAnswerRequestPayload(payload);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const prisma = await getPrisma();
  const answerConfig = getAnswerRuntimeConfig();
  const embeddingConfig = getEmbeddingRuntimeConfig();

  if (parsed.value.mode !== "keyword") {
    if (!embeddingConfig.apiKey) {
      return NextResponse.json(
        {
          error: "OPENAI_API_KEY is required for semantic and hybrid answer retrieval.",
          retrievalMode: parsed.value.mode,
          model: answerConfig.model
        },
        { status: 503 }
      );
    }

    const hasEmbeddings = await hasStoredEmbeddings(prisma, embeddingConfig.model);

    if (!hasEmbeddings) {
      return NextResponse.json(
        {
          error: `No embeddings are stored for ${embeddingConfig.model}. Run npm run embeddings:backfill before semantic or hybrid answers.`,
          retrievalMode: parsed.value.mode,
          model: answerConfig.model
        },
        { status: 409 }
      );
    }
  }

  const embeddingService =
    parsed.value.mode === "keyword" || !embeddingConfig.apiKey
      ? undefined
      : createOpenAIEmbeddingService({
          apiKey: embeddingConfig.apiKey,
          model: embeddingConfig.model
        });
  const answerClient = answerConfig.apiKey ? new OpenAIResponsesAnswerClient(answerConfig.apiKey) : undefined;

  try {
    const answer = await generateCitationBackedAnswer(prisma, parsed.value, {
      model: answerConfig.model,
      client: answerClient,
      embeddingService
    });

    return NextResponse.json(answer);
  } catch (error) {
    if (error instanceof EmbeddingServiceError) {
      return NextResponse.json(
        {
          error: error.message,
          retrievalMode: parsed.value.mode,
          model: answerConfig.model
        },
        { status: error.code === "rate_limit" ? 429 : 502 }
      );
    }

    if (error instanceof AnswerGenerationError) {
      return NextResponse.json(
        {
          error: error.message,
          retrievalMode: parsed.value.mode,
          model: answerConfig.model
        },
        { status: getAnswerErrorStatus(error) }
      );
    }

    throw error;
  }
}

function getAnswerErrorStatus(error: AnswerGenerationError) {
  if (error.code === "missing_api_key") {
    return 503;
  }

  if (error.code === "rate_limit") {
    return 429;
  }

  return 502;
}
