import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  filterPath as pFilterPath,
  shouldIncludePath as pShouldIncludePath,
  normalizePath as pNormalizePath,
  normalizeContent as pNormalizeContent,
  computeSnapshotHash as pComputeSnapshotHash,
  buildSnapshot as pBuildSnapshot,
  logParityDiagnostics as pLogParityDiagnostics,
  isLfsPointer as pIsLfsPointer,
  isSubmodulePointer as pIsSubmodulePointer,
  hasHighReplacementRatio as pHasHighReplacementRatio,
  PER_FILE_SIZE_CAP,
  TOTAL_SIZE_CAP,
  type ExcludedFile,
} from '../_shared/projectSnapshot.ts';

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

// NOTE: Legacy filter lists removed — all filtering now uses shared shouldIncludePath() from projectSnapshot.ts

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

// Legacy isAnalyzableFile removed — all filtering uses pFilterPath from projectSnapshot.ts


// Fetch repository tree from GitHub API
async function fetchRepoTree(owner: string, repo: string): Promise<{ tree: GitHubFile[]; branch: string; commitSha: string; truncated: boolean }> {
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
  
  return { tree: treeData.tree, branch: defaultBranch, commitSha: treeData.sha, truncated: treeData.truncated };
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

// --- U1 NAV/CHROME EXCLUSION GATE ---
function isNavOrChromeFile(filePath: string, content: string): boolean {
  const fp = filePath.toLowerCase();
  if (/\b(layout|navbar|nav|sidebar|header|menu|navigation|topbar|appbar|toolbar)\b/i.test(fp.split('/').pop() || '')) return true;
  if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) {
    const linkCount = (content.match(/<Link\b|<a\b[^>]*href\s*=|to\s*=\s*["']/gi) || []).length;
    const buttonCount = (content.match(/<(?:button|Button)\b/gi) || []).length;
    if (linkCount > 0 && linkCount >= buttonCount) return true;
  }
  if (/\b(navItems|menuItems|sidebarItems|navigationItems|navLinks|menuLinks)\b/.test(content)) return true;
  return false;
}

// --- U1 PRIMARY-ACTION CONTEXT GATE ---
function hasPrimaryActionContext(content: string): boolean {
  if (/<form\b/i.test(content)) return true;
  if (/onSubmit\s*=/i.test(content)) return true;
  if (/type\s*=\s*["']submit["']/i.test(content)) return true;
  if (/\b(handleSubmit|handleSave|handleConfirm|handleContinue|handleNextStep)\b/.test(content)) return true;
  if (/<(?:Dialog|Modal|AlertDialog|Confirm|Sheet|Drawer)\b/i.test(content)) return true;
  if (/(?:DialogFooter|ModalFooter|DialogActions)\b/.test(content)) return true;
  const CTA_KEYWORDS = /\b(save|submit|continue|next|confirm|delete|remove|pay|checkout|create|publish)\b/i;
  const buttonContentMatches = content.match(/<(?:button|Button)\b[^>]*>([^<]*)</gi) || [];
  let ctaCount = 0;
  for (const m of buttonContentMatches) {
    const textMatch = m.match(/>([^<]+)/);
    if (textMatch && CTA_KEYWORDS.test(textMatch[1])) ctaCount++;
  }
  if (ctaCount >= 1) return true;
  return false;
}

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
    if (isNavOrChromeFile(filePath, content)) continue;

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
    if (isNavOrChromeFile(filePath, content)) {
      console.log(`[U1] nav/chrome gate: skipping ${filePath}`);
      continue;
    }
    if (!hasPrimaryActionContext(content)) {
      console.log(`[U1] context gate: skipping ${filePath} (no form/dialog/CTA context)`);
      continue;
    }

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
    // Context-aware suppression: detect stepper, strong headings, single primary CTA
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);

    // Pre-compute context signals for U1.3 suppression
    const u13ContextSignals = detectU13ContextSignals(content, allButtons, buttonImpl);

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

        // Context-aware suppression: suppress if labeled stepper or strong heading present
        if (u13ContextSignals.hasLabeledStepper || u13ContextSignals.hasStrongNearbyHeading(btn.offset)) {
          console.log(`[U1.3] context-suppressed: "${btn.label}" in ${filePath} — stepper=${u13ContextSignals.hasLabeledStepper}, heading=${u13ContextSignals.hasStrongNearbyHeading(btn.offset)}`);
          continue;
        }

        // Signal-based confidence for U1.3
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.40;
        if (HIGH_RISK_GENERICS.has(labelLower)) {
          u13Confidence += 0.10;
        }
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) {
          u13Confidence += 0.10;
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
        if (!u13ContextSignals.isSinglePrimaryCTA) {
          u13Confidence += 0.05;
        }
        u13Confidence = Math.min(u13Confidence, 0.75);

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

// ========== A1 FULL CONTRAST ANALYSIS (PARITY WITH ZIP) ==========
// Tailwind color mappings — full default palette (shared with ZIP)
const TAILWIND_COLORS: Record<string, string> = {
  'white': '#ffffff', 'black': '#000000',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a',
  'zinc-600': '#52525b', 'zinc-700': '#3f3f46', 'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',
  'neutral-50': '#fafafa', 'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5',
  'neutral-300': '#d4d4d4', 'neutral-400': '#a3a3a3', 'neutral-500': '#737373',
  'neutral-600': '#525252', 'neutral-700': '#404040', 'neutral-800': '#262626', 'neutral-900': '#171717', 'neutral-950': '#0a0a0a',
  'stone-50': '#fafaf9', 'stone-100': '#f5f5f4', 'stone-200': '#e7e5e4',
  'stone-300': '#d6d3d1', 'stone-400': '#a8a29e', 'stone-500': '#78716c',
  'stone-600': '#57534e', 'stone-700': '#44403c', 'stone-800': '#292524', 'stone-900': '#1c1917', 'stone-950': '#0c0a09',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca',
  'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444',
  'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b', 'red-900': '#7f1d1d', 'red-950': '#450a0a',
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa',
  'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316',
  'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412', 'orange-900': '#7c2d12', 'orange-950': '#431407',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a',
  'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b',
  'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a',
  'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308',
  'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e', 'yellow-900': '#713f12', 'yellow-950': '#422006',
  'lime-50': '#f7fee7', 'lime-100': '#ecfccb', 'lime-200': '#d9f99d',
  'lime-300': '#bef264', 'lime-400': '#a3e635', 'lime-500': '#84cc16',
  'lime-600': '#65a30d', 'lime-700': '#4d7c0f', 'lime-800': '#3f6212', 'lime-900': '#365314', 'lime-950': '#1a2e05',
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e',
  'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534', 'green-900': '#14532d', 'green-950': '#052e16',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981',
  'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46', 'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-200': '#99f6e4',
  'teal-300': '#5eead4', 'teal-400': '#2dd4bf', 'teal-500': '#14b8a6',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', 'teal-800': '#115e59', 'teal-900': '#134e4a', 'teal-950': '#042f2e',
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-200': '#a5f3fc',
  'cyan-300': '#67e8f9', 'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2', 'cyan-700': '#0e7490', 'cyan-800': '#155e75', 'cyan-900': '#164e63', 'cyan-950': '#083344',
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-200': '#bae6fd',
  'sky-300': '#7dd3fc', 'sky-400': '#38bdf8', 'sky-500': '#0ea5e9',
  'sky-600': '#0284c7', 'sky-700': '#0369a1', 'sky-800': '#075985', 'sky-900': '#0c4a6e', 'sky-950': '#082f49',
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',
  'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-200': '#c7d2fe',
  'indigo-300': '#a5b4fc', 'indigo-400': '#818cf8', 'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5', 'indigo-700': '#4338ca', 'indigo-800': '#3730a3', 'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-200': '#ddd6fe',
  'violet-300': '#c4b5fd', 'violet-400': '#a78bfa', 'violet-500': '#8b5cf6',
  'violet-600': '#7c3aed', 'violet-700': '#6d28d9', 'violet-800': '#5b21b6', 'violet-900': '#4c1d95', 'violet-950': '#2e1065',
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff',
  'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7',
  'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8', 'purple-900': '#581c87', 'purple-950': '#3b0764',
  'fuchsia-50': '#fdf4ff', 'fuchsia-100': '#fae8ff', 'fuchsia-200': '#f5d0fe',
  'fuchsia-300': '#f0abfc', 'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef',
  'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf', 'fuchsia-800': '#86198f', 'fuchsia-900': '#701a75', 'fuchsia-950': '#4a044e',
  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8',
  'pink-300': '#f9a8d4', 'pink-400': '#f472b6', 'pink-500': '#ec4899',
  'pink-600': '#db2777', 'pink-700': '#be185d', 'pink-800': '#9d174d', 'pink-900': '#831843', 'pink-950': '#500724',
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3',
  'rose-300': '#fda4af', 'rose-400': '#fb7185', 'rose-500': '#f43f5e',
  'rose-600': '#e11d48', 'rose-700': '#be123c', 'rose-800': '#9f1239', 'rose-900': '#881337', 'rose-950': '#4c0519',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(hex1: string, hex2: string): number | null {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return null;
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isValidHexColor(hex: string | null | undefined): hex is string {
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
}

function alphaComposite(fgHex: string, bgHex: string, alpha: number): string | null {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const r = Math.round(fg.r * alpha + bg.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + bg.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + bg.b * (1 - alpha));
  return '#' + [r, g, b].map(c => Math.min(255, c).toString(16).padStart(2, '0')).join('');
}

const VARIANT_PREFIXES = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited',
  'disabled', 'dark', 'group-hover', 'group-focus', 'peer-hover', 'peer-focus',
  'first', 'last', 'odd', 'even', 'placeholder', 'selection', 'marker',
  'before', 'after', 'sm', 'md', 'lg', 'xl', '2xl',
]);

type A1FgSource = 'tailwind_token' | 'inline_style';
type A1BgSource = 'tailwind_token' | 'inline_style' | 'unresolved';
type A1EvidenceLevel = 'structural_deterministic' | 'structural_estimated';
type A1SizeStatus = 'normal' | 'large' | 'unknown';

function normalizeHex(hex: string): string {
  hex = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  return hex;
}

function rgbStringToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (!m) return null;
  const r = Math.min(255, parseInt(m[1]));
  const g = Math.min(255, parseInt(m[2]));
  const b = Math.min(255, parseInt(m[3]));
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function parseCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return normalizeHex(v);
  if (v.startsWith('rgb')) return rgbStringToHex(v);
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', transparent: '', inherit: '' };
  if (named[v] !== undefined) return named[v] || null;
  return null;
}

interface InlineStyleColors { fg: string | null; bg: string | null; }

function extractInlineStyleColors(tagContent: string): InlineStyleColors {
  let fg: string | null = null;
  let bg: string | null = null;
  const jsxStyleMatch = tagContent.match(/style\s*=\s*\{\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}/);
  if (jsxStyleMatch) {
    const inner = jsxStyleMatch[1];
    const colorM = inner.match(/\bcolor\s*:\s*["']([^"']+)["']/);
    if (colorM) fg = parseCssColor(colorM[1]);
    const bgColorM = inner.match(/backgroundColor\s*:\s*["']([^"']+)["']/);
    if (bgColorM) bg = parseCssColor(bgColorM[1]);
  }
  if (!fg && !bg) {
    const htmlStyleMatch = tagContent.match(/style\s*=\s*"([^"]+)"/);
    if (htmlStyleMatch) {
      const styleStr = htmlStyleMatch[1];
      const colorM = styleStr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (colorM) fg = parseCssColor(colorM[1]);
      const bgColorM = styleStr.match(/background-color\s*:\s*([^;]+)/);
      if (bgColorM) bg = parseCssColor(bgColorM[1]);
    }
  }
  return { fg, bg };
}

interface A1TokenFinding {
  fgHex: string | null; fgClass: string; fgSource: A1FgSource;
  bgHex: string | null; bgClass: string | null; bgSource: A1BgSource;
  ratio: number | null; threshold: 4.5 | 3.0; sizeStatus: A1SizeStatus;
  evidenceLevel: A1EvidenceLevel; filePath: string; componentName?: string;
  elementContext?: string; jsxTag?: string; context: string; occurrence_count: number;
  textType: 'normal' | 'large'; appliedThreshold: 4.5 | 3.0; wcagCriterion: '1.4.3';
  variant?: string; variantName?: string; alpha?: number;
  lineNumber?: number; startLine?: number | null; endLine?: number | null;
  extractedClasses?: string; fgResolved: boolean; bgResolved: boolean; bgUnresolvedReason?: string;
}

const A1_TEXT_TAGS = new Set([
  'p', 'span', 'a', 'label', 'li', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'button', 'input', 'textarea',
  'strong', 'em', 'b', 'i', 'small', 'sub', 'sup',
  'blockquote', 'q', 'cite', 'abbr', 'code', 'pre',
  'dt', 'dd', 'figcaption', 'legend', 'caption',
  'summary', 'mark', 'time', 'address',
]);

const A1_EXCLUDED_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'use', 'defs', 'clipPath', 'mask', 'image']);

function extractLucideImports(code: string): Set<string> {
  const icons = new Set<string>();
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g;
  let m;
  while ((m = importRegex.exec(code)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
    for (const name of names) icons.add(name);
  }
  return icons;
}

function isTextElement(jsxTag: string | undefined, lucideIcons: Set<string>): boolean {
  if (!jsxTag) return true;
  const tagLower = jsxTag.toLowerCase();
  if (A1_EXCLUDED_TAGS.has(tagLower)) return false;
  if (lucideIcons.has(jsxTag)) return false;
  if (/^[a-z]/.test(jsxTag)) return A1_TEXT_TAGS.has(tagLower);
  const lastSegment = jsxTag.split('.').pop()!;
  const textSegments = /^(Title|Description|Header|Label|Text|Caption|Name|Heading|Content|Footer|Subtitle)$/i;
  if (textSegments.test(lastSegment)) return true;
  return true;
}

const TW_COLOR_FAMILIES = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';

function extractJsxTag(code: string, matchIndex: number): string | undefined {
  const scanStart = Math.max(0, matchIndex - 500);
  const before = code.slice(scanStart, matchIndex);
  const tagMatches = [...before.matchAll(/<([a-zA-Z][a-zA-Z0-9.]*)\s/g)];
  if (tagMatches.length > 0) return tagMatches[tagMatches.length - 1][1];
  return undefined;
}

function extractTextColorTokens(code: string): Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string; variant?: string; alpha?: number }> {
  const results: Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string; variant?: string; alpha?: number }> = [];
  const textColorRegex = new RegExp(`text-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?`, 'g');
  let match;
  while ((match = textColorRegex.exec(code)) !== null) {
    const colorClass = match[0];
    const colorName = match[1] + (match[2] ? `-${match[2]}` : '');
    const alphaRaw = match[3] ? parseInt(match[3]) : undefined;
    const alpha = alphaRaw !== undefined ? alphaRaw / 100 : undefined;
    let variant: string | undefined;
    if (match.index > 0 && code[match.index - 1] === ':') {
      let vEnd = match.index - 1;
      let vStart = vEnd - 1;
      while (vStart >= 0 && /[\w-]/.test(code[vStart])) vStart--;
      vStart++;
      const variantName = code.slice(vStart, vEnd);
      if (variantName && VARIANT_PREFIXES.has(variantName)) variant = variantName;
    }
    const start = Math.max(0, match.index - 100);
    const end = Math.min(code.length, match.index + colorClass.length + 100);
    const context = code.slice(start, end).replace(/\n/g, ' ').trim();
    const jsxTag = extractJsxTag(code, match.index);
    results.push({ colorClass, colorName, context, matchIndex: match.index, jsxTag, variant, alpha });
  }
  return results;
}

function findContainingTagClasses(code: string, textMatchIndex: number): { tagStart: number; tagEnd: number; classes: string; tagName: string; tagContent: string } | null {
  let i = textMatchIndex;
  while (i >= 0 && code[i] !== '<') i--;
  if (i < 0) return null;
  const tagStart = i;
  const tagNameMatch = code.slice(tagStart).match(/^<\s*([A-Za-z][A-Za-z0-9_.]*)/);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1];
  let j = tagStart + 1;
  let braceDepth = 0;
  let inString: string | null = null;
  while (j < code.length) {
    const ch = code[j];
    if (inString) { if (ch === inString && code[j - 1] !== '\\') inString = null; }
    else if (braceDepth > 0) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '"' || ch === "'" || ch === '`') inString = ch;
    } else {
      if (ch === '{') braceDepth++;
      else if (ch === '>' || (ch === '/' && j + 1 < code.length && code[j + 1] === '>')) {
        const tagEnd = ch === '/' ? j + 2 : j + 1;
        const tagContent = code.slice(tagStart, tagEnd);
        const classMatch = tagContent.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/);
        const classes = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
        return { tagStart, tagEnd, classes, tagName, tagContent };
      }
      else if (ch === '"' || ch === "'" || ch === '`') inString = ch;
    }
    j++;
  }
  return null;
}

function extractTagContent(code: string, pos: number): string | null {
  let end = pos + 1;
  let bd = 0;
  let inStr: string | null = null;
  while (end < code.length) {
    const ch = code[end];
    if (inStr) { if (ch === inStr && code[end - 1] !== '\\') inStr = null; }
    else if (bd > 0) {
      if (ch === '{') bd++;
      else if (ch === '}') bd--;
      else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    } else {
      if (ch === '{') bd++;
      else if (ch === '>' || (ch === '/' && end + 1 < code.length && code[end + 1] === '>')) {
        return code.slice(pos, end + (ch === '/' ? 2 : 1));
      }
      else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    }
    end++;
  }
  return null;
}

function extractBgFromClasses(classes: string): { bgClass: string; bgName: string } | null {
  const bgRegex = new RegExp(`^bg-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?$`);
  const tokens = classes.split(/\s+/);
  for (const token of tokens) {
    if (token.includes(':')) continue;
    const m = token.match(bgRegex);
    if (m) return { bgClass: m[0], bgName: m[1] + (m[2] ? `-${m[2]}` : '') };
  }
  return null;
}

function findAncestorBg(code: string, tagStart: number): { bgClass: string; bgName: string; bgSourceType: 'ancestor' } | null {
  let pos = tagStart - 1;
  let depth = 0;
  while (pos >= 0) {
    if (code[pos] === '>') {
      let closeScan = pos - 1;
      while (closeScan >= 0 && code[closeScan] !== '<') closeScan--;
      if (closeScan >= 0 && closeScan + 1 < code.length && code[closeScan + 1] === '/') {
        depth++;
        pos = closeScan - 1;
        continue;
      }
    }
    if (code[pos] === '<' && pos + 1 < code.length && code[pos + 1] !== '/' && code[pos + 1] !== '!') {
      if (depth > 0) { depth--; pos--; continue; }
      const tagNameM = code.slice(pos).match(/^<\s*([A-Za-z][A-Za-z0-9_.]*)/);
      if (tagNameM) {
        let end = pos + 1;
        let bd = 0;
        let inStr: string | null = null;
        while (end < code.length) {
          const ch = code[end];
          if (inStr) { if (ch === inStr && code[end - 1] !== '\\') inStr = null; }
          else if (bd > 0) {
            if (ch === '{') bd++;
            else if (ch === '}') bd--;
            else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
          } else {
            if (ch === '{') bd++;
            else if (ch === '>' || (ch === '/' && end + 1 < code.length && code[end + 1] === '>')) break;
            else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
          }
          end++;
        }
        const tagStr = code.slice(pos, end + 1);
        const classM = tagStr.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/);
        const classes = classM ? (classM[1] || classM[2] || classM[3] || '') : '';
        const bg = extractBgFromClasses(classes);
        if (bg) return { ...bg, bgSourceType: 'ancestor' };
      }
      pos--;
      continue;
    }
    pos--;
  }
  return null;
}

function findAncestorInlineBg(code: string, tagStart: number): string | null {
  let pos = tagStart - 1;
  let depth = 0;
  while (pos >= 0) {
    if (code[pos] === '>') {
      let closeScan = pos - 1;
      while (closeScan >= 0 && code[closeScan] !== '<') closeScan--;
      if (closeScan >= 0 && closeScan + 1 < code.length && code[closeScan + 1] === '/') {
        depth++;
        pos = closeScan - 1;
        continue;
      }
    }
    if (code[pos] === '<' && pos + 1 < code.length && code[pos + 1] !== '/' && code[pos + 1] !== '!') {
      if (depth > 0) { depth--; pos--; continue; }
      const tc = extractTagContent(code, pos);
      if (tc) {
        const inlineColors = extractInlineStyleColors(tc);
        if (inlineColors.bg) return inlineColors.bg;
      }
      pos--;
      continue;
    }
    pos--;
  }
  return null;
}

function resolveBackground(code: string, textMatchIndex: number): { bgClass: string | null; bgName: string | null; bgSourceType: 'self' | 'ancestor' | 'unresolved'; inlineBgHex?: string } {
  const containingTag = findContainingTagClasses(code, textMatchIndex);
  if (containingTag) {
    const selfBg = extractBgFromClasses(containingTag.classes);
    if (selfBg) return { bgClass: selfBg.bgClass, bgName: selfBg.bgName, bgSourceType: 'self' };
    const selfInline = extractInlineStyleColors(containingTag.tagContent);
    if (selfInline.bg) return { bgClass: null, bgName: null, bgSourceType: 'self', inlineBgHex: selfInline.bg };
    const ancestorBg = findAncestorBg(code, containingTag.tagStart);
    if (ancestorBg) return { bgClass: ancestorBg.bgClass, bgName: ancestorBg.bgName, bgSourceType: ancestorBg.bgSourceType };
    const ancestorInlineBg = findAncestorInlineBg(code, containingTag.tagStart);
    if (ancestorInlineBg) return { bgClass: null, bgName: null, bgSourceType: 'ancestor', inlineBgHex: ancestorInlineBg };
  }
  return { bgClass: null, bgName: null, bgSourceType: 'unresolved' };
}

function inferTextSize(context: string): A1SizeStatus {
  if (/text-(3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(context)) return 'large';
  if (/text-2xl\b/.test(context) && /font-(bold|extrabold|black|semibold)\b/.test(context)) return 'large';
  if (/<h[12]\b/.test(context.toLowerCase())) return 'large';
  if (/text-(xs|sm)\b/.test(context)) return 'normal';
  if (/<(p|span|label|td|li)\b/.test(context.toLowerCase())) return 'normal';
  return 'unknown';
}

function inferElementContext(context: string): string | null {
  const lowerContext = context.toLowerCase();
  if (lowerContext.includes('button')) return 'button text';
  if (lowerContext.includes('label')) return 'form label';
  if (lowerContext.includes('error') || lowerContext.includes('alert')) return 'error or alert message';
  if (lowerContext.includes('success')) return 'success message';
  if (lowerContext.includes('warning')) return 'warning message';
  if (lowerContext.includes('badge')) return 'badge or tag';
  if (lowerContext.includes('nav')) return 'navigation item';
  if (lowerContext.includes('header')) return 'header text';
  if (lowerContext.includes('footer')) return 'footer text';
  if (lowerContext.includes('card')) return 'card content';
  if (lowerContext.includes('input') || lowerContext.includes('placeholder')) return 'input placeholder or helper text';
  if (lowerContext.includes('link') || lowerContext.includes('<a')) return 'link text';
  if (lowerContext.includes('caption') || lowerContext.includes('description')) return 'caption or description text';
  return null;
}

interface ContrastViolation {
  ruleId: string; ruleName: string; category: string;
  status: 'confirmed' | 'potential'; samplingMethod: 'pixel' | 'inferred';
  inputType: 'zip' | 'github' | 'screenshots';
  contrastRatio?: number; thresholdUsed?: 4.5 | 3.0;
  foregroundHex?: string; backgroundHex?: string;
  foreground?: { value: string | null; resolved: boolean };
  background?: { value: string | null; resolved: boolean; reason?: string };
  note?: string; elementDescription?: string; elementIdentifier?: string;
  evidence: string; diagnosis: string; contextualHint: string; correctivePrompt: string;
  confidence: number; riskLevel?: 'high' | 'medium' | 'low';
  potentialRiskReason?: string; inputLimitation?: string; advisoryGuidance?: string;
  reasonCodes?: string[]; backgroundStatus?: 'certain' | 'uncertain' | 'unmeasurable';
  blocksConvergence?: boolean;
  fgSource?: A1FgSource; bgSource?: A1BgSource; evidenceLevel?: A1EvidenceLevel;
  sizeStatus?: A1SizeStatus; variant?: string; variantName?: string;
  lineNumber?: number; startLine?: number | null; endLine?: number | null;
  extractedClasses?: string;
  affectedComponents?: Array<{
    colorClass: string; hexColor?: string; filePath: string;
    componentName?: string; elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low'; occurrence_count: number;
  }>;
}

// ========== A1 FULL ANALYSIS (identical to ZIP) ==========
function analyzeContrastInCode(files: Map<string, string>): ContrastViolation[] {
  const a1Findings: A1TokenFinding[] = [];

  for (const [filepath, content] of files) {
    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const lucideIcons = extractLucideImports(content);

    const lineOffsets: number[] = [0];
    for (let ci = 0; ci < content.length; ci++) {
      if (content[ci] === '\n') lineOffsets.push(ci + 1);
    }
    const getLineNumber = (idx: number): number => {
      let lo = 0, hi = lineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineOffsets[mid] <= idx) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };

    // CVA / variant-driven design-system components
    const isDesignSystemComponent = /src\/components\/ui\/.+\.(tsx|jsx)$/i.test(filepath);
    const cvaConfig = isDesignSystemComponent ? extractCvaVariantConfigRegex(content) : null;

    if (isDesignSystemComponent && cvaConfig) {
      let hasResolvedVariantPair = false;
      for (const [variantName, variantClasses] of Object.entries(cvaConfig.variantClassMap)) {
        const textTokens = extractTextColorTokens(variantClasses).filter(t => !t.variant);
        const fgToken = textTokens[0];
        const bgToken = extractBgFromClasses(variantClasses);
        const fgHex = fgToken ? (TAILWIND_COLORS[fgToken.colorName] || null) : null;
        const bgHex = bgToken ? (TAILWIND_COLORS[bgToken.bgName] || null) : null;
        const fgResolved = isValidHexColor(fgHex);
        const bgResolved = isValidHexColor(bgHex);
        if (!fgResolved || !bgResolved) continue;
        hasResolvedVariantPair = true;
        const sizeStatus = inferTextSize(variantClasses);
        const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
        const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
        const ratio = getContrastRatio(fgHex, bgHex);
        if (ratio === null || ratio >= threshold) continue;
        const variantIdx = content.indexOf(variantClasses);
        const line = variantIdx >= 0 ? getLineNumber(variantIdx) : undefined;
        a1Findings.push({
          fgHex, fgClass: fgToken?.colorClass || 'text-*', fgSource: 'tailwind_token',
          bgHex, bgClass: bgToken?.bgClass || null, bgSource: 'tailwind_token',
          ratio, threshold, sizeStatus, evidenceLevel: 'structural_deterministic',
          filePath: filepath, componentName: componentName || undefined,
          elementContext: inferElementContext(variantClasses) || undefined,
          context: variantClasses, occurrence_count: 1, textType, appliedThreshold: threshold,
          wcagCriterion: '1.4.3', variantName, lineNumber: line,
          startLine: line ?? null, endLine: line ?? null,
          extractedClasses: variantClasses, fgResolved: true, bgResolved: true,
        });
      }
      if (!hasResolvedVariantPair) {
        console.log(`[A1] suppressed: unresolved component styles (${filepath})`);
      }
      continue;
    }

    const pushFinding = (finding: A1TokenFinding) => { a1Findings.push(finding); };
    const textTokens = extractTextColorTokens(content);

    // BASE STATE PASS
    for (const { colorClass, colorName, context, matchIndex, jsxTag, variant, alpha } of textTokens) {
      if (variant) continue;
      const fgHexRaw = TAILWIND_COLORS[colorName] || null;
      if (!fgHexRaw) continue;
      if (!isTextElement(jsxTag, lucideIcons)) continue;

      const ternaryWindow = content.slice(Math.max(0, matchIndex - 200), Math.min(content.length, matchIndex + 200));
      const isInsideTernary = /\?\s*["'`][^"'`]*$/.test(content.slice(Math.max(0, matchIndex - 200), matchIndex)) ||
        /\?\s*["'`]/.test(ternaryWindow) && /:\s*["'`]/.test(ternaryWindow);

      let bgHex: string | null = null;
      let bgClass: string | null = null;
      let bgSource: A1BgSource = 'unresolved';

      if (!isInsideTernary) {
        const resolved = resolveBackground(content, matchIndex);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName]; bgClass = resolved.bgClass; bgSource = 'tailwind_token';
        }
      }

      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;

      let effectiveFgHex: string | null = fgHexRaw;
      if (alpha !== undefined && alpha < 1 && isValidHexColor(fgHexRaw) && isValidHexColor(bgHex)) {
        const composited = alphaComposite(fgHexRaw, bgHex, alpha);
        effectiveFgHex = composited ?? null;
      }

      const fgResolved = isValidHexColor(effectiveFgHex);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(effectiveFgHex, bgHex) : null;

      if (ratio !== null && effectiveFgHex && bgHex && effectiveFgHex.toLowerCase() === bgHex.toLowerCase()) continue;
      if (ratio !== null && ratio >= threshold) continue;

      const containingTag = findContainingTagClasses(content, matchIndex);
      pushFinding({
        fgHex: fgResolved ? effectiveFgHex : null,
        fgClass: alpha !== undefined ? `${colorClass}/${Math.round(alpha * 100)}` : colorClass,
        fgSource: 'tailwind_token', bgHex: bgResolved ? bgHex : null, bgClass,
        bgSource: bgResolved ? bgSource : 'unresolved', ratio, threshold, sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined, jsxTag, context,
        occurrence_count: 1, textType, appliedThreshold: threshold, wcagCriterion: '1.4.3',
        lineNumber: getLineNumber(matchIndex), startLine: getLineNumber(matchIndex),
        endLine: getLineNumber(matchIndex), extractedClasses: containingTag?.classes || '',
        fgResolved, bgResolved, bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }

    // VARIANT STATE PASS
    for (const { colorClass, colorName, context, matchIndex, jsxTag, variant, alpha } of textTokens) {
      if (!variant) continue;
      if (!['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'dark'].includes(variant)) continue;
      const fgHexRaw = TAILWIND_COLORS[colorName] || null;
      if (!fgHexRaw) continue;
      if (!isTextElement(jsxTag, lucideIcons)) continue;

      const ternaryWindowV = content.slice(Math.max(0, matchIndex - 200), Math.min(content.length, matchIndex + 200));
      const isInsideTernaryV = /\?\s*["'`][^"'`]*$/.test(content.slice(Math.max(0, matchIndex - 200), matchIndex)) ||
        /\?\s*["'`]/.test(ternaryWindowV) && /:\s*["'`]/.test(ternaryWindowV);

      let bgHex: string | null = null;
      let bgClass: string | null = null;
      let bgSource: A1BgSource = 'unresolved';
      if (!isInsideTernaryV) {
        const resolved = resolveBackground(content, matchIndex);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName]; bgClass = resolved.bgClass; bgSource = 'tailwind_token';
        }
      }

      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      let effectiveFgHex: string | null = fgHexRaw;
      if (alpha !== undefined && alpha < 1 && isValidHexColor(fgHexRaw) && isValidHexColor(bgHex)) {
        const composited = alphaComposite(fgHexRaw, bgHex, alpha);
        effectiveFgHex = composited ?? null;
      }

      const fgResolved = isValidHexColor(effectiveFgHex);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(effectiveFgHex, bgHex) : null;
      if (ratio !== null && effectiveFgHex && bgHex && effectiveFgHex.toLowerCase() === bgHex.toLowerCase()) continue;
      if (ratio !== null && ratio >= threshold) continue;

      const containingTag = findContainingTagClasses(content, matchIndex);
      const line = getLineNumber(matchIndex);
      pushFinding({
        fgHex: fgResolved ? effectiveFgHex : null,
        fgClass: `${variant}:${colorClass}`, fgSource: 'tailwind_token',
        bgHex: bgResolved ? bgHex : null, bgClass, bgSource: bgResolved ? bgSource : 'unresolved',
        ratio, threshold, sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined, jsxTag, context,
        occurrence_count: 1, textType, appliedThreshold: threshold, wcagCriterion: '1.4.3',
        variant, variantName: variant, lineNumber: line, startLine: line, endLine: line,
        extractedClasses: containingTag?.classes || '', fgResolved, bgResolved,
        bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }

    // PASS 2: Inline JSX style objects
    const styleRegex = /style\s*=\s*\{\s*\{/g;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(content)) !== null) {
      const containingTag = findContainingTagClasses(content, styleMatch.index);
      if (!containingTag) continue;
      const jsxTag = containingTag.tagName;
      if (!isTextElement(jsxTag, lucideIcons)) continue;
      const inlineColors = extractInlineStyleColors(containingTag.tagContent);
      if (!inlineColors.fg) continue;
      const fgHexRaw = inlineColors.fg;
      let bgHex: string | null = null;
      let bgSource: A1BgSource = 'unresolved';
      if (inlineColors.bg) { bgHex = inlineColors.bg; bgSource = 'inline_style'; }
      else {
        const resolved = resolveBackground(content, styleMatch.index);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) { bgHex = TAILWIND_COLORS[resolved.bgName]; bgSource = 'tailwind_token'; }
      }
      const ctxStart = Math.max(0, styleMatch.index - 100);
      const ctxEnd = Math.min(content.length, styleMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      const fgResolved = isValidHexColor(fgHexRaw);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(fgHexRaw, bgHex) : null;
      if (ratio !== null && ratio >= threshold) continue;
      const line = getLineNumber(styleMatch.index);
      pushFinding({
        fgHex: fgResolved ? fgHexRaw : null, fgClass: `style:color(${fgHexRaw})`,
        fgSource: 'inline_style', bgHex: bgResolved ? bgHex : null, bgClass: null,
        bgSource: bgResolved ? bgSource : 'unresolved', ratio, threshold, sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined, jsxTag, context,
        occurrence_count: 1, textType, appliedThreshold: threshold, wcagCriterion: '1.4.3',
        lineNumber: line, startLine: line, endLine: line,
        extractedClasses: containingTag.classes || '', fgResolved, bgResolved,
        bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }

    // PASS 3: HTML style strings
    const htmlStyleRegex = /style\s*=\s*"([^"]+)"/g;
    let htmlMatch;
    while ((htmlMatch = htmlStyleRegex.exec(content)) !== null) {
      const styleStr = htmlMatch[1];
      const colorM = styleStr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (!colorM) continue;
      const fgHexRaw = parseCssColor(colorM[1]);
      if (!fgHexRaw) continue;
      const containingTag = findContainingTagClasses(content, htmlMatch.index);
      if (!containingTag) continue;
      const jsxTag = containingTag.tagName;
      if (!isTextElement(jsxTag, lucideIcons)) continue;
      let bgHex: string | null = null;
      let bgSource: A1BgSource = 'unresolved';
      const bgColorM = styleStr.match(/background-color\s*:\s*([^;]+)/);
      if (bgColorM) {
        const parsed = parseCssColor(bgColorM[1]);
        if (parsed) { bgHex = parsed; bgSource = 'inline_style'; }
      } else {
        const resolved = resolveBackground(content, htmlMatch.index);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) { bgHex = TAILWIND_COLORS[resolved.bgName]; bgSource = 'tailwind_token'; }
      }
      const ctxStart = Math.max(0, htmlMatch.index - 100);
      const ctxEnd = Math.min(content.length, htmlMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      const fgResolved = isValidHexColor(fgHexRaw);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(fgHexRaw, bgHex) : null;
      if (ratio !== null && ratio >= threshold) continue;
      const line = getLineNumber(htmlMatch.index);
      pushFinding({
        fgHex: fgResolved ? fgHexRaw : null, fgClass: `style:color(${fgHexRaw})`,
        fgSource: 'inline_style', bgHex: bgResolved ? bgHex : null, bgClass: null,
        bgSource: bgResolved ? bgSource : 'unresolved', ratio, threshold, sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined, jsxTag, context,
        occurrence_count: 1, textType, appliedThreshold: threshold, wcagCriterion: '1.4.3',
        lineNumber: line, startLine: line, endLine: line,
        extractedClasses: containingTag.classes || '', fgResolved, bgResolved,
        bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }
  }

  if (a1Findings.length === 0) return [];

  const dedupeMap = new Map<string, A1TokenFinding>();
  for (const finding of a1Findings) {
    const key = [finding.fgClass, finding.bgSource, finding.bgHex || 'unresolved', finding.filePath, finding.variant || 'base', finding.variantName || 'none', finding.lineNumber || 0].join('|');
    if (dedupeMap.has(key)) { dedupeMap.get(key)!.occurrence_count += 1; }
    else { dedupeMap.set(key, { ...finding }); }
  }

  // A1.1 risk-signal gate for Potential findings
  const A1_RISK_SIGNAL_PATTERNS = [
    /\btext-muted\b/, /\btext-muted-foreground\b/, /\btext-foreground\b/,
    /\btext-primary\b/, /\btext-secondary\b/, /\btext-accent\b/,
    /\btext-popover-foreground\b/, /\btext-card-foreground\b/,
    /\bopacity-(?:50|60|70)\b/, /\btext-opacity-\d+\b/,
    /var\(--[\w-]*(?:foreground|muted|background|primary|secondary|accent)[\w-]*\)/,
    /hsl\(var\(--[\w-]+\)\)/,
  ];

  function hasRiskSignal(classes: string, fgClass: string): boolean {
    const combined = `${classes} ${fgClass}`;
    return A1_RISK_SIGNAL_PATTERNS.some(p => p.test(combined));
  }

  const results: ContrastViolation[] = [];

  for (const finding of dedupeMap.values()) {
    const fileName = finding.filePath.split('/').pop() || finding.filePath;
    const elementIdentifier = finding.componentName ? `${finding.componentName} (${fileName})` : fileName;

    const fgResolved = finding.fgResolved && isValidHexColor(finding.fgHex);
    const bgResolved = finding.bgResolved && isValidHexColor(finding.bgHex);
    const fontResolved = finding.sizeStatus !== 'unknown';
    const canCompute = fgResolved && bgResolved && finding.ratio !== null;

    // A1 Confirmed requires ALL prerequisites: fg + bg + font size + ratio
    const isConfirmed = canCompute && fontResolved && finding.ratio! < finding.threshold;
    const status: 'confirmed' | 'potential' = isConfirmed ? 'confirmed' : 'potential';

    console.log(`[A1] prereq: fgResolved=${fgResolved} bgResolved=${bgResolved} fontResolved=${fontResolved} ratioComputed=${finding.ratio !== null} → ${status} (${finding.fgClass} in ${finding.filePath})`);

    // GATE: skip noisy potential findings with no risk signal
    if (!isConfirmed && !canCompute) {
      const riskFound = hasRiskSignal(finding.extractedClasses || '', finding.fgClass);
      if (!riskFound) continue;
    }

    const reasonCodes: string[] = ['STATIC_ANALYSIS'];
    if (!bgResolved) reasonCodes.push('BG_UNRESOLVED');
    if (finding.sizeStatus === 'unknown') reasonCodes.push('SIZE_UNKNOWN');

    let riskLevel: 'high' | 'medium' | 'low' = 'low';
    if (canCompute) {
      if (finding.ratio! < 2.5) riskLevel = 'high';
      else if (finding.ratio! < 3.5) riskLevel = 'medium';
    }

    const ratioStr = canCompute ? `${finding.ratio!.toFixed(2)}:1` : 'Not computed (requires rendered colors)';
    const bgDisplay = bgResolved && finding.bgHex ? finding.bgHex : 'theme/variable-dependent';
    const fgDisplay = fgResolved && finding.fgHex ? finding.fgHex : 'theme/variable/opacity-dependent';
    const variantLabel = finding.variant ? ` [${finding.variant} state]` : '';
    const branchLabel = finding.variantName ? ` [variant=${finding.variantName}]` : '';
    const diagnosis = canCompute
      ? `Text ${finding.fgClass} (${fgDisplay}) on ${bgDisplay}${variantLabel}${branchLabel} — contrast ratio ${ratioStr} vs ${finding.threshold}:1 required (${finding.sizeStatus === 'large' ? 'large' : 'normal'} text).`
      : `Text ${finding.fgClass} (${fgDisplay}) on ${bgDisplay}${variantLabel}${branchLabel} — contrast not computed (theme/variable-dependent colors).`;

    let correctivePrompt = '';
    if (isConfirmed) {
      correctivePrompt = `• ${finding.elementContext || 'Text element'} "${finding.fgClass}" in ${elementIdentifier}\n  Issue: ${ratioStr} vs ${finding.threshold}:1 required\n  Fix: Replace ${finding.fgClass} with a darker token or adjust background ${finding.bgClass || bgDisplay} to ensure ≥ ${finding.threshold}:1.`;
    }

    const advisoryGuidance = isConfirmed ? undefined
      : !canCompute ? 'Theme-dependent or opacity-reduced colors cannot be verified statically. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast.'
      : `Verify contrast in browser DevTools. Computed ratio: ${ratioStr}.`;

    results.push({
      ruleId: 'A1', ruleName: 'Insufficient text contrast', category: 'accessibility',
      status, samplingMethod: 'inferred', inputType: 'github',
      contrastRatio: canCompute ? (finding.ratio ?? undefined) : undefined,
      thresholdUsed: finding.threshold,
      foregroundHex: fgResolved ? (finding.fgHex ?? undefined) : undefined,
      backgroundHex: bgResolved ? (finding.bgHex ?? undefined) : undefined,
      foreground: { value: fgResolved ? finding.fgHex : null, resolved: fgResolved },
      background: { value: bgResolved ? finding.bgHex : null, resolved: bgResolved, reason: bgResolved ? undefined : (finding.bgUnresolvedReason || 'theme/variable-dependent') },
      note: !canCompute ? 'contrast not computed (theme/variable-dependent colors)' : undefined,
      elementIdentifier, elementDescription: finding.elementContext,
      evidence: `${finding.fgClass}${fgResolved && finding.fgHex ? ` (${finding.fgHex})` : ''}${finding.bgClass ? ` on ${finding.bgClass}${bgResolved && finding.bgHex ? ` (${finding.bgHex})` : ''}` : ''} in ${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ''}${finding.variantName ? ` [variant=${finding.variantName}]` : ''}`,
      diagnosis, contextualHint: canCompute ? `Contrast ${ratioStr} — ${finding.evidenceLevel.replace(/_/g, ' ')}.` : 'Contrast not computed — theme/variable-dependent colors.',
      correctivePrompt, confidence: isConfirmed ? 0.9 : (!bgResolved ? 0.4 : 0.55), riskLevel,
      reasonCodes: isConfirmed ? undefined : reasonCodes,
      potentialRiskReason: isConfirmed ? undefined : (!canCompute ? 'theme/variable-dependent colors' : `computed ratio ${ratioStr}`),
      backgroundStatus: bgResolved ? 'certain' : 'uncertain',
      blocksConvergence: isConfirmed,
      inputLimitation: !canCompute ? 'Theme/variable-dependent colors; static analysis cannot compute effective contrast ratio.' : undefined,
      advisoryGuidance,
      fgSource: finding.fgSource, bgSource: bgResolved ? finding.bgSource : 'unresolved',
      evidenceLevel: finding.evidenceLevel, sizeStatus: finding.sizeStatus,
      variant: finding.variant, variantName: finding.variantName,
      lineNumber: finding.lineNumber, startLine: finding.startLine ?? finding.lineNumber ?? null,
      endLine: finding.endLine ?? finding.lineNumber ?? null, extractedClasses: finding.extractedClasses,
      affectedComponents: [{ colorClass: finding.fgClass, hexColor: finding.fgHex ?? undefined, filePath: finding.filePath, componentName: finding.componentName, elementContext: finding.elementContext, riskLevel, occurrence_count: finding.occurrence_count }],
    });
  }

  const confirmed = results.filter(r => r.status === 'confirmed').length;
  const potential = results.filter(r => r.status === 'potential').length;
  console.log(`A1 token-contrast (GitHub): ${results.length} findings (${confirmed} confirmed, ${potential} potential, ${a1Findings.length - dedupeMap.size} pre-deduped, ${dedupeMap.size - results.length} gated-out)`);

  return results;
}

// ========== A1.3 — Theme-Dependent or Opacity-Reduced Text (Potential Only) ==========
const A1_3_THEME_CLASS_PATTERNS = [
  /\btext-muted\b/, /\btext-muted-foreground\b/, /\btext-foreground\b/,
  /\btext-primary\b/, /\btext-secondary\b/, /\btext-accent\b/,
  /\btext-popover-foreground\b/, /\btext-card-foreground\b/,
];
const A1_3_OPACITY_PATTERNS = [
  /\bopacity-(?:50|60|70)\b/, /\btext-opacity-\d+\b/,
  /\btext-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\s[^"'`]*?opacity-(?:50|60|70)\b/,
];
const A1_3_CSS_VAR_PATTERN = /(?:color|--[\w-]+)\s*:\s*(?:var\(--[\w-]*(?:foreground|muted|primary|secondary|accent)[\w-]*\)|hsl\(var\(--[\w-]+\)\))/;
const A1_3_SUPPRESS_DISABLED = /\bdisabled\b/;
const A1_3_SUPPRESS_ARIA_HIDDEN = /aria-hidden\s*=\s*["']true["']/;
const A1_3_SUPPRESS_PLACEHOLDER = /\bplaceholder\b/;

function detectA1ThemeDependentText(files: Map<string, string>): ContrastViolation[] {
  const findings: ContrastViolation[] = [];
  const seen = new Set<string>();

  for (const [filepath, content] of files) {
    if (!/\.(tsx|jsx)$/i.test(filepath)) continue;
    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];
    const lucideIcons = extractLucideImports(content);
    const lineOffsets: number[] = [0];
    for (let ci = 0; ci < content.length; ci++) {
      if (content[ci] === '\n') lineOffsets.push(ci + 1);
    }
    const getLineNumber = (idx: number): number => {
      let lo = 0, hi = lineOffsets.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineOffsets[mid] <= idx) lo = mid; else hi = mid - 1; }
      return lo + 1;
    };

    const tagRegex = /<([A-Za-z][A-Za-z0-9_.]*)\s+[^>]*(?:className|style)[^>]*>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      const tagContent = tagMatch[0];
      const tagName = tagMatch[1];
      if (!isTextElement(tagName, lucideIcons)) continue;
      if (A1_3_SUPPRESS_ARIA_HIDDEN.test(tagContent)) continue;
      if (A1_3_SUPPRESS_DISABLED.test(tagContent)) continue;
      if (A1_3_SUPPRESS_PLACEHOLDER.test(tagContent) && /input|textarea/i.test(tagName)) continue;
      const selfClosing = tagContent.endsWith('/>');
      if (selfClosing && !/\b(?:label|title|alt|aria-label)\s*=/.test(tagContent)) continue;

      let matched = false;
      let matchedPattern = '';
      for (const pat of A1_3_THEME_CLASS_PATTERNS) {
        if (pat.test(tagContent)) { matched = true; const m = tagContent.match(pat); matchedPattern = m ? m[0] : 'theme-dependent class'; break; }
      }
      if (!matched) {
        for (const pat of A1_3_OPACITY_PATTERNS) {
          if (pat.test(tagContent)) { matched = true; const m = tagContent.match(pat); matchedPattern = m ? m[0] : 'opacity-reduced text'; break; }
        }
      }
      if (!matched && A1_3_CSS_VAR_PATTERN.test(tagContent)) { matched = true; matchedPattern = 'CSS variable text color'; }
      if (!matched) continue;

      const line = getLineNumber(tagMatch.index);
      const fileName = filepath.split('/').pop() || filepath;
      const dedupeKey = `a1.3|${filepath}|${line}|${matchedPattern}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const elementIdentifier = componentName ? `${componentName} (${fileName})` : fileName;
      const ctxStart = Math.max(0, tagMatch.index - 40);
      const ctxEnd = Math.min(content.length, tagMatch.index + tagContent.length + 40);
      const surroundingCtx = content.slice(ctxStart, ctxEnd);
      const elementContext = inferElementContext(surroundingCtx) || `${tagName} element`;

      findings.push({
        ruleId: 'A1', ruleName: 'Insufficient text contrast', category: 'accessibility',
        status: 'potential', samplingMethod: 'inferred', inputType: 'github',
        contrastRatio: undefined, thresholdUsed: 4.5,
        foreground: { value: null, resolved: false },
        background: { value: null, resolved: false, reason: 'theme-dependent / CSS variable' },
        note: 'A1.3: Theme-dependent or opacity-reduced text — contrast not statically computable.',
        elementIdentifier, elementDescription: elementContext,
        evidence: `${matchedPattern} in ${filepath}:${line}`,
        diagnosis: `Text color is theme-dependent or opacity-reduced. Final contrast ratio cannot be statically computed.`,
        contextualHint: 'Contrast not computed — theme-dependent or opacity-reduced text.',
        correctivePrompt: '', confidence: matchedPattern.includes('opacity') ? 0.70 : 0.65,
        riskLevel: 'low', reasonCodes: ['THEME_DEPENDENT', 'STATIC_ANALYSIS'],
        potentialRiskReason: 'theme-dependent or opacity-reduced text color',
        backgroundStatus: 'unmeasurable', blocksConvergence: false,
        inputLimitation: 'Theme-dependent or opacity-reduced colors; contrast cannot be statically computed.',
        advisoryGuidance: 'Provide a rendered screenshot for visual contrast verification.',
        lineNumber: line, startLine: line, endLine: line,
      });
    }
  }
  console.log(`A1.3 theme-dependent (GitHub): ${findings.length} findings`);
  return findings;
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

// ============================================================
// A2 Focus Visibility — Fully Deterministic Detection (GitHub)
// ============================================================

interface A2Finding {
  elementLabel: string;
  elementType: string;
  elementTag: string;
  elementName: string;
  elementSource: 'jsx_tag' | 'wrapper_component' | 'html_tag_fallback' | 'unknown';
  sourceLabel: string;
  filePath: string;
  lineNumber: number;
  lineEnd?: number;
  componentName: string;
  classification: 'confirmed' | 'potential' | 'not_applicable';
  detection: string;
  explanation: string;
  confidence: number;
  focusClasses: string[];
  correctivePrompt?: string;
  potentialSubtype?: 'borderline';
  potentialReason?: string;
  deduplicationKey: string;
  focusable: 'yes' | 'no' | 'unknown';
  selectorHints: string[];
  _a2Debug: {
    outlineRemoved: boolean;
    hasStrongReplacement: boolean;
    hasWeakFocusStyling: boolean;
    matchedTokens: string[];
    focusable: string;
  };
}

function buildComponentSymbolTable(content: string): Array<{ name: string; startLine: number; endLine: number }> {
  const symbols: Array<{ name: string; startLine: number; endLine: number }> = [];
  const lines = content.split('\n');
  const defRegex = /^(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_.]*)\s*=\s*(?:React\.)?(?:forwardRef|memo)?\s*[(<]/;
  const fnDefRegex = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*[(<]/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    let name: string | null = null;
    const m1 = trimmed.match(defRegex);
    if (m1) name = m1[1];
    if (!name) {
      const m2 = trimmed.match(fnDefRegex);
      if (m2) name = m2[1];
    }
    if (name) {
      let depth = 0;
      let endLine = i;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{' || ch === '(') depth++;
          else if (ch === '}' || ch === ')') depth--;
        }
        endLine = j;
        if (depth <= 0 && j > i) break;
      }
      symbols.push({ name, startLine: i + 1, endLine: endLine + 1 });
    }
  }
  return symbols;
}

function resolveA2ElementName(
  content: string,
  classStrPos: number,
  line: number,
  tagMatch: RegExpMatchArray | null,
  elementTag: string,
  symbolTable: Array<{ name: string; startLine: number; endLine: number }>,
  fileComponentName: string,
): { elementName: string; elementSource: 'jsx_tag' | 'wrapper_component' | 'html_tag_fallback' | 'unknown' } {
  if (tagMatch) {
    const rawTag = tagMatch[1];
    const contextStart = Math.max(0, classStrPos - 500);
    const contextBefore = content.slice(contextStart, classStrPos);
    const dottedMatch = contextBefore.match(/<([A-Z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)(?:\s|$)[^>]*$/);
    if (dottedMatch) {
      return { elementName: dottedMatch[1], elementSource: 'jsx_tag' };
    }
    if (/^[A-Z]/.test(rawTag)) {
      return { elementName: rawTag, elementSource: 'jsx_tag' };
    }
  }

  for (const sym of symbolTable) {
    if (line >= sym.startLine && line <= sym.endLine) {
      return { elementName: sym.name, elementSource: 'wrapper_component' };
    }
  }

  if (elementTag && elementTag !== 'unknown') {
    return { elementName: elementTag, elementSource: 'html_tag_fallback' };
  }

  if (fileComponentName) {
    return { elementName: fileComponentName, elementSource: 'wrapper_component' };
  }

  return { elementName: 'unknown', elementSource: 'unknown' };
}

function detectA2FocusVisibility(allFiles: Map<string, string>): A2Finding[] {
  const findings: A2Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const fileName = filePath.split('/').pop() || filePath;
    const symbolTable = buildComponentSymbolTable(content);

    const classNameRegex = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[^}]*(?:`([^`]+)`|["']([^"']+)["'])[^}]*\})/g;
    const classRegex = /\bclass\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
    const cvaBaseRegex = /(?:cva|cn)\(\s*["'`]([^"'`]+)["'`]/g;

    const classStrings: Array<{ classStr: string; line: number }> = [];

    let match;
    while ((match = classNameRegex.exec(content)) !== null) {
      const classStr = match[1] || match[2] || match[3] || match[4] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }
    while ((match = classRegex.exec(content)) !== null) {
      const classStr = match[1] || match[2] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }
    while ((match = cvaBaseRegex.exec(content)) !== null) {
      const classStr = match[1] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }

    for (const { classStr, line } of classStrings) {
      const tokens = classStr.split(/\s+/).filter(Boolean);

      const outlineRemovalTokens = tokens.filter(t =>
        t === 'outline-none' ||
        t === 'focus:outline-none' ||
        t === 'focus-visible:outline-none'
      );
      const outlineRemoved = outlineRemovalTokens.length > 0;
      if (!outlineRemoved) continue;

      const strongReplacementTokens = tokens.filter(t =>
        /^focus(?:-visible)?:ring-(?!0$)/i.test(t) ||
        /^focus(?:-visible)?:border-(?!0$|none$)/i.test(t) ||
        /^focus(?:-visible)?:shadow-(?!none$)/i.test(t) ||
        /^focus(?:-visible)?:outline-(?!none$)/i.test(t)
      );
      const hasStrongReplacement = strongReplacementTokens.length > 0;

      if (hasStrongReplacement) {
        console.log(`A2 PASS (deterministic): ${filePath}:${line} — strong replacement [${strongReplacementTokens.join(', ')}]`);
        continue;
      }

      // STEP 2b: Check focus-within wrapper indicators
      const hasFocusWithinIndicator = tokens.some(t =>
        /^focus-within:ring-(?!0$)/i.test(t) ||
        /^focus-within:border-(?!0$|none$)/i.test(t) ||
        /^focus-within:shadow-(?!none$)/i.test(t)
      );
      if (hasFocusWithinIndicator) {
        console.log(`A2 PASS (deterministic): ${filePath}:${line} — focus-within wrapper indicator`);
        continue;
      }

      // STEP 2c: Check state-driven highlight patterns (Radix/CMDK/listbox/menu)
      const hasStateDrivenIndicator = tokens.some(t =>
        /^data-\[selected(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^data-\[highlighted(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^aria-selected:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^data-\[state=active\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^data-\[state=open\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t)
      );
      if (hasStateDrivenIndicator) {
        console.log(`A2 PASS (deterministic): ${filePath}:${line} — state-driven focus/selection indicator`);
        continue;
      }

      // STEP 2d: Check if wrapper element (one hop up) has focus-within indicator
      const wrapperContextStart = Math.max(0, content.indexOf(classStr) - 800);
      const wrapperContextBefore = content.slice(wrapperContextStart, content.indexOf(classStr));
      const parentClassMatch = wrapperContextBefore.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[^}]*(?:`([^`]+)`|["']([^"']+)["'])[^}]*\})(?:[^<]*<[^/]){0,2}[^<]*$/);
      if (parentClassMatch) {
        const parentClasses = (parentClassMatch[1] || parentClassMatch[2] || parentClassMatch[3] || parentClassMatch[4] || '');
        const parentTokens = parentClasses.split(/\s+/).filter(Boolean);
        const parentHasFocusWithin = parentTokens.some(t =>
          /^focus-within:ring-(?!0$)/i.test(t) ||
          /^focus-within:border-(?!0$|none$)/i.test(t) ||
          /^focus-within:shadow-(?!none$)/i.test(t)
        );
        if (parentHasFocusWithin) {
          console.log(`A2 PASS (deterministic): ${filePath}:${line} — parent wrapper has focus-within indicator`);
          continue;
        }
      }

      const weakFocusTokens = tokens.filter(t =>
        /^focus(?:-visible)?:bg-/i.test(t) ||
        /^focus(?:-visible)?:text-/i.test(t) ||
        /^focus(?:-visible)?:underline$/i.test(t) ||
        /^focus(?:-visible)?:opacity-/i.test(t) ||
        /^focus(?:-visible)?:font-/i.test(t)
      );
      const hasWeakFocusStyling = weakFocusTokens.length > 0;

      // ── Extract element tag and attributes from surrounding JSX context ──
      const classStrPos = content.indexOf(classStr, 0);
      const contextStart = Math.max(0, classStrPos - 500);
      const contextBefore = content.slice(contextStart, classStrPos);
      const tagMatch = contextBefore.match(/<(\w+)(?:\s|$)[^>]*$/);
      const rawTagName = tagMatch ? tagMatch[1] : '';
      const elementTag = rawTagName ? rawTagName.toLowerCase() : 'unknown';
      const { elementName, elementSource } = resolveA2ElementName(content, classStrPos, line, tagMatch, elementTag, symbolTable, componentName);
      const tagOpenStart = contextBefore.lastIndexOf('<');
      const fullTagRegion = content.slice(contextStart + (tagOpenStart >= 0 ? tagOpenStart : 0), classStrPos + classStr.length + 200);
      
      const selectorHints: string[] = [];
      const idMatch = fullTagRegion.match(/\bid\s*=\s*["']([^"']+)["']/);
      if (idMatch) selectorHints.push(`id="${idMatch[1]}"`);
      const nameMatch = fullTagRegion.match(/\bname\s*=\s*["']([^"']+)["']/);
      if (nameMatch) selectorHints.push(`name="${nameMatch[1]}"`);
      const ariaLabelMatch = fullTagRegion.match(/\baria-label\s*=\s*["']([^"']+)["']/);
      if (ariaLabelMatch) selectorHints.push(`aria-label="${ariaLabelMatch[1]}"`);
      const roleMatch = fullTagRegion.match(/\brole\s*=\s*["']([^"']+)["']/);
      if (roleMatch) selectorHints.push(`role="${roleMatch[1]}"`);
      const tabIndexMatch = fullTagRegion.match(/\btabIndex\s*=\s*\{?\s*(-?\d+)\s*\}?/);
      if (tabIndexMatch) selectorHints.push(`tabIndex=${tabIndexMatch[1]}`);
      const hrefMatch = fullTagRegion.match(/\bhref\s*=/);
      if (hrefMatch) selectorHints.push(`href`);
      const contentEditableMatch = fullTagRegion.match(/\bcontentEditable/i);
      if (contentEditableMatch) selectorHints.push(`contentEditable`);

      let elementType = 'interactive element';
      if (/\bbutton\b|<button|<Button/i.test(contextBefore)) elementType = 'button';
      else if (/\binput\b|<input|<Input/i.test(contextBefore)) elementType = 'input';
      else if (/\bselect\b|<select|<Select/i.test(contextBefore)) elementType = 'select';
      else if (/\btextarea\b|<textarea|<Textarea/i.test(contextBefore)) elementType = 'textarea';
      else if (/\bmenuitem|MenuItem|DropdownMenu|ContextMenu/i.test(contextBefore)) elementType = 'menuitem';
      else if (/\btab\b|<Tab/i.test(contextBefore)) elementType = 'tab';
      else if (/\ba\b|<a\b|<Link/i.test(contextBefore)) elementType = 'link';

      const INHERENTLY_FOCUSABLE = /^(input|textarea|select|button|a)$/;
      const FOCUSABLE_ROLES = /^(button|link|menuitem|option|combobox|tab|checkbox|radio|switch|listbox|slider|treeitem|gridcell)$/;
      const parsedRole = roleMatch ? roleMatch[1].toLowerCase() : '';
      const parsedTabIndex = tabIndexMatch ? parseInt(tabIndexMatch[1], 10) : null;

      let focusable: 'yes' | 'no' | 'unknown' = 'unknown';
      if (INHERENTLY_FOCUSABLE.test(elementTag)) {
        focusable = 'yes';
      } else if (parsedTabIndex !== null && parsedTabIndex >= 0) {
        focusable = 'yes';
      } else if (contentEditableMatch) {
        focusable = 'yes';
      } else if (FOCUSABLE_ROLES.test(parsedRole)) {
        focusable = 'yes';
      } else if (/^(div|span|p|section|article|header|footer|aside|nav|figure|main)$/.test(elementTag)) {
        focusable = parsedTabIndex !== null && parsedTabIndex < 0 ? 'no' : (parsedTabIndex === null ? 'no' : 'yes');
      }
      // Component wrappers (capitalized tag) → check against known lists
      const jsxTagName = tagMatch?.[1] || '';
      const isCapitalized = /^[A-Z]/.test(jsxTagName);

      // ── Non-focusable wrapper/content suppression list ──
      const NON_FOCUSABLE_WRAPPER_RE = /^(?:HoverCard|HoverCardContent|Popover|PopoverContent|DropdownMenuContent|ContextMenuContent|MenubarContent|DialogContent|SheetContent|DrawerContent|TooltipContent|AlertDialogContent|Portal|Viewport)$|Content$/;
      // ── Known interactive Radix/shadcn primitives ──
      const KNOWN_INTERACTIVE_RE = /(?:Trigger|Item|Button|Link|Tab|Checkbox|Switch|Radio|Slider|Toggle)$/;

      if (isCapitalized || elementTag === 'unknown') {
        if (NON_FOCUSABLE_WRAPPER_RE.test(jsxTagName)) {
          if (parsedTabIndex === null || parsedTabIndex < 0) {
            if (!FOCUSABLE_ROLES.test(parsedRole)) {
              focusable = 'no';
            }
          }
        } else if (KNOWN_INTERACTIVE_RE.test(jsxTagName)) {
          focusable = 'yes';
        } else if (/input|button|select|textarea|command/i.test(componentName)) {
          focusable = 'yes';
        } else if (/content|wrapper|container|card|popover|hover/i.test(componentName)) {
          focusable = parsedTabIndex !== null && parsedTabIndex >= 0 ? 'yes' : 'no';
        }
      }

      // ── Focusable target gate: suppress unknown-focusable component wrappers ──
      if (focusable === 'unknown' && isCapitalized && !hasWeakFocusStyling) {
        console.log(`A2 SUPPRESSED (deterministic): ${filePath}:${line} — unknown focusability on component ${jsxTagName}, no evidence of keyboard target`);
        continue;
      }

      const lineEnd = Math.min(line + 5, content.split('\n').length);

      const isBorderline = hasWeakFocusStyling;
      const allMatchedTokens = [...outlineRemovalTokens, ...(isBorderline ? weakFocusTokens : [])];

      let classification: 'confirmed' | 'potential' | 'not_applicable';
      if (focusable === 'no') {
        classification = 'not_applicable';
        console.log(`A2 NOT_APPLICABLE (deterministic): ${filePath}:${line} — non-focusable ${jsxTagName || elementTag}`);
      } else if (isBorderline) {
        classification = 'potential';
      } else if (focusable === 'yes') {
        classification = 'confirmed';
      } else {
        classification = 'potential';
      }

      const dedupeKey = `${filePath}|${componentName}|${line}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      if (classification === 'not_applicable') continue;

      let detection: string;
      if (isBorderline) {
        const details = [...outlineRemovalTokens, ...weakFocusTokens].join(', ');
        detection = `Focus indicated only by background/text color change (${details}) after outline removal — contrast not verifiable statically`;
      } else {
        detection = `Focus indicator removed (${outlineRemovalTokens.join(', ')}) without visible replacement`;
      }

      const explanation = isBorderline
        ? 'Issue reason: Outline removed; focus relies only on bg/text change; contrast can\'t be verified statically.\n\nRecommended fix: Add a clear focus-visible indicator (e.g., focus-visible:ring-2 + focus-visible:ring-offset-2) or restore outline.'
        : 'Element removes the default browser outline without providing a visible focus replacement.';

      const confidence = isBorderline ? 0.68 : (focusable === 'yes' ? 0.92 : 0.75);
      const sourceLabel = elementName !== 'unknown' ? elementName : (componentName || fileName.replace(/\.\w+$/, ''));

      console.log(`A2 ${classification.toUpperCase()} (deterministic): ${filePath}:${line} tag=${elementTag} name=${elementName} focusable=${focusable} tokens=[${allMatchedTokens.join(',')}]`);

      findings.push({
        elementLabel: sourceLabel,
        elementType,
        elementTag,
        elementName,
        elementSource,
        sourceLabel,
        filePath,
        lineNumber: line,
        lineEnd,
        componentName,
        classification,
        detection,
        explanation,
        confidence,
        focusClasses: allMatchedTokens,
        correctivePrompt: classification === 'confirmed' ? `[${sourceLabel} ${elementType}] — ${filePath}\n\nIssue reason:\nFocus indicator is removed (${outlineRemovalTokens.join(', ')}) without a visible replacement.\n\nRecommended fix:\nAdd a visible keyboard focus style using :focus-visible (e.g., focus-visible:ring-2 focus-visible:ring-offset-2).` : undefined,
        potentialSubtype: classification === 'potential' ? 'borderline' : undefined,
        potentialReason: classification === 'potential' ? (isBorderline ? 'Custom focus styles exist but perceptibility cannot be statically verified.' : 'Element focusability could not be deterministically confirmed (component wrapper or unknown tag).') : undefined,
        deduplicationKey: dedupeKey,
        focusable,
        selectorHints,
        _a2Debug: {
          outlineRemoved,
          hasStrongReplacement,
          hasWeakFocusStyling,
          matchedTokens: allMatchedTokens,
          focusable,
        },
      });
    }
  }

  return findings;
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
  startLine?: number | null;
  endLine?: number | null;
}

// --- A4 Helpers: page-level detection ---

function identifyPageFiles(allFiles: Map<string, string>): Set<string> {
  const pageFiles = new Set<string>();
  const PAGE_PATH_RE = /(?:^|\/)(?:pages|routes|app|views)\/[^/]+\.(tsx|jsx|ts|js)$/i;
  for (const filePath of allFiles.keys()) {
    const norm = normalizePath(filePath);
    if (PAGE_PATH_RE.test(norm)) pageFiles.add(norm);
  }
  for (const [, content] of allFiles) {
    const routeElementRe = /element\s*[:=]\s*(?:\{?\s*)?<(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = routeElementRe.exec(content)) !== null) {
      const compName = m[1];
      for (const [fp, fc] of allFiles) {
        const norm = normalizePath(fp);
        if (pageFiles.has(norm)) continue;
        const exportRe = new RegExp(`export\\s+(?:default\\s+)?(?:function|const)\\s+${compName}\\b`);
        if (exportRe.test(fc)) pageFiles.add(norm);
      }
    }
  }
  return pageFiles;
}

function resolveImportedComponent(
  importSource: string,
  currentFile: string,
  allFiles: Map<string, string>
): { filePath: string; content: string } | null {
  let resolved = importSource.replace(/^@\//, 'src/');
  if (resolved.startsWith('.')) {
    const dir = currentFile.replace(/\/[^/]+$/, '');
    const parts = dir.split('/');
    for (const seg of resolved.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    resolved = parts.join('/');
  }
  const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}.jsx`, `${resolved}.js`, `${resolved}/index.tsx`, `${resolved}/index.ts`];
  for (const cand of candidates) {
    const norm = normalizePath(cand);
    if (allFiles.has(norm)) return { filePath: norm, content: allFiles.get(norm)! };
  }
  return null;
}

function layoutProvidesMain(pageContent: string, pageFilePath: string, allFiles: Map<string, string>): boolean {
  const returnMatch = pageContent.match(/\breturn\s*\(\s*</);
  if (!returnMatch) return false;
  const afterReturn = pageContent.slice(returnMatch.index!);
  const wrapperMatch = afterReturn.match(/^\s*return\s*\(\s*<([A-Z]\w*)/);
  if (!wrapperMatch) return false;
  const wrapperName = wrapperMatch[1];
  const importRe = new RegExp(`import\\s+(?:\\{[^}]*\\b${wrapperName}\\b[^}]*\\}|${wrapperName})\\s+from\\s+["']([^"']+)["']`);
  const importMatch = pageContent.match(importRe);
  if (!importMatch) return false;
  const resolved = resolveImportedComponent(importMatch[1], pageFilePath, allFiles);
  if (!resolved) return false;
  return /<main\b/i.test(resolved.content) || /role\s*=\s*["']main["']/i.test(resolved.content);
}

function detectA4SemanticStructure(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  // Global landmark tracking — pre-pass across ALL files (no directory filter)
  let hasMainLandmark = false;
  for (const [, content] of allFiles) {
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) {
      hasMainLandmark = true;
      break;
    }
  }
  let hasNavLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const clickableNonSemantics: A4Finding[] = [];
  const headingIssues: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];
  const visualHeadingIssues: A4Finding[] = [];

  const pageFiles = identifyPageFiles(allFiles);
  const pageH1Counts = new Map<string, number[]>();

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
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/') && !filePath.startsWith('client/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const isPage = pageFiles.has(filePath);
    if (isPage) {
      const h1LineNumbers: number[] = [];
      const h1Re = /<h1\b/gi;
      let h1Match;
      while ((h1Match = h1Re.exec(content)) !== null) {
        h1LineNumbers.push(content.slice(0, h1Match.index).split('\n').length);
      }
      pageH1Counts.set(filePath, h1LineNumbers);
    }

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
        startLine: lineNumber,
      });
    }

    // A4.2: Interactive semantics
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
        startLine: lineNumber,
      });
    }

    // A4.3: Nav landmark detection (main is handled by pre-pass)
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists
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

  // Page-level multiple <h1> check
  for (const [pagePath, h1Lines] of pageH1Counts) {
    if (h1Lines.length > 1) {
      for (const h1Line of h1Lines) {
        const dedupeKey = `A4.1|multiple-h1|${pagePath}|${h1Line}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        headingIssues.push({
          elementLabel: `<h1> at line ${h1Line}`, elementType: 'h1', sourceLabel: 'Page heading',
          filePath: pagePath, componentName: undefined,
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'potential',
          detection: `multiple_h1: ${h1Lines.length} <h1> elements in the same page file`,
          evidence: `<h1> at ${pagePath}:${h1Line} (${h1Lines.length} total in file)`,
          explanation: `This page file contains ${h1Lines.length} <h1> elements. Each page view should have exactly one <h1>.`,
          confidence: 0.70,
          deduplicationKey: dedupeKey,
          startLine: h1Line,
        });
      }
    }
  }

  // Skipped heading levels
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
        startLine: null,
      });
      break;
    }
  }

  // A4.3: Missing <main> — layout-aware
  if (!hasMainLandmark) {
    let layoutProvidesIt = false;
    for (const pagePath of pageFiles) {
      const pageContent = allFiles.get(pagePath);
      if (pageContent && layoutProvidesMain(pageContent, pagePath, allFiles)) {
        layoutProvidesIt = true;
        break;
      }
    }
    if (!layoutProvidesIt) {
      const confidence = pageFiles.size > 0 ? 0.80 : 0.60;
      landmarkIssues.push({
        elementLabel: 'Missing <main> landmark', elementType: 'main', sourceLabel: 'Page landmark',
        filePath: 'global', componentName: undefined,
        subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
        classification: 'potential',
        detection: 'No <main> or role="main" found in any source or layout file',
        evidence: 'No <main> element or role="main" found across scanned UI source files.',
        explanation: 'No <main> landmark found. Screen readers use landmarks to navigate page regions efficiently (WCAG 2.4.1 Bypass Blocks).',
        confidence,
        deduplicationKey: 'A4.3|no-main',
        startLine: 1,
      });
    }
  }

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ========== A5 DETERMINISTIC DETECTION (Missing Form Labels) ==========

// Wrapper component → implied control type mapping
const A5_WRAPPER_COMPONENT_MAP: Record<string, { controlType: string; impliedRole?: string }> = {
  'Input': { controlType: 'input' },
  'Textarea': { controlType: 'textarea' },
  'SelectTrigger': { controlType: 'select', impliedRole: 'combobox' },
  'Switch': { controlType: 'checkbox', impliedRole: 'switch' },
  'Checkbox': { controlType: 'checkbox' },
  'RadioGroupItem': { controlType: 'radio' },
  'Slider': { controlType: 'slider', impliedRole: 'slider' },
};

const A5_WRAPPER_NAMES = Object.keys(A5_WRAPPER_COMPONENT_MAP).join('|');

// Import paths that indicate a UI control (not routing, not utility)
const A5_UI_IMPORT_PATTERNS = [
  /['"]@\/components\/ui\//,
  /['"]\.\.?\/components\/ui\//,
  /['"]@radix-ui\//,
  /['"]shadcn/,
  /['"]@headlessui\//,
];

// Import paths that indicate NON-UI usage (routing, state, etc.)
const A5_NON_UI_IMPORT_PATTERNS = [
  /['"]react-router/,
  /['"]@remix-run/,
  /['"]next\/navigation/,
  /['"]wouter/,
];

function extractImportSources(content: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+(['"][^'"]+['"])/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const path = m[3];
    if (m[1]) {
      const names = m[1].split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts.length > 1 ? parts[1].trim() : parts[0].trim();
      }).filter(Boolean);
      for (const name of names) importMap.set(name, path);
    }
    if (m[2]) importMap.set(m[2], path);
  }
  return importMap;
}

const A5_FORM_CONTROL_ROLES = new Set([
  'switch',
  'combobox',
  'checkbox',
  'radio',
  'slider',
  'textbox',
  'searchbox',
  'spinbutton',
  'listbox',
]);

interface ParsedA5Attribute {
  present: boolean;
  value: string | null;
  isNonEmpty: boolean;
  isDynamic: boolean;
  evidence: string | null;
}

function compactA5EvidenceValue(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function parseA5AttributeFromTag(openingTag: string, attributeName: string): ParsedA5Attribute {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrRegex = new RegExp(`\\b${escapedName}\\s*=\\s*`, 'i');
  const attrMatch = attrRegex.exec(openingTag);

  if (!attrMatch) {
    return { present: false, value: null, isNonEmpty: false, isDynamic: false, evidence: null };
  }

  let cursor = attrMatch.index + attrMatch[0].length;
  while (cursor < openingTag.length && /\s/.test(openingTag[cursor])) cursor++;

  if (cursor >= openingTag.length) {
    return { present: true, value: null, isNonEmpty: false, isDynamic: false, evidence: `${attributeName}=` };
  }

  const firstChar = openingTag[cursor];

  if (firstChar === '"' || firstChar === "'") {
    const quote = firstChar;
    let end = cursor + 1;
    while (end < openingTag.length) {
      if (openingTag[end] === quote && openingTag[end - 1] !== '\\') break;
      end++;
    }
    const rawValue = openingTag.slice(cursor + 1, end);
    return {
      present: true,
      value: rawValue,
      isNonEmpty: rawValue.trim().length > 0,
      isDynamic: false,
      evidence: `${attributeName}=${quote}${rawValue}${quote}`,
    };
  }

  if (firstChar === '{') {
    let end = cursor;
    let depth = 0;
    let inString: string | null = null;
    let inTemplateLiteral = false;

    while (end < openingTag.length) {
      const ch = openingTag[end];

      if (inString) {
        if (ch === inString && openingTag[end - 1] !== '\\') inString = null;
        end++;
        continue;
      }

      if (inTemplateLiteral) {
        if (ch === '`' && openingTag[end - 1] !== '\\') inTemplateLiteral = false;
        end++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        end++;
        continue;
      }

      if (ch === '`') {
        inTemplateLiteral = true;
        end++;
        continue;
      }

      if (ch === '{') {
        depth++;
        end++;
        continue;
      }

      if (ch === '}') {
        depth--;
        end++;
        if (depth === 0) break;
        continue;
      }

      end++;
    }

    const expressionRaw = openingTag.slice(cursor + 1, Math.max(cursor + 1, end - 1)).trim();
    const literalExpressionMatch = expressionRaw.match(/^(["'])([\s\S]*)\1$/);

    if (literalExpressionMatch) {
      const literalValue = literalExpressionMatch[2];
      return {
        present: true,
        value: literalValue,
        isNonEmpty: literalValue.trim().length > 0,
        isDynamic: false,
        evidence: `${attributeName}={${literalExpressionMatch[1]}${literalValue}${literalExpressionMatch[1]}}`,
      };
    }

    return {
      present: true,
      value: expressionRaw,
      isNonEmpty: expressionRaw.length > 0,
      isDynamic: true,
      evidence: `${attributeName}={${compactA5EvidenceValue(expressionRaw)}}`,
    };
  }

  let end = cursor;
  while (end < openingTag.length && !/[\s/>]/.test(openingTag[end])) end++;
  const bareValue = openingTag.slice(cursor, end);

  return {
    present: true,
    value: bareValue,
    isNonEmpty: bareValue.trim().length > 0,
    isDynamic: false,
    evidence: `${attributeName}=${bareValue}`,
  };
}

function isUiControl(componentName: string, importMap: Map<string, string>, openingTag: string): boolean {
  const importPath = importMap.get(componentName);

  if (importPath) {
    if (A5_NON_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return false;
    if (A5_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return true;
  }

  const parsedRole = parseA5AttributeFromTag(openingTag, 'role');
  if (parsedRole.isNonEmpty && parsedRole.value) {
    return A5_FORM_CONTROL_ROLES.has(parsedRole.value.toLowerCase());
  }

  return false;
}

function parseAriaLabelValue(openingTag: string): ParsedA5Attribute {
  return parseA5AttributeFromTag(openingTag, 'aria-label');
}

function parseAriaLabelledByValue(openingTag: string): ParsedA5Attribute {
  return parseA5AttributeFromTag(openingTag, 'aria-labelledby');
}

interface A5Finding {
  elementLabel: string;
  elementType: string;
  elementName?: string;
  controlType?: string;
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
  selectorHints?: string[];
  controlId?: string;
  labelingMethod?: string;
  // Line number metadata
  startLine?: number;
  endLine?: number;
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

    // Collect all id= attributes (exclude data-testid, data-id, etc.)
    const controlIds = new Set<string>();
    const controlIdRegex = /(?<![a-zA-Z-])id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`(?<![a-zA-Z-])id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
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

    // Detect shadcn Form pattern: FormItem containing FormLabel + FormControl
    const hasFormPattern = /<FormLabel\b/.test(content) && /<FormControl\b/.test(content);
    const formControlRanges: Array<{start: number; end: number}> = [];
    if (hasFormPattern) {
      const formItemRegex = /<FormItem\b[^>]*>/g;
      let fiMatch;
      while ((fiMatch = formItemRegex.exec(content)) !== null) {
        const fiStart = fiMatch.index;
        const closeIdx = content.indexOf('</FormItem>', fiStart);
        if (closeIdx === -1) continue;
        const block = content.slice(fiStart, closeIdx);
        if (/<FormLabel\b/.test(block) && /<FormControl\b/.test(block)) {
          const fcStart = content.indexOf('<FormControl', fiStart);
          const fcEnd = content.indexOf('</FormControl>', fcStart);
          if (fcStart !== -1 && fcEnd !== -1 && fcEnd <= closeIdx) {
            formControlRanges.push({ start: fcStart, end: fcEnd + '</FormControl>'.length });
          }
        }
      }
    }

    // Extract imports for this file to determine component sources
    const importMap = extractImportSources(content);

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    // Native tags + React wrapper components from A5_WRAPPER_COMPONENT_MAP
    const controlNodes = extractJsxOpeningTags(content, `input|textarea|select|${A5_WRAPPER_NAMES}`);
    for (const controlNode of controlNodes) {
      const { tag: rawTag, attrs, index, fullMatch } = controlNode;
      const isReactComponent = /^[A-Z]/.test(rawTag);
      const tag = isReactComponent ? rawTag : rawTag.toLowerCase();
      if (tag === 'Select') continue;

      // Import-aware control identification: skip wrapper components from non-UI sources
      if (isReactComponent && A5_WRAPPER_COMPONENT_MAP[tag]) {
        if (!isUiControl(tag, importMap, fullMatch)) continue;
      }

      const tagLower = tag.toLowerCase();
      if (tagLower === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, index).split('\n');
      const lineNumber = linesBefore.length;
      const endLineNumber = lineNumber + (fullMatch.split('\n').length - 1);
      // Determine display tag and element name for wrapper components
      const wrapperInfo = isReactComponent ? A5_WRAPPER_COMPONENT_MAP[tag] : undefined;
      const elementNameVal = isReactComponent ? tag : undefined;
      const controlTypeVal = wrapperInfo?.controlType || tagLower;
      const impliedRole = wrapperInfo?.impliedRole;
      const displayTag = isReactComponent && impliedRole
        ? `${tag} (role=${impliedRole})`
        : isReactComponent ? tag : tagLower;

      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputSubtype = (controlTypeVal === 'input') ? (typeMatch?.[1] || typeMatch?.[2] || 'text') : undefined;

      // Check for valid label sources from full opening tag (supports multiline dashed props)
      const ariaLabelParsed = parseAriaLabelValue(fullMatch);
      const hasAriaLabel = ariaLabelParsed.present && ariaLabelParsed.isNonEmpty;
      const ariaLabelledByParsed = parseAriaLabelledByValue(fullMatch);
      const hasAriaLabelledBy = ariaLabelledByParsed.present && ariaLabelledByParsed.isNonEmpty;

      const controlIdParsed = parseA5AttributeFromTag(fullMatch, 'id');
      const controlId = (controlIdParsed.isNonEmpty && !controlIdParsed.isDynamic && controlIdParsed.value)
        ? controlIdParsed.value
        : null;
      const hasDynamicId = controlIdParsed.isNonEmpty && controlIdParsed.isDynamic;
      const hasExplicitLabel = !!controlId && labelForTargets.has(controlId);

      // Component-aware label resolution: check for `label` prop on wrapper components
      let hasLabelProp = false;
      let labelPropIsDynamic = false;
      if (isReactComponent && A5_WRAPPER_COMPONENT_MAP[tag]) {
        const labelPropParsed = parseA5AttributeFromTag(fullMatch, 'label');
        if (labelPropParsed.present && labelPropParsed.isNonEmpty) {
          hasLabelProp = true;
          labelPropIsDynamic = labelPropParsed.isDynamic;
        }
      }

      const beforeControl = content.slice(Math.max(0, index - 500), index);
      const lastLabelOpen = Math.max(beforeControl.lastIndexOf('<label'), beforeControl.lastIndexOf('<Label'));
      const lastLabelClose = Math.max(beforeControl.lastIndexOf('</label'), beforeControl.lastIndexOf('</Label'));
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const isInFormControl = formControlRanges.some(r => index >= r.start && index <= r.end);

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel || isInFormControl || (hasLabelProp && !labelPropIsDynamic);
      const hasDynamicLabelOnly = hasLabelProp && labelPropIsDynamic && !hasAriaLabel && !hasAriaLabelledBy && !hasExplicitLabel && !isWrappedInLabel && !isInFormControl;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      const nameParsed = parseA5AttributeFromTag(fullMatch, 'name');
      const elementNameAttr = (nameParsed.isNonEmpty && nameParsed.value ? nameParsed.value : '') || controlId || '';
      const label = placeholder || elementNameAttr || `<${displayTag}> control`;
      const fileName = filePath.split('/').pop() || filePath;

      // Build selector hints
      const selectorHints: string[] = [];
      if (controlId) selectorHints.push(`id="${controlId}"`);
      else if (hasDynamicId) selectorHints.push('id=(dynamic)');
      if (nameParsed.isNonEmpty && nameParsed.value) selectorHints.push(`name="${nameParsed.value}"`);
      if (hasAriaLabel && ariaLabelParsed.evidence) selectorHints.push(ariaLabelParsed.evidence);
      if (hasAriaLabelledBy && ariaLabelledByParsed.evidence) selectorHints.push(ariaLabelledByParsed.evidence);

      // Determine labeling method (include evidence)
      let labelingMethod = '';
      if (isInFormControl) labelingMethod = 'FormLabel/FormControl (shadcn)';
      else if (hasLabelProp && !labelPropIsDynamic) labelingMethod = 'label prop (wrapper)';
      else if (hasAriaLabel) labelingMethod = ariaLabelParsed.evidence || 'aria-label';
      else if (hasAriaLabelledBy) labelingMethod = ariaLabelledByParsed.evidence || 'aria-labelledby';
      else if (hasExplicitLabel) labelingMethod = `label[htmlFor="${controlId}"]`;
      else if (isWrappedInLabel) labelingMethod = 'wrapping <label>';
      else if (hasDynamicLabelOnly) labelingMethod = 'label prop (dynamic — not verified)';

      if (controlId && hasExplicitLabel) {
        const idCount = idCounts.get(controlId) || 0;
        if (idCount > 1) {
          const dedupeKey = `A5.3|${filePath}|${controlId}|duplicate`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            findings.push({
              elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
              inputSubtype, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.3', subCheckLabel: 'Broken label association', classification: 'confirmed',
              detection: `Duplicate id="${controlId}"`, evidence: `<${displayTag} id="${controlId}"> at ${filePath}:${lineNumber}`,
              explanation: `Multiple elements share id="${controlId}", creating ambiguous label association.`,
              confidence: 0.92,
              correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nDuplicate id="${controlId}".\n\nRecommended fix:\nAssign unique ids and update <label for> attributes.`,
              deduplicationKey: dedupeKey,
              selectorHints, controlId, labelingMethod: 'broken (duplicate id)',
              startLine: lineNumber, endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
            });
          }
          continue;
        }
      }

      if (hasValidLabel) continue;

      // Dynamic label prop on wrapper → downgrade to Potential
      if (hasDynamicLabelOnly) {
        const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}|dynamic-label`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.1', subCheckLabel: 'Missing label association',
            classification: 'potential',
            detection: `<${displayTag}> has label prop but value is dynamic — not statically verifiable`,
            evidence: `<${displayTag}> at ${filePath}:${lineNumber} — label prop present but runtime-dependent`,
            explanation: `Wrapper component <${displayTag}> has a label prop with a dynamic value that cannot be statically verified as non-empty.`,
            confidence: 0.50,
            potentialSubtype: 'borderline',
            deduplicationKey: dedupeKey,
            selectorHints,
            controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined),
            labelingMethod,
            startLine: lineNumber, endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        }
        continue;
      }

      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label', classification: 'confirmed',
            detection: `<${displayTag}> placeholder-only label`, evidence: `<${displayTag} placeholder="${placeholder}"> at ${filePath}:${lineNumber}`,
            explanation: `Placeholder "${placeholder}" is the only label. Placeholders are not sufficient labels.`,
            confidence: 0.95,
            correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nPlaceholder-only label.\n\nRecommended fix:\nAdd a <label> or aria-label/aria-labelledby.`,
            deduplicationKey: dedupeKey,
            selectorHints, controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined), labelingMethod: 'none (placeholder only)',
            startLine: lineNumber, endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        }
        continue;
      }

      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({
          elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
          inputSubtype, sourceLabel: label, filePath, componentName,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
          detection: `<${displayTag}> has no label`, evidence: `<${displayTag}> at ${filePath}:${lineNumber}`,
          explanation: `Form control has no accessible name.`,
          confidence: 0.97,
          correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nNo programmatic label.\n\nRecommended fix:\nAdd a <label> or aria-label/aria-labelledby.`,
          deduplicationKey: dedupeKey,
          selectorHints, controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined), labelingMethod: 'none',
          startLine: lineNumber, endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
        });
      }
    }

    let match: RegExpExecArray | null;

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
        startLine: lineNumber,
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
        startLine: lineNumber2,
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

      const strippedOfTags = innerContent.replace(/<[^>]*>/g, '');
      const visibleText = strippedOfTags.replace(/\{[^}]*\}/g, '').trim();
      if (visibleText.length > 0) return;

      // Check for JSX expression children that likely render text
      const exprMatches = strippedOfTags.match(/\{([^}]+)\}/g);
      if (exprMatches) {
        const TEXT_PROP_SUFFIXES = /\.(label|name|title|text|caption|heading|description|content|displayName|value)\s*\}$/;
        const SINGLE_IDENT = /^\{\s*[a-zA-Z_$][\w$]*\s*\}$/;
        const TEMPLATE_LITERAL = /^\{\s*`[^`]*`\s*\}$/;
        const I18N_CALL = /^\{\s*(?:t|i18n\.t|formatMessage|intl\.formatMessage)\s*\(/;
        for (const expr of exprMatches) {
          if (TEXT_PROP_SUFFIXES.test(expr) || SINGLE_IDENT.test(expr) || TEMPLATE_LITERAL.test(expr) || I18N_CALL.test(expr)) {
            return;
          }
        }
      }

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
const DETERMINISTIC_CODE_RULES = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
const HYBRID_RULES_SET_GH = new Set(['U1', 'U2', 'U3', 'U5', 'E1', 'E3']);

function buildCodeAnalysisPrompt(selectedRules: string[]) {
  const selectedRulesSet = new Set(selectedRules);
  // DETERMINISTIC rules (A1, A2, A3-A6) are NEVER sent to LLM
  const accessibilityRulesForLLM = rules.accessibility.filter(r => 
    !DETERMINISTIC_CODE_RULES.has(r.id) && selectedRulesSet.has(r.id)
  );
  
  return `You are an expert UI/UX code auditor performing static analysis of source code from a GitHub repository.
This analysis uses a Two-Layer Hybrid Architecture:
- Accessibility rules A1, A2, A3, A4, A5, A6 are evaluated by the DETERMINISTIC engine (regex/static analysis). Do NOT report findings for these rules.
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

### U2 (Incomplete / Unclear Navigation) — WAYFINDING-ONLY ASSESSMENT:
**NOTE:** U2 deterministic sub-checks (U2.D1, U2.D2, U2.D3) run separately via static analysis.
Your role is ONLY to provide optional LLM reinforcement when deterministic D2 signals are ambiguous.

**U2 EVALUATES ONLY (web/desktop wayfinding):**
- Can users know where they are? (active page indicator, page heading)
- Can users know where they can go? (visible navigation, discoverable menu)
- Can users navigate back/up in deep contexts? (back button, breadcrumb, parent link)

**U2 MUST NOT EVALUATE (anti-overlap):**
- Step-based forms, progress indicators, missing step context → U4
- Layout grouping, sections, card structure → U6
- Inability to go back/exit/cancel a flow → E3
- Content truncation or hidden overflow → U3
- Accessibility landmark semantics → A-rules

**CRITICAL:** Do NOT flag just because breadcrumbs are missing. Active nav highlight + page heading = sufficient wayfinding.
**CRITICAL:** Do NOT generate findings about breadcrumb depth, shallow breadcrumbs, or breadcrumbs not reflecting deeper navigation. Breadcrumb-depth analysis is handled EXCLUSIVELY by the deterministic D3 gate. Any LLM breadcrumb-depth finding will be discarded.

**CLASSIFICATION:**
- U2 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- NEVER generate corrective prompts for U2
- Confidence: 0.60–0.80 (cap at 0.80)

${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U1').map(r => `- ${r.id}: ${r.name}`).join('\n')}

### U4 (Recognition-to-Recall Regression) — LLM-MANDATORY EVALUATION:
**ALL U4 subtypes require YOUR decision. Deterministic analysis extracted CANDIDATES in \`[U4_EVIDENCE_BUNDLE]\`. You are the SOLE decision maker.**

**GLOBAL CONSTRAINTS (MANDATORY):**
- U4 MUST NEVER output "confirmed". Status is ALWAYS "potential".
- Maximum confidence: 0.65. Range: 0.45–0.65.
- If evidence is ambiguous → SUPPRESS (do not report).
- If categorical intent cannot be verified → SUPPRESS.
- Do NOT assume text inputs require structured selection.
- Do NOT infer enum expectation from generic labels: reason, message, description, notes, details.
- U4 must prioritize false-positive avoidance over sensitivity. You are ALLOWED to decline reporting.
- Truncation/overflow issues are U3 scope — never flag under U4.

**EVALUATION QUESTIONS (answer for each candidate):**
1. Does this reduce recognition-based interaction?
2. Is recall burden plausibly increased?
3. Are there visible mitigations?
4. Is semantic intent clearly categorical?
If ANY answer is "no" or "uncertain" → SUPPRESS.

**U4.1 (Structured Selection → Free-Text):**
Report ONLY if: strong evidence the field represents a FINITE categorical domain AND no structured input exists AND the field is NOT narrative/open-ended.
Suppress if: label implies open description, domain expectation unclear, no explicit enum evidence.

**U4.2 (Hidden Selection State):**
Report ONLY if: selection interaction exists AND active state is NOT visually persistent AND no visible badge/highlight/breadcrumb/summary exists.
Suppress if: active styling present, aria-selected present, context visible elsewhere.
**CRITICAL for U4.2:** If the mitigation signals include "active_state_in_component_definition", this means the shared component definition (e.g., components/ui/tabs.tsx) provides persistent active styling via data-[state=active] or similar. In this case you MUST output {"report":"no"} — the active indicator EXISTS in the component definition even if not visible in the page-level usage code.

**U4.3 (Multi-Step Context Regression):**
Report ONLY if: multi-step flow confirmed AND missing step indicator AND missing back navigation AND missing summary AND missing persistent context.
If ANY mitigation exists → SUPPRESS.

**U4.4 (Generic Context-Free CTAs):**
Report ONLY if: button text is generic AND action outcome is NOT contextually clarified nearby.
Suppress if: section heading clarifies action, page title clarifies context, action universally obvious (e.g., Login form).

**ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or variable names as evidence.
- Base conclusions ONLY on field labels, CTA text, nearby headings, and code context from the evidence bundles.
- If evidence is insufficient, return NO U4 finding.

**OUTPUT FOR U4 — STRUCTURED u4Elements (ALL Potential):**
\`\`\`json
{
  "ruleId": "U4",
  "ruleName": "Recognition-to-recall regression",
  "category": "usability",
  "isU4Aggregated": true,
  "u4Elements": [
    {
      "elementLabel": "\\"Category\\" text input",
      "elementType": "input",
      "location": "src/components/Form.tsx",
      "detection": "U4.1: Text input for categorical field with no selection component",
      "evidence": "Field expects structured category selection but only provides free-text input. Recognition → recall shift: user must remember valid categories instead of selecting from a list.",
      "subCheck": "U4.1",
      "subCheckLabel": "Structured Selection → Free-Text",
      "status": "potential",
      "recommendedFix": "Replace with <Select> or <Combobox>",
      "confidence": 0.60,
      "mitigationSummary": "No selection component, no autocomplete, no datalist"
    }
  ],
  "diagnosis": "Summary of U4 findings — recognition-to-recall shift explanation...",
  "confidence": 0.55
}
\`\`\`
- If NO U4 issues pass evaluation, do NOT include U4 in the violations array.
- Each u4Element MUST include: subCheck, status ("potential"), confidence (0.45–0.65), and mitigationSummary.
- The explanation/evidence MUST explicitly describe the recognition → recall shift.

### U6 (Weak Grouping / Layout Coherence) — LLM-ASSISTED EVALUATION:
**NOTE:** U6 uses pre-extracted layout evidence bundles appended as \`[U6_LAYOUT_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted layout cues to assess grouping/hierarchy.
**NOTE:** U6 is ONLY evaluated on page-like components (not router/config files). Files have already been filtered. Each bundle includes a trigger summary line: "Blocks:X Containers:Y Headings:Z SemanticSections:S Grid:true/false". Use these counts to ground your assessment.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or "test" wording as evidence.
- Do NOT infer developer intent from naming conventions.
- Base conclusions ONLY on the extracted layout evidence: headings, container counts, flex/grid usage, spacing tokens, repeated patterns, flat-stack cues, and the trigger summary counts.
- If evidence is insufficient to demonstrate weak grouping, return NO U6 finding — do not guess.
- If the trigger summary shows Containers >= 2, this indicates deliberate visual grouping — be very cautious about reporting.

**EVALUATE (using ONLY the layout evidence bundle, not file names):**
- Missing section separation: Related content not grouped into visual containers
- Inconsistent spacing hierarchy: Uneven or missing spacing tokens between groups
- Unclear grouping of related elements: Flat stacks of inputs/buttons without headings or wrappers
- Misalignment patterns: Mixed flex/grid usage suggesting alignment issues
- Clutter: Too many sibling elements at same nesting level without separation

**CLASSIFICATION:**
- U6 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80 (cap at 0.80)

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
      "evidence": "Blocks:8 Containers:0 Headings:1 — 12 sibling inputs without section headings or fieldset wrappers",
      "recommendedFix": "Group related fields into fieldsets with legends or add section headings",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of grouping/layout issues grounded in trigger summary counts...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U6 issues found, do NOT include U6 in the violations array.
- Each u6Element MUST cite evidence grounded in the trigger summary counts (Blocks, Containers, Headings — NOT file names).

### E1 (Insufficient Transparency in High-Impact Actions) — LLM-ASSISTED EVALUATION:
**NOTE:** E1 uses pre-extracted high-impact action evidence bundles appended as \`[E1_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/context to assess transparency.
**NOTE:** Actions with strong disclosure (irreversibility warnings, consequence lists) AND a confirmation dialog have ALREADY been filtered out. Do NOT re-flag suppressed actions.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("may be unclear", "transparency risk").
- Base conclusions ONLY on the extracted CTA labels, nearby UI text, and confirmation dialog presence/absence.
- If evidence is insufficient, return NO E1 finding — do not guess.
- Do NOT flag password reset, sign-in, sign-out, or other auth-flow actions.

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

### E2 (Imbalanced Choice Architecture in High-Impact Decisions) — LLM-ASSISTED EVALUATION:
**NOTE:** E2 uses pre-extracted choice bundle data appended as \`[E2_CHOICE_BUNDLE]\`. Each bundle has ALREADY passed the high-impact domain gate (consent/privacy, monetization, irreversible actions) and has 2+ deterministic imbalance signals.

**SCOPE — E2 flags ONLY when:**
- Multiple choice options are presented for a MEANINGFUL decision (consent, payment, subscription, data sharing, deletion), AND
- One option is visually dominant or frictionless, AND
- The alternative is visually suppressed, harder to find, or requires extra steps, AND
- This imbalance could steer users toward a system-beneficial outcome.

**MUST NOT FLAG:**
- Standard "Sign Up" (primary) + "Sign In" (secondary) on landing pages.
- Navigation links vs auth buttons on marketing pages.
- Standard marketing layout unless tied to consent/monetization/data/high-impact context.
- Role-based dashboard actions.
- Any cluster where BOTH options are clearly visible and accessible.

**ANTI-HALLUCINATION RULES:**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral phrasing.
- If evidence is insufficient, return NO E2 finding.

**CONFIDENCE (STRICT):**
- 0.55–0.65: Weak signals. 0.65–0.75: Multiple strong signals + clear high-impact context. NEVER exceed 0.75.

**OUTPUT:**
\`\`\`json
{
  "ruleId": "E2", "ruleName": "Imbalanced choice architecture in high-impact decision", "category": "ethics",
  "status": "potential", "isE2Aggregated": true,
  "e2Elements": [{ "elementLabel": "...", "elementType": "button-group", "location": "...", "detection": "...", "evidence": "...", "recommendedFix": "Present confirm/decline options with comparable visual weight and equal discoverability.", "confidence": 0.65 }],
  "diagnosis": "Summary...", "contextualHint": "...", "confidence": 0.65
}
\`\`\`
- If NO E2 issues found, do NOT include E2 in the violations array.

### E3 (Structural Absence of Exit/Cancel for High-Impact Actions) — HYBRID EVALUATION:
**NOTE:** E3 uses pre-extracted evidence bundles appended as \`[E3_CONTROL_RESTRICTION_EVIDENCE]\`. Use ONLY the provided structural evidence.

**SCOPE — E3 detects ONLY:**
- High-impact destructive/irreversible actions (delete, payment, subscribe, account deletion) that lack ANY structural exit mechanism (cancel, back, close, undo, dismiss, breadcrumb).

**E3 must NOT evaluate:**
- Visual bias between cancel and confirm buttons (belongs to E2)
- Missing consequence/transparency text (belongs to E1)
- Multi-step wizard usability or step indicators (belongs to U4)
- Forced marketing opt-ins or consent checkboxes (belongs to E1)

**HIGH-IMPACT ACTION GATE:** E3 triggers ONLY if a high-impact action is present (delete, payment, subscribe, account deletion, destructive variants). If NO high-impact action → do NOT report E3.

**STRUCTURAL CONTROL ABSENCE:** E3 triggers ONLY if NO structural exit exists near the high-impact action (cancel, back, close, undo, dismiss, breadcrumb, onClose handler). If ANY exists → SUPPRESS E3.

**SUPPRESSION:**
- Cancel exists but visually weaker → E2, NOT E3. Suppress.
- Consequence text missing but cancel exists → E1. Suppress.
- Step indicators or wizard navigation → U4. Suppress.

**CLASSIFICATION:**
- E3 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.65–0.80 (cap at 0.80). Suppress below 0.65.

**OUTPUT FOR E3 — STRUCTURED e3Elements:**
\`\`\`json
{
  "ruleId": "E3", "ruleName": "Obscured or restricted user control", "category": "ethics",
  "status": "potential", "isE3Aggregated": true,
  "e3Elements": [{ "elementLabel": "Delete dialog without cancel", "elementType": "dialog", "location": "...", "subCheck": "E3.D1", "detection": "...", "evidence": "...", "recommendedFix": "...", "confidence": 0.78 }]
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

// ========== U4 CANDIDATE EXTRACTION (Recognition-to-Recall Regression) — TWO-STAGE ==========
// Stage 1: Deterministic candidate extraction ONLY — no classification, no emission.

interface U4Candidate {
  candidateType: 'U4.1' | 'U4.2' | 'U4.3' | 'U4.4';
  elementLabel: string;
  elementType: string;
  filePath: string;
  codeSnippet: string;
  nearbyHeadings: string[];
  mitigationSignals: string[];
  rawEvidence: string;
}

const U4_STRUCTURED_LABEL_RE = /\b(category|type|status|specialty|department|gender|country|state|province|region|language|currency|priority|severity|role|level|grade|plan|tier|occupation|industry|marital|blood\s*type|ethnicity|nationality|education|degree|sport|position|brand|model|color|size|material|condition|source|channel|frequency|method|mode|format|platform|device)\b/i;
const U4_FREEFORM_LABEL_RE = /\b(note|notes|comment|comments|description|details|message|reason|bio|biography|about|story|narrative|explain|additional|other|remarks|feedback|suggestion|instructions|address|street|thoughts|opinion|custom|free.?text)\b/i;
const U4_SELECTION_RE = /<(?:Select|RadioGroup|Radio|CheckboxGroup|Combobox|Autocomplete|Listbox|ToggleGroup|SegmentedControl|Dropdown|DropdownMenu)\b|<(?:select|datalist)\b|\b(?:autocomplete|datalist|onSuggest|filterOptions|combobox)\b/i;
const U4_STANDARD_AUTH_CTAS = /^(Sign\s*In|Sign\s*Up|Log\s*In|Log\s*Out|Register|Create\s*Account|Go\s*to\s*Dashboard|Go\s*Home|Back\s*to\s*Home|Back\s*to\s*Login|Forgot\s*Password|Reset\s*Password|Verify\s*Email|Resend\s*Code|Resend\s*Email|Sign\s*Out|Logout)$/i;

function extractU4Candidates(allFiles: Map<string, string>): U4Candidate[] {
  const candidates: U4Candidate[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules')) continue;

    const lines = content.split('\n');

    const getHeadings = (lineNum: number, range: number): string[] => {
      const ctxStart = Math.max(0, lineNum - range);
      const ctxEnd = Math.min(lines.length, lineNum + range);
      const nearby = lines.slice(ctxStart, ctxEnd).join('\n');
      const headings: string[] = [];
      const hRe = /<h([1-6])\b[^>]*>([^<]{2,60})<\/h\1>/gi;
      let hm;
      while ((hm = hRe.exec(nearby)) !== null) headings.push(hm[2].replace(/\{[^}]*\}/g, '').trim());
      return headings;
    };

    const getSnippet = (lineNum: number, range: number): string => {
      const ctxStart = Math.max(0, lineNum - range);
      const ctxEnd = Math.min(lines.length, lineNum + range);
      return lines.slice(ctxStart, ctxEnd).join('\n');
    };

    // ---- U4.1 Candidates ----
    const inputRe = /<(?:Input|input|textarea|Textarea)\b([^>]*?)(?:\/>|>)/gi;
    let m;
    while ((m = inputRe.exec(content)) !== null) {
      const attrs = m[1] || '';
      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputType = typeMatch?.[1] || typeMatch?.[2] || 'text';
      if (!['text', ''].includes(inputType.toLowerCase())) continue;

      const labelMatch = attrs.match(/(?:label|aria-label|name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const label = labelMatch?.[1] || labelMatch?.[2] || '';
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';
      const fieldText = `${label} ${placeholder}`.trim();

      if (!fieldText || !U4_STRUCTURED_LABEL_RE.test(fieldText)) continue;
      if (U4_FREEFORM_LABEL_RE.test(fieldText)) continue;
      if (/optional/i.test(attrs)) continue;

      const lineNum = content.substring(0, m.index).split('\n').length;
      const nearbyContent = getSnippet(lineNum, 30);
      const mitigations: string[] = [];
      if (U4_SELECTION_RE.test(nearbyContent)) mitigations.push('selection_component_nearby');
      if (/autocomplete/i.test(attrs)) mitigations.push('autocomplete_present');

      candidates.push({
        candidateType: 'U4.1', elementLabel: `"${label || placeholder}" text input`,
        elementType: 'input', filePath, codeSnippet: getSnippet(lineNum, 8),
        nearbyHeadings: getHeadings(lineNum, 15), mitigationSignals: mitigations,
        rawEvidence: `Text input with label/placeholder "${fieldText}". Matched keyword: "${fieldText.match(U4_STRUCTURED_LABEL_RE)?.[0] || ''}". ${mitigations.length > 0 ? 'Mitigations: ' + mitigations.join(', ') : 'No nearby selection component or autocomplete.'}`,
      });
    }

    // ---- U4.2 Candidates ----
    const ACTIVE_STATE_RE = /\b(bg-primary|bg-accent|aria-selected|aria-current|aria-pressed|isActive|isSelected|data-state\s*=\s*"active"|data-active|activeTab|selectedTab|currentTab|activeIndex|selectedIndex|variant\s*=.*default)\b/i;
    const COMPONENT_DEF_ACTIVE_RE = /data-\[state=active\]:|data-state\s*=\s*["']active["']|aria-selected|\.active\b|isActive|isSelected|&\[data-state="active"\]/i;

    // Helper: resolve import path for a component and check its definition for active state styling
    const resolveComponentActiveState = (componentNames: string[]): { found: boolean; sourceFile: string; evidence: string } => {
      for (const cName of componentNames) {
        const importRe = new RegExp(`import\\s+\\{[^}]*\\b${cName}\\b[^}]*\\}\\s+from\\s+['"]([@./][^'"]+)['"]`, 'i');
        const importMatch = content.match(importRe);
        if (!importMatch) continue;
        const importPath = importMatch[1];

        const candidatePaths: string[] = [];
        if (importPath.startsWith('@/')) {
          const rel = importPath.slice(2);
          candidatePaths.push(`${rel}.tsx`, `${rel}.ts`, `${rel}/index.tsx`, `${rel}/index.ts`);
          candidatePaths.push(`src/${rel}.tsx`, `src/${rel}.ts`, `src/${rel}/index.tsx`, `src/${rel}/index.ts`);
        } else {
          const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
          const segments = importPath.replace(/^\.\//, '').split('/');
          let resolved = fileDir;
          for (const seg of segments) {
            if (seg === '..') resolved = resolved.includes('/') ? resolved.substring(0, resolved.lastIndexOf('/')) : '';
            else resolved = resolved ? `${resolved}/${seg}` : seg;
          }
          candidatePaths.push(`${resolved}.tsx`, `${resolved}.ts`, `${resolved}/index.tsx`, `${resolved}/index.ts`);
        }

        for (const cp of candidatePaths) {
          for (const tryPath of [cp, cp.replace(/^src\//, '')]) {
            for (const [fPath, fContent] of allFiles) {
              const normalizedFPath = fPath.replace(/\\/g, '/').replace(/^\.\//, '');
              if (normalizedFPath === tryPath || normalizedFPath.endsWith('/' + tryPath) || normalizedFPath === 'src/' + tryPath) {
                if (COMPONENT_DEF_ACTIVE_RE.test(fContent)) {
                  return { found: true, sourceFile: normalizedFPath, evidence: `Component definition in ${normalizedFPath} includes active state styling (data-[state=active]: or similar)` };
                }
              }
            }
          }
        }
      }
      return { found: false, sourceFile: '', evidence: '' };
    };

    const selectionPatterns = [
      { re: /<(?:Tabs|TabsList|TabsTrigger)\b/gi, label: 'Tabs component', type: 'tab', resolveNames: ['TabsTrigger', 'Tabs', 'TabsList'] },
      { re: /<(?:ToggleGroup|ToggleGroupItem)\b/gi, label: 'Toggle group', type: 'toggle', resolveNames: ['ToggleGroupItem', 'ToggleGroup'] },
    ];
    for (const pat of selectionPatterns) {
      pat.re.lastIndex = 0;
      let pm;
      while ((pm = pat.re.exec(content)) !== null) {
        const lineNum = content.substring(0, pm.index).split('\n').length;
        const nearbyContent = getSnippet(lineNum, 20);
        const mitigations: string[] = [];
        if (ACTIVE_STATE_RE.test(nearbyContent)) mitigations.push('active_state_indicator');
        if (/className.*\b(active|selected)\b/i.test(nearbyContent)) mitigations.push('active_class');

        // Component-aware: resolve import and check component definition for active state
        const componentCheck = resolveComponentActiveState(pat.resolveNames);
        if (componentCheck.found) {
          mitigations.push('active_state_in_component_definition');
        }

        // SUPPRESS entirely if component definition provides active state styling
        if (mitigations.includes('active_state_in_component_definition')) {
          console.log(`U4.2 SUPPRESSED for ${pat.label} in ${filePath}: ${componentCheck.evidence}`);
          break;
        }

        candidates.push({
          candidateType: 'U4.2', elementLabel: pat.label, elementType: pat.type, filePath,
          codeSnippet: getSnippet(lineNum, 10), nearbyHeadings: getHeadings(lineNum, 15),
          mitigationSignals: mitigations,
          rawEvidence: `${pat.label} detected. ${mitigations.length > 0 ? 'Active state signals: ' + mitigations.join(', ') : 'No active state indicator found within ±20 lines AND no active styling in resolved component definition.'}`,
        });
        break;
      }
    }

    // ---- U4.3 Candidates (Conservative multi-step detection) ----
    const STEP_INDEX_RE = /\b(step|currentStep|activeStep|stepIndex)\b\s*[=<>!]/i;
    if (STEP_INDEX_RE.test(content)) {
      // --- stepCount: derive ONLY from explicit sources ---
      let stepCount: number | 'unknown' = 'unknown';
      let stepCountSource: 'array' | 'stepper' | 'state-based' | 'unknown' = 'unknown';
      let stepLabels: string[] = [];

      // Source A: Explicit steps array with label properties
      const stepArrayMatch = content.match(/(?:steps|STEPS|stepsConfig|STEP_CONFIG)\s*=\s*\[([^\]]{10,})\]/s);
      if (stepArrayMatch) {
        const arrayContent = stepArrayMatch[1];
        const labelMatches = arrayContent.match(/(?:label|title|name)\s*:\s*["'`]([^"'`]+)["'`]/gi);
        if (labelMatches && labelMatches.length >= 2) {
          stepCount = labelMatches.length;
          stepCountSource = 'array';
          stepLabels = labelMatches.map(lm => {
            const v = lm.match(/["'`]([^"'`]+)["'`]/);
            return v?.[1] || '';
          }).filter(Boolean);
        }
      }

      // Source B: Stepper/Progress component with multiple step items rendered in JSX
      if (stepCount === 'unknown') {
        const stepperItemRe = /<(?:Step|StepItem|StepTrigger|StepperItem)\b[^>]*>/gi;
        const stepperItems = content.match(stepperItemRe);
        if (stepperItems && stepperItems.length >= 2) {
          stepCount = stepperItems.length;
          stepCountSource = 'stepper';
        }
      }

      // Source C: Conditional render branches tied to a SINGLE step state variable
      if (stepCount === 'unknown') {
        for (const varName of ['step', 'currentStep', 'activeStep', 'stepIndex']) {
          const re = new RegExp(`\\b${varName}\\b\\s*===?\\s*(\\d+)`, 'g');
          const matches = content.match(re);
          if (matches) {
            const uniqueValues = new Set(matches.map(m => m.match(/(\d+)$/)?.[1]));
            if (uniqueValues.size >= 2 && uniqueValues.size <= 10) {
              stepCount = uniqueValues.size;
              stepCountSource = 'state-based';
              break;
            }
          }
        }
      }

      if (stepCount !== 'unknown' ? stepCount >= 2 : STEP_INDEX_RE.test(content)) {
        let hasStepIndicator: boolean | 'unknown' = 'unknown';
        if (stepLabels.length >= 2) hasStepIndicator = true;
        if (hasStepIndicator !== true && /<(?:Stepper|Steps|StepIndicator|StepList)\b/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /Step\s+\d+\s+of\s+\d+/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /Step\s+\{[^}]*\}\s*(?:of|\/)\s*\{[^}]*\}/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /aria-current\s*=\s*["']step["']/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /role\s*=\s*["']tablist["']/i.test(content) && STEP_INDEX_RE.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /\.map\b[^)]*=>\s*[^)]*(?:step|s)\.(?:label|title|name)\b/i.test(content)) hasStepIndicator = true;

        let hasBackNav: boolean | 'unknown' = 'unknown';
        const backLabelRe = />\s*(Previous|Back|Go\s*[Bb]ack|Return)\s*</i;
        if (backLabelRe.test(content)) hasBackNav = true;
        if (hasBackNav !== true && /<(?:Button|button)\b[^>]*(?:aria-label|title)\s*=\s*["'](?:Previous|Back|Go\s*back|Return)["'][^>]*>/i.test(content)) hasBackNav = true;
        if (hasBackNav !== true && /\b(?:setStep|setCurrentStep|setActiveStep)\s*\(\s*(?:\w+\s*(?:=>|-)|\(\s*\w+\s*\)\s*=>)\s*\w+\s*-\s*1\b/i.test(content)) hasBackNav = true;
        if (hasBackNav !== true && /\bstep\s*-\s*1\b/i.test(content) && /\b(?:setStep|setCurrentStep|setActiveStep)\b/i.test(content)) hasBackNav = true;

        let persistentContext: boolean | 'unknown' = 'unknown';
        if (/(?:selected(?:Location|Doctor|Service|Date|Time|Item|Plan|Option|Specialty|Provider|Slot)|chosen(?:Plan|Option|Service|Doctor|Location))\b/.test(content)) {
          if (/\{[^}]*selected(?:Location|Doctor|Service|Date|Time|Item|Plan|Option|Specialty|Provider|Slot)[^}]*\}/i.test(content)) {
            persistentContext = true;
          }
        }
        if (persistentContext !== true && /<(?:Breadcrumb|BreadcrumbItem|BreadcrumbLink)\b/i.test(content)) persistentContext = true;
        if (persistentContext !== true && /(?:summary|recap|overview|selected-items|selection-panel)\b/i.test(content) && /\{[^}]*selected/i.test(content)) persistentContext = true;

        let summaryStep: boolean | 'unknown' = 'unknown';
        const hasSummaryHeading = /(?:Review|Review\s*(?:&|and)\s*Confirm|Summary|Confirm\s*(?:&|and)\s*Book|Confirmation)\b/i.test(content);
        if (hasSummaryHeading) {
          if (/\{[^}]*(?:selected|chosen|formData|appointmentData|bookingData)/i.test(content)) {
            summaryStep = true;
          } else {
            summaryStep = 'unknown';
          }
        } else {
          summaryStep = false;
        }

        const shouldSuppress = (
          (hasStepIndicator === true && hasBackNav === true) ||
          (persistentContext === true && summaryStep === true && hasBackNav !== false) ||
          (typeof stepCount === 'number' && stepCount <= 4 && hasStepIndicator === true)
        );

        if (shouldSuppress) {
          console.log(`U4.3 SUPPRESSED for ${filePath}: stepCount=${stepCount}, hasStepIndicator=${hasStepIndicator}, hasBackNav=${hasBackNav}, persistentContext=${persistentContext}, summaryStep=${summaryStep}`);
        } else {
          const sendToLLM = (
            ((typeof stepCount === 'number' && stepCount >= 5) || stepCount === 'unknown') &&
            hasStepIndicator !== true &&
            persistentContext !== true
          );

          if (sendToLLM) {
            let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || '';
            const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
            if (exportedFn?.[1]) componentName = exportedFn[1];
            const stepLine = content.search(STEP_INDEX_RE);
            const lineNum = stepLine >= 0 ? content.substring(0, stepLine).split('\n').length : 1;

            candidates.push({
              candidateType: 'U4.3',
              elementLabel: `${componentName} (${stepCount === 'unknown' ? 'unknown' : stepCount}-step flow)`,
              elementType: 'wizard', filePath, codeSnippet: getSnippet(lineNum, 15),
              nearbyHeadings: getHeadings(lineNum, 20), mitigationSignals: [
                `stepCount=${stepCount} (source: ${stepCountSource})`,
                `hasStepIndicator=${hasStepIndicator}`,
                `hasBackNav=${hasBackNav}`,
                `persistentContext=${persistentContext}`,
                `summaryStep=${summaryStep}`,
                ...(stepLabels.length > 0 ? [`stepLabels: ${stepLabels.join(', ')}`] : []),
              ],
              rawEvidence: `Multi-step flow detected (stepCount=${stepCount}, source=${stepCountSource}). hasStepIndicator=${hasStepIndicator}, hasBackNav=${hasBackNav}, persistentContext=${persistentContext}, summaryStep=${summaryStep}. ${stepLabels.length > 0 ? 'Step labels: ' + stepLabels.join(', ') + '.' : ''} Not suppressed — sent to LLM for evaluation.`,
            });
          } else {
            console.log(`U4.3 NOT SENT TO LLM for ${filePath}: stepCount=${stepCount}, hasStepIndicator=${hasStepIndicator}, persistentContext=${persistentContext} — does not meet LLM send criteria.`);
          }
        }
      }
    }

    // ---- U4.4 Candidates ----
    const GENERIC_CTA_RE = /^(Next|Continue|Submit|Confirm|OK|Done|Proceed|Go|Save|Apply|Accept)$/i;
    const btnRe = /<(?:Button|button)\b[^>]*>([^<]{1,40})<\/(?:Button|button)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[1].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      if (U4_STANDARD_AUTH_CTAS.test(label)) continue;
      if (!GENERIC_CTA_RE.test(label)) continue;

      const lineNum = content.substring(0, bm.index).split('\n').length;
      const nearby = getSnippet(lineNum, 10);
      const transitionsStep = /\b(setStep|nextStep|activeStep|step\s*\+|step\s*\+=)\b/i.test(nearby);
      const commitsData = /\b(onSubmit|handleSubmit|mutate|\.insert|\.update|fetch\(|axios)\b/i.test(nearby);
      if (!transitionsStep && !commitsData) continue;

      const headings = getHeadings(lineNum, 10);
      const mitigations: string[] = [];
      if (headings.length > 0) mitigations.push(`nearby_headings: ${headings.join(', ')}`);

      candidates.push({
        candidateType: 'U4.4', elementLabel: `"${label}" button`, elementType: 'button', filePath,
        codeSnippet: getSnippet(lineNum, 8), nearbyHeadings: headings, mitigationSignals: mitigations,
        rawEvidence: `Generic CTA "${label}". ${transitionsStep ? 'Transitions step.' : ''} ${commitsData ? 'Commits data.' : ''} ${headings.length > 0 ? 'Nearby headings: ' + headings.join(', ') : 'No nearby headings.'}`,
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter(c => {
    const key = `${c.filePath}|${c.candidateType}|${c.elementLabel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function formatU4CandidatesForLLM(candidates: U4Candidate[]): string {
  if (candidates.length === 0) return '';
  const lines: string[] = [];
  lines.push('[U4_EVIDENCE_BUNDLE]');
  lines.push('CANDIDATE regions detected by static analysis. You MUST evaluate each and decide: REPORT or SUPPRESS.');
  lines.push('You are the SOLE decision maker. Do NOT auto-confirm. Status is ALWAYS "potential". Max confidence: 0.65.');
  lines.push('For each: (1) Does this reduce recognition-based interaction? (2) Is recall burden plausibly increased? (3) Are there visible mitigations? (4) Is semantic intent clearly categorical?');
  lines.push('If ANY answer uncertain → SUPPRESS.');
  lines.push('');
  for (const c of candidates) {
    lines.push(`--- ${c.candidateType} CANDIDATE ---`);
    lines.push(`Element: ${c.elementLabel} (${c.elementType})`);
    lines.push(`File: ${c.filePath}`);
    lines.push(`Evidence: ${c.rawEvidence}`);
    if (c.mitigationSignals.length > 0) lines.push(`Mitigations: ${c.mitigationSignals.join(', ')}`);
    if (c.nearbyHeadings.length > 0) lines.push(`Nearby headings: ${c.nearbyHeadings.join(', ')}`);
    lines.push(`Code:\n${c.codeSnippet.slice(0, 400)}`);
    lines.push('');
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
  disclosureTermsFound: string[];
  frictionMechanisms: string[];
  suppressed: boolean;
  suppressionReason?: string;
}

// Strict high-impact keyword list — excludes "reset", "accept", "agree" (too broad)
const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove\s*account|close\s*account|permanently\s*delete|destroy|erase|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay\b|upgrade|checkout|confirm\s*(?:order|purchase|payment)|finalize|publish|authorize|grant\s*access|share\s*data|export\s*data|connect\s*account)\b/i;

const E1_AUTH_FLOW_PATH = /(?:forgot.?password|reset.?password|sign.?in|sign.?up|login|register|auth|verify.?email|confirm.?email)/i;
const E1_AUTH_EXCLUDED_LABELS = /\b(send\s*reset\s*link|reset\s*password|sign\s*in|sign\s*up|log\s*in|log\s*out|sign\s*out|register|create\s*account|verify\s*email|resend\s*code|resend\s*link)\b/i;
const E1_OVERRIDE_IN_AUTH = /\b(delete|erase|destroy|permanently|purchase|pay\b|subscribe|checkout|billing)\b/i;

const E1_WARNING_WORDS = /\b(permanent|cannot\s*be\s*undone|irreversible|this\s*action|will\s*be\s*(?:deleted|removed|lost)|are\s*you\s*sure|caution|warning|permanently\s*(?:remove|delete|erase)|data\s*will\s*be\s*removed)\b/i;
const E1_PRICING_WORDS = /\b(\$\d|\€\d|\£\d|USD|EUR|per\s*month|\/mo|\/year|billing|subscription\s*(?:fee|cost|price)|free\s*trial|charged)\b/i;
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|confirmation|modal|Dialog)\b/i;

const E1_STRONG_DISCLOSURE_RE = /\b(cannot\s*be\s*undone|irreversible|permanent(?:ly)?|will\s*be\s*(?:deleted|removed|lost|erased)|this\s*(?:action|cannot)|data\s*will\s*be\s*removed|all\s*(?:your\s*)?data|appointments|messages|records|files)\b/gi;
const E1_FRICTION_TYPE_CONFIRM = /\b(type\s*["']?DELETE|type\s*["']?CONFIRM|type\s*to\s*confirm|enter\s*["']?delete)\b/i;
const E1_FRICTION_CHECKBOX = /(?:<(?:Checkbox|checkbox|input)\b[^>]*(?:type\s*=\s*["']checkbox["']))[^>]*(?:acknowledge|confirm|understand|agree|consent|irreversible|permanent)/i;
const E1_FRICTION_DOUBLE_CONFIRM = /(?:Are\s*you\s*(?:sure|certain)|Confirm\s*(?:deletion|removal|action)|This\s*will\s*permanently)/i;

function extractE1DisclosureTerms(text: string): string[] {
  const terms: string[] = [];
  E1_STRONG_DISCLOSURE_RE.lastIndex = 0;
  let m;
  while ((m = E1_STRONG_DISCLOSURE_RE.exec(text)) !== null) {
    const term = m[1].toLowerCase().trim();
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function extractE1FrictionMechanisms(text: string): string[] {
  const mechanisms: string[] = [];
  if (E1_FRICTION_TYPE_CONFIRM.test(text)) mechanisms.push('type-to-confirm');
  if (E1_FRICTION_CHECKBOX.test(text)) mechanisms.push('checkbox');
  if (E1_FRICTION_DOUBLE_CONFIRM.test(text)) mechanisms.push('double-confirm');
  return mechanisms;
}

function extractE1EvidenceBundle(allFiles: Map<string, string>): E1EvidenceBundle[] {
  const bundles: E1EvidenceBundle[] = [];
  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // AUTH-FLOW EXCLUSION
    const isAuthFlow = E1_AUTH_FLOW_PATH.test(filePath);
    if (isAuthFlow && !E1_OVERRIDE_IN_AUTH.test(content)) {
      console.log(`E1 SUPPRESSED (auth-flow file): ${filePath}`);
      continue;
    }

    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const attrs = bm[1] || '';
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      if (E1_AUTH_EXCLUDED_LABELS.test(label)) continue;
      if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_HIGH_IMPACT_KEYWORDS.test(attrs)) continue;

      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';
      if (/\b(share\s*data|export\s*data|grant\s*access|connect\s*account|authorize)\b/i.test(label)) ctaType = 'data-sharing';

      const regionStart = Math.max(0, bm.index - 500);
      const regionEnd = Math.min(content.length, bm.index + bm[0].length + 500);
      const region = content.slice(regionStart, regionEnd);

      const nearbyText: string[] = [];
      const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
      let hm;
      while ((hm = hRe.exec(region)) !== null) nearbyText.push(`h${hm[1]}: ${hm[2].replace(/\{[^}]*\}/g, '').trim()}`);
      const pRe = /<(?:p|span|div|label)\b[^>]*>([^<]{3,150})<\/(?:p|span|div|label)>/gi;
      let pm;
      while ((pm = pRe.exec(region)) !== null) {
        const text = pm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3 && text.length <= 150) nearbyText.push(text);
      }

      const hasWarningText = E1_WARNING_WORDS.test(region);
      const hasPricingText = E1_PRICING_WORDS.test(region);
      const hasConfirmationDialog = E1_CONFIRMATION_PATTERNS.test(content);
      const disclosureTermsFound = extractE1DisclosureTerms(content);
      const frictionMechanisms = extractE1FrictionMechanisms(content);

      // DISCLOSURE + CONFIRMATION PASS-THROUGH
      const hasStrongDisclosure = disclosureTermsFound.length > 0;
      const labelMentionsAction = /\b(delete|remove|erase|destroy|cancel|unsubscribe)\b/i.test(label);

      if (hasStrongDisclosure && hasConfirmationDialog) {
        console.log(`E1 SUPPRESSED (disclosure pass-through): "${label}" in ${filePath}`);
        continue;
      }

      bundles.push({
        filePath, ctaLabel: label, ctaType,
        nearbyText: [...new Set(nearbyText)].slice(0, 6),
        hasConfirmationDialog, hasWarningText, hasPricingText,
        disclosureTermsFound, frictionMechanisms, suppressed: false,
      });
    }
  }
  return bundles.slice(0, 20);
}

function formatE1EvidenceBundleForPrompt(bundles: E1EvidenceBundle[]): string {
  const activeBundles = bundles.filter(b => !b.suppressed);
  if (activeBundles.length === 0) return '';
  const lines = [
    '[E1_EVIDENCE_BUNDLE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence.',
    'NOTE: Actions with strong disclosure + confirmation have ALREADY been filtered out.',
  ];
  for (const b of activeBundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  CTA: "${b.ctaLabel}" (type: ${b.ctaType})`);
    if (b.nearbyText.length > 0) lines.push(`  Nearby text: ${b.nearbyText.join(' | ')}`);
    lines.push(`  Flags: confirmation=${b.hasConfirmationDialog}, warning=${b.hasWarningText}, pricing=${b.hasPricingText}`);
    if (b.disclosureTermsFound.length > 0) lines.push(`  Disclosure terms found: ${b.disclosureTermsFound.join(', ')}`);
    if (b.frictionMechanisms.length > 0) lines.push(`  Friction mechanisms: ${b.frictionMechanisms.join(', ')}`);
  }
  lines.push('[/E1_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== E2 CHOICE BUNDLE EXTRACTION (v2 — High-Impact Gate + Signal Scoring) ==========

const E2_HIGH_IMPACT_KEYWORDS_RE = /\b(accept|decline|cookie|consent|tracking|personalization|privacy|data|share|subscribe|trial|upgrade|buy|purchase|payment|card|delete|remove|cancel\s*plan|confirm|submit|discharge|book\s*appointment|final|cannot\s*be\s*undone)\b/gi;
const E2_EXCLUSION_LABELS = /^(sign\s*in|log\s*in|sign\s*up|register|get\s*started|learn\s*more|home|about|contact|pricing|features|blog|docs|documentation|faq|help|support)$/i;

interface E2ChoiceBundle {
  filePath: string;
  ctaLabels: { label: string; styleTokens: string; position: number }[];
  nearbyMicrocopy: string[];
  highImpactKeywords: string[];
  imbalanceSignals: string[];
  signalCount: number;
}

function detectE2ImbalanceSignals(ctaLabels: { label: string; styleTokens: string; position: number }[]): string[] {
  const signals: string[] = [];
  if (ctaLabels.length < 2) return signals;
  const styles = ctaLabels.map(c => c.styleTokens.toLowerCase());
  const labels = ctaLabels.map(c => c.label.toLowerCase());
  const hasPrimary = styles.some(s => /bg-|variant=default|variant=\s*$/.test(s) && !/variant=(ghost|link|outline|secondary)/.test(s));
  const hasGhostOrLink = styles.some(s => /variant=(ghost|link|outline)|text-(gray|muted|slate)|text-sm/.test(s));
  if (hasPrimary && hasGhostOrLink) signals.push('visual_dominance');
  const hasWFull = styles.some(s => /w-full|px-8|px-10|py-3|py-4/.test(s));
  const hasSmall = styles.some(s => /text-sm|text-xs|size=sm/.test(s));
  if (hasWFull && hasSmall) signals.push('size_asymmetry');
  const hasPositive = labels.some(l => /\b(yes|continue|accept|agree|upgrade|get|start|try|unlock)\b/i.test(l));
  const hasNegative = labels.some(l => /\b(no\s*thanks|no,?\s*i|maybe\s*later|i\s*don'?t|not\s*now|i\s*hate|i\s*prefer\s*not)\b/i.test(l));
  if (hasPositive && hasNegative) signals.push('language_bias');
  if (/defaultChecked|checked|defaultValue|pre-?selected/.test(styles.join(' '))) signals.push('default_selection');
  const hasLearnMore = labels.some(l => /^learn\s*more$/i.test(l));
  const hasExplicitDecline = labels.some(l => /\b(decline|cancel|no|opt.?out|dismiss|close|skip)\b/i.test(l));
  if (hasLearnMore && !hasExplicitDecline) signals.push('ambiguous_alternative');
  return signals;
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

      const allExcluded = ctaLabels.every(c => E2_EXCLUSION_LABELS.test(c.label));
      if (allExcluded) continue;

      const regionStart = Math.max(0, group[0].index - 400);
      const regionEnd = Math.min(content.length, group[group.length - 1].index + 400);
      const region = content.slice(regionStart, regionEnd);
      const nearbyMicrocopy: string[] = [];
      const textRe = /<(?:p|span|h[1-6]|div|label)\b[^>]*>([^<]{3,100})<\/(?:p|span|h[1-6]|div|label)>/gi;
      let tm;
      while ((tm = textRe.exec(region)) !== null) {
        const text = tm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3) nearbyMicrocopy.push(text);
      }

      const combinedText = region.toLowerCase() + ' ' + ctaLabels.map(c => c.label.toLowerCase()).join(' ') + ' ' + nearbyMicrocopy.join(' ').toLowerCase();
      const matchedKeywords: string[] = [];
      E2_HIGH_IMPACT_KEYWORDS_RE.lastIndex = 0;
      let kwm;
      while ((kwm = E2_HIGH_IMPACT_KEYWORDS_RE.exec(combinedText)) !== null) {
        const kw = kwm[1].toLowerCase();
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }

      const hasConversionLabel = /\b(sign\s*up|register|create\s*account)\b/i.test(combinedText);
      const hasConsentOrMoney = matchedKeywords.some(k => /consent|privacy|data|share|cookie|tracking|payment|subscribe|trial|upgrade|buy|purchase|card/.test(k));
      if (hasConversionLabel && hasConsentOrMoney && !matchedKeywords.includes('account_conversion')) matchedKeywords.push('account_conversion');

      if (matchedKeywords.length === 0) continue;

      const imbalanceSignals = detectE2ImbalanceSignals(ctaLabels);
      if (imbalanceSignals.length < 2) continue;

      bundles.push({ filePath, ctaLabels, nearbyMicrocopy: [...new Set(nearbyMicrocopy)].slice(0, 5), highImpactKeywords: matchedKeywords, imbalanceSignals, signalCount: imbalanceSignals.length });
    }
  }
  return bundles.slice(0, 20);
}

function formatE2ChoiceBundleForPrompt(bundles: E2ChoiceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = ['[E2_CHOICE_BUNDLE]', 'E2 evaluates ONLY choice clusters in high-impact decision contexts. Each bundle passed the gate and has 2+ imbalance signals.'];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  High-impact context: ${b.highImpactKeywords.join(', ')}`);
    lines.push(`  Imbalance signals (${b.signalCount}): ${b.imbalanceSignals.join(', ')}`);
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
  subCheck: 'E3.D1' | 'E3.D2';
  elementLabel: string;
  elementType: string;
  detection: string;
  evidence: string;
  recommendedFix: string;
  confidence: number;
  deduplicationKey: string;
}

const E3_HIGH_IMPACT_CTA = /\b(delete|remove|permanently\s*delete|destroy|erase|confirm\s*payment|pay\s*now|pay\b|subscribe|proceed\s*with\s*charge|deactivate\s*account|close\s*account|account\s*deletion|danger|destructive)\b/i;
const E3_HIGH_IMPACT_VARIANT = /\b(variant\s*=\s*["'](?:destructive|danger)["']|colorScheme\s*=\s*["'](?:red|danger)["'])\b/i;
const E3_EXIT_PATTERNS = /\b(onClose|onDismiss|handleClose|handleDismiss|closeModal|dismissModal|setOpen\(false\)|setIsOpen\(false\)|setShow\(false\)|onOpenChange)\b/i;
const E3_EXIT_BUTTON_RE = /<(?:Button|button|a)\b[^>]*>([^<]*(?:cancel|back|close|dismiss|decline|undo|no\s*thanks|go\s*back|return|exit|skip|×|✕|X)[^<]*)<\/(?:Button|button|a)>/gi;
const E3_ESCAPE_RE = /\b(Escape|escape|onEscapeKeyDown|closeOnEsc|closeOnOverlayClick|closeOnBackdropClick)\b/i;
const E3_DIALOG_CLOSE_RE = /DialogClose|SheetClose|DrawerClose|AlertDialogCancel/i;
const E3_BREADCRUMB_RE = /<(?:Breadcrumb|breadcrumb|nav)\b[^>]*(?:aria-label\s*=\s*["']breadcrumb["']|className\s*=\s*["'][^"]*breadcrumb)/i;

function hasStructuralExit(region: string): boolean {
  E3_EXIT_BUTTON_RE.lastIndex = 0;
  return E3_EXIT_PATTERNS.test(region) ||
    E3_EXIT_BUTTON_RE.test(region) ||
    E3_ESCAPE_RE.test(region) ||
    E3_DIALOG_CLOSE_RE.test(region) ||
    E3_BREADCRUMB_RE.test(region);
}

function detectE3ControlRestrictions(allFiles: Map<string, string>): E3Finding[] {
  const findings: E3Finding[] = [];
  const seen = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    if (!E3_HIGH_IMPACT_CTA.test(content) && !E3_HIGH_IMPACT_VARIANT.test(content)) continue;

    // E3.D1 — High-impact action in Modal/Dialog without structural exit
    const dialogRe = /<(?:Dialog|dialog|Modal|AlertDialog|Drawer|Sheet)\b([^>]*)>/gi;
    let dm;
    while ((dm = dialogRe.exec(content)) !== null) {
      const lineNum = content.substring(0, dm.index).split('\n').length;
      const regionEnd = Math.min(content.length, dm.index + 1000);
      const region = content.slice(dm.index, regionEnd);

      if (!E3_HIGH_IMPACT_CTA.test(region) && !E3_HIGH_IMPACT_VARIANT.test(region)) continue;
      E3_EXIT_BUTTON_RE.lastIndex = 0;
      if (hasStructuralExit(region)) continue;

      const key = `${filePath}|E3|E3.D1|${lineNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        const tagName = dm[0].match(/<(\w+)/)?.[1] || 'Dialog';
        const ctaMatch = region.match(/>([^<]*(?:delete|remove|pay|subscribe|deactivate|destroy|confirm)[^<]*)</i);
        const ctaLabel = ctaMatch ? ctaMatch[1].trim() : 'destructive action';
        findings.push({
          filePath, line: lineNum, subCheck: 'E3.D1',
          elementLabel: `${tagName} with "${ctaLabel}" but no exit control`,
          elementType: 'dialog',
          detection: `High-impact action in ${tagName} without visible cancel, close, or dismiss mechanism`,
          evidence: `<${tagName}> contains high-impact CTA ("${ctaLabel}") but no cancel/close/dismiss button, onClose handler, or escape key handler`,
          recommendedFix: 'Add a cancel or close button alongside the destructive action',
          confidence: 0.78, deduplicationKey: key,
        });
      }
    }

    // E3.D2 — High-impact action in form/page without structural exit
    const formRe = /<form\b([^>]*)>/gi;
    let fm;
    while ((fm = formRe.exec(content)) !== null) {
      const lineNum = content.substring(0, fm.index).split('\n').length;
      const regionEnd = Math.min(content.length, fm.index + 1200);
      const region = content.slice(fm.index, regionEnd);

      if (!E3_HIGH_IMPACT_CTA.test(region) && !E3_HIGH_IMPACT_VARIANT.test(region)) continue;
      E3_EXIT_BUTTON_RE.lastIndex = 0;
      if (hasStructuralExit(region)) continue;

      const inputCount = (region.match(/<(?:Input|input)\b/gi) || []).length;
      const isSimpleAuth = inputCount <= 2 && /\b(log\s*in|sign\s*in|login|sign\s*up|register)\b/i.test(region);
      if (isSimpleAuth) continue;

      const key = `${filePath}|E3|E3.D2|${lineNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        const ctaMatch = region.match(/>([^<]*(?:delete|remove|pay|subscribe|deactivate|destroy|confirm\s*payment)[^<]*)</i);
        const ctaLabel = ctaMatch ? ctaMatch[1].trim() : 'high-impact action';
        findings.push({
          filePath, line: lineNum, subCheck: 'E3.D2',
          elementLabel: `Form with "${ctaLabel}" but no cancel/exit`,
          elementType: 'form',
          detection: `Form contains high-impact action but no cancel, back, or close option`,
          evidence: `<form> with high-impact CTA ("${ctaLabel}") and ${inputCount} input(s) but no cancel/back/close control`,
          recommendedFix: 'Add a cancel or back button to allow users to exit without committing',
          confidence: 0.70, deduplicationKey: key,
        });
      }
    }
  }

  return findings.slice(0, 20);
}

function formatE3FindingsForPrompt(findings: E3Finding[]): string {
  if (findings.length === 0) return '';
  const lines = [
    '[E3_CONTROL_RESTRICTION_EVIDENCE]',
    'IMPORTANT: E3 triggers ONLY for high-impact actions (delete, payment, subscribe) that lack ALL structural exit controls.',
    'SUPPRESS if: cancel/back/close exists (even if visually weaker — that is E2), consequence text missing (that is E1), or wizard navigation (that is U4).',
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
  headingLikeCount: number;
  sectionCount: number;
  fieldsetCount: number;
  articleCount: number;
  componentBlocks: number;
  componentBlockExamples: string[];
  cardLikeDivs: number;
  cardLikeDivExamples: string[];
  separatorCount: number;
  maxDivDepth: number;
  flexCount: number;
  gridCount: number;
  spacingTokens: string[];
  repeatedBlockCount: number;
  flatStackCues: string[];
  majorSiblingEstimate: number;
  tableCount: number;
  navCount: number;
  mainCount: number;
  asideCount: number;
  formCount: number;
  blockCount: number;
  usesGridOrColumns: boolean;
  triggerSummary: string;
  suppressReason: string | null;
}

const U6_COMPONENT_NAME_RE_GH = /<(Card|Panel|Section|Container|Drawer|Sheet|Accordion|AccordionItem|Tabs|TabsContent|Table|FormField|Sidebar|Dialog|DialogContent|Popover|PopoverContent|HoverCard|AlertDialog|Separator)\b/gi;

function u6IsCardLikeDivGH(classStr: string): boolean {
  const hasRounded = /\brounded(?:-[a-z]+)?\b/.test(classStr);
  if (!hasRounded) return false;
  let structureSignals = 0;
  if (/\b(border|border-[a-z])/.test(classStr)) structureSignals++;
  if (/\bshadow(?:-[a-z]+)?\b/.test(classStr)) structureSignals++;
  if (/\bbg-(?!transparent\b)[a-zA-Z]/.test(classStr)) structureSignals++;
  if (/\bring(?:-[a-z]+)?\b/.test(classStr)) structureSignals++;
  if (structureSignals === 0) return false;
  if (/\bp-(3|4|5|6|8|10|12|16|20)\b/.test(classStr)) return true;
  if (/\bpx-(3|4|5|6|8)\b/.test(classStr) && /\bpy-(3|4|5|6|8)\b/.test(classStr)) return true;
  return false;
}

function u6ShouldSkipFileGH(filePath: string, content: string): string | null {
  const baseName = filePath.split('/').pop() || '';
  if (/^(App|main|index)\.(tsx|jsx)$/i.test(baseName)) return `Router/entry file: ${baseName}`;
  if (/^(router|routes)/i.test(baseName)) return `Router config file: ${baseName}`;
  if (/<(Routes|Route|Switch|Router|BrowserRouter|HashRouter)\b/i.test(content)) return 'Contains routing components';
  if (/createBrowserRouter|createHashRouter/i.test(content)) return 'Contains router factory';
  const providerCount = (content.match(/<(BrowserRouter|ThemeProvider|AuthProvider|QueryClientProvider|Provider|StoreProvider|TooltipProvider|SidebarProvider)\b/gi) || []).length;
  const totalJsxTags = (content.match(/<[A-Z]\w+\b/g) || []).length;
  if (providerCount >= 2 && totalJsxTags > 0 && providerCount / totalJsxTags > 0.5) return 'Composition/provider wrapper file';
  return null;
}

function u6IsPageLikeGH(content: string, headings: string[], headingLikeCount: number, sectionCount: number, formCount: number, tableCount: number, componentBlocks: number, cardLikeDivs: number, mainCount: number): boolean {
  if (mainCount > 0) return true;
  if (/<(header|aside)\b/i.test(content)) return true;
  if (sectionCount > 0 || formCount > 0 || tableCount > 0) return true;
  if (componentBlocks > 0 || cardLikeDivs > 0) return true;
  const hasTopHeading = headings.some(h => /^h[12]:/.test(h));
  if (hasTopHeading && (headings.length + headingLikeCount >= 2)) return true;
  if (headingLikeCount >= 1 && sectionCount + componentBlocks + cardLikeDivs >= 1) return true;
  return false;
}

function extractU6LayoutEvidence(allFiles: Map<string, string>): U6LayoutEvidence[] {
  const bundles: U6LayoutEvidence[] = [];
  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const skipReason = u6ShouldSkipFileGH(filePath, content);
    if (skipReason) continue;

    // 1) Headings
    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(`h${hm[1]}: ${text}`);
    }
    const roleHeadingRe = /role\s*=\s*["']heading["'][^>]*>([^<]{2,60})</gi;
    let rhm;
    while ((rhm = roleHeadingRe.exec(content)) !== null) {
      headings.push(`role=heading: ${rhm[1].trim()}`);
    }

    let headingLikeCount = 0;
    const twHeadingRe = /className\s*=\s*["'][^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*\b(font-(?:semibold|bold|extrabold))\b[^"']*["']/gi;
    const twHeadingRe2 = /className\s*=\s*["'][^"']*\b(font-(?:semibold|bold|extrabold))\b[^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*["']/gi;
    headingLikeCount += (content.match(twHeadingRe) || []).length;
    headingLikeCount += (content.match(twHeadingRe2) || []).length;

    // 2) Semantic containers (expanded)
    const sectionCount = (content.match(/<section\b/gi) || []).length;
    const fieldsetCount = (content.match(/<fieldset\b/gi) || []).length;
    const articleCount = (content.match(/<article\b/gi) || []).length;
    const tableCount = (content.match(/<(?:Table|table)\b/gi) || []).length;
    const navCount = (content.match(/<nav\b/gi) || []).length;
    const mainCount = (content.match(/<main\b/gi) || []).length;
    const asideCount = (content.match(/<aside\b/gi) || []).length;
    const formCount = (content.match(/<form\b/gi) || []).length;

    // 3) Component blocks
    let componentBlocks = 0;
    const componentBlockExamples: string[] = [];
    const compBlockSet = new Set<string>();
    let cbm;
    const cbRe = new RegExp(U6_COMPONENT_NAME_RE_GH.source, 'gi');
    while ((cbm = cbRe.exec(content)) !== null) compBlockSet.add(cbm[1]);
    for (const name of compBlockSet) {
      const count = (content.match(new RegExp(`<${name}\\b`, 'gi')) || []).length;
      componentBlocks += count;
      componentBlockExamples.push(`${name} x${count}`);
    }

    // 4) Card-like divs
    let cardLikeDivs = 0;
    const cardLikeDivExamples: string[] = [];
    const divClassRe = /<div\b[^>]*className\s*=\s*["']([^"']+)["']/gi;
    let dcm;
    while ((dcm = divClassRe.exec(content)) !== null) {
      if (u6IsCardLikeDivGH(dcm[1])) {
        cardLikeDivs++;
        if (cardLikeDivExamples.length < 3) {
          const shortClass = dcm[1].split(/\s+/).filter((c: string) => /border|rounded|shadow|bg-|ring|p-\d|overflow/.test(c)).slice(0, 4).join(' ');
          cardLikeDivExamples.push(`div.${shortClass}`);
        }
      }
    }

    const divideYWithHeading = (content.match(/className\s*=\s*["'][^"']*\bdivide-y\b[^"']*["']/gi) || []).length;
    if (divideYWithHeading > 0 && headings.length > 0) cardLikeDivs += divideYWithHeading;

    // 5) Separators
    let separatorCount = (content.match(/<(?:hr|Separator)\b/gi) || []).length;
    separatorCount += (content.match(/className\s*=\s*["'][^"']*\bborder-[bt]\b[^"']*["']/gi) || []).length;

    // 6) Layout primitives
    const flexCount = (content.match(/\bflex\b/g) || []).length;
    const gridCount = (content.match(/\bgrid\b/g) || []).length;
    const usesGridOrColumns = gridCount > 0 || /\bgrid-cols-\d\b/.test(content) || /\bcolumns-\d\b/.test(content);

    // 7) Spacing tokens
    const spacingTokenSet = new Set<string>();
    const spacingRe = /\b(gap-\d+|space-[xy]-\d+|mb-\d+|mt-\d+|py-\d+|px-\d+|p-\d+|m-\d+)\b/g;
    let sm2;
    while ((sm2 = spacingRe.exec(content)) !== null) spacingTokenSet.add(sm2[1]);

    // 8) Repeated blocks & flat stack cues
    const mapCount = (content.match(/\.map\s*\(/g) || []).length;
    const flatStackCues: string[] = [];
    if (/(<(?:input|Input|textarea|Textarea|select|Select|button|Button)\b[^>]*(?:\/>|>[^<]*<\/(?:input|Input|textarea|Textarea|select|Select|button|Button)>)\s*\n?\s*){3,}/gi.test(content)) {
      flatStackCues.push('3+ sibling form controls without headings/wrappers');
    }
    if (/(?:<div\b[^>]*>[^<]*<\/div>\s*\n?\s*){5,}/gi.test(content)) {
      flatStackCues.push('5+ flat sibling divs');
    }

    // 9) Major sibling estimate
    const returnMatch = content.match(/return\s*\(\s*\n?\s*<(\w+)/);
    let majorSiblingEstimate = 0;
    if (returnMatch) {
      const afterReturn = content.slice((returnMatch.index || 0) + returnMatch[0].length);
      const directChildRe = /^\s{2,6}<(\w+)\b/gm;
      let dcChild;
      const directChildren = new Set<number>();
      while ((dcChild = directChildRe.exec(afterReturn)) !== null) {
        if (dcChild.index > 3000) break;
        directChildren.add(dcChild.index);
      }
      majorSiblingEstimate = directChildren.size;
    }

    // Page-like check
    if (!u6IsPageLikeGH(content, headings, headingLikeCount, sectionCount, formCount, tableCount, componentBlocks, cardLikeDivs, mainCount)) continue;

    if (headings.length === 0 && headingLikeCount === 0 && sectionCount === 0 && fieldsetCount === 0 &&
        componentBlocks === 0 && cardLikeDivs === 0 && flexCount < 2 && spacingTokenSet.size === 0 && flatStackCues.length === 0) continue;

    const semanticSections = sectionCount + articleCount + fieldsetCount + navCount + asideCount;
    const totalContainers = semanticSections + componentBlocks + cardLikeDivs;
    const blockCount = majorSiblingEstimate;
    const totalHeadings = headings.length + headingLikeCount;

    // Complexity gate
    if (blockCount < 4 && !usesGridOrColumns) continue;

    // Strong suppression
    let suppressReason: string | null = null;

    if (tableCount >= 1 && (/<thead\b/i.test(content) || /<TableHead\b/i.test(content) || /<th\b/i.test(content))) {
      suppressReason = `Table-centric layout with column headers`;
    } else if (totalHeadings >= 2 && totalContainers >= 2) {
      suppressReason = `Structured: ${totalHeadings} headings + ${totalContainers} containers`;
    } else if (componentBlockExamples.length >= 2) {
      const distinctPrimitives = new Set(componentBlockExamples.map(e => e.split(' ')[0]));
      if (distinctPrimitives.size >= 2) {
        suppressReason = `Deliberate structure: ${[...distinctPrimitives].join(', ')} used`;
      }
    } else if (componentBlocks + cardLikeDivs >= 2) {
      suppressReason = `Well-grouped: ${componentBlocks} component blocks + ${cardLikeDivs} card-like divs`;
    } else if (totalHeadings >= 2 && separatorCount >= 1) {
      suppressReason = `Clear hierarchy: ${totalHeadings} headings + ${separatorCount} separators`;
    } else if (semanticSections >= 2) {
      suppressReason = `Semantic grouping: ${sectionCount} sections + ${articleCount} articles + ${fieldsetCount} fieldsets`;
    } else if (majorSiblingEstimate <= 2 && flatStackCues.length === 0) {
      suppressReason = `Simple page: ${majorSiblingEstimate} major siblings`;
    }

    const triggerSummary = `Blocks:${blockCount} Containers:${totalContainers} Headings:${totalHeadings} SemanticSections:${semanticSections} Grid:${usesGridOrColumns}`;

    bundles.push({
      filePath, headings: [...new Set(headings)].slice(0, 8), headingLikeCount,
      sectionCount, fieldsetCount, articleCount, componentBlocks,
      componentBlockExamples: componentBlockExamples.slice(0, 5),
      cardLikeDivs, cardLikeDivExamples: cardLikeDivExamples.slice(0, 3),
      separatorCount,
      maxDivDepth: Math.min((content.match(/<div\b/gi) || []).length, (content.match(/<\/div>/gi) || []).length),
      flexCount, gridCount, spacingTokens: [...spacingTokenSet].slice(0, 12),
      repeatedBlockCount: mapCount, flatStackCues, majorSiblingEstimate, tableCount,
      navCount, mainCount, asideCount, formCount, blockCount, usesGridOrColumns, triggerSummary,
      suppressReason,
    });
  }
  return bundles.slice(0, 15);
}

function formatU6LayoutEvidenceForPrompt(bundles: U6LayoutEvidence[]): string {
  const unsuppressed = bundles.filter(b => !b.suppressReason);
  if (unsuppressed.length === 0) return '';
  const lines = ['[U6_LAYOUT_EVIDENCE_BUNDLE]', 'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Evaluate ONLY the extracted layout cues.'];
  for (const b of unsuppressed) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  Trigger summary: ${b.triggerSummary}`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    if (b.headingLikeCount > 0) lines.push(`  Heading-like styled elements: ${b.headingLikeCount}`);
    lines.push(`  Semantic containers: ${b.sectionCount} <section>, ${b.fieldsetCount} <fieldset>, ${b.articleCount} <article>, ${b.navCount} <nav>, ${b.asideCount} <aside>`);
    lines.push(`  Component blocks: ${b.componentBlocks} (${b.componentBlockExamples.join(', ') || 'none'})`);
    lines.push(`  Card-like divs: ${b.cardLikeDivs} (${b.cardLikeDivExamples.join(', ') || 'none'})`);
    if (b.separatorCount > 0) lines.push(`  Separators: ${b.separatorCount}`);
    if (b.tableCount > 0) lines.push(`  Tables: ${b.tableCount}`);
    lines.push(`  Layout: ${b.flexCount} flex, ${b.gridCount} grid, grid/columns: ${b.usesGridOrColumns}, div depth ~${b.maxDivDepth}`);
    if (b.spacingTokens.length > 0) lines.push(`  Spacing tokens: ${b.spacingTokens.join(', ')}`);
    if (b.repeatedBlockCount > 0) lines.push(`  Repeated blocks (map): ${b.repeatedBlockCount}`);
    lines.push(`  Major sibling blocks: ~${b.majorSiblingEstimate}`);
    if (b.flatStackCues.length > 0) lines.push(`  Flat-stack cues: ${b.flatStackCues.join('; ')}`);
  }
  lines.push('[/U6_LAYOUT_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// =====================
// U3 Content Accessibility Detection (sub-checks U3.D1, U3.D2, U3.D3, U3.D4)
// =====================

interface U3Finding {
  subCheck: 'U3.D1' | 'U3.D2' | 'U3.D3' | 'U3.D4' | 'U3.D5';
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
  truncationType?: string;
  textLength?: number | 'dynamic';
  triggerReason?: string;
  expandDetected?: boolean;
  elementTag?: string;
  varName?: string;
  lineNumber?: number;
  occurrences?: number;
}

function extractU3TextPreview(content: string, pos: number): string | undefined {
  const after = content.slice(pos, Math.min(content.length, pos + 800));
  const cap = (s: string): string => s.length > 120 ? s.slice(0, 117) + '…' : s;
  const looksLikeClasses = (s: string): boolean =>
    /^[\w\s\-/[\]:!.#]+$/.test(s) && /\b(text-|bg-|flex|grid|p-|m-|w-|h-|rounded|border|font-|block|inline|hidden|overflow|relative|absolute|max-|min-)/.test(s);

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

  const childStringRe = />\s*\{\s*[`"']([^`"']{5,})[`"']\s*\}\s*</g;
  let csm;
  while ((csm = childStringRe.exec(after)) !== null) {
    const raw = csm[1].trim();
    if (raw.length > 0 && !looksLikeClasses(raw)) return cap(raw);
  }

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

  const dynBroadRe = />\s*\{([^}]{3,40})\}\s*</g;
  let db;
  while ((db = dynBroadRe.exec(after)) !== null) {
    const expr = db[1].trim();
    if (/[a-zA-Z]/.test(expr) && !/className|style|onClick/i.test(expr)) return '(dynamic text)';
  }
  return undefined;
}

function u3IsDynamic(preview: string | undefined): boolean {
  if (!preview) return false;
  return preview.startsWith('(dynamic text');
}

function u3StaticTextLength(preview: string | undefined): number {
  if (!preview) return -1;
  if (u3IsDynamic(preview)) return -1;
  return preview.replace(/…$/, '').length;
}

function u3HasExpandMechanism(content: string, pos: number, windowLines: number): boolean {
  const lines = content.split('\n');
  const currentLine = content.slice(0, pos).split('\n').length - 1;
  const startLine = Math.max(0, currentLine - windowLines);
  const endLine = Math.min(lines.length - 1, currentLine + windowLines);
  const window = lines.slice(startLine, endLine + 1).join('\n');
  return /show\s*more|see\s*more|see\s*all|view\s*more|expand|read\s*more|collapse/i.test(window) ||
    /\b(expanded|setExpanded|isOpen|setIsOpen|isExpanded|setOpen|toggleOpen|toggleExpand)\b/.test(window) ||
    /title\s*=|<Tooltip|data-tooltip|aria-describedby/i.test(window);
}

function u3FindCarrierElement(content: string, pos: number): { tag: string; className: string; tagStart: number; fullTag: string } | null {
  const U3_TRUNC_CLASS_RE = /\b(truncate|line-clamp-\d+|text-ellipsis)\b/;
  const before = content.slice(Math.max(0, pos - 600), pos);
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  const ancestors: { tag: string; className: string; tagStart: number; fullTag: string }[] = [];
  let tm;
  while ((tm = tagRe.exec(before)) !== null) {
    const tag = tm[1];
    const attrs = tm[2];
    const absStart = Math.max(0, pos - 600) + tm.index;
    if (attrs.endsWith('/')) continue;
    const tagEnd = absStart + tm[0].length;
    const between = content.slice(tagEnd, pos);
    const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
    if (closeRe.test(between)) continue;
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*["']([^"']*)["'][^}]*\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
    ancestors.push({ tag, className, tagStart: absStart, fullTag: tm[0] });
  }
  if (ancestors.length === 0) return null;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (U3_TRUNC_CLASS_RE.test(ancestors[i].className)) return ancestors[i];
  }
  return ancestors[ancestors.length - 1];
}

function u3FindParentElement(content: string, carrierTagStart: number): { tag: string; className: string } | null {
  const before = content.slice(Math.max(0, carrierTagStart - 500), carrierTagStart);
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  let best: { tag: string; className: string } | null = null;
  let tm;
  while ((tm = tagRe.exec(before)) !== null) {
    const tag = tm[1];
    const attrs = tm[2];
    if (attrs.endsWith('/')) continue;
    const absStart = Math.max(0, carrierTagStart - 500) + tm.index;
    const tagEnd = absStart + tm[0].length;
    const between = content.slice(tagEnd, carrierTagStart);
    const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
    if (closeRe.test(between)) continue;
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*["']([^"']*)["'][^}]*\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
    best = { tag, className };
  }
  return best;
}

function u3HasComponentExpandForVar(content: string, varName: string, pos: number): { hasExpand: boolean; mechanism?: string } {
  const lastSeg = varName.split('.').pop() || varName;
  const objPrefix = varName.includes('.') ? varName.split('.')[0] : null;

  const varRe = new RegExp(`>\\s*\\{[^}]*\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}\\s*<`, 'g');
  let vm;
  let otherOccurrences = 0;
  while ((vm = varRe.exec(content)) !== null) {
    if (Math.abs(vm.index - pos) < 50) continue;
    const localCtx = content.slice(Math.max(0, vm.index - 150), Math.min(content.length, vm.index + 150));
    if (!/\btruncate\b|\bline-clamp-[1-9]\b|\btext-ellipsis\b/.test(localCtx)) {
      otherOccurrences++;
    }
  }
  if (otherOccurrences > 0) {
    return { hasExpand: true, mechanism: `same variable rendered without truncation elsewhere in component` };
  }

  const nearbyBefore = content.slice(Math.max(0, pos - 800), pos);
  const selectedPatterns = [
    /onClick\s*=\s*\{[^}]*set(?:Selected|Active|Current|Open)\w*\s*\(/i,
    /onClick\s*=\s*\{[^}]*(?:handleSelect|handleClick|openDetail|viewDetail|showDetail)\b/i,
  ];
  for (const sp of selectedPatterns) {
    if (sp.test(nearbyBefore)) {
      if (objPrefix && new RegExp(`selected\\w*\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(content)) {
        return { hasExpand: true, mechanism: `click-to-select detail view (selected*.${lastSeg})` };
      }
      if (/\bselected\w*\b.*\bsubject\b|\bselected\w*\b.*\bbody\b|\bdetail\b/i.test(content)) {
        return { hasExpand: true, mechanism: 'click-to-select detail view' };
      }
    }
  }

  if (/<(?:Dialog|Drawer|Sheet|Modal)\b/i.test(content)) {
    const dialogContent = content.match(/<(?:Dialog|Drawer|Sheet|Modal)(?:Content|Body)?\b[\s\S]{0,2000}/i);
    if (dialogContent) {
      const varInDialog = new RegExp(`\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (varInDialog.test(dialogContent[0])) {
        return { hasExpand: true, mechanism: 'Dialog/Drawer/Modal shows full content' };
      }
    }
  }

  return { hasExpand: false };
}

function u3HasWideContainer(context: string): boolean {
  if (/\bw-full\b/.test(context) && !/\bmax-w-/.test(context)) return true;
  if (/\bflex-1\b/.test(context) && !/\bmax-w-/.test(context) && !/\bw-\d+\b/.test(context)) return true;
  return false;
}

function u3HasWidthConstraint(context: string): boolean {
  return /\bw-\d+\b/.test(context) || /\bmax-w-\w+\b/.test(context);
}

const U3_ICON_COMPONENT_RE = /^(?:MapPin|Calendar|Clock|Mail|Phone|User|Star|Heart|Search|Check|X|Plus|Minus|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|ChevronLeft|ChevronRight|ChevronUp|ChevronDown|Eye|EyeOff|Edit|Trash|Delete|Copy|Download|Upload|Settings|Menu|Close|Home|Info|AlertCircle|AlertTriangle|Bell|Bookmark|Camera|Circle|Clipboard|Code|Coffee|Compass|CreditCard|Database|Disc|DollarSign|ExternalLink|File|Filter|Flag|Folder|Gift|Globe|Grid|Hash|Headphones|Image|Inbox|Key|Layers|Layout|Link|List|Loader|Lock|LogIn|LogOut|Map|MessageCircle|MessageSquare|Mic|Monitor|Moon|MoreHorizontal|MoreVertical|Move|Music|Navigation|Paperclip|Pause|Pen|Percent|Play|Power|Printer|Radio|RefreshCw|Repeat|RotateCw|Save|Scissors|Send|Server|Share|Shield|ShoppingCart|Sidebar|Slash|Sliders|Smartphone|Speaker|Square|Sun|Sunrise|Sunset|Tag|Target|Terminal|Thermometer|ThumbsUp|ThumbsDown|ToggleLeft|ToggleRight|Tool|TrendingUp|TrendingDown|Triangle|Truck|Tv|Type|Umbrella|Underline|Unlock|Video|Volume|Watch|Wifi|Wind|Zap|ZoomIn|ZoomOut|Icon|Svg|svg|LucideIcon)$/;

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
      { re: /\bline-clamp-[1-6]\b/g, label: 'line-clamp' },
      { re: /\btruncate\b/g, label: 'truncate' },
      { re: /\btext-ellipsis\b/g, label: 'text-ellipsis' },
    ];

    for (const { re, label } of truncationPatterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const pos = m.index;
        const lineNumber = content.slice(0, pos).split('\n').length;
        const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));

        if (/overflow-(?:auto|y-auto|x-auto|scroll)\b/.test(context)) continue;

        const textPreview = extractU3TextPreview(content, pos);
        const isDynamic = u3IsDynamic(textPreview);
        const staticLen = u3StaticTextLength(textPreview);

        if (!isDynamic && staticLen >= 0 && staticLen <= 18) continue;
        if (!isDynamic && staticLen >= 0 && staticLen <= 30 && u3HasWideContainer(context)) continue;
        if (u3HasExpandMechanism(content, pos, 20)) continue;

        // SUPPRESS: component-level expand for dynamic text (click-to-open detail view)
        if (isDynamic && textPreview) {
          const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
          if (dynVarMatch) {
            const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
            if (expandCheck.hasExpand) continue;
          }
        }

        let confidence = 0.70;
        let triggerReason = '';
        if (isDynamic) {
          confidence = 0.75;
          triggerReason = 'Dynamic content with truncation class';
        } else if (staticLen >= 20) {
          confidence = 0.72;
          triggerReason = `Static text (${staticLen} chars) may exceed container`;
        } else if (u3HasWidthConstraint(context)) {
          confidence = 0.72;
          triggerReason = 'Width constraint + truncation on text';
        } else {
          triggerReason = 'Truncation class on content without expand mechanism';
        }

        const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const carrier = u3FindCarrierElement(content, pos);
        const elementTag = carrier?.tag && !U3_ICON_COMPONENT_RE.test(carrier.tag) ? carrier.tag : (() => {
          const tagRe = /<([a-zA-Z][\w.]*)\s/g;
          let best: string | undefined;
          let tm2;
          const slice = context.slice(0, 300);
          while ((tm2 = tagRe.exec(slice)) !== null) {
            if (!U3_ICON_COMPONENT_RE.test(tm2[1])) best = tm2[1];
          }
          return best;
        })();

        const d1VarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
        const d1VarName = d1VarMatch ? d1VarMatch[1].split('.').pop() : undefined;

        findings.push({
          subCheck: 'U3.D1', subCheckLabel: 'Line clamp / ellipsis truncation', classification: 'potential',
          elementLabel: `Truncated text (${label})`, elementType: 'text', filePath,
          detection: `${m[0]} without expand mechanism`,
          evidence: `${m[0]} at ${fileName}:${lineNumber} — no expand/tooltip found nearby`,
          explanation: `Text is truncated using ${label} without a visible mechanism to reveal full content.`,
          confidence, textPreview,
          advisoryGuidance: 'Ensure truncated content has an accessible expand mechanism.',
          deduplicationKey: dedupeKey,
          truncationType: label,
          textLength: isDynamic ? 'dynamic' : (staticLen >= 0 ? staticLen : undefined),
          triggerReason, expandDetected: false, elementTag,
          varName: d1VarName, lineNumber,
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

      const textPreview = extractU3TextPreview(content, pos);
      const isDynamic = u3IsDynamic(textPreview);
      const staticLen = u3StaticTextLength(textPreview);

      if (!isDynamic && staticLen >= 0 && staticLen <= 18) continue;
      if (!isDynamic && staticLen >= 0 && staticLen <= 30 && u3HasWideContainer(context)) continue;
      if (u3HasExpandMechanism(content, pos, 20)) continue;

      // SUPPRESS: component-level expand for dynamic text
      if (isDynamic && textPreview) {
        const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
        if (dynVarMatch) {
          const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
          if (expandCheck.hasExpand) continue;
        }
      }

      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const triggerReason = isDynamic ? 'Dynamic content with nowrap + overflow-hidden' : `Text (${staticLen} chars) with nowrap + overflow-hidden`;

      const nwVarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
      const nwVarName = nwVarMatch ? nwVarMatch[1].split('.').pop() : undefined;

      findings.push({
        subCheck: 'U3.D1', subCheckLabel: 'Line clamp / ellipsis truncation', classification: 'potential',
        elementLabel: 'Truncated text (nowrap + overflow)', elementType: 'text', filePath,
        detection: 'whitespace-nowrap + overflow-hidden without expand mechanism',
        evidence: `whitespace-nowrap + overflow-hidden at ${fileName}:${lineNumber}`,
        explanation: 'Text is forced to a single line with overflow hidden, potentially clipping important content.',
        confidence: 0.70, textPreview,
        advisoryGuidance: 'Add a title attribute or expand mechanism.', deduplicationKey: dedupeKey,
        truncationType: 'nowrap',
        textLength: isDynamic ? 'dynamic' : (staticLen >= 0 ? staticLen : undefined),
        triggerReason, expandDetected: false,
        varName: nwVarName, lineNumber,
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
      if (u3HasExpandMechanism(content, pos, 20)) continue;

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
        truncationType: 'overflow-clip',
        triggerReason: `Fixed height (${hm[0]}) + overflow-hidden on text container`,
        expandDetected: false,
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
        truncationType: 'scroll-trap',
        triggerReason: 'Nested scroll containers within fixed-height parent',
        expandDetected: false,
      });
    }

    // --- U3.D4: Hidden content without control ---
    const hiddenRe = /\bhidden\b/g;
    let hm3;
    while ((hm3 = hiddenRe.exec(content)) !== null) {
      const pos = hm3.index;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const context = content.slice(Math.max(0, pos - 150), Math.min(content.length, pos + 500));
      const localOffset = Math.min(pos, 150);

      const afterMatch = content.slice(pos + 6, pos + 30);
      if (/^\s*=\s*["']?false/.test(afterMatch)) continue;
      if (/^\s*=\s*\{false\}/.test(afterMatch)) continue;

      // SUPPRESS: responsive hidden variants
      const lineStart = content.lastIndexOf('\n', pos) + 1;
      const lineEnd = content.indexOf('\n', pos);
      const currentLineText = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (/\b(?:sm|md|lg|xl|2xl):hidden\b/.test(currentLineText)) continue;
      const nearbyLines = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
      if (/hidden\s+(?:sm|md|lg|xl|2xl):(?:block|flex|inline|grid)\b/.test(nearbyLines)) continue;
      if (/(?:block|flex|inline|grid)\s+(?:sm|md|lg|xl|2xl):hidden\b/.test(nearbyLines)) continue;

      // SUPPRESS: aria-hidden
      if (/aria-hidden\s*=\s*["']true["']/.test(context.slice(Math.max(0, localOffset - 30), localOffset + 40))) continue;

      if (/\bsvg\b|icon|separator|divider|decorat/i.test(context.slice(0, 200))) continue;
      if (/sr-only|visually-hidden/i.test(context)) continue;

      const contentAfter = context.slice(localOffset);
      const hasMeaningfulText = /<(?:p|h[1-6]|span|div|li)\b[^>]*>[^<]{20,}/i.test(contentAfter);
      const hasDynamic = />\s*\{[a-zA-Z_][\w.]*\}\s*</.test(contentAfter);
      const hasDescriptiveContent = /\b(?:description|message|content|paragraph|body|summary|bio|detail)\b/i.test(contentAfter);
      if (!hasMeaningfulText && !hasDynamic && !hasDescriptiveContent) continue;

      if (u3HasExpandMechanism(content, pos, 25)) continue;

      const widerWindow = content.slice(Math.max(0, pos - 500), Math.min(content.length, pos + 500));
      if (/aria-controls|aria-expanded/i.test(widerWindow)) continue;
      if (/<(?:button|a)\b[^>]*>[^<]*(?:Menu|Open|Close|Show|Hide|Toggle)[^<]*/i.test(widerWindow)) continue;

      const dedupeKey = `U3.D4|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const textPreview = extractU3TextPreview(content, pos);
      findings.push({
        subCheck: 'U3.D4', subCheckLabel: 'Hidden content without control', classification: 'potential',
        elementLabel: 'Hidden content (hidden attribute)', elementType: 'content', filePath,
        detection: 'hidden attribute on content element without visible toggle',
        evidence: `hidden at ${fileName}:${lineNumber} — meaningful content hidden without toggle`,
        explanation: 'Content is hidden without a visible mechanism to reveal it.',
        confidence: 0.68, textPreview,
        advisoryGuidance: 'Provide a visible toggle to reveal hidden content.', deduplicationKey: dedupeKey,
        truncationType: 'hidden',
        triggerReason: hasDynamic ? 'Dynamic content hidden without toggle' : 'Meaningful text (≥20 chars) hidden without toggle',
        expandDetected: false,
      });
    }

    // --- U3.D5: Unbroken text overflow risk (refined gating) ---
    const U3_WRAP_SAFE = /\bbreak-words\b|\bbreak-all\b|\bwhitespace-normal\b|\boverflow-wrap[:\s]*anywhere\b|\boverflowWrap\s*:\s*["']?anywhere|\bword-break\s*:\s*break-word/;
    const U3_SCROLL_SAFE = /\boverflow-x-auto\b|\boverflow-auto\b/;
    const U3_STRONG_CONSTRAINT = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
    const U3_TRUNCATE_OR_NOWRAP = /\btruncate\b|\bwhitespace-nowrap\b/;
    const U3_FIXED_WIDTH = /\bw-\d|\bmax-w-/;
    const U3_WIDE_CONTAINER = /\bw-full\b|\bflex-1\b/;

    const U3_HIGH_RISK = /\b(?:reason|notes|bio|description|message|subject|comment|details|address|diagnosis|complaint|feedback|body|content|summary|remarks)\b/i;
    const U3_MEDIUM_RISK = /\b(?:specialty|title|label)\b/i;
    const U3_LOW_RISK = /\b(?:location|status|date|time|id|num|type)\b/i;
    const U3_LOW_RISK_NEVER = /\b(?:firstName|lastName|name|startTime|endTime|role|search|selectedDoctor|doctor|slot|count|email|phone|price|amount|code|key|slug|url|href|icon|avatar|image|src|alt|index|idx|length|size|width|height|color|variant|className|style|ref|onClick|onChange|onSubmit|disabled|checked|value|placeholder|control|register|errors|watch|reset|handleSubmit|trigger|formState|setValue|getValues)\b/i;
    const U3_SKIP_VAR = /^(?:i|j|k|e|_|el|ev|cb|fn|err|res|req|ctx|ref|key|idx|index|item|row|col|acc|cur|prev|next|len|num|val|tmp|obj|arr|map|set|get|put|del|add|sub|mod|div|max|min|sum|avg)$/;

    const U3_TEXT_VAR = />\s*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}\s*</g;
    const U3_TEXT_VAR2 = />\s*[^<]*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}/g;

    const d5SeenVars = new Map<string, number>();
    const d5Findings: U3Finding[] = [];

    for (const varRegex of [U3_TEXT_VAR, U3_TEXT_VAR2]) {
      varRegex.lastIndex = 0;
      let dxm;
      while ((dxm = varRegex.exec(content)) !== null) {
        const varName = dxm[1];
        const pos = dxm.index;

        if (U3_SKIP_VAR.test(varName)) continue;
        const segments = varName.split('.');
        if (segments[0] === 'form' || segments[0] === 'controller') continue;
        if (segments.length === 1 && segments[0].length <= 2) continue;

        const lastSeg = segments[segments.length - 1];
        if (U3_LOW_RISK_NEVER.test(lastSeg)) continue;

        let riskTier: 'High' | 'Medium' | 'Low' | 'None';
        if (U3_HIGH_RISK.test(lastSeg)) riskTier = 'High';
        else if (U3_MEDIUM_RISK.test(lastSeg)) riskTier = 'Medium';
        else if (U3_LOW_RISK.test(lastSeg)) riskTier = 'Low';
        else riskTier = 'None';

        if (riskTier === 'None') continue;

        // ── STRICT EVIDENCE BINDING ──
        const carrier = u3FindCarrierElement(content, pos);
        const carrierClasses = carrier ? carrier.className : '';
        const parent = carrier ? u3FindParentElement(content, carrier.tagStart) : null;
        const parentClasses = parent ? parent.className : '';
        const boundClasses = carrierClasses + ' ' + parentClasses;

        const hasStrongConstraint = U3_STRONG_CONSTRAINT.test(boundClasses);
        const hasFixedWidthWithOverflow = U3_FIXED_WIDTH.test(boundClasses) && /\boverflow-hidden\b/.test(boundClasses);
        const carrierTag = carrier?.tag || parent?.tag || '';
        const isTableCell = /^(td|th|TableCell)$/i.test(carrierTag) || /^(td|th|TableCell)$/i.test(parent?.tag || '');
        const isTableCellConstrained = isTableCell && (U3_STRONG_CONSTRAINT.test(boundClasses) || U3_FIXED_WIDTH.test(boundClasses));
        const isGridConstrained = /\bgrid\b/.test(boundClasses) && /\bcol(?:s|-span)/.test(boundClasses) && (/\bmax-w-/.test(boundClasses) || /\boverflow-hidden\b/.test(boundClasses));

        if (!hasStrongConstraint && !hasFixedWidthWithOverflow && !isTableCellConstrained && !isGridConstrained) continue;

        if (riskTier === 'Medium' && !U3_TRUNCATE_OR_NOWRAP.test(boundClasses)) continue;

        if (riskTier === 'Low') {
          if (!(/\btruncate\b/.test(boundClasses) && /\boverflow-hidden\b/.test(boundClasses))) continue;
        }

        if (U3_WRAP_SAFE.test(boundClasses)) continue;
        if (U3_SCROLL_SAFE.test(boundClasses)) continue;
        if (/\bfont-mono\b|\bmonospace\b/i.test(boundClasses)) continue;

        const varKey = `${filePath}|${lastSeg}`;
        const prevCount = d5SeenVars.get(varKey) || 0;
        if (prevCount >= 1) continue;
        d5SeenVars.set(varKey, prevCount + 1);

        const lineNumber = content.slice(0, pos).split('\n').length;
        const dedupeKey = `U3.D5|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        // ── COMPONENT-LEVEL EXPAND DETECTION ──
        const expandCheck = u3HasComponentExpandForVar(content, varName, pos);
        const hasLocalExpand = u3HasExpandMechanism(content, pos, 20);

        if (expandCheck.hasExpand || hasLocalExpand) continue;

        let confidence = 0.70;
        if (hasStrongConstraint) confidence += 0.15;
        if (riskTier === 'High') confidence += 0.10;
        else if (riskTier === 'Medium') confidence += 0.05;
        else if (riskTier === 'Low') confidence -= 0.10;
        const hasWideContainer = U3_WIDE_CONTAINER.test(boundClasses) && !/\bmax-w-/.test(boundClasses);
        if (hasWideContainer) confidence -= 0.10;
        if (/\btitle\s*=|\btooltip\b|<Tooltip/i.test(boundClasses)) confidence -= 0.10;
        confidence = Math.max(0.55, Math.min(0.90, confidence));
        if (confidence < 0.65) continue;

        const matchedClasses: string[] = [];
        if (/\bwhitespace-nowrap\b/.test(boundClasses)) matchedClasses.push('whitespace-nowrap');
        if (/\btruncate\b/.test(boundClasses)) matchedClasses.push('truncate');
        if (/\boverflow-hidden\b/.test(boundClasses)) matchedClasses.push('overflow-hidden');
        if (/\btext-ellipsis\b/.test(boundClasses)) matchedClasses.push('text-ellipsis');
        if (/\bline-clamp-[1-9]\b/.test(boundClasses)) matchedClasses.push('line-clamp');
        if (isTableCellConstrained) matchedClasses.push('table-cell');
        if (isGridConstrained) matchedClasses.push('grid-narrow');
        if (/\bw-\d/.test(boundClasses)) matchedClasses.push('fixed-width');
        if (/\bmax-w-/.test(boundClasses)) matchedClasses.push('max-width');

        const rawTag = U3_STRONG_CONSTRAINT.test(carrierClasses) ? (carrier?.tag || undefined) :
                          U3_STRONG_CONSTRAINT.test(parentClasses) ? (parent?.tag || undefined) :
                          (carrier?.tag || undefined);
        const reportTag = rawTag && U3_ICON_COMPONENT_RE.test(rawTag) ? (parent?.tag || carrier?.tag || undefined) : rawTag;

        d5Findings.push({
          subCheck: 'U3.D5',
          subCheckLabel: 'Unbroken text overflow risk',
          classification: 'potential',
          elementLabel: `Unbroken text overflow (${varName})`,
          elementType: 'text',
          filePath,
          detection: 'Long unbroken text may overflow (no wrap protection)',
          evidence: `{${varName}} [${riskTier}] at ${fileName}:${lineNumber} — carrier <${reportTag || '?'}> className="${U3_STRONG_CONSTRAINT.test(carrierClasses) ? carrierClasses.trim() : parentClasses.trim()}" — no wrap protection`,
          explanation: 'User-generated text without spaces can overflow the container when word-break protection is missing.',
          confidence,
          textPreview: `(dynamic text: ${varName})`,
          advisoryGuidance: 'Add break-words / overflow-wrap:anywhere and allow multi-line display, or clamp with "Show more".',
          deduplicationKey: dedupeKey,
          truncationType: 'unbroken-overflow',
          textLength: 'dynamic',
          triggerReason: `{${varName}} [${riskTier}-risk] in <${reportTag || '?'}> with ${matchedClasses.join(' + ')} but no wrap protection`,
          expandDetected: false,
          elementTag: reportTag,
          varName: lastSeg,
          lineNumber,
        });
      }
    }
    const d5ByFile = new Map<string, U3Finding[]>();
    for (const f of d5Findings) { const ex = d5ByFile.get(f.filePath) || []; ex.push(f); d5ByFile.set(f.filePath, ex); }
    for (const [, ff] of d5ByFile) {
      ff.sort((a, b) => b.confidence - a.confidence);
      findings.push(...ff.slice(0, 3));
    }
  }

  // ── Cross-subcheck deduplication ──
  const TRUNC_PRIORITY: Record<string, number> = { 'line-clamp': 3, truncate: 2, nowrap: 1, 'unbroken-overflow': 0, 'text-ellipsis': 2 };
  const mergedFindings: U3Finding[] = [];
  const mergeMap = new Map<string, U3Finding>();

  for (const f of findings) {
    if (!f.varName || !f.lineNumber) {
      mergedFindings.push(f);
      continue;
    }
    const mergeKey = `${f.filePath}|${f.varName}`;
    const existing = mergeMap.get(mergeKey);
    if (existing && existing.lineNumber && Math.abs(existing.lineNumber - f.lineNumber) <= 10) {
      const existingPrio = TRUNC_PRIORITY[existing.truncationType || ''] ?? -1;
      const newPrio = TRUNC_PRIORITY[f.truncationType || ''] ?? -1;
      existing.occurrences = (existing.occurrences || 1) + 1;
      if (newPrio > existingPrio) {
        existing.truncationType = f.truncationType;
        existing.subCheck = f.subCheck;
        existing.subCheckLabel = f.subCheckLabel;
        existing.elementLabel = `Content may be cut off (${existing.truncationType}${f.truncationType !== existing.truncationType ? ' + overflow risk' : ''})`;
        existing.detection = `${f.detection} (merged with ${existing.detection})`;
      } else {
        existing.elementLabel = `Content may be cut off (${existing.truncationType}${f.truncationType !== existing.truncationType ? ' + overflow risk' : ''})`;
      }
      existing.confidence = Math.max(existing.confidence, f.confidence);
      existing.evidence = `${existing.evidence} | also: ${f.evidence}`;
    } else if (!existing) {
      f.occurrences = 1;
      mergeMap.set(mergeKey, f);
    } else {
      f.occurrences = 1;
      mergedFindings.push(f);
    }
  }
  mergedFindings.push(...mergeMap.values());

  const byFile = new Map<string, U3Finding[]>();
  for (const f of mergedFindings) { const ex = byFile.get(f.filePath) || []; ex.push(f); byFile.set(f.filePath, ex); }
  const capped: U3Finding[] = [];
  for (const [, ff] of byFile) { ff.sort((a, b) => b.confidence - a.confidence); capped.push(...ff.slice(0, 5)); }

  const subChecks = new Set(capped.map(f => f.subCheck));
  const bonus = Math.min((subChecks.size - 1) * 0.05, 0.15);
  for (const f of capped) { f.confidence = Math.min(f.confidence + bonus, 0.85); }

  console.log(`[U3] Detection: ${findings.length} raw → ${mergedFindings.length} after merge → ${capped.length} after capping (${subChecks.size} sub-checks)`);
  return capped;
}

// =====================
// U1.3 Context-Aware Suppression Signals
// =====================

interface U13ContextResult {
  hasLabeledStepper: boolean;
  hasStrongNearbyHeading: (btnOffset: number) => boolean;
  isSinglePrimaryCTA: boolean;
  contextSignals: string[];
}

function detectU13ContextSignals(
  content: string,
  allButtons: ButtonUsage[],
  buttonImpl: { filePath: string; config: CvaVariantConfig } | null,
): U13ContextResult {
  const contextSignals: string[] = [];

  // (A) Labeled stepper detection
  let hasLabeledStepper = false;

  const stepItemRe = /<(?:Step|StepItem|StepTrigger|StepperItem|StepLabel)\b[^>]*>([^<]{2,})<\//gi;
  const stepItemMatches = content.match(stepItemRe);
  if (stepItemMatches && stepItemMatches.length >= 3) {
    const hasActiveStep = /(?:aria-current\s*=\s*["']step["']|data-state\s*=\s*["']active["']|isActive|currentStep|activeStep|step\s*===?\s*\d|className\s*=\s*[^>]*(?:active|current|selected))/i.test(content);
    if (hasActiveStep) {
      hasLabeledStepper = true;
      contextSignals.push('stepper_labels');
      contextSignals.push('active_step_indicator');
    }
  }

  const stepsArrayRe = /(?:const|let)\s+\w*[Ss]teps\w*\s*=\s*\[([^\]]{20,})\]/s;
  const stepsArrayMatch = content.match(stepsArrayRe);
  if (stepsArrayMatch) {
    const arrayContent = stepsArrayMatch[1];
    const labelEntries = arrayContent.match(/(?:label|title|name)\s*:\s*["'][^"']+["']/gi);
    if (labelEntries && labelEntries.length >= 3) {
      const hasStepTracking = /(?:currentStep|activeStep|step\s*===?\s*\d|setStep|useState.*step)/i.test(content);
      if (hasStepTracking) {
        hasLabeledStepper = true;
        contextSignals.push('stepper_array_labels');
        contextSignals.push('step_state_tracking');
      }
    }
  }

  const stepperComponentRe = /<(?:Stepper|Steps|ProgressSteps|StepWizard)\b[^>]*>/i;
  if (stepperComponentRe.test(content)) {
    const stepChildRe = /<(?:Step|StepItem)\b/gi;
    const stepChildren = content.match(stepChildRe);
    if (stepChildren && stepChildren.length >= 3) {
      hasLabeledStepper = true;
      contextSignals.push('stepper_component');
    }
  }

  // (B) Strong nearby heading detection
  const headingPositions: Array<{ offset: number; text: string }> = [];
  const headingRe = /<(?:h[1-3])\b[^>]*>([^<]+)</gi;
  let hMatch;
  while ((hMatch = headingRe.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5) headingPositions.push({ offset: hMatch.index, text });
  }
  const typoHeadingRe = /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*\b(?:font-(?:bold|semibold))\b[^"']*["'][^>]*>([^<]+)</gi;
  while ((hMatch = typoHeadingRe.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5) headingPositions.push({ offset: hMatch.index, text });
  }
  const typoHeadingRe2 = /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:font-(?:bold|semibold))\b[^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*["'][^>]*>([^<]+)</gi;
  while ((hMatch = typoHeadingRe2.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5 && !headingPositions.some(h => h.offset === hMatch!.index)) {
      headingPositions.push({ offset: hMatch.index, text });
    }
  }

  const HEADING_PROXIMITY_CHARS = 2000;
  const hasStrongNearbyHeading = (btnOffset: number): boolean => {
    return headingPositions.some(h => {
      const dist = btnOffset - h.offset;
      return dist >= 0 && dist <= HEADING_PROXIMITY_CHARS;
    });
  };
  if (headingPositions.length > 0) contextSignals.push('nearby_heading');

  // (C) Single primary CTA detection
  let highEmphasisCount = 0;
  for (const btn of allButtons) {
    const emph = buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)
      ? classifyButtonEmphasis({
          resolvedVariant: btn.variant || buttonImpl.config.defaultVariant || 'default',
          variantConfig: buttonImpl.config,
          instanceClassName: btn.className,
        }).emphasis
      : classifyTailwindEmphasis(btn.className);
    if (emph === 'high') highEmphasisCount++;
  }
  const isSinglePrimaryCTA = highEmphasisCount <= 1;
  if (isSinglePrimaryCTA) contextSignals.push('single_primary_cta');

  return { hasLabeledStepper, hasStrongNearbyHeading, isSinglePrimaryCTA, contextSignals };
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
// U2 Navigation Detection — Web/Desktop Wayfinding Clarity Only (v4)
// Sub-checks: U2.D1 (missing nav landmark), U2.D2 (deep pages without "you are here" cues), U2.D3 (breadcrumb depth risk — evidence-gated)
// Scope: Can users know where they are, where they can go, and how to go back?
// U2 must NOT evaluate: layout grouping (U6), truncation (U3), step indicators (U4), exit/cancel absence (E3), landmark semantics (A-rules)
// =====================

// U2.D3 helpers (project-agnostic breadcrumb depth risk detection)
function detectBreadcrumbCapDepthGH(allFiles: Map<string, string>, breadcrumbLogicFilesArg: string[]): { capped: boolean; file: string; functionName: string } | null {
  const breadcrumbFilePatterns = /breadcrumb|crumbs|navtrail/i;
  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    const isBreadcrumbFile = breadcrumbFilePatterns.test(filePath) || breadcrumbLogicFilesArg.includes(filePath);
    const hasBreadcrumbTokens = /getBreadcrumbs|buildBreadcrumbs|makeCrumbs|breadcrumbs?\s*[:=]\s*\[/i.test(content);
    if (!isBreadcrumbFile && !hasBreadcrumbTokens) continue;
    const fnNameMatch = content.match(/(?:function|const)\s+(getBreadcrumbs|buildBreadcrumbs|makeCrumbs|createBreadcrumbs?|useBreadcrumbs?)\b/i);
    const functionName = fnNameMatch ? fnNameMatch[1] : 'breadcrumb logic';
    if (/(?:return|=)\s*\[\s*\{[^}]+\}\s*,\s*\{[^}]+\}\s*\]/i.test(content) &&
        !/(?:return|=)\s*\[\s*\{[^}]+\}\s*,\s*\{[^}]+\}\s*,\s*\{/i.test(content)) {
      return { capped: true, file: filePath, functionName };
    }
    if (/\.split\s*\(\s*["']\/?["']\s*\)/.test(content)) {
      const usesShallowIndex = /segments?\[0\]|segments?\[1\]|parts?\[0\]|parts?\[1\]/i.test(content);
      const usesDeepIndex = /segments?\[[2-9]\]|parts?\[[2-9]\]|\.slice\(\s*0\s*,\s*[3-9]/i.test(content);
      if (usesShallowIndex && !usesDeepIndex) return { capped: true, file: filePath, functionName };
    }
    if (/switch\s*\(/i.test(content)) {
      const cases = content.match(/case\s*["']\/[^"']*["']/gi) || [];
      if (cases.length >= 1) {
        const maxCaseDepth = Math.max(...cases.map(c => {
          const p = c.replace(/case\s*["']/i, '').replace(/["']$/, '');
          return p.split('/').filter(Boolean).length;
        }), 0);
        if (maxCaseDepth <= 2) return { capped: true, file: filePath, functionName };
      }
    }
    if (/\.slice\s*\(\s*0\s*,\s*2\s*\)|\.slice\s*\(\s*-2\s*\)/i.test(content) &&
        /segment|crumb|path|part/i.test(content)) {
      return { capped: true, file: filePath, functionName };
    }
  }
  return null;
}

function collectDeepRouteEvidenceGH(allFiles: Map<string, string>): { maxDepth: number; exampleRoute: string; channels: string[] } {
  let maxDepth = 0;
  let exampleRoute = '';
  const channelsUsed = new Set<string>();
  function measureDepth(pathStr: string): number {
    return pathStr.replace(/:[^/]+|\[[^\]]+\]|\$[^/]+/g, '_dyn').split('/').filter(Boolean).length;
  }
  function updateMax(path: string, depth: number, channel: string) {
    if (depth > maxDepth) { maxDepth = depth; exampleRoute = path; }
    if (depth >= 3) channelsUsed.add(channel);
  }
  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (filePath.includes('node_modules/')) continue;
    if (/\.(tsx|jsx|ts|js)$/.test(filePath)) {
      const routePaths = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
      for (const m of routePaths) {
        const p = m.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
        updateMax(p, measureDepth(p), 'A');
      }
      const linkMatches = content.match(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*["'](\/[^"']{4,})["']/gi) || [];
      for (const m of linkMatches) {
        const p = m.replace(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*["']/i, '').replace(/["']$/, '');
        updateMax(p, measureDepth(p), 'B');
      }
      const templateLinks = content.match(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*`(\/[^`]{4,})`/gi) || [];
      for (const m of templateLinks) {
        const p = m.replace(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*`/i, '').replace(/`$/, '');
        const normalized = p.replace(/\$\{[^}]+\}/g, '_dyn');
        updateMax(normalized, measureDepth(normalized), 'B');
      }
    }
    if (/\/(pages|app|routes|views)\//.test(filePath)) {
      const routePart = filePath.replace(/^.*?\/(pages|app|routes|views)\//, '/');
      const cleanedRoute = routePart.replace(/\.(tsx|jsx|ts|js|mdx?)$/, '').replace(/\/index$/, '').replace(/\/page$/, '');
      const depth = measureDepth(cleanedRoute);
      if (depth >= 3) updateMax(cleanedRoute, depth, 'C');
    }
  }
  return { maxDepth, exampleRoute, channels: [...channelsUsed] };
}

function detectBreadcrumbDepthRiskGH(
  allFiles: Map<string, string>, breadcrumbLogicFilesArg: string[],
  hasBreadcrumbLogicDefined: boolean, _hasBreadcrumbComponentInDesignSystem: boolean,
  hasBreadcrumbRendered: boolean, hasActiveNavHighlight: boolean, hasPageHeadingInLayout: boolean,
): Omit<U2Finding, 'deduplicationKey'> | null {
  const capDepth = detectBreadcrumbCapDepthGH(allFiles, breadcrumbLogicFilesArg);
  if (!capDepth) return null;
  const evidence = collectDeepRouteEvidenceGH(allFiles);
  const hasStrongEvidence = evidence.maxDepth >= 3 && (evidence.channels.includes('A') || evidence.channels.includes('B'));
  if (!hasStrongEvidence) return null;
  if (hasBreadcrumbRendered && hasActiveNavHighlight && hasPageHeadingInLayout) return null;
  let confidence = 0.60;
  if (evidence.channels.includes('A')) confidence += 0.10;
  if (evidence.channels.includes('B')) confidence += 0.10;
  if (evidence.channels.includes('A') && evidence.channels.includes('B')) confidence += 0.05;
  confidence = Math.min(confidence, 0.85);
  return {
    subCheck: 'U2.D3', subCheckLabel: 'Breadcrumb depth may not cover deep routes', classification: 'potential',
    elementLabel: capDepth.functionName, elementType: 'navigation', filePath: capDepth.file,
    detection: 'Breadcrumb implementation appears limited to 1–2 levels',
    evidence: `${capDepth.functionName} in ${capDepth.file} appears capped at ≤2 levels. App includes deeper routes (e.g., "${evidence.exampleRoute}", depth ${evidence.maxDepth}). Evidence channels: ${evidence.channels.join(', ')}.`,
    explanation: `Breadcrumb logic appears limited to 1–2 levels, but the app includes deeper routes such as "${evidence.exampleRoute}", which may reduce wayfinding cues.`,
    confidence,
    advisoryGuidance: 'Review breadcrumb logic to ensure it covers the full route depth, or provide alternative wayfinding cues for deep views.',
  };
}



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

const NAV_COMPONENT_NAMES_GH = /\b(Sidebar|Navbar|Header|Topbar|Menu|Tabs|Breadcrumb|NavigationMenu|Drawer|Sheet|Stepper|AppSidebar|TopNav|BottomNav|NavBar|MainNav|SideNav)\b/;

function detectU2Navigation(allFiles: Map<string, string>): U2Finding[] {
  const findings: U2Finding[] = [];
  const seenKeys = new Set<string>();

  let routeCount = 0;
  const routeFiles: string[] = [];
  const deepRouteFiles: string[] = [];
  let hasNavComponentRendered = false;
  let hasNavItemsMapping = false;
  let hasBreadcrumbLogicDefined = false;
  let hasBreadcrumbComponentInDesignSystem = false;
  let hasBreadcrumbRendered = false;
  const breadcrumbLogicFiles: string[] = [];
  let hasBackControl = false;
  let hasParentRouteLink = false;
  let hasLayoutWithNav = false;
  let hasTabsAsPrimaryIA = false;
  let hasDrawerWithMenu = false;
  const navPrimitivesFound = new Set<string>();
  let hasVisiblePageTitle = false;
  let hasMobileOnlyNavToggle = false;
  let hasDesktopNavHidden = false;
  let maxRouteDepth = 0;
  let hasActiveNavHighlight = false;
  let hasPageHeadingInLayout = false;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const routePatterns = [/<Route\b/gi, /path\s*[:=]\s*["']\//gi, /createBrowserRouter/gi, /useRoutes/gi];
    let fileRouteCount = 0;
    for (const pat of routePatterns) {
      const matches = content.match(pat);
      if (matches) fileRouteCount += matches.length;
    }
    if (fileRouteCount > 0) { routeCount += fileRouteCount; routeFiles.push(filePath); }

    const deepPathPatterns = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
    for (const match of deepPathPatterns) {
      const pathValue = match.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
      const segments = pathValue.split('/').filter(Boolean);
      if (segments.length >= 2 && /(:id|\[id\]|\/edit|\/new|\/create|\/details)/i.test(pathValue)) {
        deepRouteFiles.push(filePath);
      }
    }

    if (NAV_COMPONENT_NAMES_GH.test(content)) {
      const navCompMatch = content.match(NAV_COMPONENT_NAMES_GH);
      if (navCompMatch && new RegExp(`<${navCompMatch[1]}\\b`, 'i').test(content)) {
        hasNavComponentRendered = true;
      }
    }

    if (/(?:navItems|menuItems|routes|links|navigationItems|sidebarItems)\s*\.map\s*\(/i.test(content)) {
      hasNavItemsMapping = true;
    }

    if (/layout|sidebar|navbar|header|navigation|menu/i.test(filePath)) {
      if (/<(?:Link|NavLink|a)\b[^>]*(?:href|to)\s*=/i.test(content) || NAV_COMPONENT_NAMES_GH.test(content)) {
        hasLayoutWithNav = true;
      }
    }

    if (/getBreadcrumbs\s*\(|buildBreadcrumbs\s*\(|makeCrumbs\s*\(|breadcrumbs?\s*[:=]\s*\[/i.test(content) ||
        /breadcrumb|crumbs|navtrail/i.test(filePath)) {
      hasBreadcrumbLogicDefined = true;
      breadcrumbLogicFiles.push(filePath);
    }
    if (/(?:export\s+(?:function|const)\s+Breadcrumb|Breadcrumb\s*=\s*React\.forwardRef|const\s+Breadcrumb\b)/i.test(content)) {
      hasBreadcrumbComponentInDesignSystem = true;
    }
    if (/<Breadcrumb\b/i.test(content) || /role\s*=\s*["']breadcrumb["']/i.test(content)) {
      hasBreadcrumbRendered = true;
    }

    if (/<(?:Button|button|a|Link)\b[^>]*>(?:[^<]*(?:Back|Go back|Return|← Back|Previous|Cancel)[^<]*)<\//i.test(content)) {
      hasBackControl = true;
    }
    if (/navigate\s*\(\s*-1\s*\)|history\.back|router\.back/i.test(content)) {
      if (/<(?:Button|button|a|Link)\b/i.test(content)) hasBackControl = true;
    }
    if (/<(?:Link|a)\b[^>]*(?:href|to)\s*=\s*["']\/[^"'/]*["']/i.test(content) &&
        /header|breadcrumb|page-title|back/i.test(content)) {
      hasParentRouteLink = true;
    }

    // Active nav highlight detection
    if (/aria-current\s*=\s*["']page["']/i.test(content)) hasActiveNavHighlight = true;
    if (/<NavLink\b/i.test(content)) hasActiveNavHighlight = true;
    if (/isActive|data-state\s*=\s*["']active["']/i.test(content) &&
        /nav|sidebar|menu|header|tab/i.test(content)) hasActiveNavHighlight = true;
    if (/className\s*=.*(?:active|selected|current)/i.test(content) &&
        /nav|sidebar|menu|header|tab/i.test(filePath + content.slice(0, 200))) hasActiveNavHighlight = true;

    // Page heading in layout/page files
    if (/<h1\b/i.test(content) || /<h2\b/i.test(content)) {
      if (/layout|page|view|screen|dashboard|detail/i.test(filePath) ||
          /<(?:h1|h2)\b/i.test(content.slice(0, Math.min(content.length, 2000)))) {
        hasPageHeadingInLayout = true;
      }
    }
    if (/<h1\b/i.test(content)) hasVisiblePageTitle = true;

    if (/<Tabs\b/i.test(content) && /<TabsList\b/i.test(content)) { hasTabsAsPrimaryIA = true; navPrimitivesFound.add('Tabs'); }
    if (/<(?:Drawer|Sheet)\b/i.test(content) && /(?:Menu|menu|hamburger|☰)/i.test(content)) { hasDrawerWithMenu = true; navPrimitivesFound.add('Drawer/Sheet'); }
    if (/<Sidebar\b/i.test(content)) navPrimitivesFound.add('Sidebar');
    if (/<Breadcrumb\b/i.test(content)) navPrimitivesFound.add('Breadcrumb');
    if (/<Navbar\b|<NavBar\b|<Header\b.*(?:nav|link|menu)/i.test(content)) navPrimitivesFound.add('Navbar');
    if (/<NavigationMenu\b/i.test(content)) navPrimitivesFound.add('NavigationMenu');

    if (/mobileOpen|isMobileMenuOpen|mobileMenuOpen|menuOpen.*mobile/i.test(content)) hasMobileOnlyNavToggle = true;
    if (/(?:sm:|md:)(?:hidden|block|flex|inline-flex)\b/i.test(content) &&
        /(?:nav|sidebar|menu|header)/i.test(content)) {
      if (/(?:lg:|xl:)hidden\b/i.test(content)) hasDesktopNavHidden = true;
      else hasMobileOnlyNavToggle = true;
    }

    const pathMatchesU2 = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
    for (const match of pathMatchesU2) {
      const pathValue = match.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
      const depth = pathValue.split('/').filter(Boolean).length;
      if (depth > maxRouteDepth) maxRouteDepth = depth;
    }
  }

  const navPrimitiveCount = navPrimitivesFound.size;

  // Global suppression
  if (routeCount <= 2) { console.log('[U2] Suppressed: ≤2 routes'); return []; }
  if (navPrimitiveCount >= 2) { console.log(`[U2] Suppressed: ≥2 nav primitives (${[...navPrimitivesFound].join(', ')})`); return []; }
  if (hasLayoutWithNav && hasNavComponentRendered) { console.log('[U2] Suppressed: layout provides nav'); return []; }
  if (hasTabsAsPrimaryIA && routeCount <= 5) { console.log('[U2] Suppressed: Tabs as primary IA'); return []; }
  if (hasDrawerWithMenu) { console.log('[U2] Suppressed: Drawer/Sheet with menu'); return []; }
  if (hasActiveNavHighlight && hasVisiblePageTitle) { console.log('[U2] Suppressed: active highlight + page heading'); return []; }
  if (hasBreadcrumbRendered && hasVisiblePageTitle) { console.log('[U2] Suppressed: breadcrumb + page title'); return []; }
  if (hasMobileOnlyNavToggle && !hasDesktopNavHidden) { console.log('[U2] Suppressed: mobile-only nav toggle'); return []; }

  // U2.D1 — Missing navigation landmark
  if (routeCount >= 3 && !hasNavComponentRendered && !hasNavItemsMapping && !hasLayoutWithNav) {
    const dedupeKey = 'U2.D1|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      const conf = Math.min(0.65 + (routeCount > 5 ? 0.05 : 0) + (routeCount > 8 ? 0.05 : 0), 0.75);
      findings.push({
        subCheck: 'U2.D1', subCheckLabel: 'Missing navigation landmark', classification: 'potential',
        elementLabel: 'Application routing', elementType: 'navigation', filePath: routeFiles[0] || 'Unknown',
        detection: `${routeCount} routes without visible navigation UI`,
        evidence: `Routes in: ${routeFiles.slice(0, 3).join(', ')}${routeFiles.length > 3 ? ` (+${routeFiles.length - 3} more)` : ''}. No rendered nav components or navItems mapping found.`,
        explanation: `The app defines ${routeCount} routes but no visible navigation UI was detected.`,
        confidence: conf, advisoryGuidance: 'Add a visible navigation component that exposes the main routes.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // U2.D2 — Deep pages without "you are here" cues
  if (deepRouteFiles.length > 0) {
    const hasAnyCue = hasActiveNavHighlight || hasPageHeadingInLayout || hasBreadcrumbRendered || hasBackControl || hasParentRouteLink;
    if (!hasAnyCue) {
      const dedupeKey = 'U2.D2|global';
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        const missingCues: string[] = [];
        if (!hasActiveNavHighlight) missingCues.push('no active nav highlight');
        if (!hasPageHeadingInLayout) missingCues.push('no page heading');
        if (!hasBreadcrumbRendered) missingCues.push('no breadcrumb');
        if (!hasBackControl) missingCues.push('no back button');
        const conf = Math.min(0.65 + (missingCues.length > 3 ? 0.10 : 0.05), 0.80);
        findings.push({
          subCheck: 'U2.D2', subCheckLabel: 'Deep pages without "you are here" cues', classification: 'potential',
          elementLabel: 'Deep route navigation', elementType: 'navigation', filePath: deepRouteFiles[0],
          detection: 'Detail/nested views lack persistent wayfinding cues',
          evidence: `Deep routes: ${deepRouteFiles.slice(0, 3).join(', ')}. Missing: ${missingCues.join('; ')}.`,
          explanation: 'Deep/nested pages lack all persistent wayfinding cues.',
          confidence: conf, advisoryGuidance: 'Add at least one "you are here" cue: active nav highlight, page heading, or breadcrumb.',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  // U2.D3 — Breadcrumb depth risk (evidence-gated, project-agnostic)
  {
    const d3Result = detectBreadcrumbDepthRiskGH(allFiles, breadcrumbLogicFiles, hasBreadcrumbLogicDefined, hasBreadcrumbComponentInDesignSystem, hasBreadcrumbRendered, hasActiveNavHighlight, hasPageHeadingInLayout);
    if (d3Result) {
      const dedupeKey = 'U2.D3|global';
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({ ...d3Result, deduplicationKey: dedupeKey });
      }
    }
  }

  console.log(`[U2] Detection (GitHub): routes=${routeCount}, navComp=${hasNavComponentRendered}, navMapping=${hasNavItemsMapping}, layoutNav=${hasLayoutWithNav}, breadcrumb=${hasBreadcrumbRendered}, back=${hasBackControl}, deep=${deepRouteFiles.length}, maxDepth=${maxRouteDepth}, navPrimitives=${navPrimitiveCount}, activeHighlight=${hasActiveNavHighlight}, pageHeading=${hasPageHeadingInLayout}, mobileOnly=${hasMobileOnlyNavToggle}, desktopHidden=${hasDesktopNavHidden}, findings=${findings.length}`);
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
    const treeResult = await fetchRepoTree(owner, repo);
    const tree = treeResult.tree;
    const commitSha = treeResult.commitSha;
    const branch = treeResult.branch;
    console.log(`Fetched ${tree.length} items from repository tree (branch: ${branch}, commit: ${commitSha})`);
    
    // Filter for analyzable files (using shared parity filter)
    // Filter for analyzable files (using shared parity filter with detailed reasons)
    const excludedFiles: ExcludedFile[] = [];
    const apiErrors: Array<{ path: string; error: string }> = [];
    const analyzableFiles = tree.filter((file) => {
      if (file.type !== 'blob') return false;
      // Detect submodules (type='commit' is already filtered, but check sha-only blobs)
      if (file.type === 'blob' && file.size === 0) return false;
      
      const filterResult = pFilterPath(file.path);
      if (!filterResult.included) {
        excludedFiles.push({ path: file.path, reason: filterResult.reason!, detail: filterResult.detail });
        return false;
      }
      // Per-file size cap (use GitHub tree metadata when available)
      if (file.size && file.size > PER_FILE_SIZE_CAP) {
        excludedFiles.push({ path: file.path, reason: 'size_cap', detail: `${file.size} bytes > ${PER_FILE_SIZE_CAP}` });
        return false;
      }
      return true;
    });
    console.log(`Found ${analyzableFiles.length} analyzable UI files (excluded ${excludedFiles.length})`);
    
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
    
    // Fetch ALL analyzable files (no arbitrary MAX_FILES cap — use size cap only)
    const MAX_TOTAL_SIZE = TOTAL_SIZE_CAP;
    
    console.log(`Fetching content for ${analyzableFiles.length} files...`);
    
    // Fetch file contents
    const allFiles = new Map<string, string>();
    let totalSize = 0;
    
    for (const file of analyzableFiles) {
      if (totalSize >= MAX_TOTAL_SIZE) {
        // Mark remaining as excluded due to total size cap
        const remainingIdx = analyzableFiles.indexOf(file);
        for (let i = remainingIdx; i < analyzableFiles.length; i++) {
          excludedFiles.push({ path: analyzableFiles[i].path, reason: 'size_cap', detail: `total exceeded ${MAX_TOTAL_SIZE}` });
        }
        console.log(`Reached total size limit (${totalSize} bytes), stopping file fetch`);
        break;
      }
      
      try {
        const rawContent = await fetchFileContent(owner, repo, file.path);
        if (!rawContent) {
          excludedFiles.push({ path: file.path, reason: 'api_error', detail: 'empty response' });
          continue;
        }

        // Check for LFS pointers
        if (pIsLfsPointer(rawContent)) {
          excludedFiles.push({ path: file.path, reason: 'git_lfs_pointer' });
          continue;
        }

        // Check for submodule pointers
        if (pIsSubmodulePointer(rawContent)) {
          excludedFiles.push({ path: file.path, reason: 'submodule' });
          continue;
        }

        const content = pNormalizeContent(rawContent);

        // Check for high replacement ratio (binary/corrupted)
        if (pHasHighReplacementRatio(content)) {
          excludedFiles.push({ path: file.path, reason: 'decode_error', detail: 'high replacement char ratio' });
          continue;
        }

        // Per-file size cap on content
        if (content.length > PER_FILE_SIZE_CAP) {
          excludedFiles.push({ path: file.path, reason: 'size_cap', detail: `${content.length} bytes content > ${PER_FILE_SIZE_CAP}` });
          continue;
        }

        const canonPath = pNormalizePath(file.path);
        allFiles.set(canonPath, content);
        totalSize += content.length;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`Failed to fetch ${file.path}:`, err);
        excludedFiles.push({ path: file.path, reason: 'api_error', detail: errMsg });
        apiErrors.push({ path: file.path, error: errMsg });
      }
    }
    
    console.log(`Fetched ${allFiles.size} files, total size: ${totalSize} bytes`);
    
    // Detect stack
    const stack = detectStack(allFiles);
    console.log(`Detected stack: ${stack}`);
    
    // Run deterministic analyses
    const selectedRulesSet = new Set(selectedRules || []);
    
    // A1 - Contrast analysis (full parity with ZIP)
    const contrastViolations: ContrastViolation[] = [];
    if (selectedRulesSet.has('A1')) {
      const computed = analyzeContrastInCode(allFiles);
      contrastViolations.push(...computed);
      // A1.3: theme-dependent / opacity-reduced text detection
      const themeDependentFindings = detectA1ThemeDependentText(allFiles);
      contrastViolations.push(...themeDependentFindings);
      console.log(`Computed ${contrastViolations.length} contrast violations (incl. ${themeDependentFindings.length} A1.3 theme/opacity)`);
    } else {
      console.log('A1 not selected, skipping contrast analysis');
    }
    
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
          diagnosis: `Navigation clarity risk: ${u2Findings.length} wayfinding concern(s) detected via structural analysis.`,
          contextualHint: 'Navigation clarity risk — verify in context.',
          advisoryGuidance: 'Review navigation wayfinding: ensure users can identify their location, discover available routes, and navigate back from deep views.',
          confidence: Math.min(Math.round(overallConfidence * 100) / 100, 0.80),
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
          truncationType: f.truncationType, textLength: f.textLength,
          triggerReason: f.triggerReason, expandDetected: f.expandDetected,
          elementTag: f.elementTag,
          occurrences: f.occurrences,
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
    
    // Extract U4 candidates (Stage 1: deterministic extraction only, no classification)
    const u4Candidates: U4Candidate[] = selectedRulesSet.has('U4') ? extractU4Candidates(allFiles) : [];
    const u4BundleText = formatU4CandidatesForLLM(u4Candidates);

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
    
    // ========== A2 Focus Visibility — Fully Deterministic ==========
    // Group by file + focus-class pattern signature, then split confirmed/potential
    const aggregatedA2GitHubList: any[] = [];
    if (selectedRulesSet.has('A2')) {
      const a2Findings = detectA2FocusVisibility(allFiles);
      if (a2Findings.length > 0) {
        // ── Pattern-signature grouping ──
        const groupByPattern = (list: typeof a2Findings) => {
          const groups = new Map<string, { representative: typeof list[0]; occurrences: number; components: Set<string>; lines: number[] }>();
          for (const f of list) {
            const patternSig = [...f.focusClasses].sort().join(' ');
            const groupKey = `${f.filePath}|${patternSig}`;
            const existing = groups.get(groupKey);
            if (existing) {
              existing.occurrences++;
              if (f.componentName) existing.components.add(f.componentName);
              existing.lines.push(f.lineNumber);
              if (f.confidence > existing.representative.confidence) existing.representative = f;
            } else {
              const components = new Set<string>();
              if (f.componentName) components.add(f.componentName);
              groups.set(groupKey, { representative: f, occurrences: 1, components, lines: [f.lineNumber] });
            }
          }
          return Array.from(groups.values());
        };

        const confirmedFindings = a2Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = a2Findings.filter(f => f.classification === 'potential');

        const confirmedGroups = groupByPattern(confirmedFindings);
        const potentialGroups = groupByPattern(potentialFindings);

        const mapA2Groups = (groups: ReturnType<typeof groupByPattern>) => groups.map(g => ({
          elementLabel: g.representative.sourceLabel,
          elementType: g.representative.elementType,
          elementTag: g.representative.elementTag,
          elementName: g.representative.elementName,
          elementSource: g.representative.elementSource,
          role: g.representative.elementType,
          accessibleName: '',
          sourceLabel: g.representative.sourceLabel,
          selectorHint: `<${g.representative.elementTag || g.representative.elementType || 'element'}> in ${g.representative.filePath}`,
          selectorHints: g.representative.selectorHints,
          location: g.representative.filePath,
          lineRange: g.lines.length > 1 ? `${Math.min(...g.lines)}–${Math.max(...g.lines)}` : (g.representative.lineEnd ? `${g.representative.lineNumber}–${g.representative.lineEnd}` : `${g.representative.lineNumber}`),
          detection: g.representative.detection + (g.occurrences > 1 ? ` (${g.occurrences} occurrences)` : ''),
          detectionMethod: 'deterministic' as const,
          focusClasses: g.representative.focusClasses,
          classification: g.representative.classification as 'confirmed' | 'potential',
          potentialSubtype: g.representative.potentialSubtype,
          potentialReason: g.representative.potentialReason,
          explanation: g.representative.explanation,
          confidence: g.representative.confidence,
          correctivePrompt: g.representative.correctivePrompt,
          deduplicationKey: g.representative.deduplicationKey,
          focusable: g.representative.focusable,
          occurrences: g.occurrences,
          affectedComponents: Array.from(g.components),
          _a2Debug: g.representative._a2Debug,
        }));

        if (confirmedGroups.length > 0) {
          const totalConfirmed = confirmedGroups.reduce((s, g) => s + g.occurrences, 0);
          aggregatedA2GitHubList.push({
            ruleId: 'A2',
            ruleName: 'Poor focus visibility',
            category: 'accessibility',
            status: 'confirmed',
            blocksConvergence: true,
            inputType: 'github',
            isA2Aggregated: true,
            a2Elements: mapA2Groups(confirmedGroups),
            evaluationMethod: 'deterministic',
            diagnosis: `Focus visibility issues: ${confirmedGroups.length} pattern(s) across ${totalConfirmed} occurrence(s).`,
            contextualHint: 'Add visible focus-visible indicators for keyboard accessibility.',
            correctivePrompt: 'Add a visible focus indicator for interactive elements that remove the default outline.',
            confidence: Math.max(...confirmedGroups.map(g => g.representative.confidence)),
          });
        }

        if (potentialGroups.length > 0) {
          const totalPotential = potentialGroups.reduce((s, g) => s + g.occurrences, 0);
          aggregatedA2GitHubList.push({
            ruleId: 'A2',
            ruleName: 'Poor focus visibility',
            category: 'accessibility',
            status: 'potential',
            potentialSubtype: 'borderline',
            blocksConvergence: false,
            inputType: 'github',
            isA2Aggregated: true,
            a2Elements: mapA2Groups(potentialGroups),
            evaluationMethod: 'deterministic',
            diagnosis: `Focus visibility issues: ${potentialGroups.length} pattern(s) across ${totalPotential} occurrence(s).`,
            contextualHint: 'Interactive elements have subtle focus indicators — verify visibility manually.',
            advisoryGuidance: 'Focus styling exists but may be too subtle. Consider using a clearer focus-visible indicator.',
            confidence: Math.max(...potentialGroups.map(g => g.representative.confidence)),
          });
        }

        const totalRaw = a2Findings.length;
        const totalGrouped = confirmedGroups.length + potentialGroups.length;
        console.log(`A2 deterministic (GitHub): ${totalRaw} raw findings → ${totalGrouped} grouped items → ${aggregatedA2GitHubList.length} object(s) (${confirmedGroups.length} confirmed groups, ${potentialGroups.length} borderline groups)`);
      } else {
        console.log('A2 deterministic (GitHub): No violations found');
      }
    }
    
    // Filter out any LLM A2 findings (deterministic takes over)
    const nonA2AiViolations = taggedAiViolations.filter((v: any) => v.ruleId !== 'A2' && v.ruleId !== 'A3' && v.ruleId !== 'A4' && v.ruleId !== 'A5' && v.ruleId !== 'A6' && v.ruleId !== 'U1');
    
    
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
          startLine: f.startLine ?? null, endLine: f.endLine ?? null,
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
          elementLabel: f.sourceLabel, elementType: f.elementType, elementName: f.elementName, controlType: f.controlType,
          inputSubtype: f.inputSubtype, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, filePath: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          advisoryGuidance: f.advisoryGuidance,
          potentialSubtype: f.potentialSubtype,
          deduplicationKey: f.deduplicationKey,
          selectorHints: f.selectorHints,
          controlId: f.controlId,
          labelingMethod: f.labelingMethod,
          startLine: f.startLine ?? null,
          endLine: f.endLine ?? null,
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
          // FILTER OUT LLM breadcrumb-depth speculations — must pass deterministic D3 gate
          const diagnosisLower = ((v.diagnosis || '') + (v.evidence || '') + (v.contextualHint || '')).toLowerCase();
          if (/breadcrumb.*depth|breadcrumb.*shallow|breadcrumb.*level|breadcrumb.*cap|breadcrumb.*reflect|breadcrumb.*limited|breadcrumb.*not cover|breadcrumb.*deeper|breadcrumb.*insufficient/i.test(diagnosisLower)) {
            console.log('[U2] Filtered out LLM breadcrumb-depth finding (GitHub) — must pass deterministic D3 gate');
            return null;
          }
          return { ...v, status: 'potential', blocksConvergence: false, evaluationMethod: 'hybrid_llm_fallback', confidence: Math.min(v.confidence || 0.65, 0.75) };
        }
        return v;
      }).filter(Boolean);
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

    // ========== U4 POST-PROCESSING (Recognition-to-Recall — Two-Stage, LLM-Mandatory) ==========
    // ALL U4 output comes from LLM (Stage 2). NEVER confirmed, always potential, max 0.65.
    const aggregatedU4GitHubList: any[] = [];
    if (selectedRulesSet.has('U4')) {
      const u4FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'U4');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U4');

      const allU4Elements: any[] = [];

      // Only LLM findings — no deterministic emission
      if (u4FromLLM.length > 0) {
        const aggregatedOne = u4FromLLM.find((v: any) => v.isU4Aggregated && v.u4Elements?.length > 0);
        const llmElements = aggregatedOne?.u4Elements || u4FromLLM.map((v: any) => ({
          elementLabel: v.evidence?.split('.')[0] || 'UI region',
          elementType: 'component', location: v.evidence || 'Unknown',
          detection: v.diagnosis || '', evidence: v.evidence || '',
          recommendedFix: v.contextualHint || '', confidence: v.confidence || 0.55,
          subCheck: 'U4.4', subCheckLabel: 'Generic Action Labels',
        }));

        for (const el of llmElements) {
          const cappedConf = Math.min(el.confidence || 0.55, 0.65);
          allU4Elements.push({
            elementLabel: el.elementLabel || 'UI region',
            elementType: el.elementType || 'component',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '', evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.round(cappedConf * 100) / 100,
            subCheck: el.subCheck || 'U4.4',
            subCheckLabel: el.subCheckLabel || 'Generic Action Labels',
            status: 'potential', // ALWAYS potential
            evaluationMethod: 'llm_assisted',
            mitigationSummary: el.mitigationSummary || '',
            deduplicationKey: el.deduplicationKey || `U4|${el.subCheck || 'U4.4'}|${el.location || ''}|${el.elementLabel || ''}`,
          });
        }
      }

      if (allU4Elements.length > 0) {
        const conf = Math.min(Math.max(...allU4Elements.map((e: any) => e.confidence)), 0.65);
        aggregatedU4GitHubList.push({
          ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isU4Aggregated: true, u4Elements: allU4Elements,
          evaluationMethod: 'llm_assisted',
          diagnosis: `Potential recognition-to-recall risks: ${allU4Elements.length} finding(s). LLM evaluated ${u4Candidates.length} candidates, reported ${allU4Elements.length}.`,
          contextualHint: 'Review to ensure recognition-based interaction is preferred over recall-dependent alternatives.',
          advisoryGuidance: 'Ensure structured selections, active state indicators, step context, and descriptive CTAs are provided where appropriate.',
          confidence: Math.round(conf * 100) / 100,
        });
        console.log(`U4 aggregated (GitHub): ${allU4Elements.length} potential (from ${u4Candidates.length} candidates)`);
      } else {
        console.log(`U4: LLM suppressed all ${u4Candidates.length} candidates — no findings`);
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

    // ========== U6 POST-PROCESSING (Weak Grouping / Layout Coherence — deterministic + LLM) ==========
    const aggregatedU6GitHubList: any[] = [];
    if (selectedRulesSet.has('U6')) {
      const allSuppressed = u6LayoutBundles.length > 0 && u6LayoutBundles.every(b => b.suppressReason);
      const suppressedFiles = u6LayoutBundles.filter(b => b.suppressReason).map(b => `${b.filePath} (${b.suppressReason})`);
      if (suppressedFiles.length > 0) console.log(`U6 deterministic suppression (GitHub): ${suppressedFiles.join('; ')}`);

      const u6FromLLM = filteredNonA2AiViolations.filter((v: any) => v.ruleId === 'U6');
      filteredNonA2AiViolations = filteredNonA2AiViolations.filter((v: any) => v.ruleId !== 'U6');

      if (allSuppressed) {
        console.log('U6 (GitHub): All files pass deterministic grouping checks — suppressing all U6 findings');
      } else if (u6FromLLM.length > 0) {
        const suppressedPaths = new Set(u6LayoutBundles.filter(b => b.suppressReason).map(b => b.filePath));
        const filterElement = (el: any) => {
          const loc = el.location || el.filePath || '';
          for (const sp of suppressedPaths) {
            if (loc.includes(sp) || sp.includes(loc)) return false;
          }
          return true;
        };

        const aggregatedOne = u6FromLLM.find((v: any) => v.isU6Aggregated && v.u6Elements?.length > 0);
        let u6Elements: any[];
        if (aggregatedOne) {
          u6Elements = (aggregatedOne.u6Elements || []).filter(filterElement).map((el: any) => ({
            elementLabel: el.elementLabel || 'Layout region',
            elementType: el.elementType || 'section',
            location: el.location || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: el.deduplicationKey || `U6|${el.location || ''}|${el.elementLabel || ''}`,
          }));
        } else {
          u6Elements = u6FromLLM.filter(filterElement).map((v: any) => ({
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
        }

        const unsuppressedBundles = u6LayoutBundles.filter(b => !b.suppressReason);
        const evidenceSummary = unsuppressedBundles.map(b =>
          `${b.filePath}: ${b.componentBlocks} component blocks, ${b.cardLikeDivs} card-like divs, ${b.sectionCount + b.articleCount + b.fieldsetCount} semantic, ~${b.majorSiblingEstimate} siblings`
        ).join('; ');

        if (u6Elements.length > 0) {
          const overallConfidence = Math.min(Math.max(...u6Elements.map((e: any) => e.confidence)), 0.80);
          aggregatedU6GitHubList.push({
            ruleId: 'U6', ruleName: 'Weak grouping / layout coherence', category: 'usability',
            status: 'potential', blocksConvergence: false,
            inputType: 'github', isU6Aggregated: true, u6Elements, evaluationMethod: 'llm_assisted',
            diagnosis: (aggregatedOne?.diagnosis || `Layout coherence issues: ${u6Elements.length} potential risk(s).`) + ` [Structural: ${evidenceSummary}]`,
            contextualHint: aggregatedOne?.contextualHint || 'Improve grouping, alignment, and spacing.',
            advisoryGuidance: 'Use consistent spacing, section headings, and visual containers to group related elements.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
          console.log(`U6 aggregated (GitHub): ${u6FromLLM.length} LLM finding(s) → ${u6Elements.length} element(s) after suppression`);
        } else {
          console.log('U6 (GitHub): All LLM findings suppressed by deterministic checks');
        }
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

    // ========== E2 POST-PROCESSING (Imbalanced Choice Architecture — High-Impact Gate + LLM-assisted) ==========
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
              recommendedFix: el.recommendedFix || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
              confidence: Math.min(el.confidence || 0.60, 0.75),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: el.deduplicationKey || `E2|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : e2FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'Choice group',
              elementType: 'button-group',
              location: v.evidence || 'Unknown',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
              confidence: Math.min(v.confidence || 0.60, 0.75),
              evaluationMethod: 'llm_only_code' as const,
              deduplicationKey: `E2|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...e2Elements.map((e: any) => e.confidence)), 0.75);
        aggregatedE2GitHubList.push({
          ruleId: 'E2', ruleName: 'Imbalanced choice architecture in high-impact decision', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Choice architecture imbalance: ${e2Elements.length} potential risk(s) in high-impact decision context.`,
          contextualHint: 'Present confirm/decline options with comparable visual weight and equal discoverability.',
          advisoryGuidance: 'Present confirm/decline options with comparable visual weight and equal discoverability. Avoid preselected consent/paid options; ensure opt-out is as easy as opt-in.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E2 aggregated (GitHub): ${e2FromLLM.length} LLM finding(s) → ${e2Elements.length} element(s)`);
      } else {
        console.log('E2: No LLM findings (high-impact gate likely filtered all bundles)');
      }
    }

    // ========== E3 POST-PROCESSING (Obscured or Restricted User Control — HYBRID) ==========
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
        if (llmReinforced) confidence = Math.min(confidence + 0.05, 0.80);
        if (confidence < 0.65) continue;

        e3Elements.push({
          elementLabel: f.elementLabel, elementType: f.elementType, location: f.filePath,
          subCheck: f.subCheck, detection: f.detection, evidence: f.evidence,
          recommendedFix: f.recommendedFix,
          confidence: Math.min(confidence, 0.80),
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
              const conf = Math.min(el.confidence || 0.65, 0.80);
              if (conf < 0.65) continue;
              e3Elements.push({
                elementLabel: el.elementLabel || 'High-impact action without exit', elementType: el.elementType || 'unknown',
                location: el.location || 'Unknown', subCheck: el.subCheck,
                detection: el.detection || '', evidence: el.evidence || '',
                recommendedFix: el.recommendedFix || '',
                confidence: conf,
                evaluationMethod: 'hybrid_structural_llm' as const,
                deduplicationKey: el.deduplicationKey || `E3|${el.location || ''}|${el.elementLabel || ''}`,
              });
            }
          }
        }
      }
      if (e3Elements.length > 0) {
        const overallConfidence = Math.min(Math.max(...e3Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedE3GitHubList.push({
          ruleId: 'E3', ruleName: 'Obscured or restricted user control', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'github', isE3Aggregated: true, e3Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Structural exit absence: ${e3Elements.length} high-impact action(s) without visible cancel/close/exit mechanism.`,
          contextualHint: 'Verify that high-impact actions provide clear exit controls.',
          advisoryGuidance: 'Analysis flagged potential restriction of user control; verify structural exit mechanisms for high-impact actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E3 aggregated (GitHub): ${deterministicE3.length} deterministic + ${e3FromLLM.length} LLM → ${e3Elements.length} element(s)`);
      } else {
        console.log('E3: No findings (all suppressed or no high-impact actions without exit) (GitHub)');
      }
    }

    // Combine all violations
    const allViolationsPreSuppression = [
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
      ...aggregatedA2GitHubList,
      ...(aggregatedA3GitHub ? [aggregatedA3GitHub] : []),
      ...(aggregatedA4GitHub ? [aggregatedA4GitHub] : []),
      ...(aggregatedA5GitHub ? [aggregatedA5GitHub] : []),
      ...(aggregatedA6GitHub ? [aggregatedA6GitHub] : []),
    ];

    // ========== POSITIVE FINDING FILTER (Issues-Only Guardrail) ==========
    const { applyCrossRuleSuppression, filterPositiveFindings } = await import('../_shared/cross-rule-suppression.ts');
    const { kept: issuesOnly } = filterPositiveFindings(allViolationsPreSuppression);
    console.log(`Positive-filter: ${allViolationsPreSuppression.length} → ${issuesOnly.length} (removed ${allViolationsPreSuppression.length - issuesOnly.length} non-issues)`);

    // ========== CROSS-RULE SUPPRESSION (S1–S10 + fallback priority) ==========
    const { kept: suppressedResult, suppressedElements } = applyCrossRuleSuppression(issuesOnly);

    // Deduplicate by ruleId+status
    const seenRuleStatus = new Set<string>();
    const deduplicatedViolations = suppressedResult.filter(v => {
      const key = `${v.ruleId}|${v.status || 'unknown'}`;
      if (seenRuleStatus.has(key)) return false;
      seenRuleStatus.add(key);
      return true;
    });
    
    console.log(`GitHub analysis complete: ${allViolationsPreSuppression.length} pre-suppression → ${deduplicatedViolations.length} violations (${suppressedElements.length} element(s) suppressed)`);

    // === PARITY DIAGNOSTICS ===
    const rulesExecuted = Array.from(selectedRulesSet);
    const findingsPerRule: Record<string, number> = {};
    for (const v of deduplicatedViolations) {
      const rid = (v as any).ruleId || 'unknown';
      findingsPerRule[rid] = (findingsPerRule[rid] || 0) + 1;
    }
    const ghSnapshot = pBuildSnapshot(allFiles, 'github', excludedFiles);
    pLogParityDiagnostics(ghSnapshot, rulesExecuted, findingsPerRule, apiErrors);
    
    return new Response(
      JSON.stringify({
        success: true,
        violations: deduplicatedViolations,
        passNotes: analysisResult.passNotes || {},
        filesAnalyzed: allFiles.size,
        stackDetected: stack,
        repoInfo: { owner, repo },
        snapshotHash: ghSnapshot.hash,
        snapshotFileCount: ghSnapshot.metadata.totalFiles,
        snapshotTotalBytes: ghSnapshot.metadata.totalSizeBytes,
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
