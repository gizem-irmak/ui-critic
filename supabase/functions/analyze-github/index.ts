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

interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
  offset: number;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];

  const openerRegex = /<(CardFooter|ButtonGroup|div|footer|section|nav)\b([^>]*)>/gi;
  let openerMatch;
  while ((openerMatch = openerRegex.exec(content)) !== null) {
    const tagName = openerMatch[1];
    const attrs = openerMatch[2] || '';
    const isNamedContainer = /^(CardFooter|ButtonGroup)$/i.test(tagName);

    if (!isNamedContainer) {
      const hasLayoutClass = /(?:flex|grid|gap-|justify-|items-|space-x-|space-y-)/.test(attrs);
      if (!hasLayoutClass) continue;
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
    const buttons = extractButtonUsagesFromJsx(containerContent, buttonLocalNames, openTagEnd);

    console.log(`[U1.2] container candidate: <${tagName}> (offset ${openerMatch.index}), descendant CTAs = ${buttons.length}, labels = [${buttons.map(b => b.label).join(', ')}]`);

    if (buttons.length >= 2) {
      groups.push({
        containerType,
        buttons,
        lineContext: content.slice(openerMatch.index, Math.min(openerMatch.index + 200, containerEnd)),
        offset: openerMatch.index,
      });
    }
  }

  const sorted = groups.sort((a, b) => a.offset - b.offset);
  const deduped: ActionGroup[] = [];
  for (const g of sorted) {
    const gEnd = g.offset + g.lineContext.length;
    const containedByExisting = deduped.some(d => {
      const dEnd = d.offset + d.lineContext.length;
      return d.offset <= g.offset && dEnd >= gEnd;
    });
    if (!containedByExisting) {
      for (let i = deduped.length - 1; i >= 0; i--) {
        const dEnd = deduped[i].offset + deduped[i].lineContext.length;
        if (g.offset <= deduped[i].offset && gEnd >= dEnd) {
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

    // U1.2: Check action groups for competing primaries
    const u12SuppressedLabels = new Set<string>();
    const actionGroups = extractActionGroups(content, buttonLocalNames);
    for (const group of actionGroups) {
      // Scoped suppression: skip this group if it's inside a U1.1 form
      if (isInsideU11Form(filePath, group.offset)) {
        console.log(`[U1.2] suppressed: container at offset ${group.offset} is inside U1.1 form scope in ${filePath}`);
        continue;
      }

      const ctas: Array<{ label: string; emphasis: Emphasis; styleKey: string | null }> = [];
      let usedPath = '';
      for (const btn of group.buttons) {
        // Path 1: CVA variant-based detection
        if (buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)) {
          const resolvedVariant = btn.variant || buttonImpl.config.defaultVariant || 'default';
          const classified = classifyButtonEmphasis({
            resolvedVariant,
            variantConfig: buttonImpl.config,
            instanceClassName: btn.className,
          });
          ctas.push({ label: btn.label, emphasis: classified.emphasis, styleKey: classified.styleKey });
          usedPath = 'cva';
        } else {
          // Path 2: Tailwind-token emphasis detection for plain buttons
          const twEmphasis = classifyTailwindEmphasis(btn.className);
          const styleKey = twEmphasis === 'high' ? 'tw-filled' : twEmphasis === 'low' ? 'tw-outline' : twEmphasis === 'medium' ? 'tw-secondary' : null;
          ctas.push({ label: btn.label, emphasis: twEmphasis, styleKey });
          usedPath = 'tailwind';
        }
      }

      console.log(`[U1.2] siblings found = ${ctas.length}, emphasis = [${ctas.map(c => `${c.label}:${c.emphasis}`).join(', ')}] (path=${usedPath})`);

      if (ctas.some(c => c.emphasis === 'unknown' || !c.styleKey)) continue;

      const highs = ctas.filter(c => c.emphasis === 'high');
      if (highs.length >= 2) {
        const highStyleKeys = new Set(highs.map(h => h.styleKey));
        if (highStyleKeys.size === 1) {
          const groupKey = `${filePath}|${group.containerType}`;
          if (seenU12Groups.has(groupKey)) continue;
          seenU12Groups.add(groupKey);

          const labels = ctas.map(c => c.label);
          const sharedToken = highs[0].styleKey || 'default';
          console.log(`[U1.2] fired for container = ${filePath} | ${group.containerType}`);

          // Signal-based confidence for U1.2
          let u12Confidence = 0.60;
          u12Confidence += 0.10; // same parent container (always true in ActionGroup)
          u12Confidence += 0.10; // same high-emphasis styling (highStyleKeys.size === 1)
          if (group.containerType === 'CardFooter' || /flex.*row|flex-row|gap-|space-x-/.test(group.lineContext)) {
            u12Confidence += 0.05;
          }
          const hasSemanticDiff = group.buttons.some(b => {
            const attrs = b.className || '';
            return /aria-describedby/.test(attrs);
          });
          if (!hasSemanticDiff) {
            u12Confidence += 0.05;
          }
          u12Confidence = Math.min(u12Confidence, 0.90);

          findings.push({
            subCheck: 'U1.2',
            subCheckLabel: 'Multiple equivalent CTAs',
            classification: 'potential',
            elementLabel: `${componentName} — ${group.containerType}`,
            elementType: 'button group',
            filePath,
            detection: `${highs.length} CTAs share ${usedPath === 'tailwind' ? 'Tailwind high-emphasis classes' : `variant="${sharedToken}"`}`,
            evidence: `${labels.join(', ')} — all use same high-emphasis styling (${sharedToken})`,
            explanation: `${highs.length} sibling CTA buttons share identical high-emphasis styling, making the primary action unclear.`,
            confidence: u12Confidence,
            advisoryGuidance: 'Visually distinguish the primary action and demote secondary actions to outline/ghost/link variants.',
            deduplicationKey: `U1.2|${filePath}|${group.containerType}`,
          });
          for (const cta of ctas) {
            u12SuppressedLabels.add(cta.label.trim().toLowerCase());
          }
        }
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
${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U1').map(r => `- ${r.id}: ${r.name}`).join('\n')}

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

    // Combine all violations
    const allViolations = [
      ...aggregatedA1Violations,
      ...nonA2AiViolations,
      ...aggregatedU1GitHubList,
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
