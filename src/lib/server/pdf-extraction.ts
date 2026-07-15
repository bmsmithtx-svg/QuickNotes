export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
};

export type ExtractedPdf = {
  pageCount: number;
  pages: ExtractedPdfPage[];
};

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
};

type PdfTextContent = {
  items: PdfTextItem[];
};

type PdfPage = {
  getTextContent: () => Promise<PdfTextContent>;
  cleanup: () => void;
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  cleanup?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

type PdfJsModule = {
  getDocument: (options: {
    data: Uint8Array;
    disableFontFace: boolean;
    disableWorker: boolean;
    isEvalSupported: boolean;
    useSystemFonts: boolean;
  }) => {
    promise: Promise<PdfDocument>;
  };
};

const PDF_CLEANUP_TIMEOUT_MS = 1000;

export async function extractPdfTextByPage(buffer: Buffer): Promise<ExtractedPdf> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const pdfDocument = await loadingTask.promise;
  const pages: ExtractedPdfPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = normalizeTextItems(textContent.items);

      pages.push({
        pageNumber,
        text
      });

      page.cleanup();
    }
  } finally {
    await cleanupPdfDocument(pdfDocument);
  }

  return {
    pageCount: pdfDocument.numPages,
    pages
  };
}

async function cleanupPdfDocument(pdfDocument: PdfDocument) {
  const cleanup =
    typeof pdfDocument.destroy === "function"
      ? pdfDocument.destroy()
      : pdfDocument.cleanup?.();

  if (!cleanup) {
    return;
  }

  await Promise.race([
    cleanup,
    new Promise<void>((resolve) => {
      setTimeout(resolve, PDF_CLEANUP_TIMEOUT_MS);
    })
  ]);
}

function normalizeTextItems(items: PdfTextItem[]) {
  return items
    .map((item) => {
      if (!item.str) {
        return "";
      }

      return `${item.str}${item.hasEOL ? "\n" : " "}`;
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
