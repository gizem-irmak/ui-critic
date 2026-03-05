# Memory: tech/analysis-engine/project-ingestion-parity
Updated: now

The evaluation engine uses a unified ingestion pipeline ('projectSnapshot.ts') for ZIP and GitHub sources to ensure identical rule results for the same codebase. Key parity enforcement features:

**Shared Filtering**: Both modalities use `filterPath()` which returns typed `ExclusionReason` values (denied_directory, denied_extension, size_cap, decode_error, git_lfs_pointer, submodule, api_error, etc.) — legacy GitHub-specific filter lists (SKIP_DIRECTORIES, SKIP_FILES, ANALYZABLE_EXTENSIONS, isAnalyzableFile) have been removed.

**Content Validation**: Both pipelines apply identical validation: LFS pointer detection, submodule pointer detection, UTF-8 replacement ratio check (>5% → excluded), per-file size cap (500KB), total size cap (750KB).

**Snapshot Integrity**: After ingestion, `buildSnapshot()` produces a `NormalizedProjectSnapshot` with `hash`, `fileCount`, `totalSizeBytes`, and `excludedFiles[]`. Both responses include `snapshotHash`, `snapshotFileCount`, `snapshotTotalBytes` for client-side comparison.

**Parity Mismatch Detection**: `compareSnapshots()` compares two snapshots and produces a `ParityMismatchResult` with detailed diff (missingInGithub, missingInZip, contentDifferent — up to 30 each). When mismatch is detected, rules should NOT run.

**Enhanced Diagnostics**: `logParityDiagnostics()` now logs exclusion reason counts, denied directory/extension hit counts, API errors with path context, and per-rule finding counts.

**No MAX_FILES Cap**: GitHub ingestion no longer uses an arbitrary MAX_FILES=50 limit — it fetches ALL files that pass filtering, bounded only by the shared total size cap (750KB).
