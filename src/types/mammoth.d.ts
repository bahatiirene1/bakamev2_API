/**
 * Type declarations for mammoth module
 */

declare module 'mammoth' {
  interface ConversionResult {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  interface ConversionOptions {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  interface StyleMap {
    bold?: string;
    italic?: string;
    underline?: string;
    strikethrough?: string;
    comment?: string;
  }

  interface MammothOptions {
    styleMap?: string[] | StyleMap;
    includeDefaultStyleMap?: boolean;
    convertImage?: (image: unknown) => Promise<{ src: string }>;
  }

  function convertToHtml(
    input: ConversionOptions,
    options?: MammothOptions
  ): Promise<ConversionResult>;

  function convertToMarkdown(
    input: ConversionOptions,
    options?: MammothOptions
  ): Promise<ConversionResult>;

  function extractRawText(input: ConversionOptions): Promise<ConversionResult>;

  export { convertToHtml, convertToMarkdown, extractRawText };
}
