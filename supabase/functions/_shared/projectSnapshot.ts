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
    excludedPaths: string[];
    totalSizeBytes: number;
  };
}

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

/**
 * Determines whether a file path should be included in the snapshot.
 * Uses the canonical allow/deny lists shared by ZIP and GitHub.
 */
export function shouldIncludePath(rawPath: string): boolean {
  const path = normalizePath(rawPath);
  const segments = path.split('/');
  const filename = segments[segments.length - 1] || '';

  // Check denied directories
  for (const segment of segments) {
    if (DENIED_DIRECTORIES.has(segment)) return false;
  }

  // Check denied path patterns (e.g. supabase/.temp/)
  for (const pattern of DENIED_PATH_PATTERNS) {
    if (pattern.test(path + '/')) return false;
  }

  // Check denied file patterns
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(filename)) return false;
  }

  // Check allowed extensions
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0) return false;
  const ext = filename.slice(dotIdx).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

// =====================
// Path Normalization
// =====================

/**
 * Canonicalize a file path for rule scanning:
 * - Always posix /
 * - Strip leading ./
 * - Remove duplicate slashes
 * - Resolve .. safely
 */
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

/**
 * Normalize content for consistent rule analysis:
 * - UTF-8 string
 * - Normalize line endings to \n
 * - Preserve line numbers (no global trimming)
 */
export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// =====================
// Root Folder Detection (ZIP)
// =====================

/**
 * Detect a common root folder shared by all paths.
 * ZIP exports often wrap all files in a single root folder.
 * Returns the root prefix to strip (e.g., "my-project/"), or empty string.
 */
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

/** Fast synchronous hash (djb2) for parity comparison. Not cryptographic. */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // 32-bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeContentHash(content: string): string {
  return djb2Hash(content);
}

/**
 * Compute a stable snapshot hash from a file map.
 * Hash is over sorted (relativePath + contentHash) pairs.
 */
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

/**
 * Sort file entries deterministically:
 * Primary: relativePath lexicographic
 * Secondary: content hash tie-breaker
 */
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

/**
 * Build a NormalizedProjectSnapshot from a populated file map.
 * Call after ingestion (ZIP extraction or GitHub fetch) is complete.
 */
export function buildSnapshot(
  allFiles: Map<string, string>,
  source: 'zip' | 'github',
  excludedPaths: string[],
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
      excludedPaths,
      totalSizeBytes: totalSize,
    },
  };
}

// =====================
// Parity Diagnostics
// =====================

/**
 * Log parity diagnostics for debugging ZIP-vs-GitHub mismatches.
 * Call after rule execution to record what was analyzed and found.
 */
export function logParityDiagnostics(
  snapshot: NormalizedProjectSnapshot,
  rulesExecuted: string[],
  findingsPerRule: Record<string, number>,
): void {
  console.log('=== PARITY DIAGNOSTICS ===');
  console.log(`Source: ${snapshot.metadata.source}`);
  console.log(`Total file count: ${snapshot.metadata.totalFiles}`);
  console.log(`Total size: ${snapshot.metadata.totalSizeBytes} bytes`);
  console.log(`Snapshot hash: ${snapshot.hash}`);
  const excluded = snapshot.metadata.excludedPaths;
  console.log(`Excluded paths: ${excluded.length} total (showing first 50)`);
  for (const p of excluded.slice(0, 50)) {
    console.log(`  EXCLUDED: ${p}`);
  }
  console.log(`Rules executed: ${rulesExecuted.join(', ')}`);
  for (const [rule, count] of Object.entries(findingsPerRule)) {
    console.log(`  ${rule}: ${count} finding(s)`);
  }
  console.log('=== END PARITY DIAGNOSTICS ===');
}
