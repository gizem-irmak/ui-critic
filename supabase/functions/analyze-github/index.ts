import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rule registry for code analysis (same as analyze-zip)
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Small informational text size', diagnosis: 'WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.', correctivePrompt: 'Increase text below 13px to at least 14px (text-sm) for informational or state-indicating content. Use 16px (text-base) for primary informational content in dialogs, alerts, tooltips, and chart labels. Retain very small text only for decorative or non-essential elements. Do not alter layout structure, spacing, or component hierarchy.' },
    { id: 'A3', name: 'Insufficient line spacing', diagnosis: 'Poor spacing may reduce readability, especially for users with cognitive or visual impairments.', correctivePrompt: 'Increase line height and paragraph spacing to improve text readability.' },
    { id: 'A4', name: 'Small tap / click targets', diagnosis: 'Interactive elements do not explicitly enforce minimum tap target size (44×44 CSS px), which is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). Padding or box sizing at runtime may increase the clickable area, but static analysis cannot confirm rendered dimensions.', correctivePrompt: 'Increase interactive element dimensions to at least 44×44 CSS px using min-width and min-height constraints or equivalent padding. Apply only to elements intended for user input (buttons, icon buttons). Do not modify layout structure, visual hierarchy, or component behavior beyond interactive sizing.' },
    { id: 'A5', name: 'Poor focus visibility', diagnosis: 'Lack of visible focus reduces keyboard accessibility.', correctivePrompt: 'Ensure all interactive elements have clearly visible focus states.' },
  ],
  usability: [
    { id: 'U1', name: 'Unclear primary action', diagnosis: 'Users may struggle to identify the main action.', correctivePrompt: 'Ensure exactly one primary action per action group uses a filled/default variant (e.g., variant="default" or bg-primary). Demote other actions to outline, ghost, or link variants. If more than two secondary actions exist, consider grouping them into an overflow menu ("More" or "..."). Do not alter layout structure.' },
    { id: 'U2', name: 'Multiple competing CTAs', diagnosis: 'Competing CTAs increase cognitive load and confusion.', correctivePrompt: 'Reduce emphasis on secondary actions to ensure a single, clear primary CTA.' },
    { id: 'U3', name: 'Inconsistent typography', diagnosis: 'Typography inconsistency reduces visual coherence.', correctivePrompt: 'Use a consistent typography system with limited font families and standardized heading and body styles.' },
    { id: 'U4', name: 'Excessive color usage', diagnosis: 'Excessive color usage can reduce clarity and visual balance.', correctivePrompt: 'Limit the color palette and use color consistently to support visual hierarchy.' },
    { id: 'U5', name: 'Weak grouping or alignment', diagnosis: 'Poor grouping can reduce scannability and comprehension.', correctivePrompt: 'Improve alignment and grouping to visually associate related elements.' },
    { id: 'U6', name: 'Unclear or insufficient error feedback', diagnosis: 'Insufficient error feedback may prevent users from correcting mistakes.', correctivePrompt: 'Provide clear, descriptive error messages near relevant fields using text, not color alone.' },
    { id: 'U7', name: 'Insufficient visible interaction feedback', diagnosis: 'Users may be uncertain whether actions were registered.', correctivePrompt: 'Add visible feedback after user actions (loading indicators, confirmations, or state changes).' },
    { id: 'U8', name: 'Incomplete or unclear navigation', diagnosis: 'Users may not understand how to move between screens or recover.', correctivePrompt: 'Ensure clear navigation paths including back, forward, and cancel options.' },
    { id: 'U9', name: 'Lack of cross-page visual coherence', diagnosis: 'Inconsistency reduces learnability and confidence.', correctivePrompt: 'Ensure consistent layout, navigation placement, typography, and color usage across screens.' },
    { id: 'U10', name: 'Truncated or clipped text', diagnosis: 'Truncated text may obscure meaning.', correctivePrompt: 'Ensure all text is fully visible; adjust layout, wrapping, or container sizes.' },
    { id: 'U11', name: 'Inappropriate control type', diagnosis: 'Inappropriate controls increase cognitive effort.', correctivePrompt: 'Replace chip-based controls with clearer text-based options where meaning must be explicit.' },
    { id: 'U12', name: 'Missing confirmation for high-impact actions', diagnosis: 'Users may trigger irreversible actions accidentally.', correctivePrompt: 'Add confirmation or warning steps for irreversible or high-impact actions.' },
  ],
  ethics: [
    { id: 'E1', name: 'Monetized option visually dominant', diagnosis: 'Visual dominance may nudge unintended choices.', correctivePrompt: 'Reduce emphasis on monetized actions and ensure alternatives are equally visible.' },
    { id: 'E2', name: 'Hidden or de-emphasized opt-out', diagnosis: 'Hidden opt-outs undermine user autonomy.', correctivePrompt: 'Make opt-out options clearly visible with equal hierarchy and contrast.' },
    { id: 'E3', name: 'Misleading visual hierarchy', diagnosis: 'Hierarchy may falsely suggest mandatory actions.', correctivePrompt: 'Adjust hierarchy to accurately reflect optional vs mandatory actions.' },
    { id: 'E4', name: 'Overuse of urgency cues', diagnosis: 'Excessive urgency pressures users unfairly.', correctivePrompt: 'Reduce urgency cues and present choices neutrally.' },
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
}

function extractButtonUsagesFromJsx(content: string, buttonLocalNames: Set<string>): ButtonUsage[] {
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

    usages.push({ label, variant, className, hasOnClick });
  }

  return usages;
}

interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];
  
  const containerPatterns = [
    { regex: /<CardFooter\b([^>]*)>([\s\S]*?)<\/CardFooter>/gi, type: 'CardFooter' },
    { regex: /<(?:div|footer)\b([^>]*(?:flex|gap-|space-x-)[^>]*)>([\s\S]*?)<\/(?:div|footer)>/gi, type: 'FlexContainer' },
  ];

  for (const { regex, type } of containerPatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const containerContent = match[2] || '';
      const buttons = extractButtonUsagesFromJsx(containerContent, buttonLocalNames);
      
      if (buttons.length >= 2) {
        groups.push({
          containerType: type,
          buttons,
          lineContext: match[0].slice(0, 200),
        });
      }
    }
  }

  return groups;
}

function detectU1CompetingPrimaryActions(allFiles: Map<string, string>): {
  violation: any | null;
} {
  const resolveKnownButtonImpl = (): { filePath: string; config: CvaVariantConfig } | null => {
    const candidates = [
      'src/components/ui/button.tsx',
      'src/components/ui/button.ts',
      'components/ui/button.tsx',
      'components/ui/button.ts',
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

  if (!buttonImpl) return { violation: null };

  const findings: Array<{
    filePath: string;
    componentName: string;
    groupType: string;
    labels: string[];
    resolvedVariant: string;
  }> = [];

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (filePath.includes('components/ui/button')) continue;

    const buttonLocalNames = new Set<string>();
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*components\/ui\/button[^"']*)["']/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      const imports = importMatch[1];
      if (/\bButton\b/.test(imports)) {
        const aliasMatch = imports.match(/Button\s+as\s+(\w+)/);
        if (aliasMatch) {
          buttonLocalNames.add(aliasMatch[1]);
        } else {
          buttonLocalNames.add('Button');
        }
      }
    }

    buttonLocalNames.add('button');

    if (buttonLocalNames.size === 0) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'UnknownComponent';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const actionGroups = extractActionGroups(content, buttonLocalNames);

    for (const group of actionGroups) {
      const ctas: Array<{ label: string; emphasis: Emphasis; styleKey: string | null; resolvedVariant: string | null }> = [];

      for (const btn of group.buttons) {
        const resolvedVariant = btn.variant || buttonImpl.config.defaultVariant || 'default';
        
        const classified = classifyButtonEmphasis({
          resolvedVariant,
          variantConfig: buttonImpl.config,
          instanceClassName: btn.className,
        });

        ctas.push({
          label: btn.label,
          emphasis: classified.emphasis,
          styleKey: classified.styleKey,
          resolvedVariant,
        });
      }

      if (ctas.some((c) => c.emphasis === 'unknown' || !c.styleKey)) {
        continue;
      }

      const highs = ctas.filter((c) => c.emphasis === 'high');
      if (highs.length >= 2) {
        const highStyleKeys = new Set(highs.map((h) => h.styleKey));
        if (highStyleKeys.size === 1) {
          const labels = ctas.map((c) => c.label);
          const resolvedVariant = highs[0].resolvedVariant || buttonImpl.config.defaultVariant || 'default';
          findings.push({
            filePath,
            componentName,
            groupType: group.containerType,
            labels,
            resolvedVariant,
          });
        }
      }
    }
  }

  if (findings.length === 0) return { violation: null };

  const displayLimit = 3;
  const displayedFindings = findings.slice(0, displayLimit);
  const moreCount = findings.length - displayLimit;
  
  const evidenceLines = displayedFindings.map(f => 
    `${f.componentName} (${f.groupType}): ${f.labels.slice(0, 3).join(', ')}${f.labels.length > 3 ? '...' : ''} all use variant="${f.resolvedVariant}"`
  );
  
  if (moreCount > 0) {
    evidenceLines.push(`...and ${moreCount} more similar issues`);
  }

  const u1Rule = rules.usability.find(r => r.id === 'U1');
  
  return {
    violation: {
      ruleId: 'U1',
      ruleName: u1Rule?.name || 'Unclear primary action',
      category: 'usability',
      typeBadge: 'Confirmed (static)',
      diagnosis: `Case B detected: Multiple buttons share the same high-emphasis styling within ${findings.length} action group(s), creating competing primary actions.`,
      evidence: evidenceLines.join('\n'),
      contextualHint: 'Demote secondary actions to outline/ghost/link variants; keep exactly one primary action per group.',
      correctivePrompt: u1Rule?.correctivePrompt || 'Ensure exactly one primary action per action group.',
      confidence: 0.85,
      affected_items: findings.map(f => ({
        component_name: f.componentName,
        file_path: f.filePath,
        group_type: f.groupType,
        labels: f.labels,
        resolved_variant: f.resolvedVariant,
      })),
    },
  };
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

interface ContrastViolation {
  ruleId: string;
  ruleName: string;
  category: string;
  status: string;
  inputType: 'github' | 'zip' | 'screenshots';
  evidence?: string;
  diagnosis: string;
  contextualHint: string;
  correctivePrompt: string;
  confidence: number;
  riskLevel?: string;
  inputLimitation?: string;
  advisoryGuidance?: string;
  affectedComponents?: any[];
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
  
  // Advisory guidance for heuristic findings
  const advisoryGuidance = 'This issue is reported as a potential risk based on static analysis of GitHub repository code. ' +
    'To confirm and resolve definitively, consider uploading screenshots of the rendered UI for visual verification.';
  
  const diagnosis = `Potential WCAG AA contrast risk (GitHub static analysis): ${affectedComponents.length} text color occurrence(s) detected ` +
    `in ${displayedFiles.join(', ')}${fileMoreText} using ${displayedColors.join(', ')}${moreText}. ` +
    `Risk breakdown: ${riskBreakdown || 'low-risk'}. ` +
    `GitHub analysis cannot determine actual rendered background colors or runtime configurations. ` +
    `This finding is labeled as "Potential Risk (Heuristic)" and does not block convergence.`;
  
  // NO corrective prompt for GitHub heuristic findings
  const correctivePrompt = ''; // Empty - no mandatory corrective prompt for heuristic findings
  
  return [{
    ruleId: 'A1',
    ruleName: 'Insufficient text contrast',
    category: 'accessibility',
    status: 'potential', // Always potential for GitHub analysis
    inputType: 'github', // Explicit input type tracking
    evidence: `Text color classes detected in ${displayedFiles.join(', ')}${fileMoreText}: ${displayedColors.join(', ')}${moreText}. Background color cannot be determined from static analysis.`,
    diagnosis,
    contextualHint: `Light text colors may be insufficient for informational text on light backgrounds.`,
    correctivePrompt,
    confidence: overallConfidence,
    riskLevel: overallRiskLevel,
    inputLimitation,
    advisoryGuidance,
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

function buildCodeAnalysisPrompt(selectedRules: string[]) {
  const selectedRulesSet = new Set(selectedRules);
  const accessibilityRulesWithoutA1 = rules.accessibility.filter(r => r.id !== 'A1' && selectedRulesSet.has(r.id));
  
  return `You are an expert UI/UX code auditor performing static analysis of source code from a GitHub repository.

## IMPORTANT: STATIC ANALYSIS CONTEXT
This code is being analyzed from a GitHub repository. You do NOT have access to:
- Runtime rendering
- Computed styles
- DOM measurements
- User interactions

All findings must be classified as:
- "Confirmed (static)" - When the issue is clearly evident from code patterns
- "Heuristic (requires runtime verification)" - When the issue might exist but needs runtime confirmation

## PASS 1 — Accessibility (WCAG AA) - Static Code Analysis
NOTE: A1 (text contrast) is analyzed separately. Do NOT report A1 violations.

Accessibility rules to check:
${accessibilityRulesWithoutA1.map(r => `- ${r.id}: ${r.name} - ${r.diagnosis}`).join('\n')}

### A2 Detection:
- VIOLATION: text-xs (<13px) for informational content
- WARNING: 13-14px text
- Skip text-sm (14px) and larger

### A4 Detection:
- Flag elements without explicit 44×44px minimum
- Classify as "Heuristic (requires runtime verification)"
- Size tokens: h-8 (~32px), h-9 (~36px), h-10 (~40px)

### A5 Detection:
- Only flag elements that REMOVE default outline (outline-none)
- AND lack visible focus replacement (ring, border, shadow)

## PASS 2 — Usability
${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U1').map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 3 — Ethics / Dark Patterns
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## Response Format
Return ONLY valid JSON:
{
  "violations": [
    {
      "ruleId": "A2",
      "ruleName": "Small informational text size",
      "category": "accessibility",
      "typeBadge": "Confirmed (static)" or "Heuristic (requires runtime verification)",
      "diagnosis": "...",
      "evidence": "...",
      "contextualHint": "...",
      "confidence": 0.0-1.0
    }
  ],
  "passNotes": {
    "accessibility": "Summary of accessibility findings...",
    "usability": "Summary of usability findings...",
    "ethics": "Summary of ethics findings..."
  }
}`;
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
    
    // U1 - Competing primary actions
    let u1Violation = null;
    if (selectedRulesSet.has('U1')) {
      const u1Result = detectU1CompetingPrimaryActions(allFiles);
      u1Violation = u1Result.violation;
      console.log(`U1 analysis: ${u1Violation ? '1 violation' : 'no violations'}`);
    }
    
    // Build code content for AI analysis
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
        ...(u1Violation ? [u1Violation] : []),
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
    
    const systemPrompt = buildCodeAnalysisPrompt(selectedRules || []);
    const userPrompt = `Analyze this ${stack} codebase from GitHub repository "${owner}/${repo}":\n\n${codeContent}`;
    
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
        ...(u1Violation ? [u1Violation] : []),
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
    const taggedAiViolations = aiViolations.map((v: any) => ({
      ...v,
      typeBadge: v.typeBadge || "Heuristic (requires runtime verification)",
      correctivePrompt: v.correctivePrompt || 
        rules.accessibility.find(r => r.id === v.ruleId)?.correctivePrompt ||
        rules.usability.find(r => r.id === v.ruleId)?.correctivePrompt ||
        rules.ethics.find(r => r.id === v.ruleId)?.correctivePrompt ||
        "Review and address this issue.",
    }));
    
    // Combine all violations
    const allViolations = [
      ...contrastViolations.map(v => ({ ...v, typeBadge: "Heuristic (requires runtime verification)" })),
      ...(u1Violation ? [u1Violation] : []),
      ...taggedAiViolations,
    ];
    
    // Deduplicate by ruleId
    const seenRules = new Set<string>();
    const deduplicatedViolations = allViolations.filter(v => {
      if (seenRules.has(v.ruleId)) return false;
      seenRules.add(v.ruleId);
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
