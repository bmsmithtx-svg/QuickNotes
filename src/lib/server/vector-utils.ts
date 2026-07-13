export function normalizeVector(vector: number[]) {
  validateVector(vector);

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Embedding vector cannot be normalized because it has zero magnitude.");
  }

  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]) {
  validateVector(left);
  validateVector(right);

  if (left.length !== right.length) {
    throw new Error(`Cannot compare vectors with different dimensions: ${left.length} and ${right.length}.`);
  }

  const normalizedLeft = normalizeVector(left);
  const normalizedRight = normalizeVector(right);

  return normalizedLeft.reduce((sum, value, index) => sum + value * normalizedRight[index], 0);
}

export function validateVectorDimensions(vector: number[], expectedDimensions: number) {
  validateVector(vector);

  if (!Number.isInteger(expectedDimensions) || expectedDimensions <= 0) {
    throw new Error("Expected embedding dimensions must be a positive integer.");
  }

  if (vector.length !== expectedDimensions) {
    throw new Error(`Embedding dimensions mismatch: expected ${expectedDimensions}, got ${vector.length}.`);
  }
}

export function serializeVectorForPgvector(vector: number[], expectedDimensions: number) {
  validateVectorDimensions(vector, expectedDimensions);

  return `[${vector.map((value) => value.toString()).join(",")}]`;
}

export function parseStoredVector(vectorJson: string, expectedDimensions: number) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(vectorJson);
  } catch {
    throw new Error("Stored embedding vector is not valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Stored embedding vector is not an array.");
  }

  const vector = parsed.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Stored embedding vector contains a non-finite value.");
    }

    return value;
  });

  if (vector.length !== expectedDimensions) {
    throw new Error(`Stored embedding dimensions mismatch: expected ${expectedDimensions}, got ${vector.length}.`);
  }

  return vector;
}

function validateVector(vector: number[]) {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embedding vector must be a non-empty numeric array.");
  }

  for (const value of vector) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding vector contains a non-finite value.");
    }
  }
}
