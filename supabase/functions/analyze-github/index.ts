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
interface A3Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  classificationCode: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA3KeyboardOperability(allFiles: Map<string, string>): A3Finding[] {
  const findings: A3Finding[] = [];
  const seenKeys = new Set<string>();

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const CLICK_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // A3-C1: Non-focusable custom interactive
    const tagRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*)>`, 'gi');
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      if (/tabIndex\s*=\s*\{?\s*(\d+)\s*\}?/i.test(attrs) || /tabindex\s*=\s*["'](\d+)["']/i.test(attrs)) continue;
      if (/\b(onKeyDown|onKeyUp|onKeyPress)\s*=/.test(attrs)) continue;
      if (/tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) || /tabindex\s*=\s*["']-1["']/i.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const afterTag = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();

      const label = testIdMatch?.[1] || testIdMatch?.[2] || testIdMatch?.[3]
        || ariaLabelMatch?.[1] || ariaLabelMatch?.[2]
        || titleMatch?.[1] || titleMatch?.[2]
        || (innerText && innerText.length > 0 && innerText.length <= 60 ? innerText : null)
        || `<${tag}> (clickable container)`;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const dedupeKey = `${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-C1', classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> element`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber} — missing role, tabIndex, keyboard handlers`,
        explanation: `This <${tag}> has ${triggerHandler} but lacks role, tabIndex, and keyboard event handlers. Keyboard users cannot reach or activate it.`,
        confidence: 0.92,
        correctivePrompt: `• ${label} — ${filePath}:${lineNumber}\n  element: <${tag}> (no interactive role)\n\n  Issue reason: Clickable <${tag}> with ${triggerHandler} is not focusable (no tabIndex) and has no keyboard activation handlers for Enter/Space.\n\n  Recommended fix: Replace the clickable <${tag}> with a semantic <button> or <a> element, OR add role="button", tabIndex={0}, and an onKeyDown handler that activates on Enter and Space.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A3-C2: tabindex="-1" on primary interactive
    const negTabIndexRegex = /<(button|a|input|select|textarea)\b([^>]*tabIndex\s*=\s*\{?\s*-1[^>]*)>/gi;
    while ((match = negTabIndexRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/aria-hidden\s*=\s*["']?true/i.test(attrs) || /hidden\b/.test(attrs) || /sr-only|visually-hidden|clip-path/i.test(attrs)) continue;

      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabel?.[1] || ariaLabel?.[2] || `<${tag}> element`;
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|tabindex-neg|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-C2', classification: 'confirmed',
        detection: `tabIndex={-1} on <${tag}>`,
        evidence: `<${tag} tabIndex={-1}> at ${filePath}:${lineNumber} — removed from tab order`,
        explanation: `Primary interactive <${tag}> has tabIndex={-1}, removing it from keyboard tab order.`,
        confidence: 0.90,
        correctivePrompt: `• ${label} — ${filePath}:${lineNumber}\n  element: <${tag}> (${tag})\n\n  Issue reason: Primary interactive <${tag}> has tabIndex={-1}, removing it from keyboard tab order.\n\n  Recommended fix: Remove tabIndex={-1} from the <${tag}> or provide an alternative keyboard-accessible path.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A3-P1: role="button" with tabIndex but no key handler
    const roleButtonRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*role\\s*=\\s*["']button["'][^>]*)>`, 'gi');
    while ((match = roleButtonRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!/tabIndex\s*=\s*\{?\s*[0-9]/.test(attrs) && !/tabindex\s*=\s*["'][0-9]/.test(attrs)) continue;
      if (/onKeyDown|onKeyUp|onKeyPress/.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || `<${tag} role="button">`;
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|role-nokey|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, role: 'button', sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `role="button" + tabIndex but no key handler`,
        evidence: `<${tag} role="button" tabIndex=0> at ${filePath}:${lineNumber} — missing Enter/Space activation`,
        explanation: `Has role="button" and tabIndex but no onKeyDown/onKeyUp handler. Keyboard users can focus but may not activate.`,
        confidence: 0.72,
        correctivePrompt: `• ${label} — ${filePath}:${lineNumber}\n  element: <${tag}> (role="button")\n\n  Issue reason: Has role="button" and tabIndex but no onKeyDown/onKeyUp handler. Keyboard users can focus but may not activate.\n\n  Recommended fix: Prefer native <button> or add an onKeyDown handler that activates on Enter and Space.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A3-P1: <a> without href used as button
    const anchorNoHrefRegex = /<a\b([^>]*(?:onClick|onMouseDown|onPointerDown)[^>]*)>/gi;
    while ((match = anchorNoHrefRegex.exec(content)) !== null) {
      const attrs = match[1];
      if (/href\s*=\s*(?:"(?!#")(?![^"]*javascript:)[^"]+"|'(?!#')[^']+')/.test(attrs)) continue;
      const hasHref = /href\s*=/.test(attrs);
      if (hasHref && !/href\s*=\s*["']#["']/.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || '<a> as button';
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|a-nohref|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: 'a', role: 'link', sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `<a> with onClick but no valid href`,
        evidence: `<a onClick=...${hasHref ? ' href="#"' : ''}> at ${filePath}:${lineNumber}`,
        explanation: `<a> used as button with onClick${hasHref ? ' and href="#"' : ' but no href'}. Use <button> or add role="button".`,
        confidence: 0.68,
        correctivePrompt: `• ${label} — ${filePath}:${lineNumber}\n  element: <a> (role="link")\n\n  Issue reason: <a> used as button with onClick${hasHref ? ' and href="#"' : ' but no href'}. Not a valid navigation link.\n\n  Recommended fix: Replace the <a> with a semantic <button>, or add a valid href for navigation and role="button" with key handlers.`,
        deduplicationKey: dedupeKey,
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

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const CLICK_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;

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

    // A4.1: Heading semantics
    const h1Match = content.match(/<h1\b/gi);
    if (h1Match) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.2: Interactive elements are semantic
    const tagRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*)>`, 'gi');
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      if (/tabIndex\s*=\s*\{?\s*0\s*\}?/i.test(attrs) && INTERACTIVE_ROLES.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const afterTag = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || (innerText && innerText.length <= 60 ? innerText : null) || `Clickable <${tag}>`;

      const dedupeKey = `A4.2|${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clickableNonSemantics.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        subCheck: 'A4.2', subCheckLabel: 'Interactive elements',
        classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> without ARIA role`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber}`,
        explanation: `Clickable <${tag}> with ${triggerHandler} but no semantic role (button/link). Screen readers cannot identify this as interactive.`,
        confidence: 0.95,
        correctivePrompt: `Replace clickable <${tag}> with <button> or <a>. If non-button must be used, add role="button", tabIndex="0", and Enter/Space handlers.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, number>();
    let classMatch;
    while ((classMatch = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch[1] || classMatch[2] || classMatch[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
    }
    for (const [cls, count] of classCounts) {
      if (count >= 3) {
        const hasSemanticList = /<(?:ul|ol)\b/i.test(content) || /role\s*=\s*["']list["']/i.test(content);
        if (!hasSemanticList) {
          const listDedupeKey = `A4.4|${filePath}|${cls.substring(0, 30)}`;
          if (!seenKeys.has(listDedupeKey)) {
            seenKeys.add(listDedupeKey);
            listIssues.push({
              elementLabel: `Repeated items (${count}x)`, elementType: 'div', sourceLabel: `Repeated pattern in ${componentName || filePath}`,
              filePath, componentName,
              subCheck: 'A4.4', subCheckLabel: 'Lists',
              classification: 'potential',
              detection: `${count} sibling elements with identical className, no <ul>/<ol> wrapper`,
              evidence: `Repeated class in ${filePath}: "${cls.substring(0, 60)}..."`,
              explanation: `${count} elements with the same class pattern but no semantic list (<ul>/<ol>) structure. Screen readers cannot convey the list relationship.`,
              confidence: 0.72,
              deduplicationKey: listDedupeKey,
            });
          }
        }
      }
    }
  }

  // A4.1: Post-scan heading analysis
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'confirmed',
      detection: 'No <h1> found in any source file',
      evidence: `Heading levels used: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found. Every page should have exactly one <h1> representing the page title for screen reader navigation.',
      confidence: 0.90,
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
        detection: `Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
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
      detection: `${h1Count} <h1> elements found across source files`,
      evidence: `${h1Count} <h1> tags detected`,
      explanation: `Multiple <h1> elements detected. Pages should generally have exactly one <h1> for the page title.`,
      confidence: 0.72,
      deduplicationKey: 'A4.1|multiple-h1',
    });
  }

  // A4.3: Missing landmarks
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

  findings.push(...headingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
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

### A2 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**ABSOLUTE RULE:**
If an element does NOT remove the default browser focus outline, it MUST NOT be reported under A2.
Lack of a custom focus-visible style alone is NOT an accessibility issue — browser defaults are acceptable.

**PREREQUISITE — OUTLINE REMOVAL CHECK:**
ONLY evaluate an element for A2 if it explicitly removes the default focus outline or zeroes the ring:
- \`outline-none\`, \`focus:outline-none\`, or \`focus-visible:outline-none\` is present in the class list
- OR \`ring-0\`, \`focus:ring-0\`, or \`focus-visible:ring-0\` is present
- OR \`focus:border-0\`, \`focus-visible:border-0\` is present
If the element does NOT remove the outline AND does not zero the ring/border → SKIP (do not report)

**FOCUSABILITY DETERMINATION:**
An element is ONLY considered focusable if it matches ONE of:
1. Native focusable: \`<button>\`, \`<a href="...">\`, \`<input>\`, \`<select>\`, \`<textarea>\`
2. Explicit tabIndex >= 0
3. Interactive ARIA role WITH tabIndex: \`role="button"\`, \`role="link"\`, etc.
4. onClick handler WITH keyboard handler

**CLASSIFICATION:**
- **PASS (SKIP)**: outline removed BUT has a STRONG visible replacement:
  * \`focus:ring-2\` or higher, \`focus-visible:ring-2\` or higher → PASS
  * \`ring-offset-2\` or higher → PASS
  * Border change with distinct color → PASS
  * Outline replacement (not outline-none) → PASS
- **HEURISTIC RISK (Borderline)**: outline removed AND replacement exists but is LIKELY TOO SUBTLE:
  * \`ring-1\` / \`focus:ring-1\` / \`focus-visible:ring-1\` (< 2px) → HEURISTIC
  * Muted ring color: \`ring-gray-100/200\`, \`ring-slate-100/200\`, \`ring-zinc-200\` → HEURISTIC
  * No ring offset (missing \`ring-offset-*\` or \`ring-offset-0\`) → HEURISTIC
  * \`ring-1\` + muted color + no offset → HEURISTIC
  * Background/text ONLY (\`focus:bg-*\`, \`focus:text-*\`) without ring/outline/border → HEURISTIC
  * Shadow-sm only: \`focus:shadow-sm\` without ring/outline/border → HEURISTIC
  * \`:focus\` without \`:focus-visible\` (keyboard perception risk) → HEURISTIC
  * Detection text example: "Subtle focus ring (ring-1 gray-200) without offset after outline removal — may be hard to perceive"
- **CONFIRMED**: outline removed AND NO visible replacement at all (or only ring-0/border-0). IMPORTANT: If focus is removed AND no replacement exists → ALWAYS Confirmed, NEVER Heuristic/Borderline.

**VARIANT HANDLING:**
Treat \`focus:*\` and \`focus-visible:*\` equally as valid focus styling signals. Do NOT require \`focus-visible:\` exclusively.

**FOCUS REPLACEMENT PRIORITY:**
1. Strong ring: \`focus:ring-2\` or higher, \`focus-visible:ring-2\` or higher → PASS
2. Border: \`focus:border-*\`, \`focus-visible:border-*\` with distinct color → PASS
3. Outline: \`focus-visible:outline-*\` (not outline-none) → PASS
4. Strong shadow: \`focus:shadow-md\` or larger → PASS
5. Subtle ring: \`ring-1\` with muted color and no offset → HEURISTIC RISK
6. Shadow-sm only without ring/outline/border → HEURISTIC RISK
7. Background/text ONLY → HEURISTIC RISK
8. NONE of the above → CONFIRMED (blocking)

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
${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U1').map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 3 — Ethics / Dark Patterns
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
          blocksConvergence: hasConfirmed, inputType: 'github', isA3Aggregated: true, a3Elements,
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
        typeBadge: 'Heuristic (requires runtime verification)',
      });
      
      console.log(`A1 aggregated (GitHub): ${potentialA1Elements.length} potential elements → 1 Potential card (${elements.length} unique)`);
    }
    
    // ========== A2 Focus Visibility — Aggregate from AI findings ==========
    const a2AiViolations = taggedAiViolations.filter((v: any) => v.ruleId === 'A2' || v.ruleId === 'A5');
    const nonA2AiViolations = taggedAiViolations.filter((v: any) => v.ruleId !== 'A2' && v.ruleId !== 'A3' && v.ruleId !== 'A4' && v.ruleId !== 'A5');
    
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
          const hasSubtleFocusStyling = 
            /focus(?:-visible)?:bg-|focus(?:-visible)?:text-/.test(combined) || // bg/text only
            (/(?:focus(?:-visible)?:)?ring-1\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]/.test(combined)) || // ring-1 only
            /ring-(?:gray|slate|zinc)-(?:100|200)\b/.test(combined) || // muted ring color
            (/focus(?:-visible)?:shadow-sm\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]|focus(?:-visible)?:border(?!-0)|focus(?:-visible)?:outline-(?!none)/.test(combined)) || // shadow-sm only
            (/\bfocus:(?:ring-[^0]|border-(?!0)|shadow-(?!none)|outline-(?!none))/.test(combined) && !/focus-visible:/.test(combined)); // :focus without :focus-visible
          
          const isBorderline = hasSubtleFocusStyling;
          const isConfirmed = !isBorderline;
          // Confirmed: 90-95% deterministic; Borderline: 60-75%
          const confidence = isConfirmed ? 0.92 : 0.68;
          
          const focusClasses = (combined.match(/(?:focus:|focus-visible:)?(?:outline-none|ring-0|border-0|bg-[\w-]+|ring-[\w-]+|border-[\w-]+|text-[\w-]+|shadow-[\w-]+|ring-offset-[\w-]+)/g) || []);
          
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
            focusClasses: [...new Set(focusClasses)].filter((cls, _i, arr) => {
              if (cls === 'outline-none' && arr.includes('focus:outline-none')) return false;
              if (cls === 'outline-none' && arr.includes('focus-visible:outline-none')) return false;
              if (cls === 'ring-0' && arr.includes('focus:ring-0')) return false;
              if (cls === 'border-0' && arr.includes('focus:border-0')) return false;
              return true;
            }),
            classification: isConfirmed ? 'confirmed' as const : 'potential' as const,
            potentialSubtype: isConfirmed ? undefined : 'borderline' as const,
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
          blocksConvergence: hasConfirmed, inputType: 'github', isA4Aggregated: true, a4Elements,
          diagnosis: `Semantic structure issues: ${confirmedCount} confirmed, ${potentialCount} potential.`,
          contextualHint: 'Use semantic HTML elements to represent page hierarchy and structure.',
          correctivePrompt: 'Use semantic HTML (<h1>–<h6>, <main>, <nav>, <button>, <ul>/<ol>) for structure.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(hasConfirmed ? {} : { advisoryGuidance: 'Semantic structure may be incomplete.' }),
        };
        console.log(`A4 aggregated (GitHub): ${a4Findings.length} findings`);
      }
    }

    // Combine all violations
    const allViolations = [
      ...aggregatedA1Violations,
      ...nonA2AiViolations,
      ...(aggregatedA2GitHub ? [aggregatedA2GitHub] : []),
      ...(aggregatedA3GitHub ? [aggregatedA3GitHub] : []),
      ...(aggregatedA4GitHub ? [aggregatedA4GitHub] : []),
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
