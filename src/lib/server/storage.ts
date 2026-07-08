import { mkdir } from "node:fs/promises";
import path from "node:path";

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "storage");
export const PDF_UPLOAD_DIR = path.join(LOCAL_STORAGE_ROOT, "uploads");
export const EXTRACTED_DATA_DIR = path.join(LOCAL_STORAGE_ROOT, "extracted");

export async function ensureLocalStorage() {
  await mkdir(PDF_UPLOAD_DIR, { recursive: true });
  await mkdir(EXTRACTED_DATA_DIR, { recursive: true });
}

export function getStoredPdfPath(storedFileName: string) {
  return path.join(PDF_UPLOAD_DIR, storedFileName);
}
