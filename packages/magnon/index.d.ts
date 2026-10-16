export interface TransformOptions {
  jsxRuntime?: 'automatic' | 'classic';
  development?: boolean;
  refresh?: boolean;
  sourcemap?: boolean;
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

export function transform(
  code: string,
  filename: string,
  options?: TransformOptions
): TransformResult;

export function transformBatch(
  files: string[],
  options?: TransformOptions
): BatchResult;

export interface MagnonPluginOptions extends TransformOptions {
  include?: RegExp | string[];
  exclude?: RegExp | string[];
  prewarm?: boolean;
}

export default function magnon(options?: MagnonPluginOptions): any;
