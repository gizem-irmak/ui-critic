import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rule registry for code analysis (same as analyze-zip)
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Poor focus visibility', diagnosis: 'Lack of visible focus reduces keyboard accessibility.', correctivePrompt: 'Ensure all interactive elements have clearly visible focus states.' },
    { id: 'A3', name: 'Incomplete keyboard operability', diagnosis: 'Interactive elements not fully operable via keyboard.', correctivePrompt: 'Ensure all interactive elements are keyboard accessible using native elements or ARIA + key handlers.' },
    { id: 'A4', name: 'Missing semantic structure', diagnosis: 'Page lacks proper semantic HTML structure (headings, landmarks, lists, interactive roles).', correctivePrompt: 'Use semantic HTML elements to represent page hierarchy and structure.' },
    { id: 'A5', name: 'Missing form labels (Input clarity)', diagnosis: 'Form controls lack programmatic labels, reducing accessibility.', correctivePrompt: 'Add visible <label> elements associated with form controls, or provide accessible names via aria-label/aria-labelledby.' },
    { id: 'A6', name: 'Missing accessible names (Name, Role, Value)', diagnosis: 'Interactive elements lack programmatic accessible names (WCAG 4.1.2).', correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements.' },
  ],
  usability: [
    { id: 'U1', name: 'Unclear primary action', diagnosis: 'Users may struggle to identify the main action due to competing visual emphasis or missing affordances.', correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions using variant demotion (outline, ghost, link).' },
    { id: 'U2', name: 'Incomplete / Unclear navigation', diagnosis: 'Navigation paths are missing, ambiguous, or prevent users from understanding their current location.', correctivePrompt: 'Ensure clear navigation paths including back, forward, breadcrumb, and cancel options. Provide visible indicators of current location.' },
    { id: 'U3', name: 'Truncated or inaccessible content', diagnosis: 'Important content is truncated, clipped, or hidden in ways that prevent users from accessing full information.', correctivePrompt: 'Ensure all meaningful text is fully visible. Adjust layout, wrapping, or container sizes. Provide affordances to reveal truncated content.' },
    { id: 'U4', name: 'Recognition-to-recall regression', diagnosis: 'The interface requires users to recall information from memory instead of recognizing it from visible options.', correctivePrompt: 'Make options, commands, and actions visible or easily retrievable. Reduce reliance on user memory by providing contextual cues and labels.' },
    { id: 'U5', name: 'Insufficient interaction feedback', diagnosis: 'Users receive inadequate or no visible feedback about the result of their actions.', correctivePrompt: 'Add visible feedback after user actions: loading indicators, success/error confirmations, or state change animations.' },
    { id: 'U6', name: 'Weak grouping / layout coherence', diagnosis: 'Related elements lack visual grouping or alignment, reducing scannability and comprehension.', correctivePrompt: 'Improve alignment and grouping to visually associate related elements. Use consistent spacing, borders, or background differentiation.' },
  ],
  ethics: [
    { id: 'E1', name: 'Insufficient transparency in high-impact actions', diagnosis: 'High-impact actions lack adequate disclosure, confirmation, or consequence explanation.', correctivePrompt: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions.' },
    { id: 'E2', name: 'Imbalanced or manipulative choice architecture', diagnosis: 'Choice presentation uses visual weight, ordering, or defaults to nudge users toward a specific option.', correctivePrompt: 'Present choices with equal visual weight and neutral defaults. Ensure monetized options are not visually dominant.' },
    { id: 'E3', name: 'Obscured or restricted user control', diagnosis: 'User control options (opt-out, cancel, dismiss) are visually suppressed or harder to access.', correctivePrompt: 'Make opt-out, cancel, and control options clearly visible with equal visual hierarchy and accessibility.' },
  ],
};

// File extensions to analyze (UI-related only)
const ANALYZABLE_EXTENSIONS = [
  '.html', '.htm', '.jsx', '.tsx', '.js', '.ts',
  '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte', '.astro'
];

// Directories to skip (backend, configs, tests, assets)
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'test', 'tests', '__tests__', '__mocks__', 'spec',
  'server', 'api', 'backend', 'functions', 'supabase',
  'public', 'static', 'assets', 'images', 'fonts', 'icons',
  '.github', '.vscode', '.idea', 'coverage',
]);

// Files to skip
const SKIP_FILES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'next.config.js', 'next.config.mjs', 'tailwind.config.js', 'tailwind.config.ts',
  'postcss.config.js', 'eslint.config.js', '.eslintrc.js', '.eslintrc.json',
  'jest.config.js', 'vitest.config.ts', 'playwright.config.ts',
]);

interface GitHubFile {
  path: string;
  type: 'blob' | 'tree';
  url: string;
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubFile[];
  truncated: boolean;
}

// Parse GitHub URL to extract owner and repo
function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  try {
    // Handle various GitHub URL formats
    const patterns = [
      // https://github.com/owner/repo
      /^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/\#\?]+)/,
      // github.com/owner/repo
      /^github\.com\/([^\/]+)\/([^\/\#\?]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const owner = match[1];
        let repo = match[2];
        // Remove .git suffix if present
        repo = repo.replace(/\.git$/, '');
        return { owner, repo };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Check if file should be analyzed
function isAnalyzableFile(filepath: string): boolean {
  const filename = filepath.split('/').pop() || '';
  
  // Skip if in skip files list
  if (SKIP_FILES.has(filename)) return false;
  
  // Check if any path segment is in skip directories
  const segments = filepath.toLowerCase().split('/');
  for (const segment of segments) {
    if (SKIP_DIRECTORIES.has(segment)) return false;
  }
  
  // Check file extension
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return ANALYZABLE_EXTENSIONS.includes(ext);
}

// Fetch repository tree from GitHub API
async function fetchRepoTree(owner: string, repo: string): Promise<GitHubFile[]> {
  // First, get the default branch
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  console.log(`Fetching repo info: ${repoUrl}`);
  
  const repoResponse = await fetch(repoUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'UI-Critic-Analysis-Tool',
    },
  });
  
  if (!repoResponse.ok) {
    const errorText = await repoResponse.text();
    if (repoResponse.status === 404) {
      throw new Error('Repository not found. Please ensure the repository exists and is public.');
    }
    if (repoResponse.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Please try again later.');
    }
    throw new Error(`Failed to fetch repository: ${repoResponse.status} - ${errorText}`);
  }
  
  const repoData = await repoResponse.json();
  const defaultBranch = repoData.default_branch || 'main';
  const isPrivate = repoData.private;
  
  if (isPrivate) {
    throw new Error('This repository is private. Only public repositories can be analyzed.');
  }
  
  console.log(`Repository: ${owner}/${repo}, Default branch: ${defaultBranch}`);
  
  // Fetch the file tree recursively
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
  console.log(`Fetching tree: ${treeUrl}`);
  
  const treeResponse = await fetch(treeUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'UI-Critic-Analysis-Tool',
    },
  });
  
  if (!treeResponse.ok) {
    const errorText = await treeResponse.text();
    throw new Error(`Failed to fetch repository tree: ${treeResponse.status} - ${errorText}`);
  }
  
  const treeData: GitHubTreeResponse = await treeResponse.json();
  
  if (treeData.truncated) {
    console.warn('Repository tree was truncated - some files may be missing');
  }
  
  return treeData.tree;
}

// Fetch file content from GitHub
async function fetchFileContent(owner: string, repo: string, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'UI-Critic-Analysis-Tool',
    },
  });
  
  if (!response.ok) {
    console.warn(`Failed to fetch file ${path}: ${response.status}`);
    return '';
  }
  
  return await response.text();
}

// =====================
// Static Analysis Functions (adapted from analyze-zip)
// =====================

type Emphasis = 'high' | 'medium' | 'low' | 'unknown';

interface CvaVariantConfig {
  defaultVariant?: string;
  variantClassMap: Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function extractCvaVariantConfigRegex(source: string): CvaVariantConfig | null {
  try {
    const cvaMatch = source.match(/(?:const\s+\w+\s*=\s*)?cva\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*\{/s);
    if (!cvaMatch) return null;

    const startIdx = source.indexOf(cvaMatch[0]) + cvaMatch[0].length - 1;
    let depth = 1;
    let endIdx = startIdx + 1;
    while (depth > 0 && endIdx < source.length) {
      if (source[endIdx] === '{') depth++;
      else if (source[endIdx] === '}') depth--;
      endIdx++;
    }
    const configStr = source.slice(startIdx, endIdx);

    const variantClassMap: Record<string, string> = {};
    const variantsMatch = configStr.match(/variants\s*:\s*\{[\s\S]*?variant\s*:\s*\{([^}]+)\}/);
    if (variantsMatch) {
      const variantBlock = variantsMatch[1];
      const kvRegex = /(\w+)\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(variantBlock)) !== null) {
        const key = kvMatch[1];
        const value = kvMatch[2] || kvMatch[3] || kvMatch[4] || '';
        variantClassMap[key] = value;
      }
    }

    let defaultVariant: string | undefined;
    const defaultVariantsMatch = configStr.match(/defaultVariants\s*:\s*\{[^}]*variant\s*:\s*(?:"([^"]+)"|'([^']+)')/);
    if (defaultVariantsMatch) {
      defaultVariant = defaultVariantsMatch[1] || defaultVariantsMatch[2];
    }

    if (!defaultVariant) {
      if (variantClassMap['default']) defaultVariant = 'default';
      else {
        const keys = Object.keys(variantClassMap);
        if (keys.length > 0) defaultVariant = keys[0];
      }
    }

    if (Object.keys(variantClassMap).length === 0) return null;

    return { defaultVariant, variantClassMap };
  } catch {
    return null;
  }
}

function looksLikeFilledClass(className: string): boolean {
  const s = className.toLowerCase();
  if (/\bbg-(primary|destructive|blue|indigo|emerald|green|red|accent)(?:-|\b)/.test(s)) return true;
  if (/\bbg-background\b/.test(s)) return false;
  if (/\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return true;
  return false;
}

// Path 2: Tailwind-token emphasis for plain <button className="..."> (no CVA)
function classifyTailwindEmphasis(className: string): Emphasis {
  const s = className.toLowerCase();
  if (/\bbg-primary\b/.test(s)) return 'high';
  if (/\bbg-\w+-[6-9]00\b/.test(s)) return 'high';
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return 'high';
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return 'low';
  if (/\bbg-transparent\b/.test(s)) return 'low';
  if (/\bunderline\b/.test(s)) return 'low';
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return 'medium';
  return 'unknown';
}

// Unified CTA emphasis classifier — tool-agnostic (CVA + Tailwind + semantic classes)
function classifyCTAEmphasis(params: {
  variant: string | null;
  variantConfig: CvaVariantConfig | null;
  className: string;
}): { emphasis: Emphasis; cue: string } {
  const { variant, variantConfig, className } = params;
  const s = (className || '').toLowerCase();

  // Path A: CVA variant resolution (design-system components)
  if (variantConfig && (variant || variantConfig.defaultVariant)) {
    const resolvedVariant = variant || variantConfig.defaultVariant || 'default';
    const result = classifyButtonEmphasis({
      resolvedVariant,
      variantConfig,
      instanceClassName: className,
    });
    if (result.emphasis !== 'unknown') {
      return { emphasis: result.emphasis, cue: `variant="${resolvedVariant}"` };
    }
  }

  // Path B: Tailwind utility class tokens
  if (/\bbg-primary\b/.test(s)) return { emphasis: 'high', cue: 'bg-primary' };
  if (/\bbg-\w+-[6-8]00\b/.test(s)) {
    const m = s.match(/\b(bg-\w+-[6-8]00)\b/);
    return { emphasis: 'high', cue: m?.[1] || 'bg-dark' };
  }
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) {
    const bgM = s.match(/\b(bg-\S+)\b/);
    return { emphasis: 'high', cue: `${bgM?.[1] || 'bg-*'} + text-white` };
  }

  // Path C: Semantic class cues (generic CSS frameworks, custom classes)
  if (/\b(?:btn-primary|button-primary|cta-primary|main-action)\b/.test(s)) {
    return { emphasis: 'high', cue: 'semantic:btn-primary' };
  }
  if (/\bprimary\b/.test(s) && !/\b(?:text-primary|bg-primary|border-primary|ring-primary|outline-primary)\b/.test(s)) {
    return { emphasis: 'high', cue: 'semantic:primary' };
  }

  // Path D: Inline style heuristic
  if (/style\s*=/.test(s) && /background-?color/i.test(s) && /color\s*:\s*(?:white|#fff)/i.test(s)) {
    return { emphasis: 'high', cue: 'inline-style:filled' };
  }

  // LOW signals
  if (/\b(?:ghost|link)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:ghost/link' };
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return { emphasis: 'low', cue: 'border-only' };
  if (/\bbg-transparent\b/.test(s)) return { emphasis: 'low', cue: 'bg-transparent' };
  if (/\bunderline\b/.test(s)) return { emphasis: 'low', cue: 'underline' };
  if (/\b(?:btn-outline|button-outline|btn-ghost|btn-link|btn-text)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:outline' };

  // MEDIUM signals
  if (/\b(?:secondary|btn-secondary|button-secondary)\b/.test(s)) return { emphasis: 'medium', cue: 'semantic:secondary' };
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return { emphasis: 'medium', cue: 'bg-muted' };
  if (/\b(?:outline)\b/.test(s) && !/\b(?:btn-outline|button-outline)\b/.test(s)) return { emphasis: 'medium', cue: 'outline' };

  return { emphasis: 'unknown', cue: '' };
}

function looksLikeOutlineOrGhostClass(className: string): boolean {
  const s = className.toLowerCase();
  return /\bborder\b/.test(s) || /\bbg-transparent\b/.test(s) || /\bunderline\b/.test(s);
}

function classifyButtonEmphasis(params: {
  resolvedVariant: string | null;
  variantConfig: CvaVariantConfig | null;
  instanceClassName: string;
}): { emphasis: Emphasis; styleKey: string | null } {
  const { resolvedVariant, variantConfig, instanceClassName } = params;

  if (!resolvedVariant || !variantConfig) {
    if (!instanceClassName) return { emphasis: 'unknown', styleKey: null };
    if (looksLikeFilledClass(instanceClassName) && !looksLikeOutlineOrGhostClass(instanceClassName)) return { emphasis: 'high', styleKey: 'filled' };
    if (looksLikeOutlineOrGhostClass(instanceClassName)) return { emphasis: 'low', styleKey: 'outline' };
    return { emphasis: 'unknown', styleKey: null };
  }

  const lowVariants = new Set(['outline', 'ghost', 'link']);
  const mediumVariants = new Set(['secondary']);
  const highVariants = new Set(['default', 'primary', 'destructive']);

  const variantClasses = variantConfig.variantClassMap[resolvedVariant] || '';
  const combined = `${variantClasses} ${instanceClassName}`.trim();

  if (lowVariants.has(resolvedVariant)) return { emphasis: 'low', styleKey: resolvedVariant };
  if (mediumVariants.has(resolvedVariant)) return { emphasis: 'medium', styleKey: resolvedVariant };
  if (highVariants.has(resolvedVariant)) return { emphasis: 'high', styleKey: resolvedVariant };

  if (looksLikeFilledClass(combined) && !looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'high', styleKey: resolvedVariant };
  if (looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'low', styleKey: resolvedVariant };
  return { emphasis: 'unknown', styleKey: null };
}

interface ButtonUsage {
  label: string;
  variant: string | null;
  className: string;
  hasOnClick: boolean;
  offset: number;
}

function extractButtonUsagesFromJsx(content: string, buttonLocalNames: Set<string>, baseOffset = 0): ButtonUsage[] {
  const usages: ButtonUsage[] = [];
  const tagPattern = new RegExp(
    `<(${Array.from(buttonLocalNames).join('|')}|button)\\b([^>]*)(?:>([^<]*(?:<(?!\\/(${Array.from(buttonLocalNames).join('|')}|button))[^<]*)*)<\\/\\1>|\\/>)`,
    'gi'
  );

  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    const attrs = match[2] || '';
    const children = match[3] || '';

    const variantMatch = attrs.match(/variant\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
    const variant = variantMatch ? (variantMatch[1] || variantMatch[2] || variantMatch[3]) : null;

    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';

    const hasOnClick = /onClick\s*=/.test(attrs);

    let label = children.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) {
      const ariaMatch = attrs.match(/(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      label = ariaMatch ? (ariaMatch[1] || ariaMatch[2] || 'Button') : 'Button';
    }

    usages.push({ label, variant, className, hasOnClick, offset: baseOffset + match.index });
  }

  return usages;
}

// Extract all CTA candidates: buttons + anchor-as-button
function extractCTAElements(content: string, buttonLocalNames: Set<string>, baseOffset = 0): ButtonUsage[] {
  const usages = extractButtonUsagesFromJsx(content, buttonLocalNames, baseOffset);

  const anchorRegex = /<a\b([^>]*)>([^<]*(?:<(?!\/a)[^<]*)*)<\/a>/gi;
  let aMatch;
  while ((aMatch = anchorRegex.exec(content)) !== null) {
    const attrs = aMatch[1] || '';
    const children = aMatch[2] || '';

    const isRoleButton = /role\s*=\s*["']button["']/i.test(attrs);
    const hasButtonClass = /\b(?:btn|button|cta)\b/i.test(attrs);

    if (!isRoleButton && !hasButtonClass) continue;

    const classMatch = attrs.match(/(?:className|class)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';

    let label = children.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) {
      const ariaMatch = attrs.match(/(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      label = ariaMatch ? (ariaMatch[1] || ariaMatch[2] || 'Link') : 'Link';
    }

    usages.push({
      label,
      variant: null,
      className,
      hasOnClick: /onClick\s*=/.test(attrs),
      offset: baseOffset + aMatch.index,
    });
  }

  return usages;
}

interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
  offset: number;
  containerEnd: number;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];

  const NAMED_CONTAINERS = 'CardFooter|ModalFooter|DialogFooter|DialogActions|ButtonGroup|Actions|Toolbar|HeaderActions|FormActions';
  const LAYOUT_CLASS_RE = /(?:flex|grid|gap-|justify-|items-|space-x-|space-y-|actions|footer|toolbar|button-group)/;

  const openerRegex = new RegExp(`<(${NAMED_CONTAINERS}|div|footer|section|nav|header|aside|span)\\b([^>]*)>`, 'gi');
  let openerMatch;
  while ((openerMatch = openerRegex.exec(content)) !== null) {
    const tagName = openerMatch[1];
    const attrs = openerMatch[2] || '';
    const isNamedContainer = new RegExp(`^(${NAMED_CONTAINERS})$`, 'i').test(tagName);

    if (!isNamedContainer) {
      if (!LAYOUT_CLASS_RE.test(attrs)) continue;
    }

    const containerType = isNamedContainer ? tagName : 'FlexContainer';
    const openTagEnd = openerMatch.index + openerMatch[0].length;

    const nestRegex = new RegExp(`<(/?)(${tagName})\\b`, 'gi');
    nestRegex.lastIndex = openTagEnd;
    let depth = 1;
    let nestMatch;
    let containerEnd = -1;
    while ((nestMatch = nestRegex.exec(content)) !== null) {
      if (nestMatch[1] === '/') {
        depth--;
        if (depth === 0) {
          const closeIdx = content.indexOf('>', nestMatch.index);
          containerEnd = closeIdx >= 0 ? closeIdx + 1 : nestMatch.index + nestMatch[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    if (containerEnd < 0) continue;

    const containerContent = content.slice(openTagEnd, containerEnd);
    const buttons = extractCTAElements(containerContent, buttonLocalNames, openTagEnd);

    console.log(`[U1.2] container candidate: <${tagName}> (offset ${openerMatch.index}), CTAs = ${buttons.length}, labels = [${buttons.map(b => b.label).join(', ')}]`);

    if (buttons.length >= 2) {
      groups.push({
        containerType,
        buttons,
        lineContext: content.slice(openerMatch.index, Math.min(openerMatch.index + 200, containerEnd)),
        offset: openerMatch.index,
        containerEnd,
      });
    }
  }

  const sorted = groups.sort((a, b) => a.offset - b.offset);
  const deduped: ActionGroup[] = [];
  for (const g of sorted) {
    const gEnd = g.containerEnd;
    const containedByExisting = deduped.some(d => d.offset <= g.offset && d.containerEnd >= gEnd);
    if (!containedByExisting) {
      for (let i = deduped.length - 1; i >= 0; i--) {
        if (g.offset <= deduped[i].offset && gEnd >= deduped[i].containerEnd) {
          deduped.splice(i, 1);
        }
      }
      deduped.push(g);
    }
  }

  return deduped;
}

// =====================
// U1 Primary Action Detection (sub-checks U1.1, U1.2, U1.3)
// =====================

interface U1Finding {
  subCheck: 'U1.1' | 'U1.2' | 'U1.3';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance?: string;
  deduplicationKey: string;
}

function detectU1PrimaryAction(allFiles: Map<string, string>): U1Finding[] {
  const findings: U1Finding[] = [];
  // Scoped suppression: track form content ranges that triggered U1.1 per file
  const u11FormScopes = new Map<string, Array<{ start: number; end: number }>>();

  // === U1.1: Form without submit mechanism ===
  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|html|htm)$/i.test(filePath)) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let formMatch;
    while ((formMatch = formRegex.exec(content)) !== null) {
      const formAttrs = formMatch[1] || '';
      const formContent = formMatch[2] || '';

      const hasOnSubmit = /onSubmit\s*=/i.test(formAttrs);
      const hasSubmitButton = /<(?:button|Button)\b(?![^>]*type\s*=\s*["'](?:button|reset)["'])[^>]*>/i.test(formContent);
      const hasSubmitInput = /<input\b[^>]*type\s*=\s*["']submit["'][^>]*>/i.test(formContent);

      if (!hasSubmitButton && !hasSubmitInput && !hasOnSubmit) {
        const formStart = formMatch.index;
        const formEnd = formStart + formMatch[0].length;
        console.log(`[U1.1] fired: form scope ${filePath} chars ${formStart}-${formEnd}`);

        findings.push({
          subCheck: 'U1.1',
          subCheckLabel: 'No submit primary action',
          classification: 'confirmed',
          elementLabel: 'Form element',
          elementType: 'form',
          filePath,
          detection: 'Form without submit control',
          evidence: `<form> in ${filePath} — no submit button, input[type="submit"], or onSubmit handler`,
          explanation: 'A <form> exists but has no submit mechanism. Users cannot complete the form action.',
          confidence: 1.0,
          advisoryGuidance: 'Add a clear submit action (e.g., "Save", "Submit") tied to the form.',
          deduplicationKey: `U1.1|${filePath}`,
        });
        if (!u11FormScopes.has(filePath)) u11FormScopes.set(filePath, []);
        u11FormScopes.get(filePath)!.push({ start: formStart, end: formEnd });
      }
    }
  }

  // Helper: check if a character offset falls within any U1.1 form scope for a file
  const isInsideU11Form = (filePath: string, offset: number): boolean => {
    const scopes = u11FormScopes.get(filePath);
    if (!scopes) return false;
    return scopes.some(s => offset >= s.start && offset <= s.end);
  };

  // === U1.2 & U1.3: Competing CTAs and generic labels ===
  const resolveKnownButtonImpl = (): { filePath: string; config: CvaVariantConfig } | null => {
    const candidates = [
      'src/components/ui/button.tsx', 'src/components/ui/button.ts',
      'components/ui/button.tsx', 'components/ui/button.ts',
    ];
    for (const p of candidates) {
      const content = allFiles.get(p);
      if (!content) continue;
      const cfg = extractCvaVariantConfigRegex(content);
      if (cfg) return { filePath: p, config: cfg };
    }
    return null;
  };

  const buttonImpl = resolveKnownButtonImpl();
  const seenU12Groups = new Set<string>();
  const GENERIC_LABELS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (filePath.includes('components/ui/button')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    // No longer skip entire file — scoped suppression handled below

    const buttonLocalNames = new Set<string>();
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*components\/ui\/button[^"']*)["']/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      if (/\bButton\b/.test(importMatch[1])) {
        const aliasMatch = importMatch[1].match(/Button\s+as\s+(\w+)/);
        buttonLocalNames.add(aliasMatch ? aliasMatch[1] : 'Button');
      }
    }
    buttonLocalNames.add('button');

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'Component';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // U1.2: Check action groups for competing primaries (tool-agnostic)
    const u12SuppressedLabels = new Set<string>();
    const actionGroups = extractActionGroups(content, buttonLocalNames);
    const coveredOffsets = new Set<number>();

    const processU12Region = (
      ctaUsages: ButtonUsage[],
      regionLabel: string,
      regionType: 'container' | 'line-window',
      regionOffset: number,
    ) => {
      const ctas: Array<{ label: string; emphasis: Emphasis; cue: string }> = [];
      for (const btn of ctaUsages) {
        const result = classifyCTAEmphasis({
          variant: btn.variant,
          variantConfig: buttonImpl?.config || null,
          className: btn.className,
        });
        ctas.push({ label: btn.label, emphasis: result.emphasis, cue: result.cue });
      }

      console.log(`[U1.2] region "${regionLabel}" (${regionType}) in ${filePath}, CTAs = ${ctas.length}, emphasis = [${ctas.map(c => `${c.label}:${c.emphasis}(${c.cue})`).join(', ')}]`);

      const highs = ctas.filter(c => c.emphasis === 'high');
      if (highs.length < 2) return;

      const groupKey = `${filePath}|${regionLabel}`;
      if (seenU12Groups.has(groupKey)) return;
      seenU12Groups.add(groupKey);

      const labels = ctas.map(c => c.label);
      const cueList = highs.map(h => h.cue).join(', ');
      console.log(`[U1.2] fired: ${regionLabel} in ${filePath} — ${highs.length} HIGH CTAs [${cueList}]`);

      let u12Confidence = 0.60;
      if (regionType === 'container') u12Confidence += 0.10;
      const strongCues = highs.filter(h => /variant=|bg-\w+-[6-8]00|bg-primary|btn-primary|semantic:/.test(h.cue));
      if (strongCues.length === highs.length) u12Confidence += 0.10;
      const offsets = ctaUsages.map(b => b.offset);
      if (offsets.length >= 2 && Math.max(...offsets) - Math.min(...offsets) < 500) u12Confidence += 0.05;
      u12Confidence = Math.min(u12Confidence, 0.90);

      findings.push({
        subCheck: 'U1.2',
        subCheckLabel: 'Multiple equivalent CTAs',
        classification: 'potential',
        elementLabel: `${componentName} — ${regionLabel}`,
        elementType: 'button group',
        filePath,
        detection: `${highs.length}+ equivalent high-emphasis CTAs in the same region`,
        evidence: `${labels.join(', ')} — emphasis cues: [${cueList}] (${regionType === 'container' ? regionLabel : 'line-window proximity'})`,
        explanation: `${highs.length} CTA buttons share equivalent high-emphasis styling in the same UI region, making the primary action unclear.`,
        confidence: u12Confidence,
        advisoryGuidance: 'Visually distinguish the primary action and demote secondary actions to outline/ghost/link variants.',
        deduplicationKey: `U1.2|${filePath}|${regionLabel}`,
      });
      for (const cta of ctas) {
        u12SuppressedLabels.add(cta.label.trim().toLowerCase());
      }
    };

    for (const group of actionGroups) {
      if (isInsideU11Form(filePath, group.offset)) {
        console.log(`[U1.2] suppressed: container at offset ${group.offset} is inside U1.1 form scope in ${filePath}`);
        continue;
      }
      for (const btn of group.buttons) coveredOffsets.add(btn.offset);
      processU12Region(group.buttons, group.containerType, 'container', group.offset);
    }

    // Line-window fallback: group orphaned CTAs by proximity (±40 lines ≈ ±1600 chars)
    const LINE_WINDOW_CHARS = 1600;
    const allCTAsInFile = extractCTAElements(content, buttonLocalNames);
    const orphanedCTAs = allCTAsInFile.filter(c => !coveredOffsets.has(c.offset));
    if (orphanedCTAs.length >= 2) {
      const sortedOrphans = orphanedCTAs.sort((a, b) => a.offset - b.offset);
      let windowStart = 0;
      while (windowStart < sortedOrphans.length) {
        const windowCTAs = [sortedOrphans[windowStart]];
        let windowEnd = windowStart + 1;
        while (windowEnd < sortedOrphans.length && sortedOrphans[windowEnd].offset - sortedOrphans[windowStart].offset <= LINE_WINDOW_CHARS) {
          windowCTAs.push(sortedOrphans[windowEnd]);
          windowEnd++;
        }
        if (windowCTAs.length >= 2) {
          const notInForm = windowCTAs.filter(c => !isInsideU11Form(filePath, c.offset));
          if (notInForm.length >= 2) {
            processU12Region(notInForm, `line-window@${sortedOrphans[windowStart].offset}`, 'line-window', sortedOrphans[windowStart].offset);
          }
        }
        windowStart = windowEnd;
      }
    }

    // U1.3: Generic CTA labels (suppressed if label already covered by U1.2 in same file)
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (GENERIC_LABELS.has(labelLower)) {
        // Scoped suppression: skip if this button is inside a U1.1 form
        if (isInsideU11Form(filePath, btn.offset)) {
          console.log(`[U1.3] suppressed: "${btn.label}" at offset ${btn.offset} is inside U1.1 form scope in ${filePath}`);
          continue;
        }
        // Skip if this label was part of a U1.2 competing-CTAs group in this file
        if (u12SuppressedLabels.has(labelLower)) {
          console.log(`[U1.3] suppressed: "${btn.label}" covered by U1.2 in same container`);
          continue;
        }
        const dedupeKey = `U1.3|${filePath}|${labelLower}`;
        if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;

        // Signal-based confidence for U1.3
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.55;
        if (HIGH_RISK_GENERICS.has(labelLower)) {
          u13Confidence += 0.10;
        }
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) {
          u13Confidence += 0.05;
        }
        const btnEmphasis = buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)
          ? classifyButtonEmphasis({
              resolvedVariant: btn.variant || buttonImpl.config.defaultVariant || 'default',
              variantConfig: buttonImpl.config,
              instanceClassName: btn.className,
            }).emphasis
          : classifyTailwindEmphasis(btn.className);
        if (btnEmphasis === 'high') {
          u13Confidence += 0.05;
        }
        u13Confidence = Math.min(u13Confidence, 0.80);

        findings.push({
          subCheck: 'U1.3',
          subCheckLabel: 'Ambiguous CTA label',
          classification: 'potential',
          elementLabel: `"${btn.label}" button`,
          elementType: 'button',
          filePath,
          detection: `Generic label: "${btn.label}"`,
          evidence: `CTA labeled "${btn.label}" in ${componentName} — generic label without context`,
          explanation: `The CTA label "${btn.label}" is generic and does not communicate the specific action.`,
          confidence: u13Confidence,
          advisoryGuidance: 'Use specific, action-oriented labels (e.g., "Save changes" instead of "Save", "Create account" instead of "Submit").',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  return findings;
}

// Contrast analysis (simplified for GitHub - static only)
// GITHUB INPUT = HEURISTIC: Cannot confirm contrast without runtime rendering
// GitHub repositories may have incomplete styling context, missing runtime configuration,
// or external themes not available locally
const TAILWIND_COLORS: Record<string, string> = {
  'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8',
  'zinc-400': '#a1a1aa',
  'zinc-500': '#71717a',
};

// Per authoritative A1 rule: GitHub analysis = ALWAYS "Heuristic Potential Risk"
interface ContrastViolation {
  ruleId: string;
  ruleName: string;
  category: string;
  status: string;
  samplingMethod: 'pixel' | 'inferred';
  inputType: 'github' | 'zip' | 'screenshots';
  elementIdentifier?: string;
  elementDescription?: string;
  evidence?: string;
  diagnosis: string;
  contextualHint: string;
  correctivePrompt: string;
  confidence: number;
  riskLevel?: string;
  potentialRiskReason?: string;
  inputLimitation?: string;
  advisoryGuidance?: string;
  reasonCodes?: string[];
  backgroundStatus?: 'certain' | 'uncertain' | 'unmeasurable';
  affectedComponents?: any[];
  blocksConvergence?: boolean;
}

function extractTextColors(content: string): Array<{ colorClass: string; context: string }> {
  const results: Array<{ colorClass: string; context: string }> = [];
  const classPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
  
  let match;
  while ((match = classPattern.exec(content)) !== null) {
    const classes = match[1] || match[2] || match[3] || '';
    const textColorMatch = classes.match(/text-(gray|slate|zinc)-[2345]00/g);
    
    if (textColorMatch) {
      for (const colorClass of textColorMatch) {
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(content.length, match.index + 200);
        results.push({
          colorClass,
          context: content.slice(contextStart, contextEnd),
        });
      }
    }
  }
  
  return results;
}

const A1_COLOR_RISK_TIERS: Record<string, { riskLevel: 'high' | 'medium' | 'low'; baseConfidence: number }> = {
  'gray-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'gray-300': { riskLevel: 'high', baseConfidence: 0.70 },
  'slate-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'slate-300': { riskLevel: 'high', baseConfidence: 0.70 },
  'zinc-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'zinc-300': { riskLevel: 'high', baseConfidence: 0.70 },
  'gray-400': { riskLevel: 'medium', baseConfidence: 0.60 },
  'slate-400': { riskLevel: 'medium', baseConfidence: 0.60 },
  'zinc-400': { riskLevel: 'medium', baseConfidence: 0.60 },
  'gray-500': { riskLevel: 'low', baseConfidence: 0.45 },
  'slate-500': { riskLevel: 'low', baseConfidence: 0.45 },
  'zinc-500': { riskLevel: 'low', baseConfidence: 0.45 },
};

function analyzeContrastInCode(files: Map<string, string>): ContrastViolation[] {
  const a1Findings: Array<{
    colorClass: string;
    colorName: string;
    hexColor?: string;
    filePath: string;
    componentName?: string;
    riskLevel: 'high' | 'medium' | 'low';
    confidence: number;
  }> = [];
  
  for (const [filepath, content] of files) {
    const textColors = extractTextColors(content);
    
    // Try to extract component name from file
    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];
    
    for (const { colorClass } of textColors) {
      const colorMatch = colorClass.match(/text-(\w+-?\d*)/);
      if (!colorMatch) continue;
      
      const colorName = colorMatch[1];
      const riskTier = A1_COLOR_RISK_TIERS[colorName];
      
      if (!riskTier) continue;
      
      const hexColor = TAILWIND_COLORS[colorName];
      
      a1Findings.push({
        colorClass,
        colorName,
        hexColor,
        filePath: filepath,
        componentName: componentName || undefined,
        riskLevel: riskTier.riskLevel,
        confidence: riskTier.baseConfidence,
      });
    }
  }
  
  if (a1Findings.length === 0) {
    return [];
  }
  
  const dedupeMap = new Map<string, any>();
  
  for (const finding of a1Findings) {
    const key = `${finding.colorName}:${finding.filePath}`;
    if (dedupeMap.has(key)) {
      const existing = dedupeMap.get(key)!;
      existing.occurrence_count += 1;
    } else {
      dedupeMap.set(key, { ...finding, occurrence_count: 1 });
    }
  }
  
  const affectedComponents = Array.from(dedupeMap.values());
  
  const highRiskCount = affectedComponents.filter(c => c.riskLevel === 'high').length;
  const mediumRiskCount = affectedComponents.filter(c => c.riskLevel === 'medium').length;
  const lowRiskCount = affectedComponents.filter(c => c.riskLevel === 'low').length;
  
  let overallRiskLevel: 'high' | 'medium' | 'low' = 'low';
  if (highRiskCount > 0) overallRiskLevel = 'high';
  else if (mediumRiskCount > 0) overallRiskLevel = 'medium';
  
  // Reduce confidence by 15% for GitHub (even less context than ZIP - no local theme files)
  const maxConfidence = Math.max(...affectedComponents.map(c => c.confidence));
  const overallConfidence = Math.round((maxConfidence * 0.85) * 100) / 100;
  
  const uniqueColorClasses = [...new Set(affectedComponents.map(c => c.colorClass))];
  const displayLimit = 4;
  const displayedColors = uniqueColorClasses.slice(0, displayLimit);
  const moreCount = uniqueColorClasses.length - displayLimit;
  const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
  
  // Build file list with component names for location tracking
  const uniqueFiles = [...new Set(affectedComponents.map(c => {
    const fileName = c.filePath.split('/').pop() || c.filePath;
    return c.componentName ? `${c.componentName} (${fileName})` : fileName;
  }))];
  const fileDisplayLimit = 4;
  const displayedFiles = uniqueFiles.slice(0, fileDisplayLimit);
  const fileMoreCount = uniqueFiles.length - fileDisplayLimit;
  const fileMoreText = fileMoreCount > 0 ? ` and ${fileMoreCount} more` : '';
  
  const riskBreakdown = [
    highRiskCount > 0 ? `${highRiskCount} high-risk` : '',
    mediumRiskCount > 0 ? `${mediumRiskCount} medium-risk` : '',
    lowRiskCount > 0 ? `${lowRiskCount} low-risk` : '',
  ].filter(Boolean).join(', ');
  
  // Input limitation explanation for GitHub analysis
  const inputLimitation = 'GitHub repository analysis cannot access runtime rendering, computed styles, or theme configurations. ' +
    'Foreground colors are detected from Tailwind classes, but background context is often inherited, theme-dependent, or dynamic. ' +
    'External stylesheets, CSS variables, or theme providers may not be available in the analyzed code.';
  
  // Advisory guidance for potential risk findings - AVOID repeating "heuristic" labels
  const advisoryGuidance = 'To confirm contrast compliance, upload screenshots of the rendered UI for visual verification.';
  
  // Build diagnosis - AVOID repeating "heuristic", "non-blocking", or policy restatements
  const diagnosis = `${affectedComponents.length} text color occurrence(s) detected ` +
    `in ${displayedFiles.join(', ')}${fileMoreText} using ${displayedColors.join(', ')}${moreText}. ` +
    `Risk breakdown: ${riskBreakdown || 'low-risk'}. ` +
    `Background color cannot be determined from repository analysis; contrast ratio cannot be computed.`;
  
  // NO corrective prompt for GitHub heuristic findings
  const correctivePrompt = ''; // Empty - no mandatory corrective prompt for heuristic findings
  
  // GitHub input = ALWAYS inferred sampling (no pixel access)
  // Per authoritative A1 rule: GitHub analysis = ALWAYS "Heuristic Potential Risk"
  // Heuristic A1 findings NEVER block convergence
  return [{
    ruleId: 'A1',
    ruleName: 'Insufficient text contrast',
    category: 'accessibility',
    status: 'potential', // ALWAYS potential for GitHub analysis (per authoritative rule)
    samplingMethod: 'inferred', // GitHub cannot pixel-sample — colors from tokens/classes
    inputType: 'github', // Explicit input type tracking
    evidence: `Text color classes detected in ${displayedFiles.join(', ')}${fileMoreText}: ${displayedColors.join(', ')}${moreText}. Background color cannot be determined from static analysis.`,
    diagnosis,
    contextualHint: `Light text colors may be insufficient for informational text on light backgrounds.`,
    correctivePrompt,
    confidence: overallConfidence,
    riskLevel: overallRiskLevel,
    inputLimitation,
    advisoryGuidance,
    potentialRiskReason: 'Repository analysis cannot access rendered pixels; colors inferred from Tailwind classes.',
    // Per authoritative A1 rule: Heuristic findings NEVER block convergence
    blocksConvergence: false,
    affectedComponents: affectedComponents.map(c => ({
      colorClass: c.colorClass,
      hexColor: c.hexColor,
      filePath: c.filePath,
      componentName: c.componentName,
      riskLevel: c.riskLevel,
      occurrence_count: c.occurrence_count,
    })),
  }];
}

// ========== A3 DETERMINISTIC DETECTION (Keyboard Operability) ==========
// Supports multiline JSX opening tags by extracting full tag blocks.

interface A3Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  lineNumber: number;
  componentName?: string;
  classificationCode: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
  detectedHandlers: string[];
  missingFeatures: string[];
}

/**
 * Extract multiline JSX opening tags from source.
 * Handles arrow functions inside attribute values (which contain '>').
 */
function extractJsxOpeningTags(content: string, tagPattern: string): Array<{tag: string; attrs: string; index: number; fullMatch: string}> {
  const results: Array<{tag: string; attrs: string; index: number; fullMatch: string}> = [];
  const openRegex = new RegExp(`<(${tagPattern})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = openRegex.exec(content)) !== null) {
    const startIdx = m.index;
    let i = startIdx + m[0].length;
    let depth = 0;
    let inString: string | null = null;
    let inTemplateLiteral = false;
    let found = false;
    while (i < content.length) {
      const ch = content[i];
      if (inString) {
        if (ch === inString && content[i - 1] !== '\\') inString = null;
        i++; continue;
      }
      if (inTemplateLiteral) {
        if (ch === '`' && content[i - 1] !== '\\') inTemplateLiteral = false;
        i++; continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
      if (ch === '`') { inTemplateLiteral = true; i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }
      if (depth === 0 && ch === '>') {
        const fullMatch = content.slice(startIdx, i + 1);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      if (depth === 0 && ch === '/' && i + 1 < content.length && content[i + 1] === '>') {
        const fullMatch = content.slice(startIdx, i + 2);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      i++;
    }
    if (!found) continue;
  }
  return results;
}

function isInsideInteractiveAncestor(content: string, position: number): boolean {
  const precedingContent = content.slice(0, position);
  const nativeTags = ['button', 'a', 'input', 'select', 'textarea', 'label', 'details'];
  for (const tag of nativeTags) {
    const openRegex = new RegExp(`<${tag}\\b`, 'gi');
    const closeRegex = new RegExp(`</${tag}\\s*>`, 'gi');
    let opens = 0, closes = 0;
    let om;
    while ((om = openRegex.exec(precedingContent)) !== null) opens++;
    while ((om = closeRegex.exec(precedingContent)) !== null) closes++;
    if (opens > closes) return true;
  }
  return false;
}

function isSummaryInDetails(content: string, position: number, tag: string): boolean {
  if (tag.toLowerCase() !== 'summary') return false;
  return isInsideInteractiveAncestor(content, position);
}

const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl|summary';
const INTERACTIVE_ROLES_RE = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;

function detectA3KeyboardOperability(allFiles: Map<string, string>): A3Finding[] {
  const findings: A3Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const fileName = filePath.split('/').pop() || filePath;

    // A3-C1: Non-semantic elements with pointer handlers but missing keyboard support
    const nonInteractiveTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index, fullMatch } of nonInteractiveTags) {
      if (!POINTER_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']\s*true\s*["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*\{\s*true\s*\}/i.test(attrs)) continue;
      if (isInsideInteractiveAncestor(content, index)) continue;
      if (isSummaryInDetails(content, index, tag)) continue;

      const hasRole = INTERACTIVE_ROLES_RE.test(attrs);
      const hasTabIndex = /tabIndex\s*=\s*\{?\s*(\d+)\s*\}?/i.test(attrs) || /tabindex\s*=\s*["'](\d+)["']/i.test(attrs);
      const hasNegTabIndex = /tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) || /tabindex\s*=\s*["']-1["']/i.test(attrs);
      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);

      if (hasRole && hasTabIndex && hasKeyHandler) continue;

      const missingFeatures: string[] = [];
      if (!hasRole) missingFeatures.push('missing role');
      if (!hasTabIndex && !hasNegTabIndex) missingFeatures.push('missing tabIndex');
      if (hasNegTabIndex) missingFeatures.push('tabIndex={-1}');
      if (!hasKeyHandler) missingFeatures.push('missing onKeyDown');
      if (missingFeatures.length === 0) continue;

      const detectedHandlers: string[] = [];
      const handlerMatches = attrs.matchAll(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/g);
      for (const hm of handlerMatches) detectedHandlers.push(hm[1]);

      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const afterTag = content.slice(index + fullMatch.length, Math.min(content.length, index + fullMatch.length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();

      const label = ariaLabelMatch?.[1] || ariaLabelMatch?.[2]
        || (innerText && innerText.length > 0 && innerText.length <= 60 ? innerText : null)
        || titleMatch?.[1] || titleMatch?.[2]
        || testIdMatch?.[1] || testIdMatch?.[2] || testIdMatch?.[3]
        || `Clickable ${tag} (${detectedHandlers[0] || 'onClick'})`;

      const lineNumber = content.slice(0, index).split('\n').length;
      const triggerHandler = detectedHandlers[0] || 'onClick';
      const dedupeKey = `${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-C1 CONFIRMED: ${filePath}:${lineNumber} <${tag}> handlers=[${detectedHandlers}] missing=[${missingFeatures}]`);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-C1', classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> element`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber} — ${missingFeatures.join(', ')}`,
        explanation: `This <${tag}> has ${detectedHandlers.join(', ')} but ${missingFeatures.join(', ')}. Keyboard users cannot reach or activate it.`,
        confidence: 0.92,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} uses ${triggerHandler} but is not keyboard operable because it ${missingFeatures.join(', ')}.\n\nRecommended fix:\nReplace it with a <button type="button"> (or <a href> if navigation). If you must keep a ${tag}, add role="button", tabIndex={0}, and an onKeyDown handler for Enter/Space.`,
        deduplicationKey: dedupeKey,
        detectedHandlers,
        missingFeatures,
      });
    }

    // A3-C2: tabIndex={-1} on native interactive elements
    const nativeInteractiveTags = extractJsxOpeningTags(content, 'button|a|input|select|textarea');
    for (const { tag, attrs, index } of nativeInteractiveTags) {
      if (!/tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) && !/tabindex\s*=\s*["']-1["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']?true/i.test(attrs) || /\bhidden\b/.test(attrs)) continue;
      if (/sr-only|visually-hidden|clip-path/i.test(attrs)) continue;
      if (/\bdisabled\b/i.test(attrs) || /aria-disabled\s*=\s*["']?true/i.test(attrs)) continue;

      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabel?.[1] || ariaLabel?.[2] || `<${tag}> element`;
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|tabindex-neg|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-C2 CONFIRMED: ${filePath}:${lineNumber} <${tag}> tabIndex={-1}`);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-C2', classification: 'confirmed',
        detection: `tabIndex={-1} on <${tag}>`,
        evidence: `<${tag} tabIndex={-1}> at ${filePath}:${lineNumber} — removed from tab order`,
        explanation: `Primary interactive <${tag}> has tabIndex={-1}, removing it from keyboard tab order.`,
        confidence: 0.90,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} has tabIndex={-1}, removing it from keyboard tab order.\n\nRecommended fix:\nRemove tabIndex={-1} to restore default focusability.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: [],
        missingFeatures: ['tabIndex={-1}'],
      });
    }

    // A3-C3: Focus traps
    const keydownBlocks = content.matchAll(/onKeyDown\s*=\s*\{([^}]{10,500})\}/g);
    for (const km of keydownBlocks) {
      const block = km[1];
      if (/Tab/i.test(block) && /preventDefault/i.test(block)) {
        const hasEscape = /Escape|Esc/i.test(block);
        const lineNumber = content.slice(0, km.index!).split('\n').length;
        const classification = hasEscape ? 'potential' as const : 'confirmed' as const;
        const dedupeKey = `${filePath}|focus-trap|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        console.log(`A3-C3 ${classification.toUpperCase()}: ${filePath}:${lineNumber} focus trap`);

        findings.push({
          elementLabel: 'Focus trap', elementType: 'handler', sourceLabel: 'Focus trap', filePath, lineNumber, componentName,
          classificationCode: 'A3-C3', classification,
          detection: `onKeyDown intercepts Tab with preventDefault`,
          evidence: `onKeyDown handler at ${filePath}:${lineNumber} — Tab + preventDefault${hasEscape ? ' (Escape path exists)' : ''}`,
          explanation: hasEscape
            ? `Tab interception detected but Escape key path may exist. Verify focus can be released.`
            : `Tab interception with preventDefault and no Escape handler. Focus may be permanently trapped.`,
          confidence: hasEscape ? 0.65 : 0.85,
          correctivePrompt: `[Focus trap] — ${fileName}\n\nIssue reason:\nonKeyDown intercepts Tab with preventDefault${hasEscape ? '' : ' and no escape key handler'}.\n\nRecommended fix:\nEnsure focus traps have an Escape key exit path.`,
          deduplicationKey: dedupeKey,
          detectedHandlers: ['onKeyDown'],
          missingFeatures: hasEscape ? [] : ['no Escape exit path'],
        });
      }
    }

    // A3-P1: role="button" with tabIndex but no key handler
    const roleButtonTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of roleButtonTags) {
      if (!INTERACTIVE_ROLES_RE.test(attrs)) continue;
      if (!/tabIndex\s*=\s*\{?\s*[0-9]/i.test(attrs) && !/tabindex\s*=\s*["'][0-9]/i.test(attrs)) continue;
      if (KEY_HANDLER_RE.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || `<${tag} role="button">`;
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|role-nokey|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-P1 POTENTIAL: ${filePath}:${lineNumber} <${tag}> role="button" + tabIndex, no key handler`);

      findings.push({
        elementLabel: label, elementType: tag, role: 'button', sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `role="button" + tabIndex but no key handler`,
        evidence: `<${tag} role="button" tabIndex=0> at ${filePath}:${lineNumber} — missing Enter/Space activation`,
        explanation: `Has role="button" and tabIndex but no onKeyDown/onKeyUp handler.`,
        confidence: 0.72,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nMissing keyboard activation handler.\n\nRecommended fix:\nReplace with native <button> or add onKeyDown for Enter/Space.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: [],
        missingFeatures: ['missing onKeyDown'],
      });
    }

    // A3-P1: <a> without href used as button
    const anchorTags = extractJsxOpeningTags(content, 'a');
    for (const { tag, attrs, index } of anchorTags) {
      if (!POINTER_HANDLER_RE.test(attrs)) continue;
      if (/href\s*=\s*(?:"(?!#")(?![^"]*javascript:)[^"]+"|'(?!#')[^']+')/.test(attrs)) continue;
      const hasHref = /href\s*=/.test(attrs);
      if (hasHref && !/href\s*=\s*["']#["']/.test(attrs) && !/href\s*=\s*["']javascript:/i.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || '<a> as button';
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|a-nohref|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-P1 POTENTIAL: ${filePath}:${lineNumber} <a> onClick no valid href`);

      findings.push({
        elementLabel: label, elementType: 'a', role: 'link', sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `<a> with onClick but no valid href`,
        evidence: `<a onClick=...${hasHref ? ' href="#"' : ''}> at ${filePath}:${lineNumber}`,
        explanation: `<a> used as button with onClick${hasHref ? ' and href="#"' : ' but no href'}.`,
        confidence: 0.68,
        correctivePrompt: `[${label} (a)] — ${fileName}\n\nIssue reason:\n<a> used as button without valid href.\n\nRecommended fix:\nReplace with <button> or add a valid href.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: ['onClick'],
        missingFeatures: ['missing href'],
      });
    }
  }

  return findings;
}

// ========== A4 DETERMINISTIC DETECTION (Missing Semantic Structure) ==========
interface A4Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA4SemanticStructure(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  let hasH1 = false;
  let hasMainLandmark = false;
  let hasNavLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const clickableNonSemantics: A4Finding[] = [];
  const headingIssues: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];
  const visualHeadingIssues: A4Finding[] = [];

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;
  const TABINDEX_GTE0_RE = /tabIndex\s*=\s*\{?\s*(?:0|[1-9])\s*\}?/i;
  const LARGE_FONT_RE = /\b(?:text-(?:xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|text-lg)\b/;
  const BOLD_RE = /\b(?:font-bold|font-semibold|font-extrabold|font-black)\b/;
  const LIST_INTENT_RE = /^(?:\s*[•\-\*\d]+[\.\)]\s|\s*(?:item|card|entry|row|record)\b)/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html)$/.test(filePath)) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // A4.1: Heading semantics — scan for h1–h6
    if (/<h1\b/gi.test(content)) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.1: Visual heading heuristic
    const visualHeadingTags = extractJsxOpeningTags(content, 'div|span|p');
    for (const { tag, attrs, index } of visualHeadingTags) {
      const classMatch = attrs.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
      const cls = classMatch?.[1] || classMatch?.[2] || classMatch?.[3] || '';
      if (!LARGE_FONT_RE.test(cls) || !BOLD_RE.test(cls)) continue;
      if (/role\s*=\s*["']heading["']/i.test(attrs)) continue;
      const afterTag = content.slice(index + attrs.length + tag.length + 2, Math.min(content.length, index + attrs.length + tag.length + 200));
      const textMatch = afterTag.match(/^([^<]{3,80})/);
      if (!textMatch) continue;
      const text = textMatch[1].trim();
      if (text.length < 3 || text.length > 80) continue;

      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `A4.1|visual-heading|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      visualHeadingIssues.push({
        elementLabel: `Visual heading: "${text.substring(0, 40)}"`, elementType: tag, sourceLabel: text.substring(0, 40),
        filePath, componentName,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'confirmed',
        detection: `visual_heading_missing_semantics: <${tag}> with ${cls.substring(0, 40)} but no <h1–h6> or role="heading"`,
        evidence: `<${tag} className="${cls.substring(0, 60)}"> at ${filePath}:${lineNumber}`,
        explanation: `<${tag}> element looks like a heading (large font + bold: "${text.substring(0, 40)}") but lacks semantic heading markup. Screen readers cannot identify this as a heading.`,
        confidence: 0.92,
        correctivePrompt: `Replace <${tag}> with an appropriate heading level (<h2>, <h3>, etc.) or add role="heading" aria-level="N".`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.2: Interactive semantics — multiline JSX, suppresses if keyboard support missing (→ A3-C1)
    const a4NonInteractiveTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of a4NonInteractiveTags) {
      if (!POINTER_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*\{\s*true\s*\}/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      if (isInsideInteractiveAncestor(content, index)) continue;
      if (isSummaryInDetails(content, index, tag)) continue;

      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);
      const hasTabIndex = TABINDEX_GTE0_RE.test(attrs);
      // Suppress if keyboard support missing → A3-C1 territory
      if (!hasKeyHandler || !hasTabIndex) continue;

      const lineNumber = content.slice(0, index).split('\n').length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/) || attrs.match(/\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i);
      const triggerHandler = handlerMatch?.[1] || 'onClick';
      const afterTag = content.slice(index + attrs.length + tag.length + 2, Math.min(content.length, index + attrs.length + tag.length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || (innerText && innerText.length <= 60 ? innerText : null) || `Clickable <${tag}>`;

      const dedupeKey = `A4.2|${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clickableNonSemantics.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        subCheck: 'A4.2', subCheckLabel: 'Interactive semantics',
        classification: 'confirmed',
        detection: `${triggerHandler} on <${tag}> with keyboard support (tabIndex+keyHandler) but missing semantic role`,
        evidence: `<${tag} ${triggerHandler}=... tabIndex onKeyDown=...> at ${filePath}:${lineNumber} — no role="button"/"link"`,
        explanation: `Clickable <${tag}> has keyboard support but no semantic role (button/link). Screen readers cannot identify this as interactive.`,
        confidence: 0.93,
        correctivePrompt: `Add role="button" or role="link" to <${tag}>, or replace with a native <button>/<a> element.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists — tightened heuristic (Potential only)
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, { count: number; samples: string[] }>();
    let classMatch2;
    while ((classMatch2 = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch2[1] || classMatch2[2] || classMatch2[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        const entry = classCounts.get(cls) || { count: 0, samples: [] };
        entry.count++;
        const afterPos = classMatch2.index + classMatch2[0].length;
        const snippet = content.slice(afterPos, Math.min(content.length, afterPos + 200));
        const closingTag = snippet.match(/>\s*([^<]{0,80})/);
        if (closingTag?.[1]) entry.samples.push(closingTag[1].trim());
        classCounts.set(cls, entry);
      }
    }
    for (const [cls, { count, samples }] of classCounts) {
      if (count < 3) continue;
      const hasSemanticList = /<(?:ul|ol)\b/i.test(content) || /role\s*=\s*["']list["']/i.test(content);
      if (hasSemanticList) continue;
      const isTailwindOnlyClass = /^[\s\w\-\/\[\]:]+$/.test(cls) && !/\b(?:item|card|entry|row|record|list)\b/i.test(cls);
      const hasListIntent = samples.some(s => LIST_INTENT_RE.test(s)) || /\b(?:item|card|entry|row|record|list)\b/i.test(cls);
      if (isTailwindOnlyClass && !hasListIntent) continue;

      const listDedupeKey = `A4.4|${filePath}|${cls.substring(0, 30)}`;
      if (seenKeys.has(listDedupeKey)) continue;
      seenKeys.add(listDedupeKey);

      listIssues.push({
        elementLabel: `Repeated items (${count}x)`, elementType: 'div', sourceLabel: `Repeated pattern in ${componentName || filePath}`,
        filePath, componentName,
        subCheck: 'A4.4', subCheckLabel: 'List semantics',
        classification: 'potential',
        detection: `${count} sibling elements with identical className and list-like intent, no <ul>/<ol> wrapper`,
        evidence: `Repeated class in ${filePath}: "${cls.substring(0, 60)}..."`,
        explanation: `${count} elements with the same class pattern and list-like content but no semantic list (<ul>/<ol>) structure.`,
        confidence: 0.82,
        deduplicationKey: listDedupeKey,
      });
    }
  }

  // A4.1: Post-scan — missing h1 is Potential
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'potential',
      detection: 'missing_h1: No <h1> found in any source file',
      evidence: `Heading levels used: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found. Pages should generally have one <h1> for the page title, though it may be rendered dynamically.',
      confidence: 0.72,
      correctivePrompt: 'Add exactly one <h1> element for the page title.',
      deduplicationKey: 'A4.1|no-h1',
    });
  }

  const sortedLevels = Array.from(headingLevelsUsed).sort();
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i] - sortedLevels[i - 1] > 1) {
      headingIssues.push({
        elementLabel: `Heading level skip (h${sortedLevels[i - 1]} → h${sortedLevels[i]})`,
        elementType: `h${sortedLevels[i]}`, sourceLabel: 'Heading hierarchy',
        filePath: 'global', componentName: undefined,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'potential',
        detection: `skipped_levels: Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
        evidence: `Heading levels used: ${sortedLevels.map(l => `h${l}`).join(', ')}`,
        explanation: `Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}. This breaks the logical document outline for screen readers.`,
        confidence: 0.78,
        deduplicationKey: `A4.1|skip-h${sortedLevels[i - 1]}-h${sortedLevels[i]}`,
      });
      break;
    }
  }

  let h1Count = 0;
  for (const [, content] of allFiles) {
    const matches = content.match(/<h1\b/gi);
    if (matches) h1Count += matches.length;
  }
  if (h1Count > 1) {
    headingIssues.push({
      elementLabel: `Multiple <h1> elements (${h1Count})`, elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'potential',
      detection: `multiple_h1: ${h1Count} <h1> elements found across source files`,
      evidence: `${h1Count} <h1> tags detected`,
      explanation: `Multiple <h1> elements detected. Pages should generally have exactly one <h1> for the page title.`,
      confidence: 0.72,
      deduplicationKey: 'A4.1|multiple-h1',
    });
  }

  if (!hasMainLandmark) {
    landmarkIssues.push({
      elementLabel: 'Missing <main> landmark', elementType: 'main', sourceLabel: 'Page landmark',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
      classification: 'potential',
      detection: 'No <main> or role="main" found',
      evidence: 'No main landmark detected in source files',
      explanation: 'No <main> landmark found. Screen readers use landmarks to navigate page regions efficiently.',
      confidence: 0.75,
      deduplicationKey: 'A4.3|no-main',
    });
  }

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ========== A5 DETERMINISTIC DETECTION (Missing Form Labels) ==========
interface A5Finding {
  elementLabel: string;
  elementType: string;
  inputSubtype?: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A5.1' | 'A5.2' | 'A5.3' | 'A5.4' | 'A5.5' | 'A5.6';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  advisoryGuidance?: string;
  deduplicationKey: string;
  potentialSubtype?: 'accuracy' | 'borderline';
}

function detectA5FormLabels(allFiles: Map<string, string>): A5Finding[] {
  const findings: A5Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const controlIds = new Set<string>();
    const controlIdRegex = /(?:id)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
      const matches = content.match(idRegex);
      if (matches) idCounts.set(id, matches.length);
    }

    const labelForTargets = new Set<string>();
    const labelForRegex = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let labelForMatch;
    while ((labelForMatch = labelForRegex.exec(content)) !== null) {
      const target = labelForMatch[1] || labelForMatch[2] || labelForMatch[3];
      if (target) labelForTargets.add(target);
    }

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlRegex = /<(input|textarea|select)\b([^>]*)(?:>|\/>)/gi;
    let match;
    while ((match = controlRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      const attrs = match[2];

      if (tag === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputSubtype = tag === 'input' ? (typeMatch?.[1] || typeMatch?.[2] || 'text') : undefined;

      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      const controlIdMatch = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const controlId = controlIdMatch?.[1] || controlIdMatch?.[2] || controlIdMatch?.[3];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match.index - 500), match.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      const nameMatch = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || '';
      const label = placeholder || elementName || `<${tag}> control`;
      const fileName = filePath.split('/').pop() || filePath;

      if (controlId && hasExplicitLabel) {
        const idCount = idCounts.get(controlId) || 0;
        if (idCount > 1) {
          const dedupeKey = `A5.3|${filePath}|${controlId}|duplicate`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            findings.push({
              elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.3', subCheckLabel: 'Broken label association', classification: 'confirmed',
              detection: `Duplicate id="${controlId}"`, evidence: `<${tag} id="${controlId}"> at ${filePath}:${lineNumber}`,
              explanation: `Multiple elements share id="${controlId}", creating ambiguous label association.`,
              confidence: 0.92,
              correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nDuplicate id="${controlId}".\n\nRecommended fix:\nAssign unique ids and update <label for> attributes.`,
              deduplicationKey: dedupeKey,
            });
          }
          continue;
        }
      }

      if (hasValidLabel) continue;

      // title is NOT a valid label source — title-only inputs remain A5.1 Confirmed

      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label', classification: 'confirmed',
            detection: `<${tag}> placeholder-only label`, evidence: `<${tag} placeholder="${placeholder}"> at ${filePath}:${lineNumber}`,
            explanation: `Placeholder "${placeholder}" is the only label. Placeholders are not sufficient labels.`,
            confidence: 0.95,
            correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nPlaceholder-only label.\n\nRecommended fix:\nAdd a <label> or aria-label/aria-labelledby.`,
            deduplicationKey: dedupeKey,
          });
        }
        continue;
      }

      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({
          elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
          detection: `<${tag}> has no label`, evidence: `<${tag}> at ${filePath}:${lineNumber}`,
          explanation: `Form control has no accessible name.`,
          confidence: 0.97,
          correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nNo programmatic label.\n\nRecommended fix:\nAdd a <label> or aria-label/aria-labelledby.`,
          deduplicationKey: dedupeKey,
        });
      }
    }

    // ARIA input roles on non-form elements
    const ariaInputRegex = new RegExp(`<(div|span|p|section)\\b([^>]*role\\s*=\\s*["'](?:textbox|combobox|searchbox|spinbutton)["'][^>]*)>`, 'gi');
    while ((match = ariaInputRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;
      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || 'textbox';
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const label = `<${tag} role="${role}">`;
      const dedupeKey = `A5.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const fileName = filePath.split('/').pop() || filePath;
      findings.push({
        elementLabel: label, elementType: tag, role, sourceLabel: label, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} role="${role}"> has no aria-label or aria-labelledby`,
        evidence: `<${tag} role="${role}"> at ${filePath}:${lineNumber}`,
        explanation: `Custom input (role="${role}") has no accessible name.`,
        confidence: 0.95,
        correctivePrompt: `[${label}] — ${fileName}\n\nRecommended fix:\nAdd aria-label or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    // Contenteditable elements
    const contenteditableRegex = /<(\w+)\b([^>]*contenteditable\s*=\s*["']true["'][^>]*)>/gi;
    while ((match = contenteditableRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;
      const roleMatch2 = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch2?.[1] || 'textbox';
      const linesBefore2 = content.slice(0, match.index).split('\n');
      const lineNumber2 = linesBefore2.length;
      const label2 = `<${tag} contenteditable role="${role}">`;
      const dedupeKey = `A5.1|${filePath}|${tag}|contenteditable|${lineNumber2}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const fileName2 = filePath.split('/').pop() || filePath;
      findings.push({
        elementLabel: label2, elementType: tag, role, sourceLabel: label2, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} contenteditable="true"> has no label`,
        evidence: `<${tag} contenteditable="true"> at ${filePath}:${lineNumber2}`,
        explanation: `Contenteditable element has no accessible name.`,
        confidence: 0.95,
        correctivePrompt: `[${label2}] — ${fileName2}\n\nRecommended fix:\nAdd aria-label or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A5.3: Orphan labels (run once per file, after control loop)
    for (const forTarget of labelForTargets) {
      if (!controlIds.has(forTarget)) {
        const dedupeKey = `A5.3|${filePath}|${forTarget}|missing`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          const fileName3 = filePath.split('/').pop() || filePath;
          findings.push({
            elementLabel: `label[for="${forTarget}"]`, elementType: 'label', sourceLabel: `Orphan label for="${forTarget}"`, filePath, componentName,
            subCheck: 'A5.3', subCheckLabel: 'Broken label association', classification: 'confirmed',
            detection: `<label for="${forTarget}"> references non-existent id`,
            evidence: `label for="${forTarget}" in ${filePath} — no matching id`,
            explanation: `Label references non-existent id="${forTarget}".`,
            confidence: 0.90,
            correctivePrompt: `[label for="${forTarget}"] — ${fileName3}\n\nRecommended fix:\nEnsure the control has id="${forTarget}" or update the label's for attribute.`,
            deduplicationKey: dedupeKey,
          });
        }
      }
    }
  }

  // Post-process: suppress A5.1 for controls in the same file where an A5.3 orphan label exists
  const a53Files = new Set(findings.filter(f => f.subCheck === 'A5.3').map(f => f.filePath));
  const deduped = findings.filter(f => {
    if (f.subCheck === 'A5.1' && a53Files.has(f.filePath)) return false;
    return true;
  });

  // ========== Potential sub-checks (A5.P1–P4) ==========
  const confirmedKeys = new Set(deduped.map(f => `${f.filePath}|${f.elementType}|${f.elementLabel}`));
  const potentialFindings: A5Finding[] = [];
  const GENERIC_LABELS = new Set(['input', 'field', 'value', 'text', 'enter here', 'type here', 'select', 'option']);
  const labelsByFile = new Map<string, Map<string, { tag: string; label: string; line: number; filePath: string; componentName: string }[]>>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/') || filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const labelForTargets = new Set<string>();
    const labelForRegex2 = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let lfm;
    while ((lfm = labelForRegex2.exec(content)) !== null) {
      const t = lfm[1] || lfm[2] || lfm[3];
      if (t) labelForTargets.add(t);
    }

    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    if (!labelsByFile.has(filePath)) labelsByFile.set(filePath, new Map());
    const fileLabels = labelsByFile.get(filePath)!;

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlRegex2 = /<(input|textarea|select)\b([^>]*)(?:>|\/>)/gi;
    let match2;
    while ((match2 = controlRegex2.exec(content)) !== null) {
      const tag = match2[1].toLowerCase();
      const attrs = match2[2];

      if (tag === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match2.index).split('\n');
      const lineNumber = linesBefore.length;

      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '';
      const hasAriaLabel = ariaLabelVal.trim().length > 0;

      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';
      const hasAriaLabelledBy = ariaLabelledByVal.trim().length > 0;

      const controlIdMatch = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const controlId = controlIdMatch?.[1] || controlIdMatch?.[2];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match2.index - 500), match2.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleVal = titleMatch?.[1] || titleMatch?.[2] || '';
      const hasTitle = titleVal.trim().length > 0;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';

      const nameMatch = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || '';
      const label = ariaLabelVal || placeholder || elementName || `<${tag}> control`;

      const controlKey = `${filePath}|${tag}|${label}`;
      if (confirmedKeys.has(controlKey)) continue;

      const fileName = filePath.split('/').pop() || filePath;

      if (!hasValidLabel) continue;

      let accessibleName = '';
      if (hasAriaLabel) {
        accessibleName = ariaLabelVal;
      } else if (hasAriaLabelledBy) {
        const ids = ariaLabelledByVal.split(/\s+/);
        accessibleName = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
      } else if (isWrappedInLabel) {
        const labelStart = beforeControl.lastIndexOf('<label');
        const labelContent = beforeControl.slice(labelStart);
        const labelTextMatch = labelContent.match(/>([^<]*)</);
        accessibleName = labelTextMatch?.[1]?.trim() || '';
      } else if (hasExplicitLabel && controlId) {
        const labelTextRegex = new RegExp(`<label[^>]*(?:for|htmlFor)\\s*=\\s*["']${controlId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([^<]*)`, 'i');
        const ltm = content.match(labelTextRegex);
        accessibleName = ltm?.[1]?.trim() || '';
      }

      if (accessibleName) {
        const normalizedName = accessibleName.trim().toLowerCase();
        if (!fileLabels.has(normalizedName)) fileLabels.set(normalizedName, []);
        fileLabels.get(normalizedName)!.push({ tag, label: accessibleName, line: lineNumber, filePath, componentName });
      }

      if (accessibleName && GENERIC_LABELS.has(accessibleName.trim().toLowerCase())) {
        const dedupeKey = `A5.4|${filePath}|${tag}|${accessibleName}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          potentialFindings.push({
            elementLabel: accessibleName, elementType: tag, sourceLabel: accessibleName, filePath, componentName,
            subCheck: 'A5.4', subCheckLabel: 'Generic label text',
            classification: 'potential', potentialSubtype: 'borderline',
            detection: `<${tag}> label "${accessibleName}" is generic`,
            evidence: `label text "${accessibleName}" at ${filePath}:${lineNumber}`,
            explanation: `The label "${accessibleName}" is too generic to be meaningful.`,
            confidence: 0.88,
            advisoryGuidance: 'Use a descriptive label that explains the purpose of this control.',
            deduplicationKey: dedupeKey,
          });
        }
      }

      if (hasAriaLabelledBy && accessibleName) {
        const NOISY_TOKENS = /\b(optional|required|hint|note|help|info|used for)\b/i;
        if (accessibleName.length > 60 || NOISY_TOKENS.test(accessibleName)) {
          const dedupeKey = `A5.6|${filePath}|${tag}|${lineNumber}`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            potentialFindings.push({
              elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.6', subCheckLabel: 'Noisy aria-labelledby',
              classification: 'potential', potentialSubtype: 'borderline',
              detection: `<${tag}> aria-labelledby resolves to noisy/long text`,
              evidence: `Resolved text: "${accessibleName.slice(0, 80)}${accessibleName.length > 80 ? '…' : ''}" at ${filePath}:${lineNumber}`,
              explanation: `The aria-labelledby resolves to text that is too long (${accessibleName.length} chars) or contains advisory tokens.`,
              confidence: 0.82,
              advisoryGuidance: 'Simplify the referenced label text. Move hints to aria-describedby.',
              deduplicationKey: dedupeKey,
            });
          }
        }
      }
    }
  }

  for (const [, fileLabels] of labelsByFile) {
    for (const [normalizedName, controls] of fileLabels) {
      if (controls.length < 2) continue;
      const dedupeKey = `A5.5|${controls[0].filePath}|${normalizedName}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const controlList = controls.map(c => `<${c.tag}> at line ${c.line}`).join(', ');
      potentialFindings.push({
        elementLabel: controls[0].label, elementType: controls[0].tag, sourceLabel: controls[0].label,
        filePath: controls[0].filePath, componentName: controls[0].componentName,
        subCheck: 'A5.5', subCheckLabel: 'Duplicate label text',
        classification: 'potential', potentialSubtype: 'borderline',
        detection: `${controls.length} controls share label "${controls[0].label}"`,
        evidence: `Duplicate label "${controls[0].label}": ${controlList}`,
        explanation: `Multiple controls share the same accessible name "${controls[0].label}".`,
        confidence: 0.90,
        advisoryGuidance: 'Give each control a unique, descriptive label.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  return [...deduped, ...potentialFindings];
}

// ========== A6 DETERMINISTIC DETECTION (Missing Accessible Names) ==========
interface A6Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A6.1' | 'A6.2';
  subCheckLabel: string;
  classification: 'confirmed';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA6AccessibleNames(allFiles: Map<string, string>): A6Finding[] {
  const findings: A6Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    function checkElement(tag: string, attrs: string, matchIndex: number) {
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) return;
      if (/\bhidden\b/.test(attrs) && !/hidden\s*=\s*["']false["']/i.test(attrs)) return;
      if (/\bdisabled\b/.test(attrs)) return;
      if (/aria-disabled\s*=\s*["']true["']/i.test(attrs)) return;
      if (/role\s*=\s*["'](presentation|none)["']/i.test(attrs)) return;
      if (tag.toLowerCase() === 'a' && !/href\s*=/.test(attrs)) return;

      const linesBefore = content.slice(0, matchIndex).split('\n');
      const lineNumber = linesBefore.length;
      const fileName = filePath.split('/').pop() || filePath;

      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';

      if (ariaLabelledByVal.trim()) {
        const ids = ariaLabelledByVal.trim().split(/\s+/);
        const resolvedText = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
        const missingIds = ids.filter(id => !idTextMap.has(id));

        if (missingIds.length > 0 || resolvedText === '') {
          const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
          const role = roleMatch?.[1] || tag.toLowerCase();
          const label = `<${tag}> aria-labelledby="${ariaLabelledByVal}"`;
          const dedupeKey = `A6.2|${filePath}|${tag}|${ariaLabelledByVal}|${lineNumber}`;
          if (seenKeys.has(dedupeKey)) return;
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
            subCheck: 'A6.2', subCheckLabel: 'Broken aria-labelledby reference', classification: 'confirmed',
            detection: `aria-labelledby references ${missingIds.length > 0 ? 'missing ID(s): ' + missingIds.join(', ') : 'empty text'}`,
            evidence: `<${tag} aria-labelledby="${ariaLabelledByVal}"> at ${filePath}:${lineNumber}`,
            explanation: `aria-labelledby references ${missingIds.length > 0 ? 'non-existent ID(s)' : 'IDs resolving to empty text'}, so no accessible name is exposed.`,
            confidence: 0.97,
            correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\nBroken aria-labelledby.\n\nRecommended fix:\nEnsure referenced IDs exist with label text, or use aria-label.`,
            deduplicationKey: dedupeKey,
          });
          return;
        }
        return;
      }

      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = (ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '').trim();
      if (ariaLabelVal.length > 0) return;

      const afterTag = content.slice(matchIndex + tag.length + attrs.length + 2, Math.min(content.length, matchIndex + tag.length + attrs.length + 500));
      const closingTagRegex = new RegExp(`</${tag}\\s*>`, 'i');
      const closingMatch = afterTag.match(closingTagRegex);
      const innerContent = closingMatch ? afterTag.slice(0, closingMatch.index) : afterTag.slice(0, 200);

      const visibleText = innerContent.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (visibleText.length > 0) return;

      const imgAltMatch = innerContent.match(/<img\b[^>]*alt\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i);
      if ((imgAltMatch?.[1] || imgAltMatch?.[2] || '').trim().length > 0) return;

      const srOnlyMatch = innerContent.match(/<span\b[^>]*class(?:Name)?\s*=\s*(?:"[^"]*(?:sr-only|visually-hidden)[^"]*"|'[^']*(?:sr-only|visually-hidden)[^']*')[^>]*>([^<]*)</i);
      if ((srOnlyMatch?.[1] || '').trim().length > 0) return;

      if (tag.toLowerCase() === 'input') {
        const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]+)"|'([^']+)')/);
        if ((altMatch?.[1] || altMatch?.[2] || '').trim().length > 0) return;
      }

      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || tag.toLowerCase();
      const label = `<${tag.toLowerCase()}${role !== tag.toLowerCase() ? ` role="${role}"` : ''}>`;
      const dedupeKey = `A6.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
        subCheck: 'A6.1', subCheckLabel: 'Missing accessible name', classification: 'confirmed',
        detection: `<${tag.toLowerCase()}> has no accessible name`,
        evidence: `<${tag.toLowerCase()}> at ${filePath}:${lineNumber}`,
        explanation: `Interactive <${tag.toLowerCase()}>${role !== tag.toLowerCase() ? ' (role="' + role + '")' : ''} has no programmatic accessible name.`,
        confidence: 0.97,
        correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\nNo accessible name.\n\nRecommended fix:\nAdd visible text, aria-label, or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    let match;
    const buttonAnchorRegex = /<(button|a)\b([^>]*)>/gi;
    while ((match = buttonAnchorRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }

    const inputInteractiveRegex = /<input\b([^>]*type\s*=\s*["'](button|submit|reset|image)["'][^>]*)>/gi;
    while ((match = inputInteractiveRegex.exec(content)) !== null) {
      const inputType = match[2].toLowerCase();
      if (inputType === 'submit' || inputType === 'reset') continue;
      checkElement('input', match[1], match.index);
    }

    const ariaInteractiveRegex = new RegExp(`<(div|span|li|a|section|article|header|footer|nav|td|th|p)\\b([^>]*role\\s*=\\s*["'](?:button|link|tab|menuitem|switch|checkbox|radio|combobox|option)["'][^>]*)>`, 'gi');
    while ((match = ariaInteractiveRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }
  }

  return findings;
}

function detectStack(files: Map<string, string>): string {
  const fileNames = Array.from(files.keys());
  
  if (fileNames.some(f => f.includes('next.config'))) return 'Next.js';
  if (fileNames.some(f => f.includes('vite.config'))) return 'Vite';
  if (fileNames.some(f => f.includes('angular.json'))) return 'Angular';
  if (fileNames.some(f => f.endsWith('.vue'))) return 'Vue';
  if (fileNames.some(f => f.endsWith('.svelte'))) return 'Svelte';
  if (fileNames.some(f => f.endsWith('.tsx') || f.endsWith('.jsx'))) return 'React';
  if (fileNames.some(f => f.endsWith('.html'))) return 'HTML';
  return 'Unknown';
}

// ============================================================
// TWO-LAYER HYBRID ARCHITECTURE — Rule Routing (GitHub)
// ============================================================
const DETERMINISTIC_CODE_RULES = new Set(['A1', 'A3', 'A4', 'A5', 'A6']);
const HYBRID_RULES_SET_GH = new Set(['U1', 'U2', 'U3', 'U5', 'E1', 'E3']);

function buildCodeAnalysisPrompt(selectedRules: string[]) {
  const selectedRulesSet = new Set(selectedRules);
  // DETERMINISTIC rules (A1, A3-A6) are NEVER sent to LLM
  const accessibilityRulesForLLM = rules.accessibility.filter(r => 
    !DETERMINISTIC_CODE_RULES.has(r.id) && selectedRulesSet.has(r.id)
  );
  
  return `You are an expert UI/UX code auditor performing static analysis of source code from a GitHub repository.
This analysis uses a Two-Layer Hybrid Architecture:
- Accessibility rules A1, A3, A4, A5, A6 are evaluated by the DETERMINISTIC engine (regex/static analysis). Do NOT report findings for these rules.
- A2 (focus visibility) is evaluated by YOU (LLM-assisted) with deterministic post-processing.
- Usability and Ethics rules are evaluated by YOU.

## IMPORTANT: STATIC ANALYSIS CONTEXT
This code is being analyzed from a GitHub repository. You do NOT have access to:
- Runtime rendering
- Computed styles
- DOM measurements
- User interactions

All findings must be classified as:
- "Confirmed (static)" - When the issue is clearly evident from code patterns
- "Heuristic (requires runtime verification)" - When the issue might exist but needs runtime confirmation

## PASS 1 — Accessibility (WCAG AA) - LLM-Assisted Rules Only
NOTE: A1 (contrast), A3 (keyboard), A4 (semantics), A5 (form labels), A6 (accessible names) are handled by the deterministic engine. Do NOT report these rules.

Accessibility rules to check (LLM-assisted only):
${accessibilityRulesForLLM.map(r => `- ${r.id}: ${r.name} - ${r.diagnosis}`).join('\n')}

### A2 (Poor focus visibility) — CLASSIFICATION RULES:

**PREREQUISITE — FOCUS SUPPRESSION CHECK:**
ONLY evaluate an element for A2 if it explicitly suppresses the default focus indicator:
- \`outline-none\`, \`focus:outline-none\`, \`focus-visible:outline-none\`
- OR \`ring-0\`, \`focus:ring-0\`, \`focus-visible:ring-0\`
- OR \`:focus { outline: none }\`
If no suppression → SKIP.

**FOCUSABILITY:** Only native focusable elements (\`<button>\`, \`<a href>\`, \`<input>\`, \`<select>\`, \`<textarea>\`) or elements with explicit tabIndex/ARIA role.

**IGNORE:** All hover styles — hover is NOT focus.

**CLASSIFICATION:**
1. **CONFIRMED:** Focus suppression detected AND NO valid replacement. Valid replacements: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:border-*\`, \`focus-visible:border-*\`, \`focus:shadow-*\`, \`focus-visible:shadow-*\`, \`focus:bg-*\`, \`focus-visible:bg-*\`. If ANY exists → NOT confirmed. Confidence: 90-95%.
2. **POTENTIAL:** Suppression + replacement exists but perceptibility cannot be statically verified (ring-1 muted, bg-only, shadow-sm). Or interactive elements with no explicit focus styles. Do NOT assume subtle styling equals invisible. Confidence: 60-75%.
3. **PASS (SKIP):** No suppression, or strong replacement (ring-2+, border, outline, shadow-md+).

**ELEMENT IDENTITY (MANDATORY for every A2 finding):**
Each finding MUST include:
- "role": HTML tag name or ARIA role (e.g., "button", "link", "input", "menuitem")
- "accessibleName": from aria-label, aria-labelledby, or visible text content. Use "" if none.
- "sourceLabel": best human-readable label (e.g., "3-dot menu", "Submit", "Close dialog")
- "selectorHint": data-testid (preferred), then id, then class fragment, then JSX snippet (e.g., \`<Button aria-label="More options">\`)
- "filePath": full file path
- "componentName": PascalCase component name

**OUTPUT FORMAT FOR A2:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "focus:outline-none without replacement in Header.tsx",
  "diagnosis": "Button removes focus outline without visible replacement.",
  "contextualHint": "Add focus ring or border for keyboard accessibility.",
  "confidence": 0.60,
  "role": "button",
  "accessibleName": "More options",
  "sourceLabel": "More options (kebab menu)",
  "selectorHint": "<Button aria-label=\\"More options\\">",
  "filePath": "src/components/Header.tsx",
  "componentName": "Header"
}
\`\`\`

## PASS 2 — Usability

### U2 (Incomplete / Unclear Navigation) — CONTEXTUAL ASSESSMENT:
**NOTE:** U2 deterministic sub-checks (U2.D1, U2.D2, U2.D3) run separately via static analysis.
Your role is to provide contextual enrichment for navigation assessment.

**EVALUATE:**
- Wayfinding clarity: Can a user understand where they are and how to move between sections?
- Navigation density, ambiguity, redundant links, inconsistent routing patterns, missing hierarchy cues

**CLASSIFICATION:**
- U2 findings are ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Use evaluationMethod: "hybrid_llm_fallback"
- Confidence: 0.60–0.75

${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U1').map(r => `- ${r.id}: ${r.name}`).join('\n')}

### U4 (Recognition-to-Recall Regression) — LLM-ASSISTED EVALUATION:
**NOTE:** U4 uses pre-extracted evidence bundles appended as \`[U4_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/evidence to decide if the UI forces recall rather than recognition.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, variable names, or any "test" wording (e.g., "U4 Recall Test", "RecallPage") as evidence or reasoning.
- Do NOT infer developer intent from naming conventions — a file named "RecallTest.tsx" does NOT mean the UI forces recall.
- The evidence bundle header lines showing file paths are for LOCATION REFERENCE ONLY — they are NOT UI content and MUST NOT be cited as evidence of recall issues.
- Base conclusions ONLY on user-visible UI content extracted in the bundle:
  - CTA labels, headings, form field labels/placeholders, step indicators
  - Presence/absence of summary/review content (use the boolean flags as hints, not proof)
  - Whether CTAs explain what happens next
- If the extracted evidence is insufficient to demonstrate a concrete recall burden, return NO U4 finding — do not guess.

**EVALUATE (using ONLY the evidence bundle content, not file/component names):**
- Missing summaries: Forms or multi-step flows that don't show what the user previously selected
- Missing examples: Input fields without helper text, examples, or format hints
- Generic CTAs without context: Buttons labeled "Continue", "Next", "Submit" without indicating what happens next
- Multi-step flows lacking review: Step indicators without a final review/summary step

**CLASSIFICATION:**
- U4 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence represents strength of observable cues, NOT model probability
- Confidence cap: 0.80 maximum
- Confidence range: 0.60–0.80

**OUTPUT FOR U4 — STRUCTURED u4Elements:**
\`\`\`json
{
  "ruleId": "U4",
  "ruleName": "Recognition-to-recall regression",
  "category": "usability",
  "status": "potential",
  "isU4Aggregated": true,
  "u4Elements": [
    {
      "elementLabel": "Checkout confirmation step",
      "elementType": "form",
      "location": "src/components/Checkout.tsx",
      "detection": "Multi-step checkout with generic 'Confirm' CTA and no order summary visible",
      "evidence": "CTAs: 'Confirm', 'Back' | Headings: 'Step 3 of 3 — Confirm Order' | No summary of selected items shown",
      "recommendedFix": "Add an order summary showing previously selected items before the final confirmation",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of recognition-to-recall issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U4 issues found, do NOT include U4 in the violations array.

### U6 (Weak Grouping / Layout Coherence) — LLM-ASSISTED EVALUATION:
**NOTE:** U6 uses pre-extracted layout evidence bundles appended as \`[U6_LAYOUT_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted layout cues to assess grouping/hierarchy.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or "test" wording as evidence.
- Do NOT infer developer intent from naming conventions.
- Base conclusions ONLY on the extracted layout evidence.
- If evidence is insufficient, return NO U6 finding — do not guess.

**EVALUATE:**
- Missing section separation, inconsistent spacing hierarchy, unclear grouping, misalignment, clutter.

**CLASSIFICATION:**
- U6 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80

**OUTPUT FOR U6 — STRUCTURED u6Elements:**
\`\`\`json
{
  "ruleId": "U6",
  "ruleName": "Weak grouping / layout coherence",
  "category": "usability",
  "status": "potential",
  "isU6Aggregated": true,
  "u6Elements": [
    {
      "elementLabel": "Main form section",
      "elementType": "section",
      "location": "src/components/Form.tsx",
      "detection": "Long sequence of inputs without heading or visual grouping",
      "evidence": "12 sibling inputs without section headings or fieldset wrappers",
      "recommendedFix": "Group related fields into fieldsets with legends or add section headings",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U6 issues found, do NOT include U6 in the violations array.

### E1 (Insufficient Transparency in High-Impact Actions) — LLM-ASSISTED EVALUATION:
**NOTE:** E1 uses pre-extracted high-impact action evidence bundles appended as \`[E1_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/context to assess transparency.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("may be unclear", "transparency risk").
- Base conclusions ONLY on the extracted CTA labels, nearby UI text, and confirmation dialog presence/absence.
- If evidence is insufficient, return NO E1 finding — do not guess.

**EVALUATE:**
- Missing consequence disclosure for destructive actions
- Missing cost disclosure for financial actions
- Missing confirmation step for high-impact actions

**CLASSIFICATION:**
- E1 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80

**OUTPUT FOR E1 — STRUCTURED e1Elements:**
\`\`\`json
{
  "ruleId": "E1",
  "ruleName": "Insufficient transparency in high-impact actions",
  "category": "ethics",
  "status": "potential",
  "isE1Aggregated": true,
  "e1Elements": [
    {
      "elementLabel": "\\"Delete Account\\" action",
      "elementType": "button",
      "location": "src/components/Settings.tsx",
      "detection": "Destructive action without consequence disclosure or confirmation step",
      "evidence": "CTA: 'Delete Account' | No warning text | No confirmation dialog",
      "recommendedFix": "Add a confirmation dialog with irreversibility warning",
      "confidence": 0.75
    }
  ],
  "diagnosis": "Summary...",
  "contextualHint": "Short guidance...",
  "confidence": 0.75
}
\`\`\`
- If NO E1 issues found, do NOT include E1 in the violations array.

### E2 (Imbalanced or Manipulative Choice Architecture) — LLM-ASSISTED EVALUATION:
**NOTE:** E2 uses pre-extracted choice bundle data appended as \`[E2_CHOICE_BUNDLE]\`. Use ONLY the provided extracted CTA labels, style tokens, and nearby microcopy to assess choice balance.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral phrasing ("imbalance risk", "may nudge").
- Do NOT flag normal primary/secondary button patterns unless the alternative is materially de-emphasized or obscured.
- If evidence is insufficient, return NO E2 finding — do not guess.

**EVALUATE:**
- Visual dominance: one option has significantly larger size, bolder color, or higher contrast
- Obscured decline: opt-out/cancel/decline uses muted color, smaller text, or link-style vs button
- Asymmetric wording: action-oriented accept vs passive/negative decline
- Pre-selection bias: default state nudges toward one option

**CLASSIFICATION:**
- E2 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80

**OUTPUT FOR E2 — STRUCTURED e2Elements:**
\`\`\`json
{
  "ruleId": "E2",
  "ruleName": "Imbalanced or manipulative choice architecture",
  "category": "ethics",
  "status": "potential",
  "isE2Aggregated": true,
  "e2Elements": [
    {
      "elementLabel": "Upgrade dialog choices",
      "elementType": "button-group",
      "location": "src/components/UpgradeModal.tsx",
      "detection": "Primary option visually dominates decline alternative",
      "evidence": "Accept: 'Upgrade Now' (bg-blue-600, text-white, px-8) | Decline: 'Maybe later' (text-gray-400, text-sm)",
      "recommendedFix": "Balance button prominence: make decline a visible secondary button",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO E2 issues found, do NOT include E2 in the violations array.

### E3 (Obscured or Restricted User Control) — HYBRID EVALUATION:
**NOTE:** E3 uses pre-extracted control restriction evidence bundles appended as \`[E3_CONTROL_RESTRICTION_EVIDENCE]\`. Use ONLY the provided structural evidence to validate whether user control is meaningfully restricted.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("control restriction risk", "dismissal may be missing").
- If evidence is insufficient, return NO E3 finding — do not guess.

**EVALUATE:**
- Missing dismissal: modals/dialogs without close/cancel
- Missing cancel path: forms with only submit action
- Forced opt-in: required marketing/consent checkboxes
- Missing back navigation: multi-step flows without back button

**CLASSIFICATION:**
- E3 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.85

**OUTPUT FOR E3 — STRUCTURED e3Elements:**
\`\`\`json
{
  "ruleId": "E3", "ruleName": "Obscured or restricted user control", "category": "ethics",
  "status": "potential", "isE3Aggregated": true,
  "e3Elements": [{ "elementLabel": "Dialog component", "elementType": "dialog", "location": "...", "subCheck": "E3.D1", "detection": "...", "evidence": "...", "recommendedFix": "...", "confidence": 0.75 }]
}
\`\`\`
- If NO E3 issues found, do NOT include E3 in the violations array.

## PASS 3 — Ethics
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## Response Format
Return ONLY valid JSON:
{
  "violations": [
    {
      "ruleId": "A2",
      "ruleName": "Poor focus visibility",
      "category": "accessibility",
      "typeBadge": "CONFIRMED" or "HEURISTIC",
      "diagnosis": "...",
      "evidence": "...",
      "contextualHint": "...",
      "confidence": 0.0-1.0,
      "role": "button",
      "accessibleName": "Submit",
      "sourceLabel": "Submit button",
      "selectorHint": "<Button type=\\"submit\\">",
      "filePath": "src/components/Form.tsx",
      "componentName": "Form"
    }
  ],
  "passNotes": {
    "accessibility": "Summary of accessibility findings...",
    "usability": "Summary of usability findings...",
    "ethics": "Summary of ethics findings..."
  }
}`;
}

// ========== U4 EVIDENCE BUNDLE EXTRACTION (Recognition-to-Recall) ==========
interface U4EvidenceBundle {
  componentName: string;
  filePath: string;
  ctaLabels: string[];
  headings: string[];
  formFields: { label: string; placeholder?: string; helperText?: string }[];
  stepIndicators: string[];
  hasSummaryWords: boolean;
  hasHelperExamples: boolean;
  hasGenericCTA: boolean;
}

function extractU4EvidenceBundle(allFiles: Map<string, string>): U4EvidenceBundle[] {
  const bundles: U4EvidenceBundle[] = [];
  const GENERIC_CTA_RE = /\b(Continue|Next|Submit|Save|Confirm|OK|Done|Proceed|Go)\b/i;
  const STEP_RE = /\b(Step\s+\d+|step\s*[-–—]\s*\d+|Next|Back|Previous)\b/gi;
  const SUMMARY_WORDS = /\b(summary|review|confirm|overview|receipt|total|selected)\b/i;
  const HELPER_EXAMPLE_RE = /\b(e\.g\.|example|format|hint|such as|like\s+\"|must be|at least|pattern)\b/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];

    const ctaLabels: string[] = [];
    const btnRe = /<(?:Button|button)\b[^>]*>([^<]{1,60})<\/(?:Button|button)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[1].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (label.length >= 2 && label.length <= 50) ctaLabels.push(label);
    }

    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(text);
    }

    const formFields: U4EvidenceBundle['formFields'] = [];
    const inputRe = /<(?:Input|input|textarea|Textarea|select|Select)\b([^>]*)(?:\/>|>[^<]*<\/)/gi;
    let im;
    while ((im = inputRe.exec(content)) !== null) {
      const attrs = im[1] || '';
      const labelMatch = attrs.match(/(?:label|aria-label)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/i);
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/i);
      const label = labelMatch?.[1] || labelMatch?.[2] || labelMatch?.[3] || '';
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || placeholderMatch?.[3] || '';
      if (label || placeholder) {
        const afterInput = content.slice(im.index, Math.min(content.length, im.index + 300));
        const helperMatch = afterInput.match(/<(?:p|span|div)\b[^>]*(?:helper|hint|description|muted|text-sm|text-xs)[^>]*>([^<]{3,80})/i);
        formFields.push({ label: label || placeholder, placeholder: placeholder || undefined, helperText: helperMatch?.[1]?.trim() || undefined });
      }
    }

    const stepIndicators: string[] = [];
    let sm;
    while ((sm = STEP_RE.exec(content)) !== null) { stepIndicators.push(sm[1]); }

    if (ctaLabels.length === 0 && formFields.length === 0 && stepIndicators.length === 0 && headings.length === 0) continue;

    bundles.push({
      componentName, filePath,
      ctaLabels: [...new Set(ctaLabels)].slice(0, 8),
      headings: [...new Set(headings)].slice(0, 6),
      formFields: formFields.slice(0, 8),
      stepIndicators: [...new Set(stepIndicators)].slice(0, 6),
      hasSummaryWords: SUMMARY_WORDS.test(content),
      hasHelperExamples: HELPER_EXAMPLE_RE.test(content),
      hasGenericCTA: ctaLabels.some(l => GENERIC_CTA_RE.test(l)),
    });
  }
  return bundles.slice(0, 15);
}

function formatU4EvidenceBundleForPrompt(bundles: U4EvidenceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[U4_EVIDENCE_BUNDLE]',
    'IMPORTANT: The location references below are for traceability ONLY. Do NOT use file names, component names, or page titles as evidence of recall issues. Evaluate ONLY the extracted UI text (CTAs, headings, form fields, step indicators).',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    if (b.ctaLabels.length > 0) lines.push(`  CTAs: ${b.ctaLabels.join(', ')}`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    if (b.formFields.length > 0) { for (const f of b.formFields) { let row = `  Field: ${f.label}`; if (f.placeholder) row += ` (placeholder: "${f.placeholder}")`; if (f.helperText) row += ` — helper: "${f.helperText}"`; lines.push(row); } }
    if (b.stepIndicators.length > 0) lines.push(`  Steps: ${b.stepIndicators.join(', ')}`);
    lines.push(`  Flags: summary=${b.hasSummaryWords}, helpers=${b.hasHelperExamples}, genericCTA=${b.hasGenericCTA}`);
  }
  lines.push('[/U4_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== E1 EVIDENCE BUNDLE EXTRACTION (Insufficient Transparency) ==========
interface E1EvidenceBundle {
  filePath: string;
  ctaLabel: string;
  ctaType: string;
  nearbyText: string[];
  hasConfirmationDialog: boolean;
  hasWarningText: boolean;
  hasPricingText: boolean;
}

const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove|close\s*account|reset|destroy|erase|unsubscribe|terminate|revoke|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay|upgrade|checkout|confirm\s*(?:order|purchase|payment)|accept|agree)\b/i;
const E1_WARNING_WORDS = /\b(permanent|cannot\s*be\s*undone|irreversible|this\s*action|will\s*be\s*(?:deleted|removed|lost)|are\s*you\s*sure|caution|warning)\b/i;
const E1_PRICING_WORDS = /\b(\$\d|\€\d|\£\d|USD|EUR|per\s*month|\/mo|\/year|billing|subscription\s*(?:fee|cost|price)|free\s*trial|charged)\b/i;
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|confirmation|modal|Dialog)\b/i;

function extractE1EvidenceBundle(allFiles: Map<string, string>): E1EvidenceBundle[] {
  const bundles: E1EvidenceBundle[] = [];
  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const attrs = bm[1] || '';
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_HIGH_IMPACT_KEYWORDS.test(attrs)) continue;

      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';
      if (/\b(accept|agree|share|consent)\b/i.test(label)) ctaType = 'data-sharing';

      const regionStart = Math.max(0, bm.index - 300);
      const regionEnd = Math.min(content.length, bm.index + bm[0].length + 300);
      const region = content.slice(regionStart, regionEnd);

      const nearbyText: string[] = [];
      const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
      let hm;
      while ((hm = hRe.exec(region)) !== null) nearbyText.push(`h${hm[1]}: ${hm[2].replace(/\{[^}]*\}/g, '').trim()}`);
      const pRe = /<(?:p|span|div)\b[^>]*>([^<]{3,120})<\/(?:p|span|div)>/gi;
      let pm;
      while ((pm = pRe.exec(region)) !== null) {
        const text = pm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3 && text.length <= 120) nearbyText.push(text);
      }

      bundles.push({
        filePath, ctaLabel: label, ctaType,
        nearbyText: [...new Set(nearbyText)].slice(0, 6),
        hasConfirmationDialog: E1_CONFIRMATION_PATTERNS.test(content),
        hasWarningText: E1_WARNING_WORDS.test(region),
        hasPricingText: E1_PRICING_WORDS.test(region),
      });
    }
  }
  return bundles.slice(0, 20);
}

function formatE1EvidenceBundleForPrompt(bundles: E1EvidenceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = ['[E1_EVIDENCE_BUNDLE]', 'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Evaluate ONLY the extracted CTA labels and nearby UI text.'];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  CTA: "${b.ctaLabel}" (type: ${b.ctaType})`);
    if (b.nearbyText.length > 0) lines.push(`  Nearby text: ${b.nearbyText.join(' | ')}`);
    lines.push(`  Flags: confirmation=${b.hasConfirmationDialog}, warning=${b.hasWarningText}, pricing=${b.hasPricingText}`);
  }
  lines.push('[/E1_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== E2 CHOICE BUNDLE EXTRACTION (Imbalanced Choice Architecture) ==========
interface E2ChoiceBundle {
  filePath: string;
  ctaLabels: { label: string; styleTokens: string; position: number }[];
  nearbyMicrocopy: string[];
}

function extractE2ChoiceBundle(allFiles: Map<string, string>): E2ChoiceBundle[] {
  const bundles: E2ChoiceBundle[] = [];
  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    const ctaMatches: { label: string; attrs: string; index: number }[] = [];
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      ctaMatches.push({ label, attrs: bm[1] || '', index: bm.index });
    }

    const groups: typeof ctaMatches[] = [];
    let currentGroup: typeof ctaMatches = [];
    for (const cta of ctaMatches) {
      if (currentGroup.length === 0 || cta.index - currentGroup[currentGroup.length - 1].index < 500) {
        currentGroup.push(cta);
      } else {
        if (currentGroup.length >= 2) groups.push([...currentGroup]);
        currentGroup = [cta];
      }
    }
    if (currentGroup.length >= 2) groups.push(currentGroup);

    for (const group of groups) {
      const ctaLabels = group.map((cta, idx) => {
        const classMatch = cta.attrs.match(/className\s*=\s*(?:{`([^`]*)`}|"([^"]*)"|'([^']*)')/);
        const variantMatch = cta.attrs.match(/variant\s*=\s*(?:"([^"]*)"|'([^']*)')/);
        const sizeMatch = cta.attrs.match(/size\s*=\s*(?:"([^"]*)"|'([^']*)')/);
        const tokens: string[] = [];
        if (classMatch) tokens.push(classMatch[1] || classMatch[2] || classMatch[3] || '');
        if (variantMatch) tokens.push(`variant=${variantMatch[1] || variantMatch[2]}`);
        if (sizeMatch) tokens.push(`size=${sizeMatch[1] || sizeMatch[2]}`);
        return { label: cta.label, styleTokens: tokens.join(' ').trim(), position: idx };
      });

      const regionStart = Math.max(0, group[0].index - 200);
      const regionEnd = Math.min(content.length, group[group.length - 1].index + 300);
      const region = content.slice(regionStart, regionEnd);
      const nearbyMicrocopy: string[] = [];
      const textRe = /<(?:p|span|h[1-6]|div)\b[^>]*>([^<]{3,100})<\/(?:p|span|h[1-6]|div)>/gi;
      let tm;
      while ((tm = textRe.exec(region)) !== null) {
        const text = tm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3) nearbyMicrocopy.push(text);
      }

      bundles.push({ filePath, ctaLabels, nearbyMicrocopy: [...new Set(nearbyMicrocopy)].slice(0, 5) });
    }
  }
  return bundles.slice(0, 20);
}

function formatE2ChoiceBundleForPrompt(bundles: E2ChoiceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = ['[E2_CHOICE_BUNDLE]', 'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence.'];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    for (const cta of b.ctaLabels) {
      lines.push(`  CTA #${cta.position + 1}: "${cta.label}" | styles: ${cta.styleTokens || '(none detected)'}`);
    }
    if (b.nearbyMicrocopy.length > 0) lines.push(`  Nearby text: ${b.nearbyMicrocopy.join(' | ')}`);
  }
  lines.push('[/E2_CHOICE_BUNDLE]');
  return lines.join('\n');
}

// ========== E3 DETERMINISTIC DETECTION (Obscured or Restricted User Control) ==========
interface E3Finding {
  filePath: string;
  line: number;
  subCheck: 'E3.D1' | 'E3.D2' | 'E3.D3' | 'E3.D4';
  elementLabel: string;
  elementType: string;
  detection: string;
  evidence: string;
  recommendedFix: string;
  confidence: number;
  deduplicationKey: string;
}

const E3_CLOSE_PATTERNS = /\b(onClose|onDismiss|handleClose|handleDismiss|closeModal|dismissModal|setOpen\(false\)|setIsOpen\(false\)|setShow\(false\)|onOpenChange)\b/i;
const E3_CLOSE_BUTTON_RE = /<(?:Button|button)\b[^>]*>([^<]*(?:close|cancel|dismiss|×|✕|X)[^<]*)<\/(?:Button|button)>/gi;
const E3_ESCAPE_RE = /\b(Escape|escape|onEscapeKeyDown|closeOnEsc|closeOnOverlayClick|closeOnBackdropClick)\b/i;
const E3_CANCEL_LABELS = /\b(cancel|back|close|go\s*back|return|previous|exit|skip|dismiss|decline|no\s*thanks)\b/i;
const E3_MARKETING_LABELS = /\b(marketing|newsletter|promotions?|offers?|updates?|emails?|subscribe|notifications?|tracking|analytics|consent|opt.?in|communications?)\b/i;
const E3_STEP_INDICATORS = /\b(step\s*\d|step\s*\w+\s*of\s*\d|\d\s*of\s*\d|\d\s*\/\s*\d|progress|stepper|wizard|multi.?step|onboarding)\b/i;
const E3_BACK_BUTTON = /<(?:Button|button|a)\b[^>]*>([^<]*(?:back|previous|go\s*back|return|←|⬅|ArrowLeft)[^<]*)<\/(?:Button|button|a)>/gi;

function detectE3ControlRestrictions(allFiles: Map<string, string>): E3Finding[] {
  const findings: E3Finding[] = [];
  const seen = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // E3.D1 — Modal/Dialog Without Dismissal
    const dialogRe = /<(?:Dialog|dialog|Modal|AlertDialog|Drawer|Sheet)\b([^>]*)>/gi;
    let dm;
    while ((dm = dialogRe.exec(content)) !== null) {
      const lineNum = content.substring(0, dm.index).split('\n').length;
      const regionEnd = Math.min(content.length, dm.index + 800);
      const region = content.slice(dm.index, regionEnd);
      const hasCloseHandler = E3_CLOSE_PATTERNS.test(region);
      E3_CLOSE_BUTTON_RE.lastIndex = 0;
      const hasCloseButton = E3_CLOSE_BUTTON_RE.test(region);
      E3_CLOSE_BUTTON_RE.lastIndex = 0;
      const hasEscapeHandler = E3_ESCAPE_RE.test(region);
      const hasDialogClose = /DialogClose|SheetClose|DrawerClose/i.test(region);
      if (!hasCloseHandler && !hasCloseButton && !hasEscapeHandler && !hasDialogClose) {
        const key = `${filePath}|E3|E3.D1|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          const tagName = dm[0].match(/<(\w+)/)?.[1] || 'Dialog';
          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D1', elementLabel: `${tagName} component`, elementType: 'dialog',
            detection: `Modal/dialog without visible dismissal mechanism`,
            evidence: `<${tagName}> found without close button, onClose handler, escape key handler, or DialogClose component`,
            recommendedFix: 'Add a close/cancel button and ensure the dialog can be dismissed via escape key or backdrop click',
            confidence: 0.75, deduplicationKey: key,
          });
        }
      }
    }

    // E3.D2 — Form Without Cancel / Back Option
    const formRe = /<form\b([^>]*)>/gi;
    let fm;
    while ((fm = formRe.exec(content)) !== null) {
      const lineNum = content.substring(0, fm.index).split('\n').length;
      const regionEnd = Math.min(content.length, fm.index + 1200);
      const region = content.slice(fm.index, regionEnd);
      const inputCount = (region.match(/<(?:Input|input)\b/gi) || []).length;
      const hasSubmit = /<(?:Button|button)\b[^>]*(?:type\s*=\s*["']submit["'])[^>]*>|<(?:Button|button)\b[^>]*>([^<]*(?:submit|continue|confirm|save|send|next|create|sign\s*up|register|log\s*in|sign\s*in)[^<]*)<\/(?:Button|button)>/gi.test(region);
      const hasCancelButton = E3_CANCEL_LABELS.test(
        (region.match(/<(?:Button|button|a)\b[^>]*>([^<]{1,40})<\/(?:Button|button|a)>/gi) || []).map(m => m.replace(/<[^>]*>/g, '')).join(' ')
      );
      const isSimpleLogin = inputCount <= 2 && /\b(log\s*in|sign\s*in|login|password)\b/i.test(region);
      if (hasSubmit && !hasCancelButton && !isSimpleLogin && inputCount >= 1) {
        const key = `${filePath}|E3|E3.D2|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D2', elementLabel: 'Form without cancel/back', elementType: 'form',
            detection: `Form has submit action but no cancel, back, or close option`,
            evidence: `<form> with ${inputCount} input(s) and submit button but no cancel/back/close CTA`,
            recommendedFix: 'Add a cancel or back button to allow users to exit the form without submitting',
            confidence: 0.65, deduplicationKey: key,
          });
        }
      }
    }

    // E3.D3 — Forced Required Opt-In
    const checkboxRe = /<(?:Input|input|Checkbox)\b([^>]*(?:type\s*=\s*["']checkbox["']|checkbox)[^>]*)(?:\/>|>)/gi;
    let cm;
    while ((cm = checkboxRe.exec(content)) !== null) {
      const attrs = cm[1] || '';
      if (!/\brequired\b/i.test(attrs)) continue;
      const lineNum = content.substring(0, cm.index).split('\n').length;
      const regionStart = Math.max(0, cm.index - 200);
      const regionEnd = Math.min(content.length, cm.index + 300);
      const region = content.slice(regionStart, regionEnd);
      if (E3_MARKETING_LABELS.test(region)) {
        const key = `${filePath}|E3|E3.D3|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          const labelMatch = region.match(/<(?:Label|label)\b[^>]*>([^<]{3,80})<\/(?:Label|label)>/i);
          const labelText = labelMatch ? labelMatch[1].replace(/\{[^}]*\}/g, '').trim() : 'marketing/consent checkbox';
          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D3', elementLabel: `Required opt-in: "${labelText}"`, elementType: 'checkbox',
            detection: `Required checkbox for marketing/consent with no opt-out alternative`,
            evidence: `<input type="checkbox" required> with label "${labelText}" and no visible opt-out path`,
            recommendedFix: 'Make the opt-in optional or provide a visible alternative that does not require consent to proceed',
            confidence: 0.75, deduplicationKey: key,
          });
        }
      }
    }

    // E3.D4 — Multi-Step Flow Without Back
    if (E3_STEP_INDICATORS.test(content)) {
      const stepRe = new RegExp(E3_STEP_INDICATORS.source, 'gi');
      let sm;
      while ((sm = stepRe.exec(content)) !== null) {
        const lineNum = content.substring(0, sm.index).split('\n').length;
        E3_BACK_BUTTON.lastIndex = 0;
        const hasBackButton = E3_BACK_BUTTON.test(content);
        E3_BACK_BUTTON.lastIndex = 0;
        const hasPrevStep = /\b(prevStep|previousStep|goBack|handleBack|onBack|stepBack|setStep\s*\(\s*(?:step|currentStep)\s*-\s*1\))\b/i.test(content);
        if (!hasBackButton && !hasPrevStep) {
          const key = `${filePath}|E3|E3.D4|${lineNum}`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({
              filePath, line: lineNum, subCheck: 'E3.D4', elementLabel: 'Multi-step flow without back navigation', elementType: 'stepper',
              detection: `Step indicator detected but no back/previous button or navigation control`,
              evidence: `Step indicator ("${sm[0]}") found without back button or previous-step handler`,
              recommendedFix: 'Add a back/previous button to allow users to navigate to earlier steps',
              confidence: 0.70, deduplicationKey: key,
            });
          }
          break;
        }
      }
    }
  }

  return findings.slice(0, 30);
}

function formatE3FindingsForPrompt(findings: E3Finding[]): string {
  if (findings.length === 0) return '';
  const lines = [
    '[E3_CONTROL_RESTRICTION_EVIDENCE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence.',
  ];
  for (const f of findings) {
    lines.push(`\n--- Location: ${f.filePath}:${f.line} (${f.subCheck}) ---`);
    lines.push(`  Element: ${f.elementLabel} (${f.elementType})`);
    lines.push(`  Detection: ${f.detection}`);
    lines.push(`  Evidence: ${f.evidence}`);
  }
  lines.push('[/E3_CONTROL_RESTRICTION_EVIDENCE]');
  return lines.join('\n');
}

// ========== U6 LAYOUT EVIDENCE BUNDLE EXTRACTION (Weak Grouping / Layout Coherence) ==========
interface U6LayoutEvidence {
  filePath: string;
  headings: string[];
  sectionCount: number;
  fieldsetCount: number;
  articleCount: number;
  cardWrapperCount: number;
  maxDivDepth: number;
  flexCount: number;
  gridCount: number;
  spacingTokens: string[];
  repeatedBlockCount: number;
  flatStackCues: string[];
}

function extractU6LayoutEvidence(allFiles: Map<string, string>): U6LayoutEvidence[] {
  const bundles: U6LayoutEvidence[] = [];
  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(`h${hm[1]}: ${text}`);
    }
    const twHeadingRe = /className\s*=\s*["'][^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*font-bold[^"']*["'][^>]*>([^<]{2,60})/gi;
    let thm;
    while ((thm = twHeadingRe.exec(content)) !== null) {
      headings.push(`styled-heading (${thm[1]}): ${thm[2].trim()}`);
    }

    const sectionCount = (content.match(/<section\b/gi) || []).length;
    const fieldsetCount = (content.match(/<fieldset\b/gi) || []).length;
    const articleCount = (content.match(/<article\b/gi) || []).length;
    const cardWrapperCount = (content.match(/<(?:Card|div)\b[^>]*(?:card|Card)[^>]*>/gi) || []).length;
    const opens = (content.match(/<div\b/gi) || []).length;
    const closes = (content.match(/<\/div>/gi) || []).length;
    const maxDepth = Math.min(opens, closes);
    const flexCount = (content.match(/\bflex\b/g) || []).length;
    const gridCount = (content.match(/\bgrid\b/g) || []).length;
    const spacingTokenSet = new Set<string>();
    const spacingRe = /\b(gap-\d+|space-[xy]-\d+|mb-\d+|mt-\d+|py-\d+|px-\d+|p-\d+|m-\d+)\b/g;
    let sm;
    while ((sm = spacingRe.exec(content)) !== null) spacingTokenSet.add(sm[1]);
    const mapCount = (content.match(/\.map\s*\(/g) || []).length;
    const flatStackCues: string[] = [];
    if (/(<(?:input|Input|textarea|Textarea|select|Select|button|Button)\b[^>]*(?:\/>|>[^<]*<\/(?:input|Input|textarea|Textarea|select|Select|button|Button)>)\s*\n?\s*){3,}/gi.test(content)) {
      flatStackCues.push('3+ sibling form controls without headings/wrappers');
    }

    if (headings.length === 0 && sectionCount === 0 && fieldsetCount === 0 && flexCount < 2 && spacingTokenSet.size === 0 && flatStackCues.length === 0) continue;

    bundles.push({ filePath, headings: [...new Set(headings)].slice(0, 8), sectionCount, fieldsetCount, articleCount, cardWrapperCount, maxDivDepth: maxDepth, flexCount, gridCount, spacingTokens: [...spacingTokenSet].slice(0, 12), repeatedBlockCount: mapCount, flatStackCues });
  }
  return bundles.slice(0, 15);
}

function formatU6LayoutEvidenceForPrompt(bundles: U6LayoutEvidence[]): string {
  if (bundles.length === 0) return '';
  const lines = ['[U6_LAYOUT_EVIDENCE_BUNDLE]', 'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Evaluate ONLY the extracted layout cues.'];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    lines.push(`  Containers: ${b.sectionCount} <section>, ${b.fieldsetCount} <fieldset>, ${b.articleCount} <article>, ${b.cardWrapperCount} card-like`);
    lines.push(`  Layout: ${b.flexCount} flex, ${b.gridCount} grid, div depth ~${b.maxDivDepth}`);
    if (b.spacingTokens.length > 0) lines.push(`  Spacing tokens: ${b.spacingTokens.join(', ')}`);
    if (b.repeatedBlockCount > 0) lines.push(`  Repeated blocks (map): ${b.repeatedBlockCount}`);
    if (b.flatStackCues.length > 0) lines.push(`  Flat-stack cues: ${b.flatStackCues.join('; ')}`);
  }
  lines.push('[/U6_LAYOUT_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// =====================
// U3 Content Accessibility Detection (sub-checks U3.D1, U3.D2, U3.D3, U3.D4)
// =====================

interface U3Finding {
  subCheck: 'U3.D1' | 'U3.D2' | 'U3.D3' | 'U3.D4';
  subCheckLabel: string;
  classification: 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance: string;
  textPreview?: string;
  deduplicationKey: string;
}

function extractU3TextPreview(content: string, pos: number): string | undefined {
  const after = content.slice(pos, Math.min(content.length, pos + 800));

  const cap = (s: string): string => s.length > 120 ? s.slice(0, 117) + '…' : s;

  const looksLikeClasses = (s: string): boolean =>
    /^[\w\s\-/[\]:!.#]+$/.test(s) && /\b(text-|bg-|flex|grid|p-|m-|w-|h-|rounded|border|font-|block|inline|hidden|overflow|relative|absolute|max-|min-)/.test(s);

  // 1) Visible JSX text nodes between > and <
  const textParts: string[] = [];
  const jsxTextRe = />([^<>{]+)</g;
  let tm;
  while ((tm = jsxTextRe.exec(after)) !== null) {
    const raw = tm[1].trim();
    if (raw.length < 3) continue;
    if (looksLikeClasses(raw)) continue;
    if (!/[a-zA-Z]/.test(raw)) continue;
    textParts.push(raw);
  }
  if (textParts.length > 0) {
    const joined = textParts.join(' ').trim();
    if (joined.length > 0) return cap(joined);
  }

  // 2) String literal children: >{`text`}< or >{"text"}<
  const childStringRe = />\s*\{\s*[`"']([^`"']{5,})[`"']\s*\}\s*</g;
  let csm;
  while ((csm = childStringRe.exec(after)) !== null) {
    const raw = csm[1].trim();
    if (raw.length > 0 && !looksLikeClasses(raw)) return cap(raw);
  }

  // 3) Dynamic variable children: >{variable}<
  const dynChildRe = />\s*\{([a-zA-Z_][\w.]*)\}\s*</g;
  let dm;
  const dynNames: string[] = [];
  while ((dm = dynChildRe.exec(after)) !== null) {
    const varName = dm[1];
    if (/^(className|style|key|ref|id|onClick|onChange|onSubmit|disabled|checked|value|type|src|href|alt)$/.test(varName)) continue;
    dynNames.push(varName);
  }
  if (dynNames.length > 0) {
    const meaningful = dynNames.find(n => /^(title|name|label|description|text|content|message|email|url|summary|body|comment|note|caption|heading|subtitle|placeholder|address|bio|detail)$/i.test(n) || n.includes('.'));
    if (meaningful) return `(dynamic text: ${meaningful})`;
    return `(dynamic text: ${dynNames[0]})`;
  }

  // 4) Broader dynamic children
  const dynBroadRe = />\s*\{([^}]{3,40})\}\s*</g;
  let db;
  while ((db = dynBroadRe.exec(after)) !== null) {
    const expr = db[1].trim();
    if (/[a-zA-Z]/.test(expr) && !/className|style|onClick/i.test(expr)) return '(dynamic text)';
  }

  return undefined;
}

function detectU3ContentAccessibility(allFiles: Map<string, string>): U3Finding[] {
  const findings: U3Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const fileName = filePath.split('/').pop() || filePath;

    // --- U3.D1: Line clamp / ellipsis truncation without expand ---
    const truncationPatterns = [
      { re: /\bline-clamp-[1-3]\b/g, label: 'line-clamp' },
      { re: /\btruncate\b/g, label: 'truncate' },
      { re: /\btext-ellipsis\b/g, label: 'text-ellipsis' },
    ];

    for (const { re, label } of truncationPatterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const pos = m.index;
        const lineNumber = content.slice(0, pos).split('\n').length;
        const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300)).toLowerCase();
        const hasExpand = /show\s*more|expand|read\s*more|see\s*all|view\s*more|toggle|title\s*=|tooltip/i.test(context);
        if (hasExpand) continue;
        if (/overflow-(?:auto|y-auto|x-auto|scroll)\b/.test(context)) continue;

        const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        findings.push({
          subCheck: 'U3.D1', subCheckLabel: 'Line clamp / ellipsis truncation', classification: 'potential',
          elementLabel: `Truncated text (${label})`, elementType: 'text', filePath,
          detection: `${m[0]} without expand mechanism`,
          evidence: `${m[0]} at ${fileName}:${lineNumber} — no "Show more", toggle, or title tooltip found nearby`,
          explanation: `Text is truncated using ${label} without a visible mechanism to reveal full content.`,
          confidence: 0.70, textPreview: extractU3TextPreview(content, pos),
          advisoryGuidance: 'Ensure truncated content has an accessible expand mechanism.',
          deduplicationKey: dedupeKey,
        });
      }
    }

    // whitespace-nowrap + overflow-hidden
    const nowrapRe = /\bwhitespace-nowrap\b/g;
    let nwm;
    while ((nwm = nowrapRe.exec(content)) !== null) {
      const pos = nwm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
      if (!/overflow-hidden\b/.test(context)) continue;
      if (/show\s*more|expand|read\s*more|title\s*=|tooltip/i.test(context)) continue;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U3.D1', subCheckLabel: 'Line clamp / ellipsis truncation', classification: 'potential',
        elementLabel: 'Truncated text (nowrap + overflow)', elementType: 'text', filePath,
        detection: 'whitespace-nowrap + overflow-hidden without expand mechanism',
        evidence: `whitespace-nowrap + overflow-hidden at ${fileName}:${lineNumber}`,
        explanation: 'Text is forced to a single line with overflow hidden, potentially clipping important content.',
        confidence: 0.70, textPreview: extractU3TextPreview(content, pos),
        advisoryGuidance: 'Add a title attribute or expand mechanism.', deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D2: Overflow clipping with fixed height ---
    const heightPatterns = /\b(?:max-h-\d+|h-\d+)\b/g;
    let hm;
    while ((hm = heightPatterns.exec(content)) !== null) {
      const pos = hm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
      if (!/overflow-hidden\b|overflow-y-hidden\b/.test(context)) continue;
      if (/overflow-(?:auto|scroll|y-auto|y-scroll)\b/.test(context)) continue;
      const hasTextContent = /<p\b|<span\b|<div\b[^>]*>[^<]{20,}|children|text|description|content|message/i.test(context);
      if (!hasTextContent) continue;
      if (/show\s*more|expand|read\s*more|see\s*all|toggle/i.test(context)) continue;

      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D2|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U3.D2', subCheckLabel: 'Overflow clipping', classification: 'potential',
        elementLabel: 'Fixed-height overflow container', elementType: 'container', filePath,
        detection: `${hm[0]} + overflow-hidden without scroll or expand`,
        evidence: `${hm[0]} with overflow-hidden at ${fileName}:${lineNumber}`,
        explanation: `Container has a fixed height (${hm[0]}) with overflow-hidden, which may clip text content.`,
        confidence: 0.72, textPreview: extractU3TextPreview(content, pos),
        advisoryGuidance: 'Use overflow-auto or add an expand mechanism.', deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D3: Scroll trap risk ---
    const scrollRe = /\boverflow-y-(?:scroll|auto)\b/g;
    let sm2;
    while ((sm2 = scrollRe.exec(content)) !== null) {
      const pos = sm2.index;
      const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
      const scrollMatches = context.match(/overflow-y-(?:scroll|auto)/g);
      if (!scrollMatches || scrollMatches.length < 2) continue;
      if (!/\b(?:max-h-|h-\d+)\b/.test(context)) continue;

      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D3|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U3.D3', subCheckLabel: 'Scroll trap risk', classification: 'potential',
        elementLabel: 'Nested scroll container', elementType: 'container', filePath,
        detection: 'Nested scroll containers with fixed height',
        evidence: `Multiple overflow-y-scroll/auto within fixed-height region at ${fileName}:${lineNumber}`,
        explanation: 'Nested scrollable containers may create a scroll trap.',
        confidence: 0.68, advisoryGuidance: 'Avoid nesting scrollable containers.', deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D4: Hidden content without control ---
    const hiddenPatterns = [
      { re: /aria-hidden\s*=\s*["']true["']/gi, label: 'aria-hidden="true"' },
      { re: /\bhidden\b(?!\s*=\s*["']false)/g, label: 'hidden attribute' },
    ];
    for (const { re, label } of hiddenPatterns) {
      let hm2;
      while ((hm2 = re.exec(content)) !== null) {
        const pos = hm2.index;
        const context = content.slice(Math.max(0, pos - 100), Math.min(content.length, pos + 400));
        if (/\bsvg\b|icon|separator|divider|decorat/i.test(context.slice(0, 150))) continue;
        if (/sr-only|visually-hidden/i.test(context)) continue;
        const hasMeaningful = /<(?:p|h[1-6]|span|div|form|input|button|a)\b[^>]*>[^<]{5,}/i.test(context.slice(100)) ||
          /\b(?:description|message|content|paragraph|text|label)\b/i.test(context);
        if (!hasMeaningful) continue;
        if (/toggle|show|expand|open|visible|setVisible|setOpen|setShow|useState/i.test(context)) continue;

        const lineNumber = content.slice(0, pos).split('\n').length;
        const dedupeKey = `U3.D4|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        findings.push({
          subCheck: 'U3.D4', subCheckLabel: 'Hidden content without control', classification: 'potential',
          elementLabel: `Hidden content (${label})`, elementType: 'content', filePath,
          detection: `${label} on content element without visible toggle`,
          evidence: `${label} at ${fileName}:${lineNumber} — meaningful content hidden without toggle`,
          explanation: `Content is hidden using ${label} without a visible mechanism to reveal it.`,
          confidence: 0.68, textPreview: extractU3TextPreview(content, pos),
          advisoryGuidance: 'Provide a visible toggle to reveal hidden content.', deduplicationKey: dedupeKey,
        });
      }
    }
  }

  // Cap per file
  const byFile = new Map<string, U3Finding[]>();
  for (const f of findings) { const ex = byFile.get(f.filePath) || []; ex.push(f); byFile.set(f.filePath, ex); }
  const capped: U3Finding[] = [];
  for (const [, ff] of byFile) { capped.push(...ff.slice(0, 3)); }

  // Confidence bonus per additional sub-check
  const subChecks = new Set(capped.map(f => f.subCheck));
  const bonus = Math.min((subChecks.size - 1) * 0.05, 0.15);
  for (const f of capped) { f.confidence = Math.min(f.confidence + bonus, 0.85); }

  console.log(`[U3] Detection: ${findings.length} raw, ${capped.length} after capping (${subChecks.size} sub-checks)`);
  return capped;
}


// =====================
// U5 Interaction Feedback Detection (sub-checks U5.D1, U5.D2, U5.D3)
// =====================

interface U5Finding {
  subCheck: 'U5.D1' | 'U5.D2' | 'U5.D3';
  subCheckLabel: string;
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  confidence: number;
  deduplicationKey: string;
}

function detectU5InteractionFeedback(allFiles: Map<string, string>): U5Finding[] {
  const findings: U5Finding[] = [];
  const seenKeys = new Set<string>();

  function normPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normPath(filePathRaw);
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const fileName = filePath.split('/').pop() || filePath;

    // --- U5.D1: Async action without loading/disabled feedback ---
    const asyncHandlerRe = /(?:onClick|onSubmit)\s*=\s*\{[^}]*(?:async\s|await\s|fetch\s*\(|axios[.\(]|\.then\s*\(|setTimeout\s*\(|useMutation|mutateAsync|mutate\s*\()/gi;
    let ahm;
    while ((ahm = asyncHandlerRe.exec(content)) !== null) {
      const pos = ahm.index;
      const lineNumber = content.slice(0, pos).split('\n').length;

      const hasLoadingState = /\b(?:isLoading|isSubmitting|isPending|loading|submitting)\b/i.test(content);
      const hasDisabledBinding = /disabled\s*=\s*\{[^}]*(?:isLoading|isSubmitting|isPending|loading|submitting)/i.test(content);
      const hasAriaBusy = /aria-busy/i.test(content);
      const hasSpinner = /(?:Spinner|Loader|Loading|CircularProgress)\b/i.test(content);
      const hasLabelSwap = /(?:Saving|Loading|Submitting|Processing|Please wait)\.\.\./i.test(content);

      if (hasLoadingState || hasDisabledBinding || hasAriaBusy || hasSpinner || hasLabelSwap) continue;

      const beforeHandler = content.slice(Math.max(0, pos - 200), pos);
      const afterHandler = content.slice(pos, Math.min(content.length, pos + 300));
      const btnTextMatch = afterHandler.match(/>([^<]{2,30})</);
      const ariaLabelMatch = beforeHandler.match(/aria-label\s*=\s*["']([^"']+)["']/i) || afterHandler.match(/aria-label\s*=\s*["']([^"']+)["']/i);
      const elementLabel = ariaLabelMatch?.[1] || btnTextMatch?.[1]?.replace(/\{[^}]*\}/g, '').trim() || 'Async action button';

      const dedupeKey = `U5.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      let conf = 0.65 + 0.10;
      if (!hasDisabledBinding) conf += 0.05;
      if (!hasSpinner && !hasLabelSwap) conf += 0.05;

      findings.push({
        subCheck: 'U5.D1', subCheckLabel: 'Async action without loading/disabled feedback',
        elementLabel: `"${elementLabel}" button`, elementType: 'button', filePath,
        detection: `Async handler without loading state, disabled binding, or spinner`,
        evidence: `onClick/onSubmit with async pattern at ${fileName}:${lineNumber} — no isLoading, disabled, aria-busy, or spinner detected`,
        confidence: Math.min(conf, 0.85), deduplicationKey: dedupeKey,
      });
    }

    // --- U5.D2: Form submit without success/error feedback ---
    const formRe = /<form\b[^>]*onSubmit/gi;
    let fm2;
    while ((fm2 = formRe.exec(content)) !== null) {
      const pos = fm2.index;
      const lineNumber = content.slice(0, pos).split('\n').length;

      const hasToast = /\btoast\s*\(|useToast|Sonner|Snackbar|notification\s*\./i.test(content);
      const hasSuccessError = /\b(?:success|error|message|status)\b\s*&&/i.test(content) || /(?:success|error)\s*\?\s*/i.test(content);
      const hasAlertOrMessage = /\balert\s*\(|Alert|FormMessage|ErrorMessage|SuccessMessage/i.test(content);

      if (hasToast || hasSuccessError || hasAlertOrMessage) continue;

      const d1Key = `U5.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(d1Key)) continue;

      const dedupeKey = `U5.D2|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U5.D2', subCheckLabel: 'Form submit without success/error feedback',
        elementLabel: 'Form submit', elementType: 'form', filePath,
        detection: `Form onSubmit without toast, alert, or success/error state rendering`,
        evidence: `<form onSubmit> at ${fileName}:${lineNumber} — no toast(), error/success conditional rendering detected`,
        confidence: 0.70, deduplicationKey: dedupeKey,
      });
    }

    // --- U5.D3: Toggle/state change without visible state indication ---
    const toggleRe = /onClick\s*=\s*\{[^}]*(?:set\w+\s*\(\s*!\w+|set\w+\s*\(\s*prev\s*=>\s*!prev)/gi;
    let tm2;
    while ((tm2 = toggleRe.exec(content)) !== null) {
      const pos = tm2.index;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));

      const hasAriaState = /aria-pressed|aria-checked|role\s*=\s*["']switch["']/i.test(context);
      const hasClassConditional = /className\s*=\s*\{[^}]*\?\s*/i.test(context) || /\?\s*["'][^"']*["']\s*:\s*["']/i.test(context);
      const hasTextSwap = /\?\s*["'](?:On|Off|Active|Inactive|Enabled|Disabled|Show|Hide|Open|Close)["']/i.test(context);

      if (hasAriaState || hasClassConditional || hasTextSwap) continue;

      const dedupeKey = `U5.D3|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U5.D3', subCheckLabel: 'Toggle without visible state indication',
        elementLabel: 'Toggle control', elementType: 'toggle', filePath,
        detection: `Boolean toggle without aria-pressed/checked, className conditional, or text swap`,
        evidence: `onClick toggles boolean at ${fileName}:${lineNumber} — no aria-pressed, className ternary, or text swap found`,
        confidence: 0.65, deduplicationKey: dedupeKey,
      });
    }
  }

  // Cap per file
  const byFile = new Map<string, U5Finding[]>();
  for (const f of findings) { const ex = byFile.get(f.filePath) || []; ex.push(f); byFile.set(f.filePath, ex); }
  const capped: U5Finding[] = [];
  for (const [, ff] of byFile) { capped.push(...ff.slice(0, 3)); }

  console.log(`[U5] Detection: ${findings.length} raw findings, ${capped.length} after capping`);
  return capped;
}

// =====================
// U2 Navigation Detection (sub-checks U2.D1, U2.D2, U2.D3)
// =====================

interface U2Finding {
  subCheck: 'U2.D1' | 'U2.D2' | 'U2.D3';
  subCheckLabel: string;
  classification: 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance: string;
  deduplicationKey: string;
}

function detectU2Navigation(allFiles: Map<string, string>): U2Finding[] {
  const findings: U2Finding[] = [];
  const seenKeys = new Set<string>();

  let routeCount = 0;
  let hasNavElement = false;
  let hasRoleNavigation = false;
  let hasNavLinks = false;
  let hasBreadcrumbImport = false;
  let hasBreadcrumbRendered = false;
  let hasBackButton = false;
  const routeFiles: string[] = [];
  const nestedRouteFiles: string[] = [];
  const breadcrumbImportFiles: string[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    // Detect routes
    const routePatterns = [/<Route\b/gi, /path\s*[:=]\s*["']\//gi, /createBrowserRouter/gi, /useRoutes/gi];
    let fileRouteCount = 0;
    for (const pat of routePatterns) {
      const matches = content.match(pat);
      if (matches) fileRouteCount += matches.length;
    }
    if (fileRouteCount > 0) { routeCount += fileRouteCount; routeFiles.push(filePath); }

    // Nested routes
    if (/<Route\b[^>]*>\s*<Route\b/s.test(content) || /children\s*:\s*\[/s.test(content)) {
      nestedRouteFiles.push(filePath);
    }

    // Nav elements
    if (/<nav\b/i.test(content)) hasNavElement = true;
    if (/role\s*=\s*["']navigation["']/i.test(content)) hasRoleNavigation = true;

    // Nav links in layout files
    if (/<(?:Link|NavLink|a)\b[^>]*(?:href|to)\s*=/i.test(content)) {
      if (/layout|sidebar|navbar|header|navigation|menu|app\./i.test(filePath)) hasNavLinks = true;
    }

    // Breadcrumb
    if (/breadcrumb/i.test(content)) {
      if (/import\s.*breadcrumb/i.test(content) || /from\s+['"].*breadcrumb/i.test(content)) {
        hasBreadcrumbImport = true;
        breadcrumbImportFiles.push(filePath);
      }
      if (/<Breadcrumb\b/i.test(content) || /role\s*=\s*["']breadcrumb["']/i.test(content) || /<nav\b[^>]*aria-label\s*=\s*["']breadcrumb["']/i.test(content)) {
        hasBreadcrumbRendered = true;
      }
    }

    // Back button
    if (/(?:back|go\s*back|navigate\(-1\)|history\.back|router\.back|useNavigate.*-1)/i.test(content)) hasBackButton = true;
    if (/<(?:Button|button|a|Link)\b[^>]*>(?:[^<]*(?:Back|Go back|Return|← Back)[^<]*)<\//i.test(content)) hasBackButton = true;
  }

  const hasNavContainer = hasNavElement || hasRoleNavigation;

  // U2.D1: No navigation container
  if (routeCount >= 3 && !hasNavContainer && !hasNavLinks) {
    const dedupeKey = 'U2.D1|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D1', subCheckLabel: 'No navigation container', classification: 'potential',
        elementLabel: 'Application routing', elementType: 'navigation', filePath: routeFiles[0] || 'Unknown',
        detection: `${routeCount} routes detected without <nav> element or role="navigation"`,
        evidence: `Route definitions found in: ${routeFiles.slice(0, 3).join(', ')}${routeFiles.length > 3 ? ` (+${routeFiles.length - 3} more)` : ''}. No <nav> or role="navigation" detected. No navigation links in layout files.`,
        explanation: `The application defines ${routeCount} routes but lacks a visible navigation container. Users may not have a clear way to navigate between sections.`,
        confidence: 0.70,
        advisoryGuidance: 'Add a <nav> element or role="navigation" container with links to main application routes.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // U2.D2: No back affordance in nested route
  if (nestedRouteFiles.length > 0 && !hasBackButton && !hasBreadcrumbRendered) {
    const dedupeKey = 'U2.D2|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D2', subCheckLabel: 'No back affordance in nested route', classification: 'potential',
        elementLabel: 'Nested route navigation', elementType: 'navigation', filePath: nestedRouteFiles[0],
        detection: 'Nested routes without back button or breadcrumb navigation',
        evidence: `Nested route structure detected in: ${nestedRouteFiles.slice(0, 3).join(', ')}. No back button or breadcrumb component found.`,
        explanation: 'Nested routes exist but no back navigation affordance was detected. Users in child routes may not have a clear way to return.',
        confidence: 0.68,
        advisoryGuidance: 'Add a back button or breadcrumb trail in nested route views.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // U2.D3: Breadcrumb inconsistency
  if (hasBreadcrumbImport && !hasBreadcrumbRendered) {
    const dedupeKey = 'U2.D3|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D3', subCheckLabel: 'Breadcrumb inconsistency', classification: 'potential',
        elementLabel: 'Breadcrumb component', elementType: 'navigation', filePath: breadcrumbImportFiles[0] || 'Unknown',
        detection: 'Breadcrumb component imported but not rendered',
        evidence: `Breadcrumb import detected in: ${breadcrumbImportFiles.join(', ')}. No rendering found.`,
        explanation: 'A breadcrumb component is imported but not rendered, indicating incomplete navigation implementation.',
        confidence: 0.72,
        advisoryGuidance: 'Render the breadcrumb component in relevant views or remove the unused import.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  console.log(`[U2] Detection (GitHub): routes=${routeCount}, hasNav=${hasNavContainer}, hasNavLinks=${hasNavLinks}, breadcrumb=${hasBreadcrumbRendered}, back=${hasBackButton}, nested=${nestedRouteFiles.length}, findings=${findings.length}`);
  return findings;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { githubUrl, categories, selectedRules, toolUsed } = await req.json();
    
    console.log(`GitHub analysis request - URL: ${githubUrl}, Tool: ${toolUsed}`);
    console.log(`Selected categories: ${categories?.join(', ')}`);
    console.log(`Selected rules: ${selectedRules?.join(', ')}`);
    
    if (!githubUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "GitHub URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Parse GitHub URL
    const parsed = parseGitHubUrl(githubUrl);
    if (!parsed) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid GitHub URL format. Expected: https://github.com/owner/repo" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const { owner, repo } = parsed;
    console.log(`Parsed GitHub URL - Owner: ${owner}, Repo: ${repo}`);
    
    // Fetch repository tree
    const tree = await fetchRepoTree(owner, repo);
    console.log(`Fetched ${tree.length} items from repository tree`);
    
    // Filter for analyzable files
    const analyzableFiles = tree.filter(
      (file) => file.type === 'blob' && isAnalyzableFile(file.path)
    );
    console.log(`Found ${analyzableFiles.length} analyzable UI files`);
    
    if (analyzableFiles.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          violations: [],
          passNotes: {
            accessibility: "No UI files found to analyze.",
            usability: "No UI files found to analyze.",
            ethics: "No UI files found to analyze.",
          },
          filesAnalyzed: 0,
          stackDetected: 'Unknown',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Limit files to analyze (to stay within API limits and token limits)
    const MAX_FILES = 50;
    const MAX_TOTAL_SIZE = 500000; // 500KB limit for AI context
    
    const filesToFetch = analyzableFiles.slice(0, MAX_FILES);
    console.log(`Fetching content for ${filesToFetch.length} files...`);
    
    // Fetch file contents in parallel (with rate limiting)
    const allFiles = new Map<string, string>();
    let totalSize = 0;
    
    for (const file of filesToFetch) {
      if (totalSize >= MAX_TOTAL_SIZE) {
        console.log(`Reached size limit (${totalSize} bytes), stopping file fetch`);
        break;
      }
      
      try {
        const content = await fetchFileContent(owner, repo, file.path);
        if (content) {
          allFiles.set(file.path, content);
          totalSize += content.length;
        }
      } catch (err) {
        console.warn(`Failed to fetch ${file.path}:`, err);
      }
    }
    
    console.log(`Fetched ${allFiles.size} files, total size: ${totalSize} bytes`);
    
    // Detect stack
    const stack = detectStack(allFiles);
    console.log(`Detected stack: ${stack}`);
    
    // Run deterministic analyses
    const selectedRulesSet = new Set(selectedRules || []);
    
    // A1 - Contrast analysis
    const contrastViolations = selectedRulesSet.has('A1') ? analyzeContrastInCode(allFiles) : [];
    console.log(`A1 contrast analysis: ${contrastViolations.length} violations`);
    
    // U1 - Primary action sub-checks (split into confirmed + potential objects)
    const aggregatedU1GitHubList: any[] = [];
    if (selectedRulesSet.has('U1')) {
      const u1Findings = detectU1PrimaryAction(allFiles);
      if (u1Findings.length > 0) {
        const confirmedFindings = u1Findings.filter((f: any) => f.classification === 'confirmed');
        const potentialFindings = u1Findings.filter((f: any) => f.classification === 'potential');

        const mapElements = (list: any[]) => list.map((f: any) => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        if (confirmedFindings.length > 0) {
          aggregatedU1GitHubList.push({
            ruleId: 'U1', ruleName: 'Unclear primary action', category: 'usability',
            status: 'confirmed',
            blocksConvergence: false, inputType: 'github', isU1Aggregated: true, u1Elements: mapElements(confirmedFindings), evaluationMethod: 'hybrid_deterministic',
            diagnosis: `Primary action clarity issues: ${confirmedFindings.length} confirmed violation(s).`,
            contextualHint: 'Establish a clear visual hierarchy with one primary action per group.',
            confidence: 1.0,
          });
        }

        if (potentialFindings.length > 0) {
          const potentialConfidence = Math.max(...potentialFindings.map((f: any) => f.confidence));
          aggregatedU1GitHubList.push({
            ruleId: 'U1', ruleName: 'Unclear primary action', category: 'usability',
            status: 'potential',
            blocksConvergence: false, inputType: 'github', isU1Aggregated: true, u1Elements: mapElements(potentialFindings), evaluationMethod: 'hybrid_deterministic',
            diagnosis: `Primary action clarity issues: ${potentialFindings.length} potential risk(s).`,
            contextualHint: 'Establish a clear visual hierarchy with one primary action per group.',
            advisoryGuidance: 'Visually distinguish the primary action (stronger color/weight/placement) and use specific labels.',
            confidence: Math.round(potentialConfidence * 100) / 100,
          });
        }

        console.log(`U1 aggregated (GitHub): ${u1Findings.length} findings → ${aggregatedU1GitHubList.length} object(s)`);
      }
    }

    // U2 - Navigation detection
    const aggregatedU2GitHubList: any[] = [];
    if (selectedRulesSet.has('U2')) {
      const u2Findings = detectU2Navigation(allFiles);
      if (u2Findings.length > 0) {
        const u2Elements = u2Findings.map((f: any) => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u2Findings.map((f: any) => f.confidence));
        aggregatedU2GitHubList.push({
          ruleId: 'U2', ruleName: 'Incomplete / Unclear navigation', category: 'usability',
          status: 'potential',
          blocksConvergence: false, inputType: 'github', isU2Aggregated: true, u2Elements, evaluationMethod: 'hybrid_structural',
          diagnosis: `Navigation clarity issues: ${u2Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Ensure clear navigation paths with visible indicators of current location.',
          advisoryGuidance: 'Review navigation structure: ensure <nav> containers, breadcrumbs, and back affordances are present in multi-route applications.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U2 aggregated (GitHub): ${u2Findings.length} findings → 1 potential violation object`);
      }
    }

    // U3 - Content accessibility detection
    const aggregatedU3GitHubList: any[] = [];
    if (selectedRulesSet.has('U3')) {
      const u3Findings = detectU3ContentAccessibility(allFiles);
      if (u3Findings.length > 0) {
        // Remove any LLM-generated U3 findings
        filteredNonA2AiViolations = filteredNonA2AiViolations || nonA2AiViolations;

        const u3Elements = u3Findings.map((f: any) => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          textPreview: f.textPreview,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u3Findings.map((f: any) => f.confidence));
        aggregatedU3GitHubList.push({
          ruleId: 'U3', ruleName: 'Truncated or inaccessible content', category: 'usability',
          status: 'potential',
          blocksConvergence: false, inputType: 'github', isU3Aggregated: true, u3Elements, evaluationMethod: 'deterministic_structural',
          diagnosis: `Content accessibility issues: ${u3Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Ensure all meaningful text is fully visible or has an accessible expand mechanism.',
          advisoryGuidance: 'Ensure important content is fully visible or provide an accessible expand mechanism.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U3 aggregated (GitHub): ${u3Findings.length} findings → 1 potential violation object`);
      }
    }
    
    // A3 - Keyboard operability
    let aggregatedA3GitHub: any = null;
    if (selectedRulesSet.has('A3')) {
      const a3Findings = detectA3KeyboardOperability(allFiles);
      if (a3Findings.length > 0) {
        const confirmedCount = a3Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = a3Findings.filter(f => f.classification === 'potential').length;
        const hasConfirmed = confirmedCount > 0;
        const overallConfidence = Math.max(...a3Findings.map(f => f.confidence));
        const a3Elements = a3Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          classification: f.classification, classificationCode: f.classificationCode,
          potentialSubtype: f.classification === 'potential' ? 'borderline' as const : undefined,
          explanation: f.explanation, confidence: f.confidence, correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));
        aggregatedA3GitHub = {
          ruleId: 'A3', ruleName: 'Incomplete keyboard operability', category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          potentialSubtype: hasConfirmed ? undefined : 'borderline',
          blocksConvergence: hasConfirmed, inputType: 'github', isA3Aggregated: true, a3Elements, evaluationMethod: 'deterministic',
          diagnosis: `Keyboard operability issues: ${confirmedCount} confirmed, ${potentialCount} potential.`,
          contextualHint: 'Ensure all interactive elements are keyboard accessible.',
          correctivePrompt: 'Use native <button>/<a href> or add role, tabIndex=0, and Enter/Space key handlers.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(hasConfirmed ? {} : { advisoryGuidance: 'Keyboard support may be incomplete. Ensure custom controls are reachable via Tab and activate with Enter/Space.' }),
        };
        console.log(`A3 aggregated (GitHub): ${a3Findings.length} findings`);
      }
    }

    let codeContent = '';
    for (const [filepath, content] of allFiles) {
      if (codeContent.length + content.length > MAX_TOTAL_SIZE) break;
      codeContent += `\n--- FILE: ${filepath} ---\n${content}\n`;
    }
    
    // Run AI analysis
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.error("LOVABLE_API_KEY not configured");
      // Return deterministic results only
      const allViolations = [
        ...contrastViolations,
        ...aggregatedU1GitHubList,
      ];
      
      return new Response(
        JSON.stringify({
          success: true,
          violations: allViolations,
          passNotes: {
            accessibility: "AI analysis unavailable - showing deterministic results only.",
            usability: "AI analysis unavailable.",
            ethics: "AI analysis unavailable.",
          },
          filesAnalyzed: allFiles.size,
          stackDetected: stack,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Extract U4 evidence bundle
    const u4EvidenceBundles = selectedRulesSet.has('U4') ? extractU4EvidenceBundle(allFiles) : [];
    const u4BundleText = formatU4EvidenceBundleForPrompt(u4EvidenceBundles);

    // Extract U6 layout evidence bundle
    const u6LayoutBundles = selectedRulesSet.has('U6') ? extractU6LayoutEvidence(allFiles) : [];
    const u6BundleText = formatU6LayoutEvidenceForPrompt(u6LayoutBundles);

    // Extract E1 evidence bundle (high-impact action transparency)
    const e1EvidenceBundles = selectedRulesSet.has('E1') ? extractE1EvidenceBundle(allFiles) : [];
    const e1BundleText = formatE1EvidenceBundleForPrompt(e1EvidenceBundles);

    // Extract E2 choice bundle (choice architecture balance)
    const e2ChoiceBundles = selectedRulesSet.has('E2') ? extractE2ChoiceBundle(allFiles) : [];
    const e2BundleText = formatE2ChoiceBundleForPrompt(e2ChoiceBundles);

    // Extract E3 control restriction evidence (deterministic detection)
    const e3Findings = selectedRulesSet.has('E3') ? detectE3ControlRestrictions(allFiles) : [];
    const e3BundleText = formatE3FindingsForPrompt(e3Findings);
    console.log(`E3 deterministic (GitHub): ${e3Findings.length} candidate(s) found`);

    const systemPrompt = buildCodeAnalysisPrompt(selectedRules || []);
    const userPrompt = `Analyze this ${stack} codebase from GitHub repository "${owner}/${repo}":\n\n${codeContent}${u4BundleText ? '\n\n' + u4BundleText : ''}${u6BundleText ? '\n\n' + u6BundleText : ''}${e1BundleText ? '\n\n' + e1BundleText : ''}${e2BundleText ? '\n\n' + e2BundleText : ''}${e3BundleText ? '\n\n' + e3BundleText : ''}`;
    
    console.log(`Sending to AI: ${userPrompt.length} chars of code context`);
    
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: "google/gemini-2.5-flash",
        max_tokens: 12000,
      }),
    });
    
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      
      // Return deterministic results
      const allViolations = [
        ...contrastViolations,
        ...aggregatedU1GitHubList,
      ];
      
      return new Response(
        JSON.stringify({
          success: true,
          violations: allViolations,
          passNotes: {
            accessibility: "AI analysis failed - showing deterministic results only.",
            usability: "AI analysis failed.",
            ethics: "AI analysis failed.",
          },
          filesAnalyzed: allFiles.size,
          stackDetected: stack,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || "";
    
    console.log(`AI response length: ${responseText.length} chars`);
    
    // Parse AI response
    let analysisResult: any = { violations: [], passNotes: {} };
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn("Failed to parse AI response:", parseError);
    }
    
    // Filter violations by selected rules
    const aiViolations = (analysisResult.violations || []).filter(
      (v: any) => selectedRulesSet.has(v.ruleId)
    );
    
    // Add typeBadge to AI violations if not present
    const taggedAiViolations = aiViolations.map((v: any) => {
      // Determine evaluationMethod based on rule classification
      const isHybridRule = ['U1', 'U2', 'U3', 'U5', 'E1', 'E3'].includes(v.ruleId);
      const evaluationMethod = isHybridRule ? 'hybrid_llm_fallback' : 'llm_assisted';
      return {
        ...v,
        typeBadge: v.typeBadge || "Heuristic (requires runtime verification)",
        evaluationMethod,
        correctivePrompt: v.correctivePrompt || 
          rules.accessibility.find(r => r.id === v.ruleId)?.correctivePrompt ||
          rules.usability.find(r => r.id === v.ruleId)?.correctivePrompt ||
          rules.ethics.find(r => r.id === v.ruleId)?.correctivePrompt ||
          "Review and address this issue.",
      };
    });
    
    // ========== A1 AGGREGATION LOGIC (v22) ==========
    // Aggregate per-element A1 contrast findings into at most 1 Potential card
    // For GitHub: All findings are potential (no confirmed)
    
    const potentialA1Elements = contrastViolations;
    
    // Helper to build A1ElementSubItem from raw violation
    const buildA1SubItem = (v: any): any => {
      const dedupeKey = `${v.evidence || ''}-${v.foregroundHex || ''}`.toLowerCase().replace(/\s+/g, '');
      
      return {
        elementLabel: v.elementDescription || v.elementIdentifier || 'Text element',
        textSnippet: undefined,
        location: v.evidence || v.elementIdentifier || 'Unknown location',
        foregroundHex: v.foregroundHex,
        foregroundConfidence: v.confidence,
        backgroundStatus: v.backgroundStatus || 'unmeasurable',
        backgroundHex: v.backgroundHex,
        backgroundCandidates: undefined,
        contrastRatio: v.contrastRatio,
        contrastRange: undefined,
        contrastNotMeasurable: v.backgroundStatus === 'unmeasurable',
        thresholdUsed: v.thresholdUsed || 4.5,
        explanation: v.diagnosis,
        reasonCodes: v.reasonCodes || ['STATIC_ANALYSIS'],
        nearThreshold: false,
        deduplicationKey: dedupeKey,
      };
    };
    
    // Deduplicate elements by key
    const deduplicateElements = (elements: any[]): any[] => {
      const seen = new Map<string, any>();
      for (const el of elements) {
        const key = el.deduplicationKey;
        if (seen.has(key)) {
          const existing = seen.get(key);
          if (el.reasonCodes) {
            existing.reasonCodes = [...new Set([...(existing.reasonCodes || []), ...el.reasonCodes])];
          }
        } else {
          seen.set(key, el);
        }
      }
      return Array.from(seen.values());
    };
    
    const aggregatedA1Violations: any[] = [];
    
    if (potentialA1Elements.length > 0) {
      const elements = deduplicateElements(potentialA1Elements.map(buildA1SubItem));
      const avgConfidence = potentialA1Elements.reduce((sum: number, v: any) => sum + (v.confidence || 0.55), 0) / potentialA1Elements.length;
      
      const allReasonCodes = new Set<string>(['STATIC_ANALYSIS']);
      for (const el of elements) {
        if (el.reasonCodes) {
          for (const code of el.reasonCodes) {
            allReasonCodes.add(code);
          }
        }
      }
      
      aggregatedA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        isA1Aggregated: true,
        a1Elements: elements,
        diagnosis: `${elements.length} text element${elements.length !== 1 ? 's' : ''} with potential contrast issues detected via static code analysis. Background colors cannot be determined without runtime rendering.`,
        correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools after rendering.',
        contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools after rendering.',
        confidence: Math.round(avgConfidence * 100) / 100,
        reasonCodes: Array.from(allReasonCodes),
        potentialRiskReason: Array.from(allReasonCodes).join(', '),
        advisoryGuidance: 'Upload screenshots of the rendered UI for higher-confidence verification.',
        blocksConvergence: false,
        inputType: 'github',
        samplingMethod: 'inferred',
        evaluationMethod: 'deterministic',
        typeBadge: 'Heuristic (requires runtime verification)',
      });
      
      console.log(`A1 aggregated (GitHub): ${potentialA1Elements.length} potential elements → 1 Potential card (${elements.length} unique)`);
    }
    
    // ========== A2 Source-Level Pre-Filter ==========
    // Scan source files for className strings with outline-none + valid replacement
    const a2SafeFilesGH = new Set<string>();
    for (const [filePath, content] of allFiles) {
      if (!/\.(tsx|jsx|html|vue|svelte)$/i.test(filePath)) continue;
      const classStrings = content.match(/(?:className|class)\s*=\s*(?:"[^"]*"|'[^']*'|{`[^`]*`})/g) || [];
      const cvaStrings = content.match(/(?:cva|cn|clsx)\s*\([^)]{10,}\)/g) || [];
      for (const cls of [...classStrings, ...cvaStrings]) {
        const lower = cls.toLowerCase();
        const hasSuppression = /(?:focus-visible:|focus:)?outline-none|(?:focus-visible:|focus:)?ring-0/.test(lower);
        if (!hasSuppression) continue;
        const hasReplacement = /focus(?:-visible)?:ring-[1-9]|focus(?:-visible)?:ring-ring|focus(?:-visible)?:ring-\w/.test(lower) ||
          /focus(?:-visible)?:border-(?!0|none)/.test(lower) ||
          /focus(?:-visible)?:shadow-(?!none)/.test(lower) ||
          /focus(?:-visible)?:outline-(?!none)/.test(lower) ||
          /focus(?:-visible)?:ring-offset-[1-9]/.test(lower);
        if (hasReplacement) {
          a2SafeFilesGH.add(filePath);
          a2SafeFilesGH.add(filePath.replace(/^.*\//, ''));
          console.log(`A2 PRE-FILTER SAFE (GitHub): ${filePath}`);
        }
      }
    }

    // ========== A2 Focus Visibility — Aggregate from AI findings ==========
    const a2AiViolations = taggedAiViolations.filter((v: any) => v.ruleId === 'A2' || v.ruleId === 'A5');
    const nonA2AiViolations = taggedAiViolations.filter((v: any) => v.ruleId !== 'A2' && v.ruleId !== 'A3' && v.ruleId !== 'A4' && v.ruleId !== 'A5' && v.ruleId !== 'A6' && v.ruleId !== 'U1');
    
    let aggregatedA2GitHub: any = null;
    if (a2AiViolations.length > 0) {
      // Filter valid focus violations
      const validA2 = a2AiViolations.filter((v: any) => {
        const combined = ((v.diagnosis || '') + ' ' + (v.evidence || '')).toLowerCase();
        const mentionsOutlineRemoval = /outline-none|focus:outline-none|focus-visible:outline-none|ring-0|focus:ring-0|focus-visible:ring-0|focus:border-0|focus-visible:border-0/.test(combined);
        if (!mentionsOutlineRemoval) {
          console.log(`A2 SKIP (no outline removal): ${(v.evidence || '').substring(0, 80)}`);
          return false;
        }
        // Check for STRONG visible replacement = PASS (ring-2+, border, strong shadow, outline)
        const hasStrongReplacement = /focus(?:-visible)?:ring-[2-9]|ring-offset-[2-9]|focus(?:-visible)?:border(?!-0)|focus(?:-visible)?:shadow-(?!none|sm\b)|focus(?:-visible)?:outline-(?!none)/.test(combined);
        if (hasStrongReplacement) {
          console.log(`A2 PASS (has strong replacement): ${(v.evidence || '').substring(0, 80)}`);
          return false;
        }
        // SOURCE-LEVEL PRE-FILTER: check if file has outline-none + replacement in same className
        const findingFile = v.filePath || '';
        const findingFileName = findingFile.replace(/^.*\//, '');
        const evidenceFileMatch = (v.evidence || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js))/i);
        const evidenceFileName = evidenceFileMatch?.[1] || '';
        const isInSafeSet = a2SafeFilesGH.has(findingFile) || 
                            a2SafeFilesGH.has(findingFileName) ||
                            a2SafeFilesGH.has(evidenceFileName) ||
                            [...a2SafeFilesGH].some(sf => sf.includes(findingFileName) || (evidenceFileName && sf.includes(evidenceFileName)));
        if (isInSafeSet) {
          console.log(`A2 PASS (source pre-filter): ${findingFile || evidenceFileName}`);
          return false;
        }
        return true;
      });
      
      if (validA2.length > 0) {
        const a2Elements = validA2.map((v: any, idx: number) => {
          const evidence = v.evidence || '';
          const combined = ((v.diagnosis || '') + ' ' + evidence).toLowerCase();
          const componentMatch = evidence.match(/([A-Z][a-zA-Z0-9]*(?:Button|Link|Input|Select|Card|Dialog|Nav|Toggle|Trigger)?)/);
          const fileMatch = (evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js))/i);
          const elementLabel = componentMatch?.[1] || fileMatch?.[1]?.replace(/\.\w+$/, '') || `Interactive element ${idx + 1}`;
          const location = fileMatch?.[1] || v.contextualHint || 'Unknown file';
          
          // Determine element type
          let elementType = 'interactive element';
          if (/\bbutton\b/i.test(combined)) elementType = 'button';
          else if (/\blink\b|\ba\b/i.test(combined)) elementType = 'link';
          else if (/\binput\b/i.test(combined)) elementType = 'input';
          
          // ── Borderline vs Confirmed classification (expanded patterns) ──
          // Weak/ambiguous focus styles: bg, text, underline, opacity, font
          const hasWeakFocusStyle = /focus(?:-visible)?:(?:bg-|text-|underline|opacity-|font-)/.test(combined);
          const hasSubtleFocusStyling = 
            hasWeakFocusStyle || // bg/text/underline/opacity/font
            (/(?:focus(?:-visible)?:)?ring-1\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]/.test(combined)) || // ring-1 only
            /ring-(?:gray|slate|zinc)-(?:100|200)\b/.test(combined) || // muted ring color
            (/focus(?:-visible)?:shadow-sm\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]|focus(?:-visible)?:border(?!-0)|focus(?:-visible)?:outline-(?!none)/.test(combined)) || // shadow-sm only
            (/\bfocus:(?:ring-[^0]|border-(?!0)|shadow-(?!none)|outline-(?!none))/.test(combined) && !/focus-visible:/.test(combined)); // :focus without :focus-visible
          
          const isBorderline = hasSubtleFocusStyling;
          const isConfirmed = !isBorderline;
          // Confirmed: 90-95% deterministic; Borderline: 60-75%
          const confidence = isConfirmed ? 0.92 : 0.68;
          
          const focusClasses = (combined.match(/(?:focus:|focus-visible:)?(?:outline-none|ring-0|border-0|bg-[\w-]+|ring-[\w-]+|border-[\w-]+|text-[\w-]+|shadow-[\w-]+|ring-offset-[\w-]+|underline|opacity-[\w-]+|font-[\w-]+)/g) || []);
          
          // Build descriptive detection text
          let detection: string;
          if (isBorderline) {
            const subtleDetails = focusClasses.join(', ') || 'bg/text change only';
            const hasRing1 = /ring-1\b/.test(subtleDetails);
            const hasMuted = /(?:gray|slate|zinc)-(?:100|200)/.test(subtleDetails);
            const hasShadowSm = /shadow-sm/.test(subtleDetails);
          const hasBgTextOnly = /(?:focus|focus-visible):(?:bg-|text-)/.test(subtleDetails) && 
                                 !/ring-[1-9]|border-|shadow-|outline-(?!none)/.test(subtleDetails);
          
          if (hasBgTextOnly) {
              detection = `Focus indicated only by background/text color change (${subtleDetails}) after outline removal — contrast not verifiable statically`;
            } else if (hasRing1 && hasMuted) {
              detection = `Subtle focus ring (${subtleDetails}) without offset after outline removal — may be hard to perceive`;
            } else if (hasShadowSm) {
              detection = `Focus uses shadow-sm only (${subtleDetails}) without ring/outline/border — may be too subtle`;
            } else {
              detection = `Focus styling may be too subtle (${subtleDetails})`;
            }
          } else {
            detection = `Focus indicator removed without visible replacement`;
          }
          
          // Derive identity fields from AI output
          const role = v.role || elementType;
          const accessibleName = v.accessibleName ?? '';
          const sourceLabel = v.sourceLabel || elementLabel;
          const selectorHint = v.selectorHint || 
            (location !== 'Unknown file' ? `<${elementType || 'element'}> in ${location}` : undefined);
          
          return {
            elementLabel: sourceLabel,
            elementType,
            role,
            accessibleName,
            sourceLabel,
            selectorHint,
            location,
            detection,
            detectionMethod: 'deterministic' as const,
            focusClasses: [...new Set(focusClasses)].filter((cls, _i, arr) => {
              if (cls === 'outline-none' && arr.includes('focus:outline-none')) return false;
              if (cls === 'outline-none' && arr.includes('focus-visible:outline-none')) return false;
              if (cls === 'ring-0' && arr.includes('focus:ring-0')) return false;
              if (cls === 'border-0' && arr.includes('focus:border-0')) return false;
              return true;
            }),
            classification: isConfirmed ? 'confirmed' as const : 'potential' as const,
            potentialSubtype: isConfirmed ? undefined : 'borderline' as const,
            potentialReason: isConfirmed ? undefined : 'Custom focus styles exist but perceptibility cannot be statically verified.',
            explanation: (() => {
              if (isConfirmed) return v.diagnosis || 'Element removes the default browser outline without providing a visible focus replacement.';
              const classStr = focusClasses.join(' ');
              const hasBgTextOnly = /(?:focus|focus-visible):(?:bg-|text-)/.test(classStr) && 
                                     !/ring-[1-9]|border-|shadow-|outline-(?!none)/.test(classStr);
              if (hasBgTextOnly) {
                return 'Issue reason: Outline removed; focus relies only on bg/text change; contrast can\'t be verified statically.\n\nRecommended fix: Add a clear focus-visible indicator (e.g., focus-visible:ring-2 + focus-visible:ring-offset-2) or restore outline.';
              }
              return v.diagnosis || 'Focus indication relies on a subtle or low-contrast indicator (e.g., ring-1 with muted color, shadow-sm only), which may be insufficient for users with visual impairments.';
            })(),
            confidence,
            correctivePrompt: isConfirmed
              ? `[${sourceLabel} ${elementType}] — ${location}\n\nIssue reason:\nFocus indicator is removed without a visible replacement.\n\nRecommended fix:\nAdd a visible keyboard focus style using :focus-visible (e.g., focus-visible:ring-2 focus-visible:ring-offset-2) and apply consistently across all instances.`
              : undefined,
            deduplicationKey: `${location}|${elementLabel}`,
          };
        });
        
        const hasConfirmed = a2Elements.some((el: any) => el.classification === 'confirmed');
        const a2Status = hasConfirmed ? 'confirmed' : 'potential';
        const avgConf = a2Elements.reduce((s: number, e: any) => s + e.confidence, 0) / a2Elements.length;
        
        aggregatedA2GitHub = {
          ruleId: 'A2',
          ruleName: 'Poor focus visibility',
          category: 'accessibility',
          status: a2Status,
          potentialSubtype: a2Status === 'potential' ? 'borderline' : undefined,
          blocksConvergence: a2Status === 'confirmed',
           inputType: 'github',
           isA2Aggregated: true,
           a2Elements,
           evaluationMethod: 'llm_assisted',
          diagnosis: `${a2Elements.length} interactive element${a2Elements.length !== 1 ? 's' : ''} with focus visibility issues detected.`,
          contextualHint: 'Add visible focus-visible indicators for keyboard accessibility.',
          correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline.',
          confidence: Math.round(avgConf * 100) / 100,
          ...(a2Status === 'potential' ? {
            advisoryGuidance: 'Focus styling exists but may be too subtle. Consider using a clearer focus-visible indicator (e.g., ring-2 with offset) and ensure it is visually distinct.',
          } : {}),
        };
        
        console.log(`A2 aggregated (GitHub): ${validA2.length} → 1 card with ${a2Elements.length} elements (${a2Status})`);
      }
    }
    
    // A4 - Semantic structure (reuse same detector)
    let aggregatedA4GitHub: any = null;
    if (selectedRulesSet.has('A4')) {
      const a4Findings = detectA4SemanticStructure(allFiles);
      if (a4Findings.length > 0) {
        const confirmedCount = a4Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = a4Findings.filter(f => f.classification === 'potential').length;
        const hasConfirmed = confirmedCount > 0;
        const overallConfidence = Math.max(...a4Findings.map(f => f.confidence));
        const a4Elements = a4Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          potentialSubtype: f.classification === 'potential' ? 'borderline' as const : undefined,
          explanation: f.explanation, confidence: f.confidence, correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));
        aggregatedA4GitHub = {
          ruleId: 'A4', ruleName: 'Missing semantic structure', category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          potentialSubtype: hasConfirmed ? undefined : 'borderline',
          blocksConvergence: hasConfirmed, inputType: 'github', isA4Aggregated: true, a4Elements, evaluationMethod: 'deterministic',
          diagnosis: `Semantic structure issues: ${confirmedCount} confirmed, ${potentialCount} potential.`,
          contextualHint: 'Use semantic HTML elements to represent page hierarchy and structure.',
          correctivePrompt: 'Use semantic HTML (<h1>–<h6>, <main>, <nav>, <button>, <ul>/<ol>) for structure.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(hasConfirmed ? {} : { advisoryGuidance: 'Semantic structure may be incomplete.' }),
        };
        console.log(`A4 aggregated (GitHub): ${a4Findings.length} findings`);
      }
    }

    // A5 - Form labels
    let aggregatedA5GitHub: any = null;
    if (selectedRulesSet.has('A5')) {
      const a5Findings = detectA5FormLabels(allFiles);
      if (a5Findings.length > 0) {
        const confirmedFindings = a5Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = a5Findings.filter(f => f.classification === 'potential');
        const overallConfidence = Math.max(...a5Findings.map(f => f.confidence));
        const a5Elements = a5Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, inputSubtype: f.inputSubtype,
          role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          advisoryGuidance: f.advisoryGuidance,
          potentialSubtype: f.potentialSubtype,
          deduplicationKey: f.deduplicationKey,
        }));
        const hasConfirmed = confirmedFindings.length > 0;
        aggregatedA5GitHub = {
          ruleId: 'A5', ruleName: 'Missing form labels (Input clarity)', category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          blocksConvergence: hasConfirmed, inputType: 'github', isA5Aggregated: true, a5Elements, evaluationMethod: 'deterministic',
          diagnosis: `Form label issues: ${confirmedFindings.length} confirmed, ${potentialFindings.length} potential. WCAG 1.3.1/3.3.2 require programmatic labels.`,
          contextualHint: 'Add <label> or aria-label/aria-labelledby for form controls.',
          correctivePrompt: hasConfirmed ? 'Add visible <label> elements or aria-label/aria-labelledby for all form controls.' : undefined,
          advisoryGuidance: potentialFindings.length > 0 ? 'Review label quality: avoid generic text, duplicate labels, title-only naming, and noisy aria-labelledby.' : undefined,
          confidence: Math.round(overallConfidence * 100) / 100,
        };
        console.log(`A5 aggregated (GitHub): ${a5Findings.length} findings (${confirmedFindings.length} confirmed, ${potentialFindings.length} potential)`);
      }
    }

    // A6 - Accessible names
    let aggregatedA6GitHub: any = null;
    if (selectedRulesSet.has('A6')) {
      const a6Findings = detectA6AccessibleNames(allFiles);
      if (a6Findings.length > 0) {
        const overallConfidence = Math.max(...a6Findings.map(f => f.confidence));
        const a6Elements = a6Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));
        const a61Count = a6Findings.filter(f => f.subCheck === 'A6.1').length;
        const a62Count = a6Findings.filter(f => f.subCheck === 'A6.2').length;
        const breakdown = [
          a61Count > 0 ? `${a61Count} missing names` : '',
          a62Count > 0 ? `${a62Count} broken references` : '',
        ].filter(Boolean).join(', ');
        aggregatedA6GitHub = {
          ruleId: 'A6', ruleName: 'Missing accessible names (Name, Role, Value)', category: 'accessibility',
          status: 'confirmed', blocksConvergence: true, inputType: 'github', isA6Aggregated: true, a6Elements, evaluationMethod: 'deterministic',
          diagnosis: `Accessible name issues detected: ${a6Findings.length} confirmed (${breakdown}). WCAG 4.1.2 requires interactive elements to have programmatic accessible names.`,
          contextualHint: 'Add visible text, aria-label, or aria-labelledby to interactive elements.',
          correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements. For icon-only buttons/links, add an aria-label.',
          confidence: Math.round(overallConfidence * 100) / 100,
        };
        console.log(`A6 aggregated (GitHub): ${a6Findings.length} findings (${a61Count} missing names, ${a62Count} broken refs)`);
      }
    }

    // Filter LLM U2/U3/U4 findings if deterministic findings exist, ensure Potential
    let filteredNonA2AiViolations = nonA2AiViolations;
    if (aggregatedU2GitHubList.length > 0) {
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U2');
    } else {
      filteredNonA2AiViolations = filteredNonA2AiViolations.map((v: any) => {
        if (v.ruleId === 'U2') {
          return { ...v, status: 'potential', blocksConvergence: false, evaluationMethod: 'hybrid_llm_fallback', confidence: Math.min(v.confidence || 0.65, 0.75) };
        }
        return v;
      });
    }
    if (aggregatedU3GitHubList.length > 0) {
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U3');
    } else {
      filteredNonA2AiViolations = filteredNonA2AiViolations.map((v: any) => {
        if (v.ruleId === 'U3') {
          return { ...v, status: 'potential', blocksConvergence: false, evaluationMethod: 'hybrid_llm_fallback', confidence: Math.min(v.confidence || 0.65, 0.75) };
        }
        return v;
      });
    }

    // ========== U4 POST-PROCESSING (Recognition-to-Recall — LLM-assisted) ==========
    const aggregatedU4GitHubList: any[] = [];
    if (selectedRulesSet.has('U4')) {
      const u4FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'U4');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U4');

      if (u4FromLLM.length > 0) {
        const aggregatedOne = u4FromLLM.find((v: any) => v.isU4Aggregated && v.u4Elements?.length > 0);
        if (aggregatedOne) {
          const u4Elements = (aggregatedOne.u4Elements || []).map((el: any) => ({
            elementLabel: el.elementLabel || 'UI region',
            elementType: el.elementType || 'component',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            deduplicationKey: el.deduplicationKey || `U4|${el.location || ''}|${el.elementLabel || ''}`,
          }));
          const overallConfidence = Math.min(Math.max(...u4Elements.map((e: any) => e.confidence)), 0.80);
          aggregatedU4GitHubList.push({
            ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
            status: 'potential', blocksConvergence: false, inputType: 'github', isU4Aggregated: true, u4Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Recognition-to-recall issues: ${u4Elements.length} potential risk(s).`,
            contextualHint: aggregatedOne.contextualHint || 'Make options, labels, and actions visible to reduce reliance on user memory.',
            advisoryGuidance: 'Ensure important choices, actions, and data are visible or easily retrievable.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        } else {
          const u4Elements = u4FromLLM.map((v: any) => ({
            elementLabel: v.evidence?.split('.')[0] || 'UI region', elementType: 'component',
            location: v.evidence || 'Unknown', detection: v.diagnosis || '', evidence: v.evidence || '',
            recommendedFix: v.contextualHint || '', confidence: Math.min(v.confidence || 0.65, 0.80),
            deduplicationKey: `U4|${v.evidence || 'unknown'}`,
          }));
          const overallConfidence = Math.min(Math.max(...u4FromLLM.map((v: any) => v.confidence || 0.65)), 0.80);
          aggregatedU4GitHubList.push({
            ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
            status: 'potential', blocksConvergence: false, inputType: 'github', isU4Aggregated: true, u4Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Recognition-to-recall issues: ${u4Elements.length} potential risk(s).`,
            contextualHint: 'Make options, labels, and actions visible to reduce reliance on user memory.',
            advisoryGuidance: 'Ensure important choices, actions, and data are visible or easily retrievable.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`U4 aggregated (GitHub): ${u4FromLLM.length} LLM finding(s) → ${aggregatedU4GitHubList[0]?.u4Elements?.length || 0} element(s)`);
      }
    }

    // ========== Deterministic U5 (Insufficient Interaction Feedback) ==========
    const aggregatedU5GitHubList: any[] = [];
    if (selectedRulesSet.has('U5')) {
      const u5Findings = detectU5InteractionFeedback(allFiles);
      if (u5Findings.length > 0) {
        filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U5');

        const u5Elements = u5Findings.map((f: any) => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck,
          confidence: f.confidence,
          evaluationMethod: 'deterministic_structural' as const,
          deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u5Findings.map((f: any) => f.confidence));
        aggregatedU5GitHubList.push({
          ruleId: 'U5', ruleName: 'Insufficient interaction feedback', category: 'usability',
          status: 'potential',
          blocksConvergence: false, inputType: 'github', isU5Aggregated: true, u5Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Interaction feedback issues: ${u5Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.',
          advisoryGuidance: 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U5 aggregated (GitHub): ${u5Findings.length} findings → 1 potential violation object`);
      } else {
        filteredNonA2AiViolations = filteredNonA2AiViolations.map((v: any) => {
          if (v.ruleId === 'U5') {
            return { ...v, status: 'potential', blocksConvergence: false, evaluationMethod: 'hybrid_llm_fallback', confidence: Math.min(v.confidence || 0.65, 0.75) };
          }
          return v;
        });
        console.log('U5: No deterministic signals found (GitHub), LLM findings preserved as Potential');
      }
    }

    // ========== U6 POST-PROCESSING (Weak Grouping / Layout Coherence — LLM-assisted) ==========
    const aggregatedU6GitHubList: any[] = [];
    if (selectedRulesSet.has('U6')) {
      const u6FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'U6');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U6');

      if (u6FromLLM.length > 0) {
        const aggregatedOne = u6FromLLM.find((v: any) => v.isU6Aggregated && v.u6Elements?.length > 0);
        const u6Elements = aggregatedOne
          ? (aggregatedOne.u6Elements || []).map((el: any) => ({
              elementLabel: el.elementLabel || 'Layout region',
              elementType: el.elementType || 'section',
              location: el.location || 'Unknown',
              detection: el.detection || '',
              evidence: el.evidence || '',
              recommendedFix: el.recommendedFix || '',
              confidence: Math.min(el.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: el.deduplicationKey || `U6|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : u6FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'Layout region',
              elementType: 'section',
              location: v.evidence || 'Unknown',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || '',
              confidence: Math.min(v.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: `U6|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...u6Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedU6GitHubList.push({
          ruleId: 'U6', ruleName: 'Weak grouping / layout coherence', category: 'usability',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isU6Aggregated: true, u6Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Layout coherence issues: ${u6Elements.length} potential risk(s).`,
          contextualHint: 'Improve grouping, alignment, and spacing to clarify content relationships.',
          advisoryGuidance: 'Use consistent spacing, section headings, and visual containers to group related elements.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`U6 aggregated (GitHub): ${u6FromLLM.length} LLM finding(s) → ${u6Elements.length} element(s)`);
      } else {
        console.log('U6: No LLM findings for layout coherence (GitHub)');
      }
    }

    // ========== E1 POST-PROCESSING (Insufficient Transparency — LLM-assisted) ==========
    const aggregatedE1GitHubList: any[] = [];
    if (selectedRulesSet.has('E1')) {
      const e1FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'E1');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'E1');

      if (e1FromLLM.length > 0) {
        const aggregatedOne = e1FromLLM.find((v: any) => v.isE1Aggregated && v.e1Elements?.length > 0);
        const e1Elements = aggregatedOne
          ? (aggregatedOne.e1Elements || []).map((el: any) => ({
              elementLabel: el.elementLabel || 'High-impact action',
              elementType: el.elementType || 'action',
              location: el.location || 'Unknown',
              detection: el.detection || '',
              evidence: el.evidence || '',
              recommendedFix: el.recommendedFix || '',
              confidence: Math.min(el.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: el.deduplicationKey || `E1|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : e1FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'High-impact action',
              elementType: 'action',
              location: v.evidence || 'Unknown',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || '',
              confidence: Math.min(v.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: `E1|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...e1Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedE1GitHubList.push({
          ruleId: 'E1', ruleName: 'Insufficient transparency in high-impact actions', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isE1Aggregated: true, e1Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Transparency issues: ${e1Elements.length} potential risk(s).`,
          contextualHint: 'Ensure high-impact actions disclose consequences, costs, or data implications.',
          advisoryGuidance: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E1 aggregated (GitHub): ${e1FromLLM.length} LLM finding(s) → ${e1Elements.length} element(s)`);
      } else {
        console.log('E1: No LLM findings for transparency (GitHub)');
      }
    }

    // ========== E2 POST-PROCESSING (Imbalanced Choice Architecture — LLM-assisted) ==========
    const aggregatedE2GitHubList: any[] = [];
    if (selectedRulesSet.has('E2')) {
      const e2FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'E2');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'E2');

      if (e2FromLLM.length > 0) {
        const aggregatedOne = e2FromLLM.find((v: any) => v.isE2Aggregated && v.e2Elements?.length > 0);
        const e2Elements = aggregatedOne
          ? (aggregatedOne.e2Elements || []).map((el: any) => ({
              elementLabel: el.elementLabel || 'Choice group',
              elementType: el.elementType || 'button-group',
              location: el.location || 'Unknown',
              detection: el.detection || '',
              evidence: el.evidence || '',
              recommendedFix: el.recommendedFix || '',
              confidence: Math.min(el.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: el.deduplicationKey || `E2|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : e2FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'Choice group',
              elementType: 'button-group',
              location: v.evidence || 'Unknown',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || '',
              confidence: Math.min(v.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: `E2|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...e2Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedE2GitHubList.push({
          ruleId: 'E2', ruleName: 'Imbalanced or manipulative choice architecture', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Choice architecture issues: ${e2Elements.length} potential risk(s).`,
          contextualHint: 'Present choices with equal visual weight and neutral defaults.',
          advisoryGuidance: 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E2 aggregated (GitHub): ${e2FromLLM.length} LLM finding(s) → ${e2Elements.length} element(s)`);
      } else {
        console.log('E2: No LLM findings for choice architecture (GitHub)');
      }
    }

    // ========== E3 POST-PROCESSING (Obscured/Restricted User Control — HYBRID) ==========
    const aggregatedE3GitHubList: any[] = [];
    if (selectedRulesSet.has('E3')) {
      const deterministicE3 = e3Findings;
      const e3FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'E3');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'E3');

      const e3Elements: any[] = [];
      for (const f of deterministicE3) {
        let confidence = f.confidence;
        const llmReinforced = e3FromLLM.some((v: any) =>
          v.e3Elements?.some((el: any) => el.subCheck === f.subCheck && el.location?.includes(f.filePath.split('/').pop() || ''))
        );
        if (llmReinforced) confidence = Math.min(confidence + 0.05, 0.85);
        e3Elements.push({
          elementLabel: f.elementLabel, elementType: f.elementType, location: f.filePath,
          subCheck: f.subCheck, detection: f.detection, evidence: f.evidence,
          recommendedFix: f.recommendedFix,
          confidence: Math.min(confidence, 0.85),
          evaluationMethod: llmReinforced ? 'hybrid_structural_llm' as const : 'deterministic_structural' as const,
          deduplicationKey: f.deduplicationKey,
        });
      }
      if (e3FromLLM.length > 0) {
        const aggregatedLLM = e3FromLLM.find((v: any) => v.isE3Aggregated && v.e3Elements?.length > 0);
        if (aggregatedLLM) {
          for (const el of (aggregatedLLM.e3Elements || [])) {
            const alreadyCovered = e3Elements.some(e => e.subCheck === el.subCheck && e.location === el.location);
            if (!alreadyCovered) {
              e3Elements.push({
                elementLabel: el.elementLabel || 'Control restriction', elementType: el.elementType || 'unknown',
                location: el.location || 'Unknown', subCheck: el.subCheck,
                detection: el.detection || '', evidence: el.evidence || '',
                recommendedFix: el.recommendedFix || '',
                confidence: Math.min(el.confidence || 0.65, 0.85),
                evaluationMethod: 'hybrid_structural_llm' as const,
                deduplicationKey: el.deduplicationKey || `E3|${el.location || ''}|${el.elementLabel || ''}`,
              });
            }
          }
        }
      }
      if (e3Elements.length > 0) {
        const overallConfidence = Math.min(Math.max(...e3Elements.map((e: any) => e.confidence)), 0.85);
        aggregatedE3GitHubList.push({
          ruleId: 'E3', ruleName: 'Obscured or restricted user control', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isE3Aggregated: true, e3Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Control restriction issues: ${e3Elements.length} potential risk(s).`,
          contextualHint: 'Ensure users can easily dismiss, cancel, or opt out of actions.',
          advisoryGuidance: 'Provide clear dismissal, cancellation, or opt-out mechanisms and ensure users can easily reverse or exit actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E3 aggregated (GitHub): ${deterministicE3.length} deterministic + ${e3FromLLM.length} LLM → ${e3Elements.length} element(s)`);
      } else {
        console.log('E3: No findings for control restrictions (GitHub)');
      }
    }

    // Combine all violations
    const allViolations = [
      ...aggregatedA1Violations,
      ...filteredNonA2AiViolations,
      ...aggregatedU1GitHubList,
      ...aggregatedU2GitHubList,
      ...aggregatedU3GitHubList,
      ...aggregatedU4GitHubList,
      ...aggregatedU5GitHubList,
      ...aggregatedU6GitHubList,
      ...aggregatedE1GitHubList,
      ...aggregatedE2GitHubList,
      ...aggregatedE3GitHubList,
      ...(aggregatedA2GitHub ? [aggregatedA2GitHub] : []),
      ...(aggregatedA3GitHub ? [aggregatedA3GitHub] : []),
      ...(aggregatedA4GitHub ? [aggregatedA4GitHub] : []),
      ...(aggregatedA5GitHub ? [aggregatedA5GitHub] : []),
      ...(aggregatedA6GitHub ? [aggregatedA6GitHub] : []),
    ];
    
    // Deduplicate by ruleId
    const seenRuleStatus = new Set<string>();
    const deduplicatedViolations = allViolations.filter(v => {
      const key = `${v.ruleId}|${v.status || 'unknown'}`;
      if (seenRuleStatus.has(key)) return false;
      seenRuleStatus.add(key);
      return true;
    });
    
    console.log(`GitHub analysis complete: ${deduplicatedViolations.length} violations found`);
    
    return new Response(
      JSON.stringify({
        success: true,
        violations: deduplicatedViolations,
        passNotes: analysisResult.passNotes || {},
        filesAnalyzed: allFiles.size,
        stackDetected: stack,
        repoInfo: { owner, repo },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("GitHub analysis error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "GitHub analysis failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
