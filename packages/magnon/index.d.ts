export interface PackageImportRule {
  transform: string;
  preventFullImport?: boolean;
  skipDefaultConversion?: boolean;
}

export interface TransformOptions {
  jsxRuntime?: 'automatic' | 'classic';
  development?: boolean;
  refresh?: boolean;
  sourcemap?: boolean;
  optimizePackageImports?: string[] | boolean;
  modularizeImports?: Record<string, PackageImportRule>;
}

export interface TransformResult {
  code: string;
  map?: string | null;
}

export interface BatchFileResult {
  path: string;
  success: boolean;
  outputCode?: string;
  error?: string;
  durationMicros: number;
  bytesRead: number;
}

export interface BatchResult {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  totalBytes: number;
  wallTimeMs: number;
  files: BatchFileResult[];
}

export interface CompressOptions {
  gzip?: boolean;
  brotli?: boolean;
  gzipLevel?: number;
  brotliQuality?: number;
  threshold?: number;
  extensions?: string[];
  deleteOriginal?: boolean;
  verbose?: boolean;
}

export interface FileCompressResult {
  path: string;
  originalSize: number;
  gzipSize?: number | null;
  brotliSize?: number | null;
  success: boolean;
  error?: string | null;
}

export interface BatchCompressResult {
  totalFiles: number;
  totalOriginalBytes: number;
  totalGzipBytes: number;
  totalBrotliBytes: number;
  durationMs: number;
  files: FileCompressResult[];
}

export function transform(
  code: string,
  filename: string,
  options?: TransformOptions
): TransformResult;

export function transformBatch(
  files: string[],
  options?: TransformOptions
): BatchResult;

export function compressGzip(data: Buffer, level?: number): Buffer;
export function compressBrotli(data: Buffer, quality?: number): Buffer;
export function compressDirectory(dirPath: string, options?: CompressOptions): BatchCompressResult;
export function compressFiles(files: string[], options?: CompressOptions): BatchCompressResult;
export function compression(options?: CompressOptions): any;
export function compress(options?: CompressOptions): any;
export interface RolldownGroup {
  name: string;
  test: RegExp | ((id: string) => boolean);
  priority?: number;
  minSize?: number;
  maxSize?: number;
  minShareCount?: number;
}

export interface CodeSplittingOptions {
  framework?: 'react' | 'vue' | 'svelte' | false;
  chunks?: Record<string, string | string[]>;
  vendors?: Record<string, string | string[]>;
  groups?: RolldownGroup[];
  priority?: number;
  [chunkName: string]: any;
}

export interface CodeSplittingResult {
  (id: string): string | undefined;
  groups: RolldownGroup[];
  manualChunks: (id: string) => string | undefined;
}

export function codeSplitting(options?: CodeSplittingOptions | Record<string, string | string[]>): CodeSplittingResult;
export function splitChunks(options?: CodeSplittingOptions | Record<string, string | string[]>): CodeSplittingResult;

export interface ObfuscatorOptions {
  enable?: boolean;
  minChunkSize?: number;
  criticalModuleFragments?: string[];
  threads?: number;
  options?: Record<string, any>;
  verbose?: boolean;
}

export function obfuscator(options?: ObfuscatorOptions): any;
export function obfuscate(options?: ObfuscatorOptions): any;

export interface MagnonPluginOptions extends TransformOptions {
  include?: RegExp | string[];
  exclude?: RegExp | string[];
  prewarm?: boolean;
  compress?: boolean | CompressOptions;
  codeSplitting?: boolean | CodeSplittingOptions | Record<string, string | string[]>;
  splitChunks?: boolean | CodeSplittingOptions | Record<string, string | string[]>;
}

export default function magnon(options?: MagnonPluginOptions): any;
export { magnon };
