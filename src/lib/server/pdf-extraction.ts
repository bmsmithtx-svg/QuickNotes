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
  destroy: () => Promise<void>;
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

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

export async function extractPdfTextByPage(buffer: Buffer): Promise<ExtractedPdf> {
  const pdfjs = (await importRuntimeModule("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
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
    await pdfDocument.destroy();
  }

  return {
    pageCount: pdfDocument.numPages,
    pages
  };
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
