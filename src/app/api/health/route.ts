import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    app: "QuickNotes",
    status: "ok",
    version: "0.1.0",
    capabilities: {
      pdfUpload: "ready",
      textExtraction: "ready",
      citationBackedAnswers: "ready",
      hybridRetrieval: "ready",
      evaluationTests: "ready"
    }
  });
}
