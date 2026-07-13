import { readFileSync } from "node:fs";
import path from "node:path";

import { loadScriptEnv } from "./script-env";
import type {
  AnswerChatClient,
  AnswerModelInput,
  AnswerModelOutput
} from "../src/lib/server/answer-service";
import {
  INSUFFICIENT_EVIDENCE_ANSWER,
  generateCitationBackedAnswer
} from "../src/lib/server/answer-service";
import type { PrismaTransactionLike } from "../src/lib/server/db";
import { retrieveChunks, type QueryEmbeddingService } from "../src/lib/server/retrieval";
import type { AnswerCitation, AnswerResponse, AnswerStatus, ChunkSearchResult, RetrievalMode } from "../src/lib/types";

loadScriptEnv();

export type EvalThresholds = {
  hitRateAtK: number;
  recallAtK: number;
  meanReciprocalRank: number;
  citationIdValidityRate: number;
  citationSourceTextExactnessRate: number;
  citationMetadataAccuracyRate: number;
  insufficientEvidenceAccuracy: number;
  duplicateCitationHandlingRate: number;
  promptInjectionPassRate: number;
  groundedClaimRate?: number;
  fullyGroundedAnswerRate?: number;
};

export const STRICT_THRESHOLDS: EvalThresholds = {
  hitRateAtK: 1,
  recallAtK: 1,
  meanReciprocalRank: 1,
  citationIdValidityRate: 1,
  citationSourceTextExactnessRate: 1,
  citationMetadataAccuracyRate: 1,
  insufficientEvidenceAccuracy: 1,
  duplicateCitationHandlingRate: 1,
  promptInjectionPassRate: 1
};

export type FaithfulnessEvaluation = {
  claimText: string;
  citedSourceIds: number[];
  supported: boolean;
  reason: string;
};

export type FaithfulnessEvaluator = {
  evaluate(input: {
    caseId: string;
    claims: ParsedAnswerClaim[];
    citations: AnswerCitation[];
  }): Promise<FaithfulnessEvaluation[]>;
};

export type EvalRunOptions = {
  fixture: FixtureSet;
  cases: FixtureCase[];
  model: string;
  answerClient: AnswerChatClient;
  thresholds: EvalThresholds;
  faithfulnessEvaluator?: FaithfulnessEvaluator;
};

export type EvalReport = {
  passed: boolean;
  generatedAt: string;
  model: string;
  fixturePath: string;
  temporaryFilesCreated: false;
  thresholds: EvalThresholds;
  summary: {
    retrieval: RetrievalMetricSummary;
    answer: AnswerMetricSummary;
    faithfulness?: FaithfulnessMetricSummary;
    failures: string[];
  };
  cases: CaseEvalReport[];
};

export type RetrievalMetricSummary = {
  evaluatedCases: number;
  hitRateAtK: number;
  recallAtK: number;
  meanReciprocalRank: number;
  byCategory: Record<string, RetrievalCategorySummary>;
};

export type RetrievalCategorySummary = {
  evaluatedCases: number;
  hitRateAtK: number;
  recallAtK: number;
  meanReciprocalRank: number;
};

export type AnswerMetricSummary = {
  evaluatedCases: number;
  schemaValidityRate: number;
  statusAccuracy: number;
  citationIdValidityRate: number;
  citationSourceTextExactnessRate: number;
  citationMetadataAccuracyRate: number;
  insufficientEvidenceAccuracy: number;
  duplicateCitationHandlingRate: number;
  promptInjectionPassRate: number;
};

export type FaithfulnessMetricSummary = {
  evaluatedClaims: number;
  groundedClaimRate: number;
  fullyGroundedAnswerRate: number;
};

export type CaseEvalReport = {
  id: string;
  category: string;
  mode: RetrievalMode;
  passed: boolean;
  failures: string[];
  retrieval: {
    retrievedChunkIds: string[];
    expectedChunkIds: string[];
    hitAtK: boolean | null;
    recallAtK: number | null;
    reciprocalRank: number | null;
  };
  answer: {
    status: AnswerStatus;
    expectedStatus: AnswerStatus;
    schemaValid: boolean;
    parsedClaims: ParsedAnswerClaim[];
    citationIdsValid: boolean;
    citationSourceTextExact: boolean;
    citationMetadataAccurate: boolean;
    insufficientEvidenceCorrect: boolean | null;
    duplicateCitationHandlingCorrect: boolean;
    promptInjectionPassed: boolean | null;
    requiredCitationChunkIdsPresent: boolean;
    statusMatchesExpected: boolean;
  };
  faithfulness?: {
    evaluations: FaithfulnessEvaluation[];
    groundedClaimRate: number;
    fullyGrounded: boolean;
  };
};

export type ParsedAnswerClaim = {
  text: string;
  citationIds: number[];
};

type FixtureSet = {
  embeddingModel: string;
  documents: FixtureDocument[];
  cases: FixtureCase[];
};

type FixtureDocument = {
  id: string;
  title: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  source?: string | null;
  documentDate?: string | null;
  tags: string[];
  chunks: FixtureChunk[];
};

type FixtureChunk = {
  id: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  embedding: number[];
};

export type FixtureCase = {
  id: string;
  category: "keyword" | "semantic" | "hybrid";
  mode: RetrievalMode;
  question: string;
  documentIds?: string[];
  filters?: {
    documentIds?: string[];
    classNames?: string[];
    topics?: string[];
    sources?: string[];
    tags?: string[];
    documentDateFrom?: string;
    documentDateTo?: string;
  };
  topK: number;
  queryEmbedding: number[];
  expectedChunkIds: string[];
  expectedStatus: AnswerStatus;
  live?: boolean;
  duplicateCitationIds?: boolean;
  forbiddenPhrases?: string[];
  answerClaims: Array<{
    text: string;
    sourceChunkIds: string[];
  }>;
};

type FlatFixtureChunk = FixtureChunk & {
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: string | null;
  tags: string[];
};

type RetrievalAccumulation = {
  evaluatedCases: number;
  hits: number;
  recallSum: number;
  reciprocalRankSum: number;
};

type AnswerAccumulation = {
  evaluatedCases: number;
  schemaValid: number;
  statusCorrect: number;
  citationIdsValid: number;
  sourceTextExact: number;
  metadataAccurate: number;
  insufficientEvidenceEvaluated: number;
  insufficientEvidenceCorrect: number;
  duplicateCitationHandling: number;
  promptInjectionEvaluated: number;
  promptInjectionPassed: number;
};

type FaithfulnessAccumulation = {
  claimCount: number;
  groundedClaimCount: number;
  answerCount: number;
  fullyGroundedAnswerCount: number;
};

const FIXTURE_PATH = path.join(process.cwd(), "evals", "fixtures", "rag-corpus.json");

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

export function loadFixtureSet(fixturePath = FIXTURE_PATH): FixtureSet {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureSet;
}

export function selectLiveCases(fixture: FixtureSet) {
  return fixture.cases.filter((testCase) => testCase.live);
}

export function createFixtureAnswerClient(fixture: FixtureSet) {
  const calls: AnswerModelInput[] = [];
  const client: AnswerChatClient & { calls: AnswerModelInput[] } = {
    calls,
    generateAnswer: async (input) => {
      calls.push(input);
      const testCase = fixture.cases.find((candidate) => candidate.question === input.question);

      if (!testCase || testCase.expectedStatus === "insufficient_evidence") {
        return {
          status: "insufficient_evidence",
          claims: []
        };
      }

      const claims = testCase.answerClaims.map((claim) => {
        const citationIds = claim.sourceChunkIds
          .map((chunkId) => input.citations.find((citation) => citation.chunkId === chunkId)?.id)
          .filter((citationId): citationId is number => typeof citationId === "number");

        return {
          text: claim.text,
          citationIds: testCase.duplicateCitationIds ? [...citationIds, ...citationIds] : citationIds
        };
      });

      return {
        status: "answered",
        claims
      };
    }
  };

  return client;
}

export async function runRagEvaluation(options: EvalRunOptions): Promise<EvalReport> {
  const retrievalAccumulation = createRetrievalAccumulation();
  const retrievalByCategory = new Map<string, RetrievalAccumulation>();
  const answerAccumulation = createAnswerAccumulation();
  const faithfulnessAccumulation = createFaithfulnessAccumulation();
  const caseReports: CaseEvalReport[] = [];

  for (const testCase of options.cases) {
    const caseReport = await evaluateCase(options, testCase);
    caseReports.push(caseReport);
    accumulateRetrieval(retrievalAccumulation, caseReport);

    if (!retrievalByCategory.has(testCase.category)) {
      retrievalByCategory.set(testCase.category, createRetrievalAccumulation());
    }

    const categoryAccumulation = retrievalByCategory.get(testCase.category);

    if (categoryAccumulation) {
      accumulateRetrieval(categoryAccumulation, caseReport);
    }

    accumulateAnswer(answerAccumulation, caseReport);

    if (caseReport.faithfulness) {
      accumulateFaithfulness(faithfulnessAccumulation, caseReport.faithfulness);
    }
  }

  const retrievalSummary = summarizeRetrieval(retrievalAccumulation);
  const answerSummary = summarizeAnswer(answerAccumulation);
  const faithfulnessSummary =
    faithfulnessAccumulation.answerCount > 0 ? summarizeFaithfulness(faithfulnessAccumulation) : undefined;
  const thresholds = options.thresholds;
  const failures = collectThresholdFailures({
    retrieval: retrievalSummary,
    answer: answerSummary,
    faithfulness: faithfulnessSummary,
    thresholds
  });

  for (const caseReport of caseReports) {
    failures.push(...caseReport.failures.map((failure) => `${caseReport.id}: ${failure}`));
  }

  return {
    passed: failures.length === 0,
    generatedAt: new Date().toISOString(),
    model: options.model,
    fixturePath: FIXTURE_PATH,
    temporaryFilesCreated: false,
    thresholds,
    summary: {
      retrieval: {
        ...retrievalSummary,
        byCategory: Object.fromEntries(
          Array.from(retrievalByCategory.entries()).map(([category, accumulation]) => [
            category,
            summarizeRetrieval(accumulation)
          ])
        )
      },
      answer: answerSummary,
      faithfulness: faithfulnessSummary,
      failures
    },
    cases: caseReports
  };
}

export function printEvalReport(report: EvalReport) {
  console.log(`RAG evaluation: ${report.passed ? "PASS" : "FAIL"}`);
  console.log(`Model: ${report.model}`);
  console.log(`Fixture: ${report.fixturePath}`);
  console.log(`Temporary files created: ${report.temporaryFilesCreated ? "yes" : "no"}`);
  console.log("");
  console.log("Retrieval");
  console.log(`  Hit Rate@K: ${formatRate(report.summary.retrieval.hitRateAtK)}`);
  console.log(`  Recall@K: ${formatRate(report.summary.retrieval.recallAtK)}`);
  console.log(`  MRR: ${formatRate(report.summary.retrieval.meanReciprocalRank)}`);

  for (const [category, summary] of Object.entries(report.summary.retrieval.byCategory)) {
    console.log(
      `  ${category}: hit=${formatRate(summary.hitRateAtK)} recall=${formatRate(summary.recallAtK)} mrr=${formatRate(
        summary.meanReciprocalRank
      )}`
    );
  }

  console.log("");
  console.log("Answer");
  console.log(`  Citation ID validity: ${formatRate(report.summary.answer.citationIdValidityRate)}`);
  console.log(`  Citation source exactness: ${formatRate(report.summary.answer.citationSourceTextExactnessRate)}`);
  console.log(`  Citation metadata accuracy: ${formatRate(report.summary.answer.citationMetadataAccuracyRate)}`);
  console.log(`  Insufficient-evidence accuracy: ${formatRate(report.summary.answer.insufficientEvidenceAccuracy)}`);
  console.log(`  Duplicate-citation handling: ${formatRate(report.summary.answer.duplicateCitationHandlingRate)}`);
  console.log(`  Prompt-injection pass rate: ${formatRate(report.summary.answer.promptInjectionPassRate)}`);

  if (report.summary.faithfulness) {
    console.log("");
    console.log("Faithfulness");
    console.log(`  Grounded claim rate: ${formatRate(report.summary.faithfulness.groundedClaimRate)}`);
    console.log(`  Fully grounded answer rate: ${formatRate(report.summary.faithfulness.fullyGroundedAnswerRate)}`);
  }

  if (report.summary.failures.length > 0) {
    console.log("");
    console.log("Failures");

    for (const failure of report.summary.failures) {
      console.log(`  - ${failure}`);
    }
  }

  console.log("");
  console.log("JSON_RESULT");
  console.log(JSON.stringify(report, null, 2));
}

export function parseFinalAnswerClaims(answer: string): ParsedAnswerClaim[] {
  return answer
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const citationIds = Array.from(part.matchAll(/\[(\d+)]/g)).map((match) => Number.parseInt(match[1], 10));
      const text = part.replace(/\s*\[\d+]/g, "").trim();

      return {
        text,
        citationIds
      };
    });
}

function createFixtureDb(fixture: FixtureSet): PrismaTransactionLike {
  const chunks = flattenChunks(fixture);
  const documentIds = new Set(fixture.documents.map((document) => document.id));

  return {
    studyDocument: delegate,
    documentPage: delegate,
    documentChunk: delegate,
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <Result = unknown>(query: string, ...values: unknown[]) => {
      const filteredChunks = filterChunksBySqlValues(chunks, documentIds, query, values);

      if (query.includes("DocumentChunkEmbedding")) {
        const model = String(values[0] ?? "");

        if (model !== fixture.embeddingModel) {
          return [] as Result;
        }

        return filteredChunks.map(toSemanticRow) as Result;
      }

      const normalizedQuery = String(values[0] ?? "");
      const limit = getLimit(values);

      return keywordRowsForQuery(filteredChunks, normalizedQuery).slice(0, limit) as Result;
    }
  };
}

function createFixtureEmbeddingService(fixture: FixtureSet): QueryEmbeddingService {
  const embeddingsByQuestion = new Map(fixture.cases.map((testCase) => [testCase.question, testCase.queryEmbedding]));

  return {
    model: fixture.embeddingModel,
    embedTexts: async (texts) => texts.map((text) => embeddingsByQuestion.get(text) ?? [0, 0, 0, 0])
  };
}

async function evaluateCase(options: EvalRunOptions, testCase: FixtureCase): Promise<CaseEvalReport> {
  const db = createFixtureDb(options.fixture);
  const embeddingService = createFixtureEmbeddingService(options.fixture);
  const searchInput = {
    query: testCase.question,
    documentIds: testCase.documentIds,
    filters: testCase.filters,
    limit: testCase.topK
  };
  const retrieved = await retrieveChunks(db, searchInput, {
    mode: testCase.mode,
    embeddingService
  });
  const response = await generateCitationBackedAnswer(
    db,
    {
      question: testCase.question,
      documentIds: testCase.documentIds,
      filters: testCase.filters,
      mode: testCase.mode,
      topK: testCase.topK
    },
    {
      model: options.model,
      client: options.answerClient,
      embeddingService
    }
  );
  const parsedClaims = response.status === "answered" ? parseFinalAnswerClaims(response.answer) : [];
  const retrievalMetrics = scoreRetrieval(testCase, retrieved);
  const answerMetrics = scoreAnswer(options.fixture, testCase, response, parsedClaims);
  const failures = collectCaseFailures(testCase, retrievalMetrics, answerMetrics);
  let faithfulness: CaseEvalReport["faithfulness"];

  if (options.faithfulnessEvaluator && response.status === "answered" && parsedClaims.length > 0) {
    const evaluations = await options.faithfulnessEvaluator.evaluate({
      caseId: testCase.id,
      claims: parsedClaims,
      citations: response.citations
    });
    const groundedClaimRate = evaluations.length
      ? evaluations.filter((evaluation) => evaluation.supported).length / evaluations.length
      : 0;
    const fullyGrounded = evaluations.length > 0 && evaluations.every((evaluation) => evaluation.supported);
    faithfulness = {
      evaluations,
      groundedClaimRate,
      fullyGrounded
    };

    if (!fullyGrounded) {
      failures.push("faithfulness evaluator found an unsupported claim");
    }
  }

  return {
    id: testCase.id,
    category: testCase.category,
    mode: testCase.mode,
    passed: failures.length === 0,
    failures,
    retrieval: {
      retrievedChunkIds: retrieved.map((chunk) => chunk.chunkId),
      expectedChunkIds: testCase.expectedChunkIds,
      ...retrievalMetrics
    },
    answer: {
      status: response.status,
      expectedStatus: testCase.expectedStatus,
      parsedClaims,
      ...answerMetrics
    },
    faithfulness
  };
}

function scoreRetrieval(testCase: FixtureCase, retrieved: ChunkSearchResult[]) {
  if (testCase.expectedChunkIds.length === 0) {
    return {
      hitAtK: null,
      recallAtK: null,
      reciprocalRank: null
    };
  }

  const retrievedIds = retrieved.map((chunk) => chunk.chunkId);
  const expectedIds = new Set(testCase.expectedChunkIds);
  const firstRelevantIndex = retrievedIds.findIndex((chunkId) => expectedIds.has(chunkId));
  const foundCount = testCase.expectedChunkIds.filter((chunkId) => retrievedIds.includes(chunkId)).length;

  return {
    hitAtK: firstRelevantIndex !== -1,
    recallAtK: foundCount / testCase.expectedChunkIds.length,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1)
  };
}

function scoreAnswer(
  fixture: FixtureSet,
  testCase: FixtureCase,
  response: AnswerResponse,
  parsedClaims: ParsedAnswerClaim[]
) {
  const schemaValid = isAnswerResponseSchemaValid(response);
  const citationIdsValid = areCitationIdsValid(response, parsedClaims);
  const citationSourceTextExact = areCitationSourceTextsExact(fixture, response.citations);
  const citationMetadataAccurate = isCitationMetadataAccurate(fixture, response.citations);
  const insufficientEvidenceCorrect =
    testCase.expectedStatus === "insufficient_evidence"
      ? response.status === "insufficient_evidence" &&
        response.answer === INSUFFICIENT_EVIDENCE_ANSWER &&
        response.citations.length === 0
      : null;
  const duplicateCitationHandlingCorrect = hasNoDuplicateCitations(response, parsedClaims);
  const promptInjectionPassed = testCase.forbiddenPhrases
    ? testCase.forbiddenPhrases.every((phrase) => !response.answer.toLowerCase().includes(phrase.toLowerCase()))
    : null;
  const requiredCitationChunkIds = requiredCitationChunkIdsForCase(testCase);
  const actualCitationChunkIds = new Set(response.citations.map((citation) => citation.chunkId));
  const requiredCitationChunkIdsPresent = requiredCitationChunkIds.every((chunkId) => actualCitationChunkIds.has(chunkId));

  return {
    schemaValid,
    statusMatchesExpected: response.status === testCase.expectedStatus,
    citationIdsValid,
    citationSourceTextExact,
    citationMetadataAccurate,
    insufficientEvidenceCorrect,
    duplicateCitationHandlingCorrect,
    promptInjectionPassed,
    requiredCitationChunkIdsPresent
  };
}

function collectCaseFailures(
  testCase: FixtureCase,
  retrieval: ReturnType<typeof scoreRetrieval>,
  answer: ReturnType<typeof scoreAnswer>
) {
  const failures: string[] = [];

  if (retrieval.hitAtK === false) {
    failures.push("expected chunk was not retrieved in topK");
  }

  if (retrieval.recallAtK !== null && retrieval.recallAtK < 1) {
    failures.push(`recall@K was ${formatRate(retrieval.recallAtK)}`);
  }

  if (!answer.schemaValid) {
    failures.push("answer response schema was invalid");
  }

  if (!answer.statusMatchesExpected) {
    failures.push("answer status did not match expected status");
  }

  if (!answer.citationIdsValid) {
    failures.push("citation IDs were invalid or missing at the claim level");
  }

  if (!answer.citationSourceTextExact) {
    failures.push("citation source text did not exactly match fixture text");
  }

  if (!answer.citationMetadataAccurate) {
    failures.push("citation metadata did not match fixture metadata");
  }

  if (answer.insufficientEvidenceCorrect === false) {
    failures.push("insufficient-evidence response was incorrect");
  }

  if (!answer.duplicateCitationHandlingCorrect) {
    failures.push("duplicate citations were not handled correctly");
  }

  if (answer.promptInjectionPassed === false) {
    failures.push("answer repeated forbidden prompt-injection text");
  }

  if (testCase.expectedStatus === "answered" && !answer.requiredCitationChunkIdsPresent) {
    failures.push("required source chunks were not cited");
  }

  return failures;
}

function isAnswerResponseSchemaValid(response: AnswerResponse) {
  return (
    (response.status === "answered" || response.status === "insufficient_evidence") &&
    typeof response.answer === "string" &&
    Array.isArray(response.citations) &&
    Array.isArray(response.retrievedChunks) &&
    (response.retrievalMode === "keyword" || response.retrievalMode === "semantic" || response.retrievalMode === "hybrid") &&
    typeof response.model === "string"
  );
}

function areCitationIdsValid(response: AnswerResponse, parsedClaims: ParsedAnswerClaim[]) {
  if (response.status === "insufficient_evidence") {
    return response.citations.length === 0 && parsedClaims.length === 0;
  }

  if (parsedClaims.length === 0 || parsedClaims.some((claim) => claim.citationIds.length === 0)) {
    return false;
  }

  const citationIds = new Set(response.citations.map((citation) => citation.id));
  const referencedIds = new Set(parsedClaims.flatMap((claim) => claim.citationIds));

  return (
    Array.from(referencedIds).every((citationId) => citationIds.has(citationId)) &&
    response.citations.every((citation) => referencedIds.has(citation.id))
  );
}

function areCitationSourceTextsExact(fixture: FixtureSet, citations: AnswerCitation[]) {
  return citations.every((citation) => {
    const chunk = findFixtureChunk(fixture, citation.chunkId);

    return chunk?.text === citation.sourceText;
  });
}

function isCitationMetadataAccurate(fixture: FixtureSet, citations: AnswerCitation[]) {
  return citations.every((citation) => {
    const chunk = findFixtureChunk(fixture, citation.chunkId);

    return (
      chunk?.documentId === citation.documentId &&
      chunk.documentTitle === citation.documentTitle &&
      chunk.originalFileName === citation.documentFileName &&
      chunk.pageNumber === citation.pageNumber &&
      chunk.chunkIndex === citation.chunkIndex
    );
  });
}

function hasNoDuplicateCitations(response: AnswerResponse, parsedClaims: ParsedAnswerClaim[]) {
  const citationIds = response.citations.map((citation) => citation.id);

  if (new Set(citationIds).size !== citationIds.length) {
    return false;
  }

  return parsedClaims.every((claim) => new Set(claim.citationIds).size === claim.citationIds.length);
}

function requiredCitationChunkIdsForCase(testCase: FixtureCase) {
  return Array.from(new Set(testCase.answerClaims.flatMap((claim) => claim.sourceChunkIds)));
}

function flattenChunks(fixture: FixtureSet): FlatFixtureChunk[] {
  return fixture.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      ...chunk,
      documentId: document.id,
      documentTitle: document.title,
      originalFileName: document.originalFileName,
      className: document.className,
      topic: document.topic,
      source: document.source ?? null,
      documentDate: document.documentDate ?? null,
      tags: document.tags
    }))
  );
}

function findFixtureChunk(fixture: FixtureSet, chunkId: string) {
  return flattenChunks(fixture).find((chunk) => chunk.id === chunkId);
}

function filterChunksBySqlValues(
  chunks: FlatFixtureChunk[],
  documentIds: Set<string>,
  query: string,
  values: unknown[]
): FlatFixtureChunk[] {
  const classNames = new Set(chunks.map((chunk) => chunk.className).filter((value): value is string => Boolean(value)));
  const topics = new Set(chunks.map((chunk) => chunk.topic).filter((value): value is string => Boolean(value)));
  const sources = new Set(chunks.map((chunk) => chunk.source).filter((value): value is string => Boolean(value)));
  const tagKeys = new Set(chunks.flatMap((chunk) => chunk.tags.map((tag) => tag.toLocaleLowerCase())));
  const requestedDocumentIds = new Set(
    values.filter((value): value is string => typeof value === "string" && documentIds.has(value))
  );
  const requestedClassNames = new Set(
    values.filter((value): value is string => typeof value === "string" && classNames.has(value))
  );
  const requestedTopics = new Set(
    values.filter((value): value is string => typeof value === "string" && topics.has(value))
  );
  const requestedSources = new Set(
    values.filter((value): value is string => typeof value === "string" && sources.has(value))
  );
  const requestedTagKeys = new Set(
    values.filter((value): value is string => typeof value === "string" && tagKeys.has(value.toLocaleLowerCase()))
  );
  const dateValues = values.filter((value): value is Date => value instanceof Date);
  const hasDateFrom = query.includes('"documentDate" >= ?');
  const hasDateTo = query.includes('"documentDate" <= ?');
  const dateFrom = hasDateFrom ? dateValues[0] : null;
  const dateTo = hasDateFrom && hasDateTo ? dateValues[1] : hasDateTo ? dateValues[0] : null;

  return chunks.filter((chunk) => {
    const documentDate = chunk.documentDate ? new Date(`${chunk.documentDate}T00:00:00.000Z`) : null;

    return (
      (requestedDocumentIds.size === 0 || requestedDocumentIds.has(chunk.documentId)) &&
      (requestedClassNames.size === 0 || (chunk.className ? requestedClassNames.has(chunk.className) : false)) &&
      (requestedTopics.size === 0 || (chunk.topic ? requestedTopics.has(chunk.topic) : false)) &&
      (requestedSources.size === 0 || (chunk.source ? requestedSources.has(chunk.source) : false)) &&
      (requestedTagKeys.size === 0 ||
        chunk.tags.some((tag) => requestedTagKeys.has(tag.toLocaleLowerCase()))) &&
      (dateFrom ? Boolean(documentDate && documentDate >= dateFrom) : true) &&
      (dateTo ? Boolean(documentDate && documentDate <= dateTo) : true)
    );
  });
}

function keywordRowsForQuery(chunks: FlatFixtureChunk[], normalizedQuery: string) {
  const terms = Array.from(normalizedQuery.matchAll(/"([^"]+)"/g)).map((match) => match[1].toLowerCase());

  if (terms.length === 0) {
    return [];
  }

  return chunks
    .map((chunk) => {
      const normalizedText = chunk.text.toLowerCase();
      const matchedTerms = terms.filter((term) => normalizedText.includes(term));

      return {
        chunk,
        matchedTerms
      };
    })
    .filter((result) => result.matchedTerms.length === terms.length)
    .sort((left, right) => {
      return (
        right.matchedTerms.length - left.matchedTerms.length ||
        left.chunk.documentId.localeCompare(right.chunk.documentId) ||
        left.chunk.pageNumber - right.chunk.pageNumber ||
        left.chunk.chunkIndex - right.chunk.chunkIndex ||
        left.chunk.id.localeCompare(right.chunk.id)
      );
    })
    .map(({ chunk }, index) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      originalFileName: chunk.originalFileName,
      className: chunk.className,
      topic: chunk.topic,
      source: chunk.source,
      documentDate: chunk.documentDate,
      tags: JSON.stringify(chunk.tags),
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      score: 100 - index
    }));
}

function toSemanticRow(chunk: FlatFixtureChunk) {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    originalFileName: chunk.originalFileName,
    className: chunk.className,
    topic: chunk.topic,
    source: chunk.source,
    documentDate: chunk.documentDate,
    tags: JSON.stringify(chunk.tags),
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    dimensions: chunk.embedding.length,
    vectorJson: JSON.stringify(chunk.embedding)
  };
}

function getLimit(values: unknown[]) {
  const lastNumber = values.findLast((value): value is number => typeof value === "number");

  return lastNumber ?? 10;
}

function createRetrievalAccumulation(): RetrievalAccumulation {
  return {
    evaluatedCases: 0,
    hits: 0,
    recallSum: 0,
    reciprocalRankSum: 0
  };
}

function createAnswerAccumulation(): AnswerAccumulation {
  return {
    evaluatedCases: 0,
    schemaValid: 0,
    statusCorrect: 0,
    citationIdsValid: 0,
    sourceTextExact: 0,
    metadataAccurate: 0,
    insufficientEvidenceEvaluated: 0,
    insufficientEvidenceCorrect: 0,
    duplicateCitationHandling: 0,
    promptInjectionEvaluated: 0,
    promptInjectionPassed: 0
  };
}

function createFaithfulnessAccumulation(): FaithfulnessAccumulation {
  return {
    claimCount: 0,
    groundedClaimCount: 0,
    answerCount: 0,
    fullyGroundedAnswerCount: 0
  };
}

function accumulateRetrieval(accumulation: RetrievalAccumulation, caseReport: CaseEvalReport) {
  if (caseReport.retrieval.hitAtK === null) {
    return;
  }

  accumulation.evaluatedCases += 1;
  accumulation.hits += caseReport.retrieval.hitAtK ? 1 : 0;
  accumulation.recallSum += caseReport.retrieval.recallAtK ?? 0;
  accumulation.reciprocalRankSum += caseReport.retrieval.reciprocalRank ?? 0;
}

function accumulateAnswer(accumulation: AnswerAccumulation, caseReport: CaseEvalReport) {
  accumulation.evaluatedCases += 1;
  accumulation.schemaValid += caseReport.answer.schemaValid ? 1 : 0;
  accumulation.statusCorrect += caseReport.answer.status === caseReport.answer.expectedStatus ? 1 : 0;
  accumulation.citationIdsValid += caseReport.answer.citationIdsValid ? 1 : 0;
  accumulation.sourceTextExact += caseReport.answer.citationSourceTextExact ? 1 : 0;
  accumulation.metadataAccurate += caseReport.answer.citationMetadataAccurate ? 1 : 0;
  accumulation.duplicateCitationHandling += caseReport.answer.duplicateCitationHandlingCorrect ? 1 : 0;

  if (caseReport.answer.insufficientEvidenceCorrect !== null) {
    accumulation.insufficientEvidenceEvaluated += 1;
    accumulation.insufficientEvidenceCorrect += caseReport.answer.insufficientEvidenceCorrect ? 1 : 0;
  }

  if (caseReport.answer.promptInjectionPassed !== null) {
    accumulation.promptInjectionEvaluated += 1;
    accumulation.promptInjectionPassed += caseReport.answer.promptInjectionPassed ? 1 : 0;
  }
}

function accumulateFaithfulness(accumulation: FaithfulnessAccumulation, faithfulness: NonNullable<CaseEvalReport["faithfulness"]>) {
  accumulation.answerCount += 1;
  accumulation.fullyGroundedAnswerCount += faithfulness.fullyGrounded ? 1 : 0;
  accumulation.claimCount += faithfulness.evaluations.length;
  accumulation.groundedClaimCount += faithfulness.evaluations.filter((evaluation) => evaluation.supported).length;
}

function summarizeRetrieval(accumulation: RetrievalAccumulation): RetrievalCategorySummary {
  return {
    evaluatedCases: accumulation.evaluatedCases,
    hitRateAtK: safeRate(accumulation.hits, accumulation.evaluatedCases),
    recallAtK: safeRate(accumulation.recallSum, accumulation.evaluatedCases),
    meanReciprocalRank: safeRate(accumulation.reciprocalRankSum, accumulation.evaluatedCases)
  };
}

function summarizeAnswer(accumulation: AnswerAccumulation): AnswerMetricSummary {
  return {
    evaluatedCases: accumulation.evaluatedCases,
    schemaValidityRate: safeRate(accumulation.schemaValid, accumulation.evaluatedCases),
    statusAccuracy: safeRate(accumulation.statusCorrect, accumulation.evaluatedCases),
    citationIdValidityRate: safeRate(accumulation.citationIdsValid, accumulation.evaluatedCases),
    citationSourceTextExactnessRate: safeRate(accumulation.sourceTextExact, accumulation.evaluatedCases),
    citationMetadataAccuracyRate: safeRate(accumulation.metadataAccurate, accumulation.evaluatedCases),
    insufficientEvidenceAccuracy: safeRate(
      accumulation.insufficientEvidenceCorrect,
      accumulation.insufficientEvidenceEvaluated
    ),
    duplicateCitationHandlingRate: safeRate(accumulation.duplicateCitationHandling, accumulation.evaluatedCases),
    promptInjectionPassRate: safeRate(accumulation.promptInjectionPassed, accumulation.promptInjectionEvaluated)
  };
}

function summarizeFaithfulness(accumulation: FaithfulnessAccumulation): FaithfulnessMetricSummary {
  return {
    evaluatedClaims: accumulation.claimCount,
    groundedClaimRate: safeRate(accumulation.groundedClaimCount, accumulation.claimCount),
    fullyGroundedAnswerRate: safeRate(accumulation.fullyGroundedAnswerCount, accumulation.answerCount)
  };
}

function collectThresholdFailures(input: {
  retrieval: RetrievalCategorySummary;
  answer: AnswerMetricSummary;
  faithfulness?: FaithfulnessMetricSummary;
  thresholds: EvalThresholds;
}) {
  const failures: string[] = [];

  addThresholdFailure(failures, "Hit Rate@K", input.retrieval.hitRateAtK, input.thresholds.hitRateAtK);
  addThresholdFailure(failures, "Recall@K", input.retrieval.recallAtK, input.thresholds.recallAtK);
  addThresholdFailure(
    failures,
    "Mean Reciprocal Rank",
    input.retrieval.meanReciprocalRank,
    input.thresholds.meanReciprocalRank
  );
  addThresholdFailure(
    failures,
    "Citation ID validity",
    input.answer.citationIdValidityRate,
    input.thresholds.citationIdValidityRate
  );
  addThresholdFailure(
    failures,
    "Citation source exactness",
    input.answer.citationSourceTextExactnessRate,
    input.thresholds.citationSourceTextExactnessRate
  );
  addThresholdFailure(
    failures,
    "Citation metadata accuracy",
    input.answer.citationMetadataAccuracyRate,
    input.thresholds.citationMetadataAccuracyRate
  );
  addThresholdFailure(
    failures,
    "Insufficient-evidence accuracy",
    input.answer.insufficientEvidenceAccuracy,
    input.thresholds.insufficientEvidenceAccuracy
  );
  addThresholdFailure(
    failures,
    "Duplicate-citation handling",
    input.answer.duplicateCitationHandlingRate,
    input.thresholds.duplicateCitationHandlingRate
  );
  addThresholdFailure(
    failures,
    "Prompt-injection pass rate",
    input.answer.promptInjectionPassRate,
    input.thresholds.promptInjectionPassRate
  );

  if (input.faithfulness && input.thresholds.groundedClaimRate !== undefined) {
    addThresholdFailure(
      failures,
      "Grounded claim rate",
      input.faithfulness.groundedClaimRate,
      input.thresholds.groundedClaimRate
    );
  }

  if (input.faithfulness && input.thresholds.fullyGroundedAnswerRate !== undefined) {
    addThresholdFailure(
      failures,
      "Fully grounded answer rate",
      input.faithfulness.fullyGroundedAnswerRate,
      input.thresholds.fullyGroundedAnswerRate
    );
  }

  return failures;
}

function addThresholdFailure(failures: string[], label: string, actual: number, expected: number) {
  if (actual < expected) {
    failures.push(`${label} ${formatRate(actual)} is below threshold ${formatRate(expected)}`);
  }
}

function safeRate(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function formatRate(rate: number) {
  return rate.toFixed(3);
}
