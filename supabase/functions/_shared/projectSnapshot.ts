/**
 * Shared Project Snapshot Module
 * 
 * Canonical ingestion pipeline for ZIP and GitHub inputs.
 * Ensures identical filtering, normalization, and ordering
 * so that the same codebase produces identical rule results
 * regardless of input source.
 */

// =====================
// Types
// =====================

export type ExclusionReason = 
  | 'denied_directory'
  | 'denied_extension'
  | 'denied_file_pattern'
  | 'denied_path_pattern'
  | 'size_cap'
  | 'binary'
  | 'decode_error'
  | 'submodule'
  | 'git_lfs_pointer'
  | 'api_error'
  | 'truncated';

export interface ExcludedFile {
  path: string;
  reason: ExclusionReason;
  detail?: string;
}

export interface NormalizedFile {
  relativePath: string;
  content: string;
  contentHash: string;
}

export interface NormalizedProjectSnapshot {
  files: NormalizedFile[];
  rootPath: string;
  hash: string;
  metadata: {
    source: 'zip' | 'github';
    totalFiles: number;
    excludedFiles: ExcludedFile[];
    totalSizeBytes: number;
  };
}

export interface ParityMismatchResult {
  type: 'parity_mismatch';
  title: string;
  severity: 'not_evaluated';
  zipHash: string;
  gitHash: string;
  zipFileCount: number;
  gitFileCount: number;
  zipTotalBytes: number;
  gitTotalBytes: number;
  missingInGithub: string[];
  missingInZip: string[];
  contentDifferent: string[];
}

export interface ParityDiagnosticsReport {
  source: 'zip' | 'github';
  fileCount: number;
  totalSizeBytes: number;
  snapshotHash: string;
  excludedFiles: ExcludedFile[];
  excludedReasonCounts: Record<ExclusionReason, number>;
  deniedDirectoryHitCounts: Record<string, number>;
  deniedExtensionHitCounts: Record<string, number>;
  apiErrors: Array<{ path: string; error: string }>;
  rulesExecuted: string[];
  findingsPerRule: Record<string, number>;
}

// =====================
// Constants
// =====================

/** Per-file size cap in bytes (same for ZIP and GitHub) */
export const PER_FILE_SIZE_CAP = 500_000; // 500KB per file

/** Total analysis size cap */
export const TOTAL_SIZE_CAP = 750_000; // 750KB total

// =====================
// Shared Allow / Deny Lists
// =====================

export const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
  '.json', '.md',
  '.vue', '.svelte', '.astro',
]);

export const DENIED_DIRECTORIES = new Set([
  'node_modules', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.git', '.vercel', '.turbo', '.cache',
]);

const DENIED_PATH_PATTERNS: RegExp[] = [
  /supabase\/\.temp\//i,
];

const DENIED_FILE_PATTERNS: RegExp[] = [
  /\.min\.js$/i,
  /\.min\.css$/i,
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^bun\.lockb$/i,
  /^pnpm-lock\.yaml$/i,
];

// =====================
// Path Filtering
// =====================

export interface FilterResult {
  included: boolean;
  reason?: ExclusionReason;
  detail?: string;
}

/**
 * Determines whether a file path should be included in the snapshot.
 * Returns detailed result with reason for exclusion.
 */
export function filterPath(rawPath: string): FilterResult {
  const path = normalizePath(rawPath);
  const segments = path.split('/');
  const filename = segments[segments.length - 1] || '';

  // Check denied directories
  for (const segment of segments) {
    if (DENIED_DIRECTORIES.has(segment)) {
      return { included: false, reason: 'denied_directory', detail: segment };
    }
  }

  // Check denied path patterns
  for (const pattern of DENIED_PATH_PATTERNS) {
    if (pattern.test(path + '/')) {
      return { included: false, reason: 'denied_path_pattern', detail: pattern.source };
    }
  }

  // Check denied file patterns
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(filename)) {
      return { included: false, reason: 'denied_file_pattern', detail: filename };
    }
  }

  // Check allowed extensions
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0) return { included: false, reason: 'denied_extension', detail: '(no extension)' };
  const ext = filename.slice(dotIdx).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { included: false, reason: 'denied_extension', detail: ext };
  }

  return { included: true };
}

/**
 * Simple boolean check for backward compatibility.
 */
export function shouldIncludePath(rawPath: string): boolean {
  return filterPath(rawPath).included;
}

// =====================
// LFS / Submodule Detection
// =====================

const GIT_LFS_PREFIX = 'version https://git-lfs.github.com/spec';
const SUBMODULE_PATTERN = /^Subproject commit [0-9a-f]{40}$/;

/**
 * Detect if content is a Git LFS pointer.
 */
export function isLfsPointer(content: string): boolean {
  return content.trimStart().startsWith(GIT_LFS_PREFIX);
}

/**
 * Detect if content is a Git submodule pointer.
 */
export function isSubmodulePointer(content: string): boolean {
  return SUBMODULE_PATTERN.test(content.trim());
}

// =====================
// Content Validation
// =====================

/**
 * Check if content has high UTF-8 replacement character ratio,
 * indicating binary or corrupted file.
 */
export function hasHighReplacementRatio(content: string, threshold = 0.05): boolean {
  if (content.length === 0) return false;
  let replacements = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0xFFFD) replacements++;
  }
  return (replacements / content.length) > threshold;
}

// =====================
// Path Normalization
// =====================

export function normalizePath(rawPath: string): string {
  let p = rawPath.replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  p = p.replace(/^\//, '');

  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

// =====================
// Content Normalization
// =====================

export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// =====================
// Root Folder Detection (ZIP)
// =====================

export function detectCommonRoot(paths: string[]): string {
  if (paths.length <= 1) return '';

  const split = paths.map(p => p.split('/'));
  const first = split[0];
  let commonDepth = 0;

  for (let i = 0; i < first.length - 1; i++) {
    const segment = first[i];
    if (split.every(s => s.length > i + 1 && s[i] === segment)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  if (commonDepth > 0) {
    return first.slice(0, commonDepth).join('/') + '/';
  }
  return '';
}

// =====================
// Hashing
// =====================

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeContentHash(content: string): string {
  return djb2Hash(content);
}

export function computeSnapshotHash(allFiles: Map<string, string>): string {
  const entries = Array.from(allFiles.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const combined = entries
    .map(([path, content]) => `${path}:${djb2Hash(content)}`)
    .join('\n');
  return djb2Hash(combined);
}

// =====================
// Deterministic Ordering
// =====================

export function sortFileMapDeterministically(
  allFiles: Map<string, string>
): Map<string, string> {
  const entries = Array.from(allFiles.entries());
  entries.sort((a, b) => {
    const pathCmp = a[0].localeCompare(b[0]);
    if (pathCmp !== 0) return pathCmp;
    return djb2Hash(a[1]).localeCompare(djb2Hash(b[1]));
  });
  return new Map(entries);
}

// =====================
// Snapshot Builder
// =====================

export function buildSnapshot(
  allFiles: Map<string, string>,
  source: 'zip' | 'github',
  excludedFiles: ExcludedFile[],
): NormalizedProjectSnapshot {
  let totalSize = 0;
  const files: NormalizedFile[] = [];

  const sorted = sortFileMapDeterministically(allFiles);
  for (const [relativePath, content] of sorted) {
    totalSize += content.length;
    files.push({
      relativePath,
      content,
      contentHash: computeContentHash(content),
    });
  }

  return {
    files,
    rootPath: '',
    hash: computeSnapshotHash(allFiles),
    metadata: {
      source,
      totalFiles: files.length,
      excludedFiles,
      totalSizeBytes: totalSize,
    },
  };
}

// =====================
// Parity Comparison
// =====================

/**
 * Compare two snapshots and produce a parity mismatch result if they differ.
 * Returns null if snapshots match.
 */
export function compareSnapshots(
  zipSnapshot: NormalizedProjectSnapshot,
  gitSnapshot: NormalizedProjectSnapshot,
): ParityMismatchResult | null {
  if (zipSnapshot.hash === gitSnapshot.hash) {
    return null; // Parity confirmed
  }

  const zipPaths = new Set(zipSnapshot.files.map(f => f.relativePath));
  const gitPaths = new Set(gitSnapshot.files.map(f => f.relativePath));

  const missingInGithub: string[] = [];
  for (const p of zipPaths) {
    if (!gitPaths.has(p)) missingInGithub.push(p);
  }

  const missingInZip: string[] = [];
  for (const p of gitPaths) {
    if (!zipPaths.has(p)) missingInZip.push(p);
  }

  // Find content differences (same path, different hash)
  const zipHashMap = new Map(zipSnapshot.files.map(f => [f.relativePath, f.contentHash]));
  const gitHashMap = new Map(gitSnapshot.files.map(f => [f.relativePath, f.contentHash]));
  const contentDifferent: string[] = [];
  for (const [path, zipHash] of zipHashMap) {
    const gitHash = gitHashMap.get(path);
    if (gitHash && gitHash !== zipHash) {
      contentDifferent.push(path);
    }
  }

  return {
    type: 'parity_mismatch',
    title: 'Input Parity Mismatch (ZIP vs GitHub)',
    severity: 'not_evaluated',
    zipHash: zipSnapshot.hash,
    gitHash: gitSnapshot.hash,
    zipFileCount: zipSnapshot.metadata.totalFiles,
    gitFileCount: gitSnapshot.metadata.totalFiles,
    zipTotalBytes: zipSnapshot.metadata.totalSizeBytes,
    gitTotalBytes: gitSnapshot.metadata.totalSizeBytes,
    missingInGithub: missingInGithub.slice(0, 30),
    missingInZip: missingInZip.slice(0, 30),
    contentDifferent: contentDifferent.slice(0, 30),
  };
}

// =====================
// Parity Diagnostics
// =====================

/**
 * Build a detailed diagnostics report for debugging ZIP-vs-GitHub mismatches.
 */
export function buildParityDiagnostics(
  snapshot: NormalizedProjectSnapshot,
  rulesExecuted: string[],
  findingsPerRule: Record<string, number>,
  apiErrors?: Array<{ path: string; error: string }>,
): ParityDiagnosticsReport {
  const excludedReasonCounts: Record<string, number> = {};
  const deniedDirectoryHitCounts: Record<string, number> = {};
  const deniedExtensionHitCounts: Record<string, number> = {};

  for (const ef of snapshot.metadata.excludedFiles) {
    excludedReasonCounts[ef.reason] = (excludedReasonCounts[ef.reason] || 0) + 1;
    if (ef.reason === 'denied_directory' && ef.detail) {
      deniedDirectoryHitCounts[ef.detail] = (deniedDirectoryHitCounts[ef.detail] || 0) + 1;
    }
    if (ef.reason === 'denied_extension' && ef.detail) {
      deniedExtensionHitCounts[ef.detail] = (deniedExtensionHitCounts[ef.detail] || 0) + 1;
    }
  }

  return {
    source: snapshot.metadata.source,
    fileCount: snapshot.metadata.totalFiles,
    totalSizeBytes: snapshot.metadata.totalSizeBytes,
    snapshotHash: snapshot.hash,
    excludedFiles: snapshot.metadata.excludedFiles,
    excludedReasonCounts: excludedReasonCounts as Record<ExclusionReason, number>,
    deniedDirectoryHitCounts,
    deniedExtensionHitCounts,
    apiErrors: apiErrors || [],
    rulesExecuted,
    findingsPerRule,
  };
}

/**
 * Log parity diagnostics for debugging ZIP-vs-GitHub mismatches.
 */
export function logParityDiagnostics(
  snapshot: NormalizedProjectSnapshot,
  rulesExecuted: string[],
  findingsPerRule: Record<string, number>,
  apiErrors?: Array<{ path: string; error: string }>,
): void {
  const report = buildParityDiagnostics(snapshot, rulesExecuted, findingsPerRule, apiErrors);

  console.log('=== PARITY DIAGNOSTICS ===');
  console.log(`Source: ${report.source}`);
  console.log(`Total file count: ${report.fileCount}`);
  console.log(`Total size: ${report.totalSizeBytes} bytes`);
  console.log(`Snapshot hash: ${report.snapshotHash}`);

  // Exclusion reason counts
  console.log(`Excluded files: ${report.excludedFiles.length} total`);
  for (const [reason, count] of Object.entries(report.excludedReasonCounts)) {
    console.log(`  ${reason}: ${count}`);
  }

  // Denied directory hits
  if (Object.keys(report.deniedDirectoryHitCounts).length > 0) {
    console.log('Denied directory hits:');
    for (const [dir, count] of Object.entries(report.deniedDirectoryHitCounts)) {
      console.log(`  ${dir}: ${count}`);
    }
  }

  // Denied extension hits
  if (Object.keys(report.deniedExtensionHitCounts).length > 0) {
    console.log('Denied extension hits:');
    for (const [ext, count] of Object.entries(report.deniedExtensionHitCounts)) {
      console.log(`  ${ext}: ${count}`);
    }
  }

  // API errors
  if (report.apiErrors.length > 0) {
    console.log(`API errors: ${report.apiErrors.length}`);
    for (const err of report.apiErrors.slice(0, 10)) {
      console.log(`  ${err.path}: ${err.error}`);
    }
  }

  // Excluded paths (first 50)
  const excluded = report.excludedFiles;
  console.log(`Excluded paths (showing first 50 of ${excluded.length}):`);
  for (const ef of excluded.slice(0, 50)) {
    console.log(`  EXCLUDED [${ef.reason}]: ${ef.path}${ef.detail ? ` (${ef.detail})` : ''}`);
  }

  console.log(`Rules executed: ${report.rulesExecuted.join(', ')}`);
  for (const [rule, count] of Object.entries(report.findingsPerRule)) {
    console.log(`  ${rule}: ${count} finding(s)`);
  }
  console.log('=== END PARITY DIAGNOSTICS ===');
}
