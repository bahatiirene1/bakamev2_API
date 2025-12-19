/**
 * Type declarations for pdf-parse module
 */

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PDFInfo {
    Title?: string;
    Author?: string;
  }

  interface PDFData {
    numpages: number;
    info: PDFInfo;
    text: string;
  }

  function pdfParse(dataBuffer: Buffer): Promise<PDFData>;

  export default pdfParse;
}

declare module 'pdf-parse' {
  interface PDFInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  }

  interface PDFMetadata {
    _metadata?: Record<string, unknown>;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata: PDFMetadata | null;
    text: string;
    version: string;
  }

  interface PDFOptions {
    pagerender?: (pageData: unknown) => Promise<string>;
    max?: number;
    version?: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;

  export = pdfParse;
}
