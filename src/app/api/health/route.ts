import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    app: "QuickNotes",
    status: "ok",
    version: "0.1.0",
    capabilities: {
      pdfUpload: "planned",
      textExtraction: "planned",
      citationBackedAnswers: "planned",
      hybridRetrieval: "planned",
      evaluationTests: "planned"
    }
  });
}
