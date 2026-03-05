# ZIP ↔ GitHub Analysis Parity

## Overview

Both the `analyze-zip` and `analyze-github` Edge Functions share a canonical
ingestion pipeline defined in `supabase/functions/_shared/projectSnapshot.ts`.
This ensures that the same codebase, whether uploaded as a ZIP archive or
analyzed via a public GitHub URL, produces identical rule results.

## Shared Pipeline

```
ZIP bytes ─┐
            ├─► shouldIncludePath() ─► normalizePath() ─► normalizeContent()
GitHub API ─┘        (shared)              (shared)            (shared)
                                                                  │
                                                    allFiles: Map<string, string>
                                                                  │
                                              ┌───────────────────┘
                                              ▼
                                     Rule Engine (per-file)
                                              │
                                              ▼
                                     Parity Diagnostics
```

### Shared Filtering (`shouldIncludePath`)

| Category            | Values                                                               |
|---------------------|----------------------------------------------------------------------|
| **Allowed extensions** | `.ts .tsx .js .jsx .html .htm .css .scss .sass .less .json .md .vue .svelte .astro` |
| **Denied directories** | `node_modules .next .nuxt dist build out coverage .git .vercel .turbo .cache` |
| **Denied paths**       | `supabase/.temp/`                                                   |
| **Denied file patterns** | `*.min.js *.min.css package-lock.json yarn.lock bun.lockb pnpm-lock.yaml` |

### Path Normalization (`normalizePath`)

- Backslashes → forward slashes
- Remove duplicate slashes, leading `/`, `./`
- Resolve `..` safely
- ZIP: strip common root folder (e.g., `my-project/src/…` → `src/…`)

### Content Normalization (`normalizeContent`)

- Line endings → `\n` (strip `\r\n` and `\r`)
- Preserve original line numbers and whitespace

## How to Verify Parity

### 1. Run both analyses on the same codebase

Export a project as a ZIP and also push it to a public GitHub repository.
Run analysis on both inputs with the same selected rules.

### 2. Compare parity diagnostics

Both analyses log structured diagnostics prefixed with `=== PARITY DIAGNOSTICS ===`.
Check the Edge Function logs for:

| Field                | Expected                                           |
|----------------------|----------------------------------------------------|
| `Total file count`   | Equal (± config files only present in one source)  |
| `Snapshot hash`      | Identical if file sets match                       |
| `Excluded paths`     | Same directories/patterns excluded                 |
| `Rules: N findings`  | Identical per rule                                 |

### 3. Debug mismatches

If results differ, the diagnostics will show:

- **Missing/extra files**: Compare `Total file count` and `Excluded paths`
- **Filtering divergence**: Check if a file is allowed by one source but excluded by another
- **Path mismatch**: Verify paths are canonicalized (no leading root folder in ZIP)
- **Content divergence**: Verify line endings are normalized (no `\r\n` vs `\n` drift)
- **Size limits**: ZIP allows 750KB for deterministic analysis; GitHub allows 750KB.
  If a project exceeds this, files may be truncated differently.

### Known Limitations

| Limitation               | Impact                                              |
|--------------------------|-----------------------------------------------------|
| GitHub `MAX_FILES = 50`  | Large repos may not fetch all files                 |
| GitHub API rate limits   | May fail for rapid successive analyses              |
| ZIP root folder strip    | Heuristic; single-file ZIPs skip root detection     |
| AI context subset        | ZIP keeps a smaller 100KB subset for LLM context    |

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
