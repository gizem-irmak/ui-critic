# ZIP ↔ GitHub Analysis Parity

## Overview

Both the `analyze-zip` and `analyze-github` Edge Functions share a canonical
ingestion pipeline defined in `supabase/functions/_shared/projectSnapshot.ts`.
This ensures that the same codebase, whether uploaded as a ZIP archive or
analyzed via a public GitHub URL, produces identical rule results.

## Strict Parity Enforcement

### Snapshot Integrity Contract

After ingestion, both modalities compute a `NormalizedProjectSnapshot` containing:
- `hash` — djb2 over sorted `relativePath:contentHash` pairs
- `fileCount` — number of included files
- `totalSizeBytes` — sum of all content lengths
- `excludedFiles[]` — every excluded file with a typed `ExclusionReason`

The snapshot hash and metadata are returned in the analysis response for client-side comparison.

### Parity Mode

When the same project+iteration has analyses from both ZIP and GitHub:
- The client compares `snapshotHash` values
- If they differ, a **Parity Mismatch** result is generated with detailed diff
- Rules are NOT run when parity mismatch is detected — prevents false divergence

### Parity Mismatch Result

When mismatch occurs, a non-violation result is returned:

| Field | Description |
|-------|-------------|
| `title` | "Input Parity Mismatch (ZIP vs GitHub)" |
| `severity` | "not_evaluated" (Input Limitation) |
| `zipHash` / `gitHash` | Snapshot hashes for comparison |
| `missingInGithub` | Paths present in ZIP but not GitHub (up to 30) |
| `missingInZip` | Paths present in GitHub but not ZIP (up to 30) |
| `contentDifferent` | Paths with same name but different content hash (up to 30) |

## Shared Pipeline

```
ZIP bytes ─┐
            ├─► filterPath() ─► normalizePath() ─► normalizeContent()
GitHub API ─┘    (shared)          (shared)            (shared)
                                                         │
                                           ┌─────────────┘
                                           ▼
                                  Content Validation:
                                  - LFS pointer? → exclude (git_lfs_pointer)
                                  - Submodule? → exclude (submodule)
                                  - High replacement ratio? → exclude (decode_error)
                                  - Per-file size > 500KB? → exclude (size_cap)
                                           │
                                           ▼
                                  allFiles: Map<string, string>
                                           │
                                           ▼
                                  Rule Engine (per-file)
                                           │
                                           ▼
                                  Parity Diagnostics
```

### Exclusion Reasons

| Reason | Description |
|--------|-------------|
| `denied_directory` | Path contains a denied directory (node_modules, dist, etc.) |
| `denied_extension` | File extension not in allow list |
| `denied_file_pattern` | File matches denied pattern (*.min.js, lockfiles) |
| `denied_path_pattern` | Path matches denied pattern (supabase/.temp/) |
| `size_cap` | File or total exceeds size limit |
| `binary` | Binary file detected |
| `decode_error` | High UTF-8 replacement character ratio |
| `submodule` | Git submodule pointer detected |
| `git_lfs_pointer` | Git LFS pointer file detected |
| `api_error` | GitHub API failed to fetch file |

### Shared Filtering (`filterPath`)

| Category            | Values                                                               |
|---------------------|----------------------------------------------------------------------|
| **Allowed extensions** | `.ts .tsx .js .jsx .html .htm .css .scss .sass .less .json .md .vue .svelte .astro` |
| **Denied directories** | `node_modules .next .nuxt dist build out coverage .git .vercel .turbo .cache` |
| **Denied paths**       | `supabase/.temp/`                                                   |
| **Denied file patterns** | `*.min.js *.min.css package-lock.json yarn.lock bun.lockb pnpm-lock.yaml` |

### Size Caps

| Cap | Value | Applies To |
|-----|-------|-----------|
| Per-file | 500KB | Both ZIP and GitHub |
| Total | 750KB | Both ZIP and GitHub |

### Path Normalization (`normalizePath`)

- Backslashes → forward slashes
- Remove duplicate slashes, leading `/`, `./`
- Resolve `..` safely
- ZIP: strip common root folder (e.g., `my-project/src/…` → `src/…`)

### Content Normalization (`normalizeContent`)

- Line endings → `\n` (strip `\r\n` and `\r`)
- Preserve original line numbers and whitespace

### Content Validation

Both pipelines apply identical validation:
1. **LFS pointer detection**: Files starting with `version https://git-lfs.github.com/spec` → excluded
2. **Submodule detection**: Files matching `Subproject commit [hex40]` → excluded
3. **UTF-8 replacement ratio**: Files with >5% replacement characters → excluded as `decode_error`

## How to Verify Parity

### 1. Run both analyses on the same codebase

Export a project as a ZIP and also push it to a public GitHub repository.
Run analysis on both inputs with the same selected rules.

### 2. Compare snapshot metadata

Both responses include `snapshotHash`, `snapshotFileCount`, and `snapshotTotalBytes`.

| Field                | Expected                                           |
|----------------------|----------------------------------------------------|
| `snapshotHash`       | Identical if file sets match                       |
| `snapshotFileCount`  | Equal (± only config files)                        |
| `snapshotTotalBytes` | Equal (± encoding differences)                     |

### 3. Check parity diagnostics in edge function logs

Both analyses log structured diagnostics prefixed with `=== PARITY DIAGNOSTICS ===`.

Enhanced diagnostics now include:
- **Exclusion reason counts**: How many files excluded per reason
- **Denied directory hit counts**: Which directories caused the most exclusions
- **Denied extension hit counts**: Which extensions were rejected
- **API errors**: GitHub-specific fetch failures with path context

### 4. Debug mismatches

If results differ, the diagnostics will show:

- **Missing/extra files**: Compare file counts and excluded file lists
- **Filtering divergence**: Check exclusion reasons differ between sources
- **Content divergence**: Same path, different contentHash → encoding issue
- **Size cap differences**: Check if per-file or total caps hit differently

## Snapshot Hash

The snapshot hash is a djb2 hash computed over sorted `relativePath:contentHash`
pairs. It provides a fast, deterministic fingerprint for comparison. Two analyses
with the same hash are guaranteed to have processed identical file sets.

## Adding New Rules

When adding new analysis rules:
1. Add detection logic to the rule engine (currently in each `index.ts`)
2. Rules operate on `allFiles: Map<string, string>` — the normalized file map
3. Both ZIP and GitHub call the same detection functions
4. Parity diagnostics automatically track findings per rule
