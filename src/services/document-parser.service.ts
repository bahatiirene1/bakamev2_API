/**
 * Document Parser Service
 * Extracts text content from various document formats (PDF, DOCX, TXT)
 */

// Type definitions for lazy-loaded modules
type PdfParseFunction = (buffer: Buffer) => Promise<{
  numpages: number;
  text: string;
  info: { Title?: string; Author?: string };
}>;

type MammothModule = {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

// Lazy-loaded module references
let pdfParse: PdfParseFunction | null = null;
let mammoth: MammothModule | null = null;

// Lazy load dependencies
async function loadPdfParse(): Promise<PdfParseFunction> {
  if (pdfParse === null) {
    // Import the lib directly to avoid the test code in index.js
    // eslint-disable-next-line import/no-unresolved, @typescript-eslint/no-require-imports
    const module = await import('pdf-parse/lib/pdf-parse.js');
    // Handle both ESM default export and CommonJS module.exports
    pdfParse = (module.default ?? module) as PdfParseFunction;
  }
  return pdfParse;
}

async function loadMammoth(): Promise<MammothModule> {
  if (mammoth === null) {
    // eslint-disable-next-line import/no-unresolved
    mammoth = await import('mammoth');
  }
  return mammoth;
}

/**
 * Supported document types
 */
export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (limited support)
  'text/plain',
  'text/markdown',
  'text/csv',
] as const;

export type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];

/**
 * Result of document parsing
 */
export interface ParsedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    wordCount: number;
    characterCount: number;
    title?: string;
    author?: string;
  };
  mimeType: string;
  parseTime: number;
}

/**
 * Check if a MIME type is supported for parsing
 */
export function isSupportedDocumentType(mimeType: string): boolean {
  return SUPPORTED_DOCUMENT_TYPES.includes(mimeType as SupportedDocumentType);
}

/**
 * Parse a PDF file and extract text
 */
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const startTime = Date.now();

  try {
    const pdf = await loadPdfParse();
    const data = await pdf(buffer);

    const text = data.text.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const metadata: ParsedDocument['metadata'] = {
      pageCount: data.numpages,
      wordCount,
      characterCount: text.length,
    };
    if (data.info?.Title !== undefined && data.info.Title !== '') {
      metadata.title = data.info.Title;
    }
    if (data.info?.Author !== undefined && data.info.Author !== '') {
      metadata.author = data.info.Author;
    }

    return {
      text,
      metadata,
      mimeType: 'application/pdf',
      parseTime: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse PDF: ${message}`);
  }
}

/**
 * Parse a DOCX file and extract text
 */
async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const startTime = Date.now();

  try {
    const mam = await loadMammoth();
    const result = await mam.extractRawText({ buffer });

    const text = result.value.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return {
      text,
      metadata: {
        wordCount,
        characterCount: text.length,
      },
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parseTime: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse DOCX: ${message}`);
  }
}

/**
 * Parse a plain text file
 */
function parseText(buffer: Buffer, mimeType: string): ParsedDocument {
  const startTime = Date.now();

  const text = buffer.toString('utf-8').trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    metadata: {
      wordCount,
      characterCount: text.length,
    },
    mimeType,
    parseTime: Date.now() - startTime,
  };
}

/**
 * Parse a document and extract text content
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocument> {
  if (!isSupportedDocumentType(mimeType)) {
    throw new Error(`Unsupported document type: ${mimeType}`);
  }

  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(buffer);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return parseDocx(buffer);

    case 'text/plain':
    case 'text/markdown':
    case 'text/csv':
      return parseText(buffer, mimeType);

    default:
      throw new Error(`Parser not implemented for: ${mimeType}`);
  }
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      '.docx',
    'application/msword': '.doc',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
  };

  return mimeToExt[mimeType] ?? '';
}

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop();

  const extToMime: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
  };

  return ext !== undefined && ext !== '' ? (extToMime[ext] ?? null) : null;
}
