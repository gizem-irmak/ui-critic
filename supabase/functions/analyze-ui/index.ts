import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================
// A1 (Contrast) — MANDATORY COMPREHENSIVE COVERAGE RULE v24
// ============================
// 
// Rule Objective: Detect text elements that may not meet WCAG 2.1 AA contrast
// requirements. Report per element — uncertainty DOWNGRADES classification,
// it NEVER eliminates reporting.
//
// CRITICAL: For every detected text element, ALWAYS emit an A1 evaluation record.
// Silence is NOT an allowed outcome.
//
// ============================================================
// MANDATORY COMPREHENSIVE DETECTION SCOPE (v24 UPDATE)
// ============================================================
// ALL visible text elements MUST be evaluated. Do NOT exclude based on:
//   - Visual prominence (secondary, muted, faded)
//   - Semantic role (metadata, captions, badges, labels)
//   - Stylistic intent (intentionally low-contrast for aesthetic reasons)
//   - Text size, weight, or brightness
//   - Perceived importance or emphasis
//   - Font size or bounding box dimensions
//   - Color brightness or luminance
//
// TEXT DETECTION OVERRIDE: For A1, the text detection pipeline MUST NOT
// apply any filtering. Filters for other rules (A2, A4) do NOT apply to A1.
//
// MUST INCLUDE (not exhaustive):
//   - Secondary or muted text
//   - Descriptions, summaries, captions
//   - Author names, timestamps, metadata
//   - Tags, labels, badges, chips
//   - Colored text (yellow, blue, gray, etc.)
//   - Placeholder text, helper text
//   - Price labels, discount text
//   - Footer text, copyright notices
//   - Small text, light-weight text
//
// If text is visible and readable by users, it MUST be checked.
// ============================================================
//
// ============================================================
// WCAG TIERED CONTRAST THRESHOLDS (v25)
// ============================================================
// Apply different thresholds based on text size classification:
//
// NORMAL TEXT (textSize: "normal"):
//   - Minimum contrast: 4.5:1 (WCAG AA)
//   - Use for: body text, descriptions, labels, metadata, most UI text
//
// LARGE TEXT (textSize: "large"):
//   - Minimum contrast: 3.0:1 (WCAG AA)
//   - Classify as "large" when:
//     a) Estimated text height ≥ 18pt (~24px) for normal-weight text, OR
//     b) Estimated text height ≥ 14pt (~18.7px) AND text appears bold
//        (increased stroke width, heavier pixel density)
//
// ============================================================
// NAVIGATION EXCEPTION (v25.1)
// ============================================================
// Top-level navigation items and primary menu links MUST use the
// LARGE TEXT threshold (3:1), REGARDLESS of their actual font size.
//
// Apply the navigation exception when:
//   - Text appears in a top navigation bar/header
//   - Text is a primary menu link or navigation item
//   - Text is in a sidebar main navigation
//   - Text is a prominent tab label in a tab bar
//
// Do NOT apply if:
//   - The navigation text is visually comparable to body paragraph text
//   - The text is a secondary/utility link (e.g., footer links, breadcrumbs)
//
// Rationale: Navigation items serve a critical wayfinding function and
// typically have larger tap targets and visual prominence even when
// the font size technically falls below 18pt.
// ============================================================
//
// Size estimation from screenshots:
//   - Compare bounding box height to known reference elements
//   - Consider visual weight: headings, titles typically are large
//   - Bold detection: thicker strokes, denser pixel pattern, heavier weight
//   - Consider semantic role: navigation items → large text threshold
//
// When in doubt about size, classify as "normal" (conservative approach).
// When in doubt about navigation, check visual context (header position).
// ============================================================
//
// ============================================================
// VISUAL POLARITY CHECK (v25.4 - PRE-FILTER)
// ============================================================
// Before performing ANY contrast ratio calculation, perform a visual
// polarity check to detect obviously high-contrast text.
//
// Visual polarity detection:
// 1. Compute average luminance of text glyph pixels
// 2. Compute average luminance of the immediate surrounding region
//
// If:
//   - Text luminance is significantly higher than background (light-on-dark), OR
//   - Text luminance is significantly lower than background (dark-on-light),
//   AND the luminance difference exceeds ≥ 40%,
// Then:
//   - Assume visual contrast is sufficient
//   - Do NOT report A1 for this element
//   - Skip contrast calculation entirely
//
// Only proceed to WCAG contrast computation when:
//   - Text and background luminance are close, OR
//   - Polarity is weak or ambiguous
//
// This optimization avoids false positives and unnecessary calculations
// for obviously high-contrast text (e.g., white text on dark background).
// ============================================================
//
// ============================================================
// FOREGROUND PLAUSIBILITY GATE (v25.2)
// ============================================================
// If the sampled foreground color appears inconsistent with visual
// prominence (e.g., near-white/near-background for a prominent title),
// the measurement MUST be treated as unreliable.
//
// Plausibility check triggers downgrade to POTENTIAL when:
//   - Sampled foreground has very high luminance (near-white: L > 0.85)
//   - OR foreground-background luminance difference is tiny (< 0.08)
//   - AND the element is visually prominent (title, heading, card title)
//
// When triggered:
//   - DO NOT classify as CONFIRMED
//   - Downgrade to POTENTIAL with reason code: FG_IMPLAUSIBLE
//   - Add rationale: "Foreground color sampling inconsistent with
//     visual prominence (likely background or anti-aliased pixels)."
//
// CONFIRMED A1 violations are permitted ONLY when the sampled
// foreground is visually plausible for the text element.
// ============================================================
//
// ============================================================
// FOREGROUND SAMPLING VALIDATION (v25.3 - MANDATORY)
// ============================================================
// Before computing any contrast ratio, validate that the sampled
// foreground color truly represents the rendered text glyphs.
//
// FOREGROUND SAMPLING RULES:
// 1. Sample foreground colors ONLY from pixels strictly inside
//    detected text glyph shapes. Do NOT sample from:
//    - container backgrounds
//    - padding
//    - borders
//    - shadows
//    - anti-aliased outer edges
//
// 2. If sampled foreground is visually similar to surrounding background
//    (luminance difference < 10%), assume foreground sampling is incorrect.
//
// 3. In such cases, re-sample using:
//    - the lightest 20% of glyph pixels AND
//    - the darkest 20% of glyph pixels
//    Select the variant that produces the higher contrast ratio.
//
// 4. If re-sampling yields a foreground color that is visually
//    inconsistent with rendered text appearance (e.g., dark text
//    reported where text appears light), discard the measurement.
//
// CLASSIFICATION RULES:
// - CONFIRMED: foreground AND background both confidently identified,
//   contrast < threshold, sampled colors match visible appearance
// - POTENTIAL: foreground extraction fails after re-sampling
//   Reason code: FG_SAMPLING_UNRELIABLE
// - Never report confirmed violation for text that is visually
//   high-contrast (e.g., light text on dark background)
// ============================================================
//
// Classification Logic (v25.2):
//   - CONFIRMED: Background is certain AND best-case contrast < threshold
//       AND foreground is plausible for the element type
//     * Low confidence DOES NOT downgrade to Potential if background is uniform
//     * Confidence affects reporting detail, NOT classification
//   - POTENTIAL: Background cannot be reliably determined:
//     * Mixed background (multiple dominant colors)
//     * Gradient/overlay/image backgrounds
//     * Contrast outcome depends on multiple background candidates
//     * Contrast cannot be computed at all
//     * Foreground sampling is implausible (FG_IMPLAUSIBLE gate)
//
// Background Detection (v24 LOCAL-PRIORITY):
//   - Sample LOCAL MARGIN FIRST (8px around text bounding box)
//   - Weight pixels by proximity — nearer pixels dominate
//   - If local region is uniform → use that color (CERTAIN background)
//   - This correctly detects badges, pills, chips with colored backgrounds
//
// Convergence:
//   - Confirmed A1 violations COUNT toward convergence (can block)
//   - Potential A1 findings are tracked but NEVER block convergence
// ============================

type A1BBoxNorm = { x: number; y: number; w: number; h: number };
type A1TextElement = {
  screenshotIndex: number; // 1-based
  bbox: A1BBoxNorm; // normalized 0..1
  location?: string;
  elementRole?: string;
  elementDescription?: string;
  isSecondary?: boolean;
  textSize?: 'normal' | 'large';
};

// A1 Screenshot Background Certainty Factors
type A1BackgroundCertainty = {
  isCertain: boolean;
  reason?: string;
  // Factors that reduce certainty
  hasGradient?: boolean;
  hasImage?: boolean;
  hasOverlay?: boolean;
  spanMultipleRegions?: boolean;
  antiAliasingDominates?: boolean;
  mixedBackground?: boolean;
};

// ============================================================
// FOREGROUND PLAUSIBILITY GATE (v25.2)
// ============================================================
// Checks if the sampled foreground color is plausible for the element.
// If foreground is near-white or too close to background for a prominent
// element, the measurement is likely corrupted by background/anti-aliasing.
function checkForegroundPlausibility(
  fgLuminance: number,
  bgLuminance: number,
  elementRole?: string,
  textSize?: 'normal' | 'large'
): { isPlausible: boolean; reason?: string } {
  // Prominent elements that should NOT have near-white foreground
  const prominentRoles = ['heading', 'title', 'hero', 'card title', 'banner', 'headline', 'h1', 'h2'];
  const isProminent = textSize === 'large' || 
    (elementRole && prominentRoles.some(r => elementRole.toLowerCase().includes(r)));
  
  // Skip plausibility check for non-prominent elements
  if (!isProminent) {
    return { isPlausible: true };
  }
  
  // Check 1: Near-white foreground (luminance > 0.85) for prominent text is implausible
  const nearWhiteThreshold = 0.85;
  if (fgLuminance > nearWhiteThreshold) {
    return {
      isPlausible: false,
      reason: `Foreground color sampling inconsistent with visual prominence (near-white luminance ${(fgLuminance * 100).toFixed(0)}%, likely background or anti-aliased pixels).`
    };
  }
  
  // Check 2: Foreground too close to background (difference < 0.08) is implausible for prominent text
  const lumaDiffThreshold = 0.08;
  const lumaDiff = Math.abs(fgLuminance - bgLuminance);
  if (lumaDiff < lumaDiffThreshold) {
    return {
      isPlausible: false,
      reason: `Foreground color sampling inconsistent with visual prominence (luminance difference only ${(lumaDiff * 100).toFixed(1)}%, likely sampled background or anti-aliased pixels).`
    };
  }
  
  return { isPlausible: true };
}

// ============================================================
// FOREGROUND SAMPLING VALIDATION (v25.3 - MANDATORY)
// ============================================================
// Validates that sampled foreground color truly represents text glyphs.
// If sampled foreground is too similar to background, re-samples using
// lightest and darkest 20% of glyph pixels to find the true foreground.
type ForegroundValidation = {
  isValid: boolean;
  fg: RGB;
  fgHex: string;
  fgLumaStd: number;
  fgWorst: RGB;
  fgWorstHex: string;
  reason?: string; // Only set if validation failed
  resampledVariant?: 'lightest' | 'darkest'; // Which re-sample was used
};

function validateAndResampleForeground(
  textPixels: Array<{ r: number; g: number; b: number; luma255: number }>,
  bg: RGB,
  initialFg: RGB,
  initialFgLumaStd: number
): ForegroundValidation {
  const bgLuma01 = relativeLuminance01(bg);
  const fgLuma01 = relativeLuminance01(initialFg);
  const lumaDiff = Math.abs(fgLuma01 - bgLuma01);
  
  // ====================================================================
  // STEP 1: Check if initial foreground sampling is valid
  // If luminance difference < 10% (0.1), foreground sampling is suspect
  // ====================================================================
  const LUMA_DIFF_THRESHOLD = 0.10; // 10% luminance difference
  
  if (lumaDiff >= LUMA_DIFF_THRESHOLD) {
    // Initial sampling is valid - use it directly
    const fgLumas = textPixels.slice(0, Math.ceil(textPixels.length * 0.35))
      .map(p => p.luma255);
    const fgWorstPercentile = 82.5;
    const fgWorstLuma = percentile(fgLumas, fgWorstPercentile);
    const fgWorstIdx = fgLumas.findIndex(v => Math.abs(v - fgWorstLuma) < 3) ?? Math.floor(fgLumas.length * 0.82);
    const sorted = [...textPixels].sort((a, b) => a.luma255 - b.luma255);
    const fgWorstPixel = sorted[Math.min(Math.floor(sorted.length * 0.35) - 1, sorted.length - 1)] || sorted[0];
    
    return {
      isValid: true,
      fg: initialFg,
      fgHex: rgbToHex(initialFg),
      fgLumaStd: initialFgLumaStd,
      fgWorst: { r: fgWorstPixel.r, g: fgWorstPixel.g, b: fgWorstPixel.b },
      fgWorstHex: rgbToHex({ r: fgWorstPixel.r, g: fgWorstPixel.g, b: fgWorstPixel.b }),
    };
  }
  
  // ====================================================================
  // STEP 2: Re-sample using lightest and darkest 20% of glyph pixels
  // ====================================================================
  const sorted = [...textPixels].sort((a, b) => a.luma255 - b.luma255);
  const sampleSize = Math.max(5, Math.floor(sorted.length * 0.20)); // 20% of pixels
  
  // Darkest 20% (traditional foreground for dark-on-light text)
  const darkestPixels = sorted.slice(0, sampleSize);
  const darkestFg: RGB = {
    r: median(darkestPixels.map(p => p.r)),
    g: median(darkestPixels.map(p => p.g)),
    b: median(darkestPixels.map(p => p.b)),
  };
  
  // Lightest 20% (foreground for light-on-dark text)
  const lightestPixels = sorted.slice(-sampleSize);
  const lightestFg: RGB = {
    r: median(lightestPixels.map(p => p.r)),
    g: median(lightestPixels.map(p => p.g)),
    b: median(lightestPixels.map(p => p.b)),
  };
  
  // Compute contrast for each variant
  const darkestContrast = contrastRatioFromRgb(darkestFg, bg);
  const lightestContrast = contrastRatioFromRgb(lightestFg, bg);
  
  // Select the variant with higher contrast (more plausible foreground)
  const useLightest = lightestContrast > darkestContrast;
  const resampledFg = useLightest ? lightestFg : darkestFg;
  const resampledContrast = useLightest ? lightestContrast : darkestContrast;
  const resampledPixels = useLightest ? lightestPixels : darkestPixels;
  
  // ====================================================================
  // STEP 3: Validate the re-sampled foreground
  // If contrast is still below 1.5:1, the measurement is unreliable
  // ====================================================================
  const MIN_PLAUSIBLE_CONTRAST = 1.5; // Minimum contrast for visible text
  
  if (resampledContrast < MIN_PLAUSIBLE_CONTRAST) {
    // Re-sampling failed - foreground sampling is unreliable
    return {
      isValid: false,
      fg: resampledFg,
      fgHex: rgbToHex(resampledFg),
      fgLumaStd: stddev(resampledPixels.map(p => p.luma255)),
      fgWorst: resampledFg,
      fgWorstHex: rgbToHex(resampledFg),
      reason: 'Foreground color sampling unreliable for this element (re-sampling produced contrast < 1.5:1)',
    };
  }
  
  // ====================================================================
  // STEP 4: Visual consistency check
  // For dark-on-light (bg is light), foreground should be dark (and vice versa)
  // If mismatch, the measurement may be unreliable
  // ====================================================================
  const resampledFgLuma = relativeLuminance01(resampledFg);
  const bgIsLight = bgLuma01 > 0.5;
  const fgIsDark = resampledFgLuma < 0.5;
  
  // Check for visual consistency: light bg should have dark fg, dark bg should have light fg
  const isVisuallyConsistent = (bgIsLight && fgIsDark) || (!bgIsLight && !fgIsDark);
  
  if (!isVisuallyConsistent && resampledContrast < 3.0) {
    // Visual inconsistency with low contrast - likely measurement error
    return {
      isValid: false,
      fg: resampledFg,
      fgHex: rgbToHex(resampledFg),
      fgLumaStd: stddev(resampledPixels.map(p => p.luma255)),
      fgWorst: resampledFg,
      fgWorstHex: rgbToHex(resampledFg),
      reason: 'Foreground color sampling visually inconsistent with rendered text appearance',
      resampledVariant: useLightest ? 'lightest' : 'darkest',
    };
  }
  
  // Re-sampling succeeded
  const resampledLumas = resampledPixels.map(p => p.luma255);
  const fgWorstPercentile = 82.5;
  const fgWorstLuma = percentile(resampledLumas, fgWorstPercentile);
  const fgWorstIdx = resampledPixels.findIndex(p => Math.abs(p.luma255 - fgWorstLuma) < 3) ?? 0;
  const fgWorstPixel = resampledPixels[clamp(fgWorstIdx, 0, resampledPixels.length - 1)];
  
  return {
    isValid: true,
    fg: resampledFg,
    fgHex: rgbToHex(resampledFg),
    fgLumaStd: stddev(resampledLumas),
    fgWorst: { r: fgWorstPixel.r, g: fgWorstPixel.g, b: fgWorstPixel.b },
    fgWorstHex: rgbToHex({ r: fgWorstPixel.r, g: fgWorstPixel.g, b: fgWorstPixel.b }),
    resampledVariant: useLightest ? 'lightest' : 'darkest',
  };
}

type RGB = { r: number; g: number; b: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function stripDataUrlToBase64(s: string): string {
  if (!s) return s;
  const comma = s.indexOf(',');
  if (s.startsWith('data:') && comma >= 0) return s.slice(comma + 1);
  // Already raw base64
  return s;
}

function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

function hexToRgb(hex: string): RGB | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function srgbToLinear01(c255: number): number {
  const c = clamp(c255, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance01(rgb: RGB): number {
  const r = srgbToLinear01(rgb.r);
  const g = srgbToLinear01(rgb.g);
  const b = srgbToLinear01(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioFromRgb(fg: RGB, bg: RGB): number {
  const L1 = relativeLuminance01(fg);
  const L2 = relativeLuminance01(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[clamp(idx, 0, sorted.length - 1)];
}

function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function toPxBox(img: Image, bbox: A1BBoxNorm, dx = 0, dy = 0) {
  const x0 = clamp(Math.round(bbox.x * img.width) + dx, 0, img.width - 1);
  const y0 = clamp(Math.round(bbox.y * img.height) + dy, 0, img.height - 1);
  const x1 = clamp(Math.round((bbox.x + bbox.w) * img.width) + dx, 0, img.width);
  const y1 = clamp(Math.round((bbox.y + bbox.h) * img.height) + dy, 0, img.height);
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function buildGridPoints(left: number, top: number, right: number, bottom: number, targetCount: number): Array<{ x: number; y: number }> {
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const aspect = w / h;
  const cols = clamp(Math.round(Math.sqrt(targetCount * aspect)), 4, 40);
  const rows = clamp(Math.round(targetCount / cols), 4, 40);
  const pts: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(left + (c + 0.5) * (w / cols));
      const y = Math.floor(top + (r + 0.5) * (h / rows));
      pts.push({ x, y });
    }
  }
  return pts;
}

function rgbaAt(img: Image, x: number, y: number): RGB & { a: number } {
  const rgba = img.getRGBAAt(clamp(x, 0, img.width - 1), clamp(y, 0, img.height - 1));
  return { r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3] };
}

type A1Sample = {
  fg: RGB;
  bg: RGB;
  ratio: number;
  fgPixelCount: number;
  bgPixelCount: number;
  fgLumaStd: number;
  bgLumaStd: number;
  lumaDistance: number;
  fgHex: string;
  bgHex: string;
  hexRecomputedRatio: number;
  hexToRatioDelta: number;
  // Fallback tracking
  fallbackMethod?: 'direct' | 'local_uniform' | 'expanded' | 'clustered' | 'range';
  expansionPx?: number;
  clusterCount?: number;
  // Range-based measurement for mixed backgrounds
  contrastRange?: { min: number; max: number };
  bgCandidates?: RGB[];
  // Worst-case bounding for suppression decisions
  fgWorst: RGB; // Lightest plausible stroke color (80-85th percentile)
  bgWorst: RGB; // Lightest plausible background (80-90th percentile)
  contrastWorst: number; // Contrast using worst-case colors
  fgWorstHex: string;
  bgWorstHex: string;
  // Background certainty assessment for confirmed vs heuristic classification
  backgroundCertainty: A1BackgroundCertainty;
  // Foreground sampling validation (v25.3)
  foregroundValidation?: {
    isValid: boolean;
    reason?: string;
    resampledVariant?: 'lightest' | 'darkest';
  };
  // Visual polarity check result (v25.4)
  visualPolarityPass?: boolean; // True if element passes due to clear visual polarity
  visualPolarityDiff?: number; // Luminance difference (0-1) between text and background
  // Badge/pill/chip FG/BG ambiguity (v25.5)
  fgBgAmbiguity?: boolean; // True if FG/BG roles cannot be confidently determined
  fgBgAmbiguityReason?: string;
};

// ============================================================
// VISUAL POLARITY CHECK (v25.4 - PRE-FILTER)
// ============================================================
// Performs a quick luminance polarity check to skip contrast calculation
// for obviously high-contrast text (e.g., white text on dark background).
//
// Returns { pass: true } if luminance difference is ≥ 40%, meaning
// contrast is visually sufficient and full WCAG calculation can be skipped.
type VisualPolarityResult = {
  pass: boolean; // True = skip contrast calculation (obviously sufficient)
  fgLuma01: number; // Text luminance 0-1
  bgLuma01: number; // Background luminance 0-1
  lumaDiff: number; // Absolute difference 0-1
  polarity: 'light-on-dark' | 'dark-on-light' | 'ambiguous';
};

const VISUAL_POLARITY_THRESHOLD = 0.40; // 40% luminance difference threshold

function checkVisualPolarity(
  textPixels: Array<{ r: number; g: number; b: number; luma255: number }>,
  bgPixels: Array<{ r: number; g: number; b: number; luma255: number }>
): VisualPolarityResult {
  // Compute average luminance of text glyph pixels (normalized 0-1)
  const avgTextLuma = textPixels.reduce((sum, p) => sum + p.luma255, 0) / textPixels.length / 255;
  
  // Compute average luminance of background pixels (normalized 0-1)
  const avgBgLuma = bgPixels.reduce((sum, p) => sum + p.luma255, 0) / bgPixels.length / 255;
  
  // Calculate absolute luminance difference
  const lumaDiff = Math.abs(avgTextLuma - avgBgLuma);
  
  // Determine polarity direction
  let polarity: 'light-on-dark' | 'dark-on-light' | 'ambiguous';
  if (avgTextLuma > avgBgLuma + VISUAL_POLARITY_THRESHOLD) {
    polarity = 'light-on-dark';
  } else if (avgBgLuma > avgTextLuma + VISUAL_POLARITY_THRESHOLD) {
    polarity = 'dark-on-light';
  } else {
    polarity = 'ambiguous';
  }
  
  // Pass if luminance difference exceeds threshold (40%)
  const pass = lumaDiff >= VISUAL_POLARITY_THRESHOLD;
  
  return {
    pass,
    fgLuma01: avgTextLuma,
    bgLuma01: avgBgLuma,
    lumaDiff,
    polarity,
  };
}

// Simple k-means clustering for color grouping
function kMeansCluster(pixels: Array<{ r: number; g: number; b: number; luma255: number }>, k: number, maxIter = 10): Array<{ centroid: RGB; members: typeof pixels }> {
  if (pixels.length === 0 || k < 1) return [];
  const effectiveK = Math.min(k, pixels.length);
  
  // Initialize centroids by picking evenly spaced pixels by luma
  const sorted = [...pixels].sort((a, b) => a.luma255 - b.luma255);
  const centroids: RGB[] = [];
  for (let i = 0; i < effectiveK; i++) {
    const idx = Math.floor((i + 0.5) * sorted.length / effectiveK);
    const p = sorted[idx];
    centroids.push({ r: p.r, g: p.g, b: p.b });
  }
  
  let clusters: Array<{ centroid: RGB; members: typeof pixels }> = [];
  
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign pixels to nearest centroid
    clusters = centroids.map(c => ({ centroid: c, members: [] as typeof pixels }));
    
    for (const p of pixels) {
      let minDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < centroids.length; i++) {
        const c = centroids[i];
        const dist = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
        if (dist < minDist) {
          minDist = dist;
          bestIdx = i;
        }
      }
      clusters[bestIdx].members.push(p);
    }
    
    // Update centroids
    let converged = true;
    for (let i = 0; i < clusters.length; i++) {
      const members = clusters[i].members;
      if (members.length === 0) continue;
      const newCentroid: RGB = {
        r: median(members.map(m => m.r)),
        g: median(members.map(m => m.g)),
        b: median(members.map(m => m.b)),
      };
      const dist = Math.abs(newCentroid.r - centroids[i].r) + Math.abs(newCentroid.g - centroids[i].g) + Math.abs(newCentroid.b - centroids[i].b);
      if (dist > 2) converged = false;
      centroids[i] = newCentroid;
      clusters[i].centroid = newCentroid;
    }
    
    if (converged) break;
  }
  
  return clusters.filter(c => c.members.length > 0).sort((a, b) => b.members.length - a.members.length);
}

/**
 * LOCAL-PRIORITY BACKGROUND SAMPLING FOR A1 CONTRAST MEASUREMENT
 * 
 * This function implements proximity-weighted background sampling that prioritizes
 * the immediate local region around text over distant container colors.
 * 
 * Key behaviors:
 * 1. Sample from LOCAL MARGIN FIRST (6-10px around text bounding box)
 * 2. Weight pixels by proximity to text — nearer pixels dominate
 * 3. Detect uniform local backgrounds (badges, pills, chips) even if they differ
 *    from the wider container color
 * 4. Mark background as "certain" if local sampling region shows single dominant color
 * 
 * This correctly handles pill-shaped components like badges, chips, and tags
 * where the text sits on a colored background different from the page/card background.
 */
function sampleLocalBackgroundPixels(
  img: Image,
  pxBox: { left: number; top: number; right: number; bottom: number },
  localMarginPx: number,
  fgLumaMax: number
): {
  pixels: Array<{ r: number; g: number; b: number; luma255: number; weight: number }>;
  localUniformColor: RGB | null; // Single dominant color if local region is uniform
  isLocalUniform: boolean;
} {
  // ====================================================================
  // STEP 1: Define local sampling region (small margin around text)
  // For badges/pills, this should capture the pill background, not container
  // ====================================================================
  const localExpanded = {
    left: clamp(pxBox.left - localMarginPx, 0, img.width - 1),
    top: clamp(pxBox.top - localMarginPx, 0, img.height - 1),
    right: clamp(pxBox.right + localMarginPx, 0, img.width),
    bottom: clamp(pxBox.bottom + localMarginPx, 0, img.height),
  };
  
  // Sample densely in local region (inside the margin but outside text bbox)
  const localPts = buildGridPoints(localExpanded.left, localExpanded.top, localExpanded.right, localExpanded.bottom, 200)
    .filter(({ x, y }) => x < pxBox.left || x >= pxBox.right || y < pxBox.top || y >= pxBox.bottom);
  
  // Calculate center of text bbox for proximity weighting
  const textCenterX = (pxBox.left + pxBox.right) / 2;
  const textCenterY = (pxBox.top + pxBox.bottom) / 2;
  const maxDistance = Math.sqrt(
    Math.pow(localExpanded.right - localExpanded.left, 2) + 
    Math.pow(localExpanded.bottom - localExpanded.top, 2)
  );
  
  // ====================================================================
  // STEP 2: Sample pixels with proximity weighting
  // Pixels closer to text get higher weight (inverse distance)
  // ====================================================================
  const localPixels = localPts
    .map(({ x, y }) => {
      const { r, g, b, a } = rgbaAt(img, x, y);
      if (a < 200) return null;
      const luma255 = relativeLuminance01({ r, g, b }) * 255;
      
      // Skip likely text pixels (prevent bleeding)
      if (luma255 <= fgLumaMax + 2) return null;
      
      // Calculate proximity weight: closer pixels get higher weight
      const distToCenter = Math.sqrt(Math.pow(x - textCenterX, 2) + Math.pow(y - textCenterY, 2));
      // Weight formula: 1.0 for closest, decays toward 0.3 for furthest
      const weight = 0.3 + 0.7 * (1 - Math.min(distToCenter / maxDistance, 1));
      
      return { r, g, b, luma255, weight };
    })
    .filter(Boolean) as Array<{ r: number; g: number; b: number; luma255: number; weight: number }>;
  
  // ====================================================================
  // STEP 3: Check if local region has a uniform background color
  // This detects badges/pills with solid colored backgrounds
  // ====================================================================
  if (localPixels.length >= 10) {
    // Calculate weighted average and variance
    const totalWeight = localPixels.reduce((sum, p) => sum + p.weight, 0);
    const weightedR = localPixels.reduce((sum, p) => sum + p.r * p.weight, 0) / totalWeight;
    const weightedG = localPixels.reduce((sum, p) => sum + p.g * p.weight, 0) / totalWeight;
    const weightedB = localPixels.reduce((sum, p) => sum + p.b * p.weight, 0) / totalWeight;
    
    // Calculate color variance (weighted standard deviation per channel)
    const varianceR = Math.sqrt(localPixels.reduce((sum, p) => sum + p.weight * Math.pow(p.r - weightedR, 2), 0) / totalWeight);
    const varianceG = Math.sqrt(localPixels.reduce((sum, p) => sum + p.weight * Math.pow(p.g - weightedG, 2), 0) / totalWeight);
    const varianceB = Math.sqrt(localPixels.reduce((sum, p) => sum + p.weight * Math.pow(p.b - weightedB, 2), 0) / totalWeight);
    const avgVariance = (varianceR + varianceG + varianceB) / 3;
    
    // Uniform background threshold: low color variance (<15 per channel on average)
    // This correctly identifies solid-color badges, pills, and chips
    const isUniform = avgVariance < 15;
    
    if (isUniform) {
      const uniformColor: RGB = {
        r: Math.round(weightedR),
        g: Math.round(weightedG),
        b: Math.round(weightedB),
      };
      return {
        pixels: localPixels,
        localUniformColor: uniformColor,
        isLocalUniform: true,
      };
    }
  }
  
  return {
    pixels: localPixels,
    localUniformColor: null,
    isLocalUniform: false,
  };
}

/**
 * Legacy ring-based background sampling (fallback for non-local cases)
 * Used when local sampling fails or for wider region analysis
 */
function sampleBackgroundPixels(
  img: Image,
  pxBox: { left: number; top: number; right: number; bottom: number },
  ringPx: number,
  fgLumaMax: number
): Array<{ r: number; g: number; b: number; luma255: number }> {
  const expanded = {
    left: clamp(pxBox.left - ringPx, 0, img.width - 1),
    top: clamp(pxBox.top - ringPx, 0, img.height - 1),
    right: clamp(pxBox.right + ringPx, 0, img.width),
    bottom: clamp(pxBox.bottom + ringPx, 0, img.height),
  };
  const ringPts = buildGridPoints(expanded.left, expanded.top, expanded.right, expanded.bottom, 300)
    .filter(({ x, y }) => x < pxBox.left || x >= pxBox.right || y < pxBox.top || y >= pxBox.bottom);

  const bgPixelsAll = ringPts
    .map(({ x, y }) => {
      const { r, g, b, a } = rgbaAt(img, x, y);
      if (a < 200) return null;
      const luma255 = relativeLuminance01({ r, g, b }) * 255;
      return { r, g, b, luma255 };
    })
    .filter(Boolean) as Array<{ r: number; g: number; b: number; luma255: number }>;

  // Exclude likely text pixels bleeding into ring
  return bgPixelsAll.filter(p => p.luma255 > fgLumaMax + 2);
}

/**
 * INTERIOR-STROKE SAMPLING FOR A1 CONTRAST MEASUREMENT
 * 
 * This function implements the robust pixel sampling methodology for screenshot-only
 * contrast evaluation. It uses interior glyph stroke pixels to estimate true text color,
 * avoiding anti-aliased edges that blend with background.
 * 
 * Methodology:
 * 1. FOREGROUND (Text): Sample grid of pixels from text region, select darkest 30-40%
 *    by luminance (interior stroke pixels), compute median RGB as foreground color.
 * 2. BACKGROUND: Sample ring around text region, exclude text pixels and outliers,
 *    compute median RGB as background color. Uses progressive expansion if needed.
 * 3. CONTRAST: Compute WCAG contrast ratio from sampled median colors.
 * 
 * All colors are pixel-derived estimates, not design tokens.
 */
function computeA1SampleWithFallbacks(
  img: Image,
  pxBox: { left: number; top: number; right: number; bottom: number }
): A1Sample | { error: string } {
  // ====================================================================
  // STEP 1: FOREGROUND SAMPLING — Interior Glyph Stroke Methodology
  // ====================================================================
  // Sample 160 pixels from text region grid, then select the DARKEST 30-40%
  // by luminance. These are the interior glyph strokes, free from anti-aliasing.
  
  const textPts = buildGridPoints(pxBox.left, pxBox.top, pxBox.right, pxBox.bottom, 160);
  const textPixels = textPts
    .map(({ x, y }) => {
      const { r, g, b, a } = rgbaAt(img, x, y);
      // Skip transparent or semi-transparent pixels
      if (a < 200) return null;
      const luma255 = relativeLuminance01({ r, g, b }) * 255;
      return { r, g, b, luma255 };
    })
    .filter(Boolean) as Array<{ r: number; g: number; b: number; luma255: number }>;

  if (textPixels.length < 30) {
    return { error: 'Insufficient text pixels for reliable sampling' };
  }

  // Sort by luminance to identify interior strokes (darkest pixels for dark-on-light,
  // or the core stroke color in general). We take the darkest 30-40% to avoid
  // anti-aliased edges which have intermediate luminance values.
  const sorted = [...textPixels].sort((a, b) => a.luma255 - b.luma255);
  
  // Select darkest 30-40% of pixels as interior stroke candidates
  // Using 35% as middle ground, with minimum of 15 pixels for statistical validity
  const keepRatio = 0.35; // 35% of pixels (interior strokes)
  const keepCount = Math.max(15, Math.floor(sorted.length * keepRatio));
  const fgPixels = sorted.slice(0, keepCount);
  if (fgPixels.length < 15) {
    return { error: 'Insufficient foreground pixels for reliable sampling' };
  }

  const fg: RGB = {
    r: median(fgPixels.map(p => p.r)),
    g: median(fgPixels.map(p => p.g)),
    b: median(fgPixels.map(p => p.b)),
  };
  const fgLumas = fgPixels.map(p => p.luma255);
  const fgLumaStd = stddev(fgLumas);
  const fgLumaMax = Math.max(...fgLumas);

  // ====================================================================
  // WORST-CASE FOREGROUND (FG_worst): 80-85th percentile luminance
  // This is the LIGHTEST plausible stroke color, for conservative bounding
  // ====================================================================
  const fgWorstPercentile = 82.5; // midpoint of 80-85%
  const fgWorstLuma = percentile(fgLumas, fgWorstPercentile);
  // Find the pixel closest to this luminance to use its actual RGB
  const fgWorstIdx = fgPixels.findIndex(p => Math.abs(p.luma255 - fgWorstLuma) < 3) ?? Math.floor(fgPixels.length * 0.82);
  const fgWorstPixel = fgPixels[clamp(fgWorstIdx, 0, fgPixels.length - 1)];
  const fgWorst: RGB = { r: fgWorstPixel.r, g: fgWorstPixel.g, b: fgWorstPixel.b };

  // ====================================================================
  // LOCAL-PRIORITY BACKGROUND SAMPLING (v24 Enhancement)
  // 
  // Priority order for background detection:
  // 1. LOCAL MARGIN FIRST (6-10px around text) — captures badges, pills, chips
  // 2. If local is uniform → use local color directly (CERTAIN background)
  // 3. If local is mixed/insufficient → fall back to expanded ring sampling
  // 
  // This ensures text on colored badges/pills is measured against the badge
  // background, NOT the distant container/page background.
  // ====================================================================
  
  const LOCAL_MARGIN_PX = 8; // Primary local sampling margin (6-10px range)
  const FALLBACK_RING_LEVELS = [12, 20, 32]; // Fallback expansion if local fails
  
  let bgPixels: Array<{ r: number; g: number; b: number; luma255: number }> = [];
  let usedExpansion = LOCAL_MARGIN_PX;
  let fallbackMethod: 'direct' | 'local_uniform' | 'expanded' | 'clustered' | 'range' = 'direct';
  let clusterCount: number | undefined;
  let bgCandidates: RGB[] | undefined;
  let contrastRange: { min: number; max: number } | undefined;
  let localUniformDetected = false;
  let localBg: RGB | null = null;
  
  // ====================================================================
  // STEP 1: Try LOCAL proximity-weighted sampling first
  // ====================================================================
  const localResult = sampleLocalBackgroundPixels(img, pxBox, LOCAL_MARGIN_PX, fgLumaMax);
  
  if (localResult.isLocalUniform && localResult.localUniformColor) {
    // SUCCESS: Local region has uniform background (badge/pill detected)
    // Use this color directly — do NOT sample wider container
    localUniformDetected = true;
    localBg = localResult.localUniformColor;
    bgPixels = localResult.pixels.map(p => ({ r: p.r, g: p.g, b: p.b, luma255: p.luma255 }));
    fallbackMethod = 'local_uniform';
    
    // ====================================================================
    // BADGE/PILL/CHIP FG/BG ROLE VALIDATION (v25.5)
    // ====================================================================
    // For enclosed components (badges, pills, chips), the detected "foreground"
    // (darkest pixels) could actually be the container fill, not the text color.
    // This happens when text is lighter than its container background.
    //
    // Detection: If the sampled foreground color is very similar to the local
    // uniform background, it means we likely sampled the container fill as
    // foreground instead of the actual text glyph color.
    //
    // Also check: if foreground is LIGHTER than the local background, the
    // text is light-on-dark within the badge — roles may be swapped.
    // ====================================================================
    const fgLuma01 = relativeLuminance01(fg);
    const localBgLuma01 = relativeLuminance01(localBg);
    const fgBgLumaDiff = Math.abs(fgLuma01 - localBgLuma01);
    
    // If fg and local bg are very close (< 15% luminance diff), roles are ambiguous
    if (fgBgLumaDiff < 0.15) {
      // Mark as ambiguous — will be downgraded to POTENTIAL later
      (localResult as any)._fgBgAmbiguity = true;
      (localResult as any)._fgBgAmbiguityReason = 
        `Foreground/background ambiguity in enclosed component: sampled foreground luminance (${(fgLuma01 * 100).toFixed(0)}%) too close to container background (${(localBgLuma01 * 100).toFixed(0)}%).`;
    }
  } else if (localResult.pixels.length >= 15) {
    // Local region sampled but not uniform — use proximity-weighted pixels
    bgPixels = localResult.pixels.map(p => ({ r: p.r, g: p.g, b: p.b, luma255: p.luma255 }));
    fallbackMethod = 'direct';
  }
  
  // ====================================================================
  // STEP 2: Fall back to expanded ring sampling if local insufficient
  // ====================================================================
  if (bgPixels.length < 15 && !localUniformDetected) {
    for (const ringPx of FALLBACK_RING_LEVELS) {
      bgPixels = sampleBackgroundPixels(img, pxBox, ringPx, fgLumaMax);
      usedExpansion = ringPx;
      
      if (bgPixels.length >= 15) {
        fallbackMethod = 'expanded';
        break;
      }
    }
  }

  // If still insufficient after max expansion, return error
  if (bgPixels.length < 8) {
    return { error: 'Insufficient background pixels even after region expansion (up to +32px)' };
  }

  // ====================================================================
  // VISUAL POLARITY CHECK (v25.4 — PRE-FILTER)
  // ====================================================================
  // Before performing full WCAG contrast computation, check if the visual
  // polarity is obviously sufficient (≥ 40% luminance difference).
  // If polarity is clear, we can skip detailed calculation and mark as PASS.
  //
  // This optimization:
  // - Avoids false positives for obviously high-contrast text
  // - Reduces unnecessary computation for light-on-dark/dark-on-light text
  // - Only proceeds to WCAG calculation when polarity is weak/ambiguous
  // ====================================================================
  const polarityCheck = checkVisualPolarity(textPixels, bgPixels);
  
  // If polarity is sufficient, we still compute full metrics but flag the pass
  // This allows callers to skip reporting this element for A1
  const visualPolarityPass = polarityCheck.pass;

  // Check background stability
  const bgLumas = bgPixels.map(p => p.luma255);
  const bgLumaStd = stddev(bgLumas);

  // ====================================================================
  // WORST-CASE BACKGROUND (BG_worst): 80-90th percentile luminance
  // This is the LIGHTEST plausible background near the text, for conservative bounding
  // ====================================================================
  const bgWorstPercentile = 85; // midpoint of 80-90%
  const bgWorstLuma = percentile(bgLumas, bgWorstPercentile);
  // Find the pixel closest to this luminance
  const bgWorstIdx = bgPixels.findIndex(p => Math.abs(p.luma255 - bgWorstLuma) < 3) ?? Math.floor(bgPixels.length * 0.85);
  const bgWorstPixel = bgPixels[clamp(bgWorstIdx, 0, bgPixels.length - 1)];
  const bgWorst: RGB = { r: bgWorstPixel.r, g: bgWorstPixel.g, b: bgWorstPixel.b };

  // ====================================================================
  // STEP 3: Determine final background color
  // ====================================================================
  let bg: RGB;
  
  if (localUniformDetected && localBg) {
    // Use the uniform local background directly (badge/pill case)
    bg = localBg;
  } else if (bgLumaStd > 20 && bgPixels.length >= 10) {
    // Background variance is high — use clustering to find dominant color
    const clusters = kMeansCluster(bgPixels, 3, 12);
    
    if (clusters.length > 0) {
      // Check if background is truly mixed (multiple significant clusters)
      const totalPixels = bgPixels.length;
      const significantClusters = clusters.filter(c => c.members.length >= totalPixels * 0.15);
      
      if (significantClusters.length >= 2) {
        // Mixed background: compute contrast range
        fallbackMethod = 'range';
        bgCandidates = significantClusters.map(c => c.centroid);
        clusterCount = significantClusters.length;
        
        // Compute contrast with each candidate and find min/max
        const ratios = bgCandidates.map(candidate => contrastRatioFromRgb(fg, candidate));
        contrastRange = { min: Math.min(...ratios), max: Math.max(...ratios) };
        
        // Use the largest cluster as primary background for ratio reporting
        bg = clusters[0].centroid;
      } else {
        // Single dominant cluster
        fallbackMethod = 'clustered';
        clusterCount = 1;
        bg = clusters[0].centroid;
      }
    } else {
      // Clustering failed, use median of all pixels
      bg = {
        r: median(bgPixels.map(p => p.r)),
        g: median(bgPixels.map(p => p.g)),
        b: median(bgPixels.map(p => p.b)),
      };
    }
  } else {
    // Stable background: use median
    bg = {
      r: median(bgPixels.map(p => p.r)),
      g: median(bgPixels.map(p => p.g)),
      b: median(bgPixels.map(p => p.b)),
    };
  }

  // ====================================================================
  // FOREGROUND SAMPLING VALIDATION (v25.3 - MANDATORY)
  // Before computing contrast, validate that foreground sampling is reliable.
  // If sampled FG is too close to BG, re-sample using lightest/darkest 20%.
  // ====================================================================
  const fgValidation = validateAndResampleForeground(textPixels, bg, fg, fgLumaStd);
  
  // Use validated foreground (may be re-sampled)
  const validatedFg = fgValidation.fg;
  const validatedFgHex = fgValidation.fgHex;
  const validatedFgLumaStd = fgValidation.fgLumaStd;
  const validatedFgWorst = fgValidation.fgWorst;
  const validatedFgWorstHex = fgValidation.fgWorstHex;

  const fgLuma = relativeLuminance01(validatedFg) * 255;
  const bgLuma = relativeLuminance01(bg) * 255;
  const lumaDistance = Math.abs(bgLuma - fgLuma);

  const ratio = contrastRatioFromRgb(validatedFg, bg);
  
  // Compute worst-case contrast using lightest plausible colors
  const contrastWorst = contrastRatioFromRgb(validatedFgWorst, bgWorst);

  const bgHex = rgbToHex(bg);
  const bgWorstHex = rgbToHex(bgWorst);
  const fgRgb2 = hexToRgb(validatedFgHex);
  const bgRgb2 = hexToRgb(bgHex);
  const hexRecomputedRatio = fgRgb2 && bgRgb2 ? contrastRatioFromRgb(fgRgb2, bgRgb2) : ratio;
  const hexToRatioDelta = Math.abs(hexRecomputedRatio - ratio);

  // ====================================================================
  // BACKGROUND CERTAINTY ASSESSMENT (for Confirmed vs Heuristic classification)
  // Per authoritative A1 rule: background is certain ONLY if:
  // - Single dominant background color detected
  // - No gradients, images, or overlays
  // - Text does not overlap multiple background regions
  // ====================================================================
  const backgroundCertainty: A1BackgroundCertainty = (() => {
    // ====================================================================
    // LOCAL UNIFORM DETECTION (v24): If local sampling found a uniform
    // background color (badge/pill case), background is CERTAIN
    // ====================================================================
    if (fallbackMethod === 'local_uniform' && localUniformDetected) {
      return {
        isCertain: true,
        reason: undefined,
        hasGradient: false,
        hasImage: false,
        hasOverlay: false,
        spanMultipleRegions: false,
        antiAliasingDominates: false,
        mixedBackground: false,
      };
    }
    
    const reasons: string[] = [];
    
    // Check for mixed background (multiple significant clusters)
    const hasMixedBackground = fallbackMethod === 'range' && (clusterCount || 0) >= 2;
    if (hasMixedBackground) {
      reasons.push('mixed background detected');
    }
    
    // Check for gradient-like patterns (high variance with gradual transitions)
    // Gradient signature: high stddev but relatively uniform color distances
    const hasGradientPattern = bgLumaStd > 25 && fallbackMethod !== 'clustered' && fallbackMethod !== 'local_uniform';
    if (hasGradientPattern) {
      reasons.push('gradient-like background pattern');
    }
    
    // Check if anti-aliasing dominates foreground sampling
    const antiAliasingDominates = validatedFgLumaStd > 20;
    if (antiAliasingDominates) {
      reasons.push('anti-aliasing dominates color sampling');
    }
    
    // Check for ambiguous background (used fallback expansion beyond local margin)
    // Note: local_uniform and direct methods use LOCAL_MARGIN_PX (8px) and are NOT ambiguous
    const ambiguousBackground = fallbackMethod === 'expanded' && (usedExpansion || 8) > 12;
    if (ambiguousBackground) {
      reasons.push('required significant region expansion for background');
    }
    
    // Certainty decision
    const isCertain = reasons.length === 0 && 
                      fallbackMethod !== 'range' && 
                      bgLumaStd <= 20 &&
                      validatedFgLumaStd <= 15;
    
    return {
      isCertain,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      hasGradient: hasGradientPattern,
      hasImage: false, // Cannot detect from pixel analysis alone
      hasOverlay: false, // Cannot detect from pixel analysis alone
      spanMultipleRegions: hasMixedBackground,
      antiAliasingDominates,
      mixedBackground: hasMixedBackground,
    };
  })();

  return {
    fg: validatedFg,
    bg,
    ratio,
    fgPixelCount: fgPixels.length,
    bgPixelCount: bgPixels.length,
    fgLumaStd: validatedFgLumaStd,
    bgLumaStd,
    lumaDistance,
    fgHex: validatedFgHex,
    bgHex,
    hexRecomputedRatio,
    hexToRatioDelta,
    fallbackMethod,
    expansionPx: usedExpansion > 3 ? usedExpansion : undefined,
    clusterCount,
    contrastRange,
    bgCandidates,
    // Worst-case bounding fields
    fgWorst: validatedFgWorst,
    bgWorst,
    contrastWorst,
    fgWorstHex: validatedFgWorstHex,
    bgWorstHex,
    // Background certainty for classification
    backgroundCertainty,
    // Foreground validation status (v25.3)
    foregroundValidation: {
      isValid: fgValidation.isValid,
      reason: fgValidation.reason,
      resampledVariant: fgValidation.resampledVariant,
    },
    // Visual polarity check (v25.4)
    visualPolarityPass,
    visualPolarityDiff: polarityCheck.lumaDiff,
    // Badge/pill/chip FG/BG ambiguity (v25.5)
    fgBgAmbiguity: !!(localResult as any)._fgBgAmbiguity,
    fgBgAmbiguityReason: (localResult as any)._fgBgAmbiguityReason,
  };
}

// Legacy function for offset-based multi-sampling (uses new fallback logic internally)
function computeA1Sample(img: Image, pxBox: { left: number; top: number; right: number; bottom: number }, ringPx = 3): A1Sample | { error: string } {
  return computeA1SampleWithFallbacks(img, pxBox);
}

type A1ReliabilityResult = {
  reliable: boolean;
  reason?: string;
  fallbackUsed?: 'direct' | 'local_uniform' | 'expanded' | 'clustered' | 'range';
  confidencePenalty: number; // 0 = full confidence, 0.1-0.3 = reduced due to fallbacks
  // New: track whether to suppress finding entirely due to clear luminance separation
  suppressFinding?: boolean;
  suppressReason?: string;
};

/**
 * WORST-CASE CONTRAST BOUNDING FOR A1 CLASSIFICATION (v23)
 * 
 * This function determines classification (confirmed vs potential) based on
 * background certainty and contrast measurement. It NEVER suppresses findings —
 * it only determines the classification tier.
 * 
 * v23 KEY CHANGE: Low confidence MUST NOT auto-downgrade to Potential.
 * If background is certain (uniform) AND best-case contrast < threshold → CONFIRMED.
 * 
 * v25.2 KEY CHANGE: Foreground Plausibility Gate
 * If foreground is near-white or near-background for a prominent element,
 * downgrade to POTENTIAL with reason FG_IMPLAUSIBLE.
 * 
 * v25.3 KEY CHANGE: Foreground Sampling Validation
 * If foreground sampling fails validation (too close to BG, re-sampling unsuccessful),
 * downgrade to POTENTIAL with reason FG_SAMPLING_UNRELIABLE.
 * 
 * Classification rules:
 * - CONFIRMED: Background is certain AND best-case contrast < threshold
 *              AND foreground is plausible AND foreground sampling is valid
 * - POTENTIAL: Background is uncertain (mixed, gradient, image, multiple candidates)
 *              OR contrast cannot be computed
 *              OR foreground sampling is implausible (FG_IMPLAUSIBLE)
 *              OR foreground sampling validation failed (FG_SAMPLING_UNRELIABLE)
 * - PASS: Worst-case contrast >= threshold (even conservative estimate passes)
 * 
 * Confidence affects:
 * - Reporting detail and explanation
 * - NOT the confirmed/potential classification when background is certain
 */
function classifyA1Contrast(
  sample: A1Sample, 
  threshold: number,
  backgroundCertainty: A1BackgroundCertainty,
  elementRole?: string,
  textSize?: 'normal' | 'large'
): { 
  classification: 'confirmed' | 'potential' | 'pass';
  reason: string;
  effectiveRatio: number;
  isBackgroundBased: boolean; // True if classification was based on background certainty
  isForegroundImplausible?: boolean; // True if downgraded due to FG_IMPLAUSIBLE
  fgImplausibilityReason?: string;
  isForegroundSamplingUnreliable?: boolean; // True if downgraded due to FG_SAMPLING_UNRELIABLE (v25.3)
  fgSamplingUnreliableReason?: string;
  isFgBgAmbiguity?: boolean; // True if downgraded due to FG_BG_AMBIGUITY (v25.5)
  fgBgAmbiguityReason?: string;
} {
  const contrastWorst = sample.contrastWorst;
  const contrastBest = sample.contrastRange?.max ?? sample.ratio;
  const contrastMin = sample.contrastRange?.min ?? sample.ratio;
  const primaryRatio = sample.ratio;
  
  // ============================================================
  // STEP 0: VISUAL POLARITY PRE-FILTER (v25.4)
  // ============================================================
  // If visual polarity check passed (≥40% luminance difference),
  // assume visual contrast is sufficient and skip further analysis.
  // This catches obviously high-contrast text (light-on-dark, dark-on-light).
  if (sample.visualPolarityPass === true) {
    return {
      classification: 'pass',
      reason: `Visual polarity check passed: ${((sample.visualPolarityDiff ?? 0) * 100).toFixed(0)}% luminance difference exceeds 40% threshold`,
      effectiveRatio: primaryRatio,
      isBackgroundBased: false,
    };
  }
  
  // ============================================================
  // STEP 1: Check for PASS (worst-case still passes WCAG)
  // ============================================================
  // If even the most conservative measurement passes, no issue
  if (contrastWorst >= threshold) {
    return {
      classification: 'pass',
      reason: `Worst-case contrast ${contrastWorst.toFixed(1)}:1 meets threshold ${threshold}:1`,
      effectiveRatio: primaryRatio,
      isBackgroundBased: false,
    };
  }
  
  // ============================================================
  // STEP 2: Check background certainty for classification
  // ============================================================
  // Per v23 rule: Low confidence alone MUST NOT downgrade
  // Classification is based on BACKGROUND certainty, not confidence
  
  // Background is UNCERTAIN when any of these are true:
  const hasMultipleBackgroundCandidates = sample.fallbackMethod === 'range' && (sample.clusterCount ?? 0) >= 2;
  const hasMixedBackground = backgroundCertainty.mixedBackground === true;
  const hasGradient = backgroundCertainty.hasGradient === true;
  const hasImageOrOverlay = backgroundCertainty.hasImage === true || backgroundCertainty.hasOverlay === true;
  const spansMultipleRegions = backgroundCertainty.spanMultipleRegions === true;
  
  const backgroundIsUncertain = 
    hasMultipleBackgroundCandidates ||
    hasMixedBackground ||
    hasGradient ||
    hasImageOrOverlay ||
    spansMultipleRegions;
  
  // ============================================================
  // STEP 3: FOREGROUND SAMPLING VALIDATION (v25.3)
  // ============================================================
  // If foreground sampling validation failed (too close to BG, re-sampling
  // unsuccessful), downgrade to POTENTIAL with FG_SAMPLING_UNRELIABLE.
  if (sample.foregroundValidation && !sample.foregroundValidation.isValid) {
    return {
      classification: 'potential',
      reason: sample.foregroundValidation.reason || 'Foreground color sampling unreliable for this element',
      effectiveRatio: primaryRatio,
      isBackgroundBased: false,
      isForegroundSamplingUnreliable: true,
      fgSamplingUnreliableReason: sample.foregroundValidation.reason,
    };
  }
  
  // ============================================================
  // STEP 3.5: BADGE/PILL/CHIP FG/BG AMBIGUITY (v25.5)
  // ============================================================
  // If the element is an enclosed component (badge, pill, chip) and
  // foreground/background roles cannot be confidently determined,
  // downgrade to POTENTIAL with FG_BG_AMBIGUITY.
  if (sample.fgBgAmbiguity) {
    return {
      classification: 'potential',
      reason: sample.fgBgAmbiguityReason || 'Foreground/background ambiguity in enclosed component',
      effectiveRatio: primaryRatio,
      isBackgroundBased: false,
      isFgBgAmbiguity: true,
      fgBgAmbiguityReason: sample.fgBgAmbiguityReason,
    };
  }
  
  // ============================================================
  // STEP 4: FOREGROUND PLAUSIBILITY GATE (v25.2)
  // ============================================================
  // If foreground is near-white or near-background for a prominent element,
  // the measurement is likely corrupted. Downgrade to POTENTIAL.
  const fgLuminance = relativeLuminance01(sample.fg);
  const bgLuminance = relativeLuminance01(sample.bg);
  const plausibility = checkForegroundPlausibility(fgLuminance, bgLuminance, elementRole, textSize);
  
  if (!plausibility.isPlausible) {
    // Foreground sampling is implausible for this element type
    // Downgrade to POTENTIAL regardless of background certainty
    return {
      classification: 'potential',
      reason: plausibility.reason || 'Foreground color sampling inconsistent with visual prominence.',
      effectiveRatio: primaryRatio,
      isBackgroundBased: false,
      isForegroundImplausible: true,
      fgImplausibilityReason: plausibility.reason,
    };
  }
  
  // ============================================================
  // STEP 5: CONFIRMED vs POTENTIAL based on background certainty
  // ============================================================
  
  if (!backgroundIsUncertain) {
    // BACKGROUND IS CERTAIN (uniform, single dominant color)
    // Low confidence does NOT matter here - if background is uniform
    // and contrast fails, it's CONFIRMED
    // Foreground has already passed the plausibility gate
    
    if (contrastBest < threshold) {
      return {
        classification: 'confirmed',
        reason: `Contrast ${primaryRatio.toFixed(1)}:1 is below threshold ${threshold}:1 with certain background`,
        effectiveRatio: primaryRatio,
        isBackgroundBased: true,
      };
    }
    
    // Best-case passes but worst-case fails — still CONFIRMED for certain backgrounds
    // because the primary measured ratio is the best estimate
    if (primaryRatio < threshold) {
      return {
        classification: 'confirmed',
        reason: `Measured contrast ${primaryRatio.toFixed(1)}:1 is below threshold ${threshold}:1 with certain background`,
        effectiveRatio: primaryRatio,
        isBackgroundBased: true,
      };
    }
    
    // Edge case: contrast is borderline but background is certain
    // Primary ratio passes but it's close - still passes
    return {
      classification: 'pass',
      reason: `Primary contrast ${primaryRatio.toFixed(1)}:1 meets threshold ${threshold}:1`,
      effectiveRatio: primaryRatio,
      isBackgroundBased: true,
    };
  }
  
  // BACKGROUND IS UNCERTAIN — classify as POTENTIAL
  // This is the ONLY reason to use potential: background uncertainty
  // (NOT low confidence when background is certain)
  
  const uncertaintyReasons: string[] = [];
  if (hasMultipleBackgroundCandidates) uncertaintyReasons.push('multiple background candidates');
  if (hasMixedBackground) uncertaintyReasons.push('mixed background');
  if (hasGradient) uncertaintyReasons.push('gradient pattern');
  if (hasImageOrOverlay) uncertaintyReasons.push('image/overlay');
  if (spansMultipleRegions) uncertaintyReasons.push('spans multiple regions');
  
  const reasonText = sample.contrastRange
    ? `Background uncertain (${uncertaintyReasons.join(', ')}): contrast range ${contrastMin.toFixed(1)}:1 – ${contrastBest.toFixed(1)}:1`
    : `Background uncertain (${uncertaintyReasons.join(', ')}): estimated ${primaryRatio.toFixed(1)}:1`;
  
  return {
    classification: 'potential',
    reason: reasonText,
    effectiveRatio: contrastMin, // Use worst-case for conservative reporting
    isBackgroundBased: true,
  };
}

// DEPRECATED: This function is kept for backwards compatibility but
// should not be used. Per v21 rule, findings are NEVER suppressed.
function shouldSuppressA1Finding(sample: A1Sample): { 
  suppress: boolean; 
  reason?: string;
  worstCaseStatus?: 'confirmed_fail' | 'fail' | 'pass';
} {
  // v21: NEVER suppress A1 findings
  // Classification is handled by classifyA1Contrast instead
  return {
    suppress: false,
    worstCaseStatus: sample.contrastWorst < 4.0 ? 'confirmed_fail' : sample.contrastWorst < 4.5 ? 'fail' : 'pass',
  };
}

function assessA1Reliability(samples: Array<A1Sample | { error: string }>): A1ReliabilityResult {
  // If any sample outright failed to measure, treat as unreliable.
  for (const s of samples) {
    if ('error' in s) return { reliable: false, reason: s.error, confidencePenalty: 0.4 };
  }
  const okSamples = samples as A1Sample[];
  
  // Multi-sample consistency
  const ratios = okSamples.map(s => s.ratio);
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  if (maxR - minR > 0.2) {
    // Check if finding should be suppressed due to clear luminance separation
    const suppressCheck = shouldSuppressA1Finding(okSamples[0]);
    if (suppressCheck.suppress) {
      return { 
        reliable: false, 
        reason: `Multi-sample consistency failed: ratios varied by ${(maxR - minR).toFixed(2)}`,
        confidencePenalty: 0.3,
        suppressFinding: true,
        suppressReason: suppressCheck.reason,
      };
    }
    return { reliable: false, reason: `Multi-sample consistency failed: ratios varied by ${(maxR - minR).toFixed(2)}`, confidencePenalty: 0.3 };
  }

  const s0 = okSamples[0];
  
  // Base reliability checks
  if (s0.hexToRatioDelta > 0.2) {
    // Check suppression
    const suppressCheck = shouldSuppressA1Finding(s0);
    if (suppressCheck.suppress) {
      return {
        reliable: false,
        reason: `Hex-to-ratio verification failed: measured ${s0.ratio.toFixed(2)} vs recomputed ${s0.hexRecomputedRatio.toFixed(2)}`,
        confidencePenalty: 0.25,
        suppressFinding: true,
        suppressReason: suppressCheck.reason,
      };
    }
    return {
      reliable: false,
      reason: `Hex-to-ratio verification failed: measured ${s0.ratio.toFixed(2)} vs recomputed ${s0.hexRecomputedRatio.toFixed(2)}`,
      confidencePenalty: 0.25,
    };
  }
  if (s0.fgPixelCount < 15) return { reliable: false, reason: 'Insufficient foreground pixels for reliable sampling', confidencePenalty: 0.35 };
  if (s0.bgPixelCount < 15) {
    // Check suppression for background sampling issues
    const suppressCheck = shouldSuppressA1Finding(s0);
    if (suppressCheck.suppress) {
      return { 
        reliable: false, 
        reason: 'Insufficient background pixels for reliable sampling', 
        confidencePenalty: 0.35,
        suppressFinding: true,
        suppressReason: suppressCheck.reason,
      };
    }
    return { reliable: false, reason: 'Insufficient background pixels for reliable sampling', confidencePenalty: 0.35 };
  }
  if (s0.lumaDistance < 20) return { reliable: false, reason: 'Foreground and background too similar for reliable measurement', confidencePenalty: 0.3 };
  if (s0.fgLumaStd > 15) {
    // Check suppression
    const suppressCheck = shouldSuppressA1Finding(s0);
    if (suppressCheck.suppress) {
      return { 
        reliable: false, 
        reason: 'Foreground variance too high — text rendering unstable', 
        confidencePenalty: 0.25,
        suppressFinding: true,
        suppressReason: suppressCheck.reason,
      };
    }
    return { reliable: false, reason: 'Foreground variance too high — text rendering unstable', confidencePenalty: 0.25 };
  }
  
  // For range-based measurements, check if contrast range spans threshold
  if (s0.fallbackMethod === 'range' && s0.contrastRange) {
    const { min, max } = s0.contrastRange;
    // If worst-case passes, reliable PASS
    // If best-case fails, reliable FAIL
    // If range spans threshold, needs review (borderline)
    if (min >= 4.5 || max < 4.5) {
      // Clear determination possible
      return {
        reliable: true,
        fallbackUsed: 'range',
        confidencePenalty: 0.15, // Slight penalty for range-based
      };
    } else {
      // Range spans threshold — check if should suppress based on luminance separation
      const suppressCheck = shouldSuppressA1Finding(s0);
      if (suppressCheck.suppress) {
        return {
          reliable: false,
          reason: `Mixed background: contrast range ${min.toFixed(1)}:1 – ${max.toFixed(1)}:1 spans WCAG threshold`,
          fallbackUsed: 'range',
          confidencePenalty: 0.25,
          suppressFinding: true,
          suppressReason: suppressCheck.reason,
        };
      }
      // Range spans threshold — cannot confirm
      return {
        reliable: false,
        reason: `Mixed background: contrast range ${min.toFixed(1)}:1 – ${max.toFixed(1)}:1 spans WCAG threshold`,
        fallbackUsed: 'range',
        confidencePenalty: 0.25,
      };
    }
  }
  
  // High background variance is okay if clustering was used successfully
  if (s0.bgLumaStd > 20 && s0.fallbackMethod !== 'clustered' && s0.fallbackMethod !== 'range') {
    // Check suppression for high background variance
    const suppressCheck = shouldSuppressA1Finding(s0);
    if (suppressCheck.suppress) {
      return { 
        reliable: false, 
        reason: 'Background variance too high — non-uniform background', 
        confidencePenalty: 0.25,
        suppressFinding: true,
        suppressReason: suppressCheck.reason,
      };
    }
    return { reliable: false, reason: 'Background variance too high — non-uniform background', confidencePenalty: 0.25 };
  }
  
  // Determine confidence penalty based on fallback method
  let confidencePenalty = 0;
  if (s0.fallbackMethod === 'expanded') confidencePenalty = 0.08;
  else if (s0.fallbackMethod === 'clustered') confidencePenalty = 0.12;
  else if (s0.fallbackMethod === 'range') confidencePenalty = 0.15;
  
  return { reliable: true, fallbackUsed: s0.fallbackMethod, confidencePenalty };
}

async function computeA1ViolationsFromScreenshots(
  images: string[],
  a1TextElements: A1TextElement[],
  toolUsed: string,
): Promise<any[]> {
  const ruleId = 'A1';
  const ruleName = 'Insufficient text contrast';
  const advisoryGuidance = 'Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement.';

  if (!Array.isArray(a1TextElements) || a1TextElements.length === 0) {
    // No text elements identified — suppress A1 entirely rather than report generic warning
    // Per policy: Do not report aggregate or anonymous A1 findings
    console.log('A1 suppressed: No text elements identified for contrast measurement (no generic warning)');
    return [];
  }

  // Decode screenshots once.
  const decoded: Image[] = [];
  for (const imgStr of images) {
    const raw = stripDataUrlToBase64(imgStr);
    const bytes = decodeBase64(raw);
    decoded.push(await Image.decode(bytes));
  }

  const results: any[] = [];

  // Deterministic offsets for multi-sample consistency
  const offsets: Array<[number, number]> = [
    [0, 0],
    [2, 0],
    [0, 2],
  ];

  for (const el of a1TextElements) {
    const screenshotIdx0 = clamp((el.screenshotIndex || 1) - 1, 0, decoded.length - 1);
    const img = decoded[screenshotIdx0];

    const thresholdUsed = el.textSize === 'large' ? 3.0 : 4.5;
    const evidence = `Screenshot #${screenshotIdx0 + 1}${el.location ? ` — ${el.location}` : ''}`;
    const elementIdentifier = `Screenshot #${screenshotIdx0 + 1}${el.location ? ` — ${el.location}` : ''}${el.elementDescription ? ` (${el.elementDescription})` : ''}`;

    const samples = offsets.map(([dx, dy]) => computeA1Sample(img, toPxBox(img, el.bbox, dx, dy), 3));
    const reliability = assessA1Reliability(samples);

    const s0 = samples[0];
    
    // Build fallback method description for UI
    const buildFallbackDescription = (fm?: string, ep?: number, cc?: number) => {
      if (!fm || fm === 'direct') return 'direct ring sampling';
      if (fm === 'expanded') return `expanded region (+${ep}px)`;
      if (fm === 'clustered') return `color clustering (${cc || 1} cluster${cc !== 1 ? 's' : ''})`;
      if (fm === 'range') return `range-based (${cc || 2} background candidates)`;
      return 'unknown';
    };

    // ========================================================================
    // MANDATORY COVERAGE (v21): NEVER skip an element
    // Every text element MUST emit an A1 evaluation record
    // ========================================================================
    
    // CASE 1: Measurement error — emit as Potential with explicit reason
    if ('error' in s0) {
      const reasonCodes: string[] = ['BG_TOO_SMALL_REGION'];
      if (s0.error.includes('foreground')) reasonCodes.push('FG_ANTIALIASING');
      
      results.push({
        ruleId,
        ruleName,
        category: 'accessibility',
        status: 'potential' as const,
        samplingMethod: 'pixel',
        inputType: 'screenshots',
        elementIdentifier,
        elementRole: el.elementRole,
        elementDescription: el.elementDescription,
        evidence,
        diagnosis: `Contrast measurement could not be completed: ${s0.error}. Manual verification required.`,
        contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools.',
        actionableGuidance: `Verify this element meets ${thresholdUsed}:1 contrast using DevTools.`,
        confidence: 0.35,
        foregroundHex: undefined,
        backgroundHex: undefined,
        backgroundStatus: 'unmeasurable' as const,
        contrastRatio: undefined,
        thresholdUsed,
        reasonCodes,
        potentialRiskReason: reasonCodes.join(', '),
        inputLimitation: s0.error,
        advisoryGuidance,
        blocksConvergence: false,
      });
      console.log(`A1 emitted (unmeasurable): ${evidence} — ${s0.error}`);
      continue;
    }
    
    const sample = s0 as A1Sample;
    const fgHex = sample.fgHex;
    const bgHex = sample.bgHex;
    const fallbackMethod = sample.fallbackMethod;
    const expansionPx = sample.expansionPx;
    const clusterCount = sample.clusterCount;
    const contrastRange = sample.contrastRange;
    const ratio = sample.ratio;
    
    // ====================================================================
    // AUTHORITATIVE A1 CLASSIFICATION (v25.2)
    // ====================================================================
    // Per v25.2 rule:
    // - CONFIRMED: Background is CERTAIN (uniform) + contrast < threshold
    //              + foreground is plausible for the element type
    //   Low confidence does NOT auto-downgrade if background is uniform
    // - POTENTIAL: Background is UNCERTAIN (mixed, gradient, multiple candidates)
    //              OR foreground sampling is implausible (FG_IMPLAUSIBLE)
    //   This is the ONLY reason to classify as potential
    // ====================================================================
    
    const bgCertainty = sample.backgroundCertainty;
    
    // Use the v25.2 classification function with foreground plausibility gate
    const classification = classifyA1Contrast(
      sample, 
      thresholdUsed, 
      bgCertainty,
      el.elementRole,
      el.textSize
    );
    
    // CASE 2: Classification is PASS — contrast is acceptable
    if (classification.classification === 'pass') {
      console.log(`A1 passed: ${evidence} — ${classification.reason}`);
      continue;
    }
    
    // CASE 3: Emit finding (confirmed or potential)
    const effectiveRatio = classification.effectiveRatio;
    
    // Calculate confidence for REPORTING purposes only (not classification)
    // Per v23: Confidence affects detail level, NOT confirmed/potential status
    // v25.2: Reduce confidence if foreground was implausible
    const baseConfidence = bgCertainty.isCertain ? 0.92 : 0.65;
    const implausibilityPenalty = classification.isForegroundImplausible ? 0.2 : 0;
    const confidence = Math.max(0.45, baseConfidence - reliability.confidencePenalty - implausibilityPenalty);
    
    // Final status comes directly from the classification function
    // v23: Classification is based on background certainty, not confidence
    // v25.2: Also considers foreground plausibility
    const finalStatus: 'confirmed' | 'potential' = classification.classification === 'confirmed' 
      ? 'confirmed' 
      : 'potential';

    // ====================================================================
    // BUILD REASON CODES FOR POTENTIAL FINDINGS (Mandatory per A1 rule)
    // ====================================================================
    // Per v23: Reason codes explain why classification is POTENTIAL
    // Per v25.2: Include FG_IMPLAUSIBLE when foreground sampling is unreliable
    // Per v25.3: Include FG_SAMPLING_UNRELIABLE when foreground validation failed
    const reasonCodes: string[] = [];
    
    // v25.3: Add FG_SAMPLING_UNRELIABLE first if foreground validation failed
    if (classification.isForegroundSamplingUnreliable) {
      reasonCodes.push('FG_SAMPLING_UNRELIABLE');
    }
    
    // v25.2: Add FG_IMPLAUSIBLE if it triggered the downgrade
    if (classification.isForegroundImplausible) {
      reasonCodes.push('FG_IMPLAUSIBLE');
    }
    
    // Background uncertainty reason codes
    if (!bgCertainty.isCertain) {
      if (bgCertainty.mixedBackground) reasonCodes.push('BG_MIXED');
      if (bgCertainty.hasGradient) reasonCodes.push('BG_GRADIENT');
      if (bgCertainty.hasImage) reasonCodes.push('BG_IMAGE');
      if (bgCertainty.hasOverlay) reasonCodes.push('BG_OVERLAY');
      if (bgCertainty.antiAliasingDominates) reasonCodes.push('FG_ANTIALIASING');
      if (sample.bgPixelCount < 15) reasonCodes.push('BG_TOO_SMALL_REGION');
    }
    // v23 CHANGE: LOW_CONFIDENCE is NO LONGER added as a reason code
    // Low confidence does not affect classification when background is certain
    
    // Determine background status
    const backgroundStatus: 'certain' | 'uncertain' | 'unmeasurable' = 
      bgCertainty.isCertain ? 'certain' :
      sample.bgPixelCount >= 8 ? 'uncertain' : 'unmeasurable';
    
    // Track whether fallback methods were used (for reporting, not classification)
    const usedFallback = sample.fallbackMethod && sample.fallbackMethod !== 'direct';
    
    // Build background candidates if uncertain
    const backgroundCandidates = sample.bgCandidates?.map(c => ({
      hex: rgbToHex(c),
      confidence: 0.6, // Reduced confidence for candidates
    }));
    
    // Calculate foreground confidence based on sampling quality (for reporting detail)
    const foregroundConfidence = Math.max(0.5, 1 - (sample.fgLumaStd / 30) - reliability.confidencePenalty);

    // elementIdentifier already defined earlier in loop
    
    const diagnosis = (() => {
      if (finalStatus === 'confirmed') {
        return `Text contrast ${ratio.toFixed(1)}:1 is below WCAG AA minimum ${thresholdUsed}:1. ` +
               `Foreground ${sample.fgHex} on background ${sample.bgHex}${confidence < 0.75 ? ' (sampling confidence reduced)' : ' measured reliably'}.`;
      }
      // potential — explain background uncertainty
      const reasons = reasonCodes.map(code => {
        switch (code) {
          case 'BG_MIXED': return 'multiple background colors detected';
          case 'BG_GRADIENT': return 'gradient background';
          case 'BG_IMAGE': return 'image or textured background';
          case 'BG_OVERLAY': return 'transparency or overlay suspected';
          case 'BG_TOO_SMALL_REGION': return 'insufficient background pixels';
          case 'FG_ANTIALIASING': return 'glyph sampling unstable';
          case 'FG_IMPLAUSIBLE': return 'foreground sampling inconsistent with visual prominence';
          case 'FG_SAMPLING_UNRELIABLE': return 'foreground color sampling unreliable (re-sampling failed)';
          case 'FG_BG_AMBIGUITY': return 'foreground/background ambiguity in enclosed component (badge/pill/chip)';
          default: return code;
        }
      }).join(', ');
      return `Potential contrast issue: ${reasons || 'background uncertain'}. ` +
             (sample.contrastRange 
               ? `Contrast range ${sample.contrastRange.min.toFixed(1)}:1 – ${sample.contrastRange.max.toFixed(1)}:1.`
               : `Estimated ratio ${ratio.toFixed(1)}:1 requires verification.`);
    })();
    
    // Actionable guidance per element
    const actionableGuidance = finalStatus === 'confirmed'
      ? `Increase contrast to at least ${thresholdUsed}:1 by darkening text or lightening background.`
      : `Verify contrast with browser DevTools. If ratio < ${thresholdUsed}:1, adjust colors.`;

    // Build per-element result with all required fields
    results.push({
      ruleId,
      ruleName,
      category: 'accessibility',
      status: finalStatus,
      samplingMethod: 'pixel',
      inputType: 'screenshots',
      // Element identification
      elementIdentifier,
      elementRole: el.elementRole,
      elementDescription: el.elementDescription,
      evidence,
      // Diagnosis and guidance
      diagnosis,
      contextualHint: finalStatus === 'potential' 
        ? 'Verify contrast with browser DevTools or accessibility testing tools.'
        : 'Increase text/background contrast for this element and re-check against WCAG AA.',
      actionableGuidance,
      confidence,
      // Foreground color data
      foregroundRgb: `rgb(${Math.round(sample.fg.r)}, ${Math.round(sample.fg.g)}, ${Math.round(sample.fg.b)})`,
      foregroundHex: sample.fgHex,
      foregroundConfidence: Math.round(foregroundConfidence * 100) / 100,
      // Background color data
      backgroundRgb: `rgb(${Math.round(sample.bg.r)}, ${Math.round(sample.bg.g)}, ${Math.round(sample.bg.b)})`,
      backgroundHex: sample.bgHex,
      backgroundStatus,
      backgroundCandidates,
      // Contrast data
      contrastRatio: Math.round(ratio * 100) / 100,
      contrastRange: sample.contrastRange ? { min: Math.round(sample.contrastRange.min * 100) / 100, max: Math.round(sample.contrastRange.max * 100) / 100 } : undefined,
      thresholdUsed,
      colorApproximate: true,
      // Reason codes for potential findings (MANDATORY per A1 rule)
      reasonCodes: finalStatus === 'potential' ? reasonCodes : undefined,
      potentialRiskReason: reasonCodes.length > 0 ? reasonCodes.join(', ') : undefined,
      // Background certainty metadata
      backgroundCertainty: {
        isCertain: bgCertainty.isCertain,
        reason: bgCertainty.reason,
      },
      // Sampling reliability data
      samplingReliability: {
        pixelSupport: `adequate (${sample.fgPixelCount} fg pixels, ${sample.bgPixelCount} bg pixels)`,
        foregroundVariance: `stddev ${Math.round(sample.fgLumaStd)}`,
        backgroundVariance: `stddev ${Math.round(sample.bgLumaStd)}`,
        colorDistance: `Δluma ${Math.round(sample.lumaDistance)}`,
        hexVerification: `passed (measured ${sample.ratio.toFixed(2)}, recomputed ${sample.hexRecomputedRatio.toFixed(2)})`,
        multiSampleConsistency: 'passed (±0.2)',
        fallbackMethod: buildFallbackDescription(),
      },
      samplingFallback: usedFallback ? {
        method: buildFallbackDescription(),
        expansionPx: sample.expansionPx,
        clusterCount: sample.clusterCount,
        rangeSpansThreshold: sample.contrastRange ? (sample.contrastRange.min < 4.5 && sample.contrastRange.max >= 4.5) : false,
      } : undefined,
      // Convergence: Confirmed blocks, potential/borderline does not
      blocksConvergence: finalStatus === 'confirmed',
    });
  }

  // Log per-element classification breakdown
  const confirmed = results.filter(r => r.status === 'confirmed').length;
  const potential = results.filter(r => r.status === 'potential').length;
  console.log(`A1 pixel-sampled: ${results.length} finding(s) — ${confirmed} confirmed, ${potential} potential (heuristic)`);
  return results;
}

// Complete rule registry for the 3-pass analysis
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Small body font size', diagnosis: 'Body-level text elements use font sizes below the recommended 16px minimum for primary readable content. WCAG 2.1 does not mandate a minimum font size; however, 16px is widely adopted as the baseline for body text readability.', correctivePrompt: 'Increase primary body text (paragraphs, descriptions, main content text, dialog/alert/form descriptions) to at least 16px (text-base / 1rem) across all screens and components where this body-text style is reused. Do not change badges, headings, subtitles, navigation text, metadata, timestamps, button labels, or intentional microcopy.' },
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

const buildAnalysisPrompt = (categories: string[], selectedRules: string[]) => {
  const selectedRulesSet = new Set(selectedRules);
  const includesA1 = selectedRulesSet.has('A1');
  
  return `You are an expert UI/UX auditor performing a comprehensive 3-pass analysis of a user interface. Analyze the provided screenshot(s) following this structured methodology:

## PASS 1 — Accessibility (WCAG AA)
Run visual inspection for accessibility issues:
- Text contrast ratios (minimum 4.5:1 for normal text)
- Font sizes (minimum 16px for body text)
- Line spacing and readability
- Focus indicator visibility

### A2 (Small body font size) — VISUAL DETECTION RULES:

**SCOPE:** Body-level text only: paragraphs, descriptions, article content, main text areas,
dialog descriptions, alert bodies, form descriptions, card descriptions.

**DO NOT APPLY to:** Badges, metadata, timestamps, intentional microcopy, labels, tags,
chips, status indicators, keyboard shortcuts, breadcrumbs, navigation items, button labels.

**CLASSIFICATION:**
All screenshot-based A2 findings are **POTENTIAL RISK** (status: "potential", blocksConvergence: false)
because visual estimation cannot deterministically resolve exact pixel sizes.

**VISUAL SIZE THRESHOLDS (approximate visual assessment):**
1. **POTENTIAL RISK** (typeBadge: "POTENTIAL"): Body text appears noticeably smaller than 16px
   - Only for PRIMARY BODY TEXT content (descriptions, paragraphs, content blocks)
   - Confidence: 45-60% (visual estimation has inherent uncertainty)

2. **NO ACTION**: Text appears ≥16px or is not body text
   - Do NOT include in violations array
   - Skip entirely

**SEMANTIC ROLE VISUAL CLASSIFICATION:**
**PRIMARY BODY TEXT (A2 targets — must use ≥16px):**
- Dialog/modal description text
- Form field description/helper text
- Card descriptions and content blocks
- Alert/notification body text
- Article/paragraph content
- Main readable content areas

**EXCLUDED ELEMENTS (DO NOT EVALUATE for A2):**
- Badges, tags, status indicators, chips
- Metadata displays (dates, counts, status text)
- Timestamps, "time ago" displays
- Keyboard shortcut hints
- Tooltip content, breadcrumbs
- Icon-only elements, action buttons
- Navigation menu items
- Button labels, interactive elements
- Code blocks, monospace text
- Captions under images/figures

**CONFIDENCE ADJUSTMENT FACTORS:**
1. **Visual certainty** (±15%):
   - Text clearly small compared to standard body text → +10%
   - Text size ambiguous or borderline → -10%

2. **Context clarity** (±10%):
   - Standalone body text paragraph → +5%
   - Part of complex UI pattern → -5%

**OUTPUT FORMAT FOR A2 FINDINGS:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Small body font size",
  "category": "accessibility",
  "status": "potential",
  "typeBadge": "POTENTIAL",
  "evidence": "Body text in dialog description appears smaller than 16px",
  "diagnosis": "Body text in [location] appears to use a font size below the recommended 16px minimum for primary readable content.",
  "contextualHint": "Increase body text to at least 16px (text-base) for primary content areas.",
  "confidence": 0.50,
  "semanticRole": "body-text"
}
\`\`\`

**STRICT RULES:**
- Only report text that serves as PRIMARY BODY TEXT (not badges, metadata, timestamps, microcopy)
- Text appearing ≥16px → DO NOT report
- All screenshot findings are status: "potential" (visual estimation)
- Frame as best-practice concern, never WCAG violation
- Lower confidence than code analysis (visual estimation)

**DO NOT:**
- Flag badges, metadata, timestamps, or microcopy
- Flag normal-sized body text as violations
- Use "fails", "violates WCAG", or compliance language
- Assume text size without clear visual evidence
- Flag interactive elements (buttons, links)
- Over-report borderline cases
### A4 (Small tap / click targets) — STRICT CLASSIFICATION & WORDING RULES:

**VISUAL ANALYSIS LIMITATION:**
Visual inspection cannot measure exact rendered dimensions. Padding, spacing, and layout constraints may increase the actual clickable area beyond what is visually apparent. Compliance CANNOT be confirmed from screenshots alone.

**GUIDELINE FRAMING:**
- 44×44 CSS px is commonly recommended in usability and accessibility guidelines
- WCAG 2.1 Target Size (Level AAA) suggests 44×44px, but this is NOT an AA requirement
- Do NOT state that WCAG mandates 44×44 at AA level
- Frame as: "commonly recommended touch target size" or "usability guideline"

**CLASSIFICATION:**
- ALWAYS classify A4 as "⚠️ Potential Risk (Heuristic)" — NEVER "Confirmed"
- Visual inspection CANNOT confirm tap target violations without actual DOM measurement

**CONFIDENCE REASONING:**
Confidence is based on:
1. **Visual size assessment** (±15%): Elements that appear noticeably small → higher confidence of potential risk
2. **Element type** (±10%): Icon-only buttons, close buttons → higher risk of small targets
3. **Visual analysis limitation** (-15%): Always reduce confidence since exact dimensions cannot be measured

**WHAT TO REPORT:**
1. Only report interactive elements (buttons, links, clickable elements) that visually appear to lack adequate size
2. DO NOT report elements that appear to have sufficient visual size (buttons with visible padding, large touch areas)

**DO NOT:**
- Infer or assume final tap target size from visual estimation alone
- Mention internal glyphs, spans, icons, or characters (e.g., "×", "X", icons)
- Describe user difficulty as a confirmed outcome
- Use language implying measurement or certainty
- Use "non-compliant" or "fails" — prefer "may be below recommended touch target size"

**REQUIRED WORDING:**
- Refer to elements as "button" or "interactive element" — not internal content
- Use neutral, academic phrasing: "does not explicitly enforce", "cannot be guaranteed", "may be below"
- Include the component/location where the issue occurs

**OUTPUT TEMPLATE:**
"The [button/interactive element] in [component/location] appears to be below the commonly recommended touch target size of 44×44 CSS px. Although padding or layout constraints may increase the actual clickable area, this cannot be confirmed from visual inspection alone. (WCAG 2.1 Target Size is AAA, not AA.)"

**Report each potentially undersized element SEPARATELY** — do not group into one violation

### A5 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**ABSOLUTE RULE:**
If an element appears to have the default browser focus outline, it MUST NOT be reported under A5.
Lack of a custom focus-visible style alone is NOT an accessibility issue — browser defaults are acceptable.

**PREREQUISITE — VISIBLE FOCUS STATE:**
ONLY flag A5 issues if the screenshot shows evidence that focus indicators are missing or inadequate.
If you cannot determine focus state from the screenshot → DO NOT REPORT

**FOCUSABILITY DETERMINATION — STRICT CRITERIA:**
An element is ONLY considered focusable if:
1. It is a button, link (\`<a>\`), form input, select, or textarea
2. It appears to be an interactive control that would receive keyboard focus

**DO NOT CLASSIFY AS FOCUSABLE:**
- Decorative elements, static text, images
- Cards, containers, or wrappers that are not interactive

**IGNORE COMPLETELY:**
- All hover states — hover is NOT focus
- Hover feedback must NEVER be used as evidence for or against focus visibility

**CLASSIFICATION CATEGORIES:**

1. **NOT APPLICABLE — SKIP ENTIRELY:**
   - Element is NOT interactive/focusable
   - OR screenshot does not show focus state
   - DO NOT REPORT — do not include in violations array

2. **PASS — SKIP ENTIRELY:**
   - Screenshot shows visible focus indicator (ring, border, outline, glow)
   - DO NOT REPORT — do not include in violations array

3. **HEURISTIC RISK — REPORT:**
   - Element IS interactive AND appears to rely ONLY on background color change for focus
   - Set \`typeBadge: "HEURISTIC"\`
   - Set confidence to 40-50% (screenshots cannot confirm focus states)
   - Rationale: "Focus indication may rely only on background/text color change."

4. **CONFIRMED VIOLATION — REPORT:**
   - Element IS interactive AND visually appears to LACK any visible focus indicator
   - Set \`typeBadge: "CONFIRMED"\`
   - Set confidence to 50-60% (medium-low for screenshot analysis)

**OUTPUT FORMAT FOR A5 VIOLATIONS ONLY:**
\`\`\`json
{
  "ruleId": "A5",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "Button appears to lack visible focus indicator",
  "diagnosis": "The primary action button may lack a visible focus indicator for keyboard users.",
  "contextualHint": "Add visible focus ring or border for keyboard accessibility.",
  "confidence": 0.55
}
\`\`\`

**OUTPUT CONSTRAINT — MANDATORY:**
- The "violations" array must contain ONLY categories 3 and 4 (HEURISTIC RISK and CONFIRMED)
- NEVER include PASS or NOT APPLICABLE cases in violations
- NEVER speculate based on "might be subtle" or assumptions
- Report ONLY actual accessibility risks observed in the screenshot

${includesA1 ? `
### SPECIAL HANDLING FOR A1 (Text Contrast) — COMPREHENSIVE MANDATORY COVERAGE

**DESIGN PRINCIPLE: Screenshots are the source of truth for visual properties.**
Input constraint: Only screenshots are available (no DOM, no CSS tokens, no source code).
Use interior-stroke sampling to measure what a user color-picker would measure on text.

**CRITICAL: Only reliable measurements block convergence. Unreliable A1 findings MUST be classified as Potential Risk (non-blocking).**

---

## 0️⃣ MANDATORY DETECTION SCOPE — NO EXCLUSIONS (v24)

**CRITICAL: You MUST identify ALL visible text elements for A1 evaluation. NO EXCLUSIONS.**

Do NOT skip text based on:
- Visual prominence (secondary, muted, faded, subtle)
- Semantic role (metadata, captions, badges, labels, tags)
- Stylistic intent (intentionally low-contrast for aesthetic)
- Text color (gray, yellow, blue, colored text)
- Text size or weight (small text must still be evaluated)
- Perceived importance or emphasis

**MUST INCLUDE (comprehensive list — not exhaustive):**
- Secondary or muted text (even if intentionally styled that way)
- Descriptions and summaries
- Author names, usernames, handles
- Timestamps, dates, metadata
- Tags, labels, badges, chips, pills
- Colored text (yellow prices, blue links, gray hints)
- Placeholder text in inputs
- Helper text, hint text, caption text
- Price labels, discount percentages
- Footer text, copyright notices
- Breadcrumb text, navigation labels
- Status indicators, state labels
- Counter text, quantity labels
- Any other readable text visible to users

**RULE: If a user can read the text, it MUST be in a1TextElements for evaluation.**

---

## 1️⃣ INTERIOR-STROKE SAMPLING METHODOLOGY (MANDATORY FOR SCREENSHOTS)

For each detected text element, estimate colors as follows:

**STEP 1 — Detect text region:**
- Identify text region visually or via OCR
- Define a bounding box around the text element
- INCLUDE ALL VISIBLE TEXT — do not skip based on prominence

**STEP 2 — Sample foreground (text) color using INTERIOR GLYPH STROKES:**
- Sample many pixels from the text region (e.g., 50-200 pixels)
- Convert all sampled pixels to luminance
- **Select the DARKEST 30–40% of pixels** by luminance (these are the core glyph stroke interiors)
- This excludes anti-aliased edges and halos which have intermediate luminance values
- Compute the **median RGB** of this darkest subset as the foreground color
- Report the RAW sampled hex — do NOT map to Tailwind tokens or nearest palette color

**STEP 3 — Estimate background color using LOCAL-PRIORITY RING SAMPLING (v24):**
- Sample a LOCAL margin (6-10px) around the text bounding box
- Weight pixels by proximity — nearer pixels get higher weight
- If local region is uniform (single dominant color) → use that as background
- This correctly handles badges, pills, chips with colored backgrounds
- Only expand to wider regions if local sampling is insufficient
- Use the **median RGB** of remaining pixels as the background color
- Report the RAW sampled hex — do NOT snap to palette tokens

**STEP 3.5 — BADGE/PILL/CHIP ENCLOSED COMPONENT HANDLING (v25.5):**
- When text is inside a visually bounded container (badge, pill, chip, label with rounded background):
  * The container fill IS the background — do NOT sample outside the badge boundary
  * The foreground is the text glyph color, NOT the container color
  * Measure contrast between text color and container fill color
- If foreground and background roles cannot be determined with high confidence:
  * Set \`status: "potential"\`
  * Add reason: "Foreground/background ambiguity in enclosed component"
  * Do NOT report as confirmed
- Only report A1 — Confirmed for badges/pills when:
  * Text color and container background are confidently identified
  * Contrast is measured between text and its immediate container
- This prevents false positives where light badge fills are mistaken for foreground text

**STEP 4 — Compute contrast ratio:**
- Use WCAG 2.1 relative luminance formula on the sampled median foreground/background RGB
- Convert to hex for reporting (hex values are estimated from pixels, not verified tokens)
- Threshold: 4.5:1 for normal text (< ~18px), 3.0:1 for large text (≥ 18px or ≥ 14px bold)

---

## 2️⃣ RELIABILITY CHECKS (ALL must pass for Confirmed status)

**CHECK 1 — Hex-to-Ratio Verification (MANDATORY):**
After sampling, recompute contrast from the reported estimated hex values.
The recomputed ratio MUST match the measured contrast within ±0.2.
If not, mark as UNRELIABLE with reason: "Hex-to-ratio verification failed: measured X.X vs recomputed Y.Y"

**CHECK 2 — Sufficient Pixel Support:**
Require enough "text pixels" in the darkest subset (at least 15-20 pixels).
If insufficient, mark as UNRELIABLE with reason: "Insufficient foreground pixels for reliable sampling"

**CHECK 3 — Color Distance Check:**
If foreground and background colors are too similar (very small color distance, e.g., < 20 luminance units apart), mark as UNRELIABLE with reason: "Foreground and background too similar for reliable measurement"

**CHECK 4 — Foreground Variance:**
If stddev(luminance) of foreground pixels > 15, mark as UNRELIABLE with reason: "Foreground variance too high — text rendering unstable"

**CHECK 5 — Background Variance:**
If stddev(luminance) of background pixels > 20, mark as UNRELIABLE with reason: "Background variance too high — non-uniform background (possible gradient/image)"

**CHECK 6 — Multi-Sample Consistency:**
Repeat sampling with small offsets (~2-5px) 3 times total.
Compute contrast ratio for each sample.
If the 3 ratios differ by more than ±0.2, mark as UNRELIABLE with reason: "Multi-sample consistency failed: ratios varied by X.X across positions"

---

## 3️⃣ TRI-STATE CLASSIFICATION

**CONFIRMED FAIL (Reliable, Blocking):**
- ALL reliability checks PASS
- Interior-stroke contrast is clearly below WCAG AA (< 4.0:1 for normal text to allow margin)
- Set \`status: "confirmed"\`, \`samplingMethod: "pixel"\`
- Report \`contrastRatio\`, \`foregroundHex\`, \`backgroundHex\` (RAW sampled values)
- Confidence: **85–95%**
- **Blocks convergence**

**BORDERLINE / NEEDS REVIEW (Non-blocking):**
- Contrast is near threshold (≈ 4.0–4.5:1)
- OR sampling is unreliable (any reliability check failed)
- OR element is labeled "secondary" / "muted" / "caption"
- Set \`status: "borderline"\` or \`status: "potential"\`, \`samplingMethod: "inferred"\`
- Set \`potentialRiskReason\`: Specific reason (e.g., "Near-threshold contrast (4.2:1) — manual verification recommended")
- Report estimated hex values but include uncertainty note
- Confidence: **50–75%**
- **Does NOT block convergence**

**PASS / RESOLVED:**
- ALL reliability checks PASS
- Contrast ≥ 4.5:1 (or ≥ 3.0:1 for large text)
- DO NOT include in violations array
- No output for passing elements

---

## 4️⃣ CONVERGENCE BEHAVIOR

**CRITICAL: Only \`status: "confirmed"\` violations count toward threshold and block convergence.**
**\`status: "potential"\` and \`status: "borderline"\` findings are advisory and NEVER block convergence.**

This prevents infinite iterations where A1 repeats despite UI updates due to sampling variability.

---

## 5️⃣ FORBIDDEN BEHAVIORS

**DO NOT:**
- Snap sampled colors to Tailwind tokens or "nearest palette color" (e.g., don't replace sampled #8A8A8F with "#6B7280 (gray-500)")
- Report palette-mapped hex values — only RAW sampled hex from pixels
- Say "Exact color values cannot be determined from a screenshot"
- Output Confirmed status when ANY reliability check fails
- Assign high confidence (>75%) to findings that fail reliability checks
- Mark borderline ratios (4.0–4.5:1) as Confirmed — use "borderline" status instead
- Group multiple unrelated elements under one finding — each element is separate

---

## 6️⃣ OUTPUT FORMAT FOR CONFIRMED FAIL (Reliable Interior-Stroke Sampling)

\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "confirmed",
  "samplingMethod": "pixel",
  "inputType": "screenshots",
  "elementRole": "badge",
  "evidence": "CourseCard → Credits badge",
  "elementDescription": "Credits badge label text",
  "foregroundRgb": "rgb(138, 138, 143)",
  "foregroundHex": "#8A8A8F",
  "backgroundRgb": "rgb(255, 255, 255)",
  "backgroundHex": "#FFFFFF",
  "contrastRatio": 2.91,
  "thresholdUsed": 4.5,
  "samplingReliability": {
    "foregroundVariance": "low (stddev 8)",
    "backgroundVariance": "low (stddev 5)",
    "hexVerification": "passed (measured 2.91, recomputed 2.89)",
    "pixelSupport": "adequate (32 fg pixels)",
    "colorDistance": "adequate (117 luminance units)"
  },
  "colorApproximate": true,
  "diagnosis": "Credits badge text has 2.91:1 contrast (interior-stroke sampled), failing WCAG AA 4.5:1 threshold.",
  "contextualHint": "Increase badge text contrast to at least 4.5:1 by using darker text or lighter background.",
  "confidence": 0.90
}
\`\`\`

---

## 7️⃣ OUTPUT FORMAT FOR BORDERLINE / NEEDS REVIEW (Near-threshold or Unreliable)

\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "borderline",
  "samplingMethod": "inferred",
  "inputType": "screenshots",
  "elementRole": "caption",
  "evidence": "ArticleCard → Published date caption",
  "elementDescription": "Caption text appears low contrast",
  "foregroundHex": "#9CA3AF",
  "backgroundHex": "#F9FAFB",
  "contrastRatio": 4.21,
  "thresholdUsed": 4.5,
  "potentialRiskReason": "Near-threshold contrast (4.21:1) — manual verification recommended",
  "colorApproximate": true,
  "diagnosis": "Caption text has near-threshold contrast (4.21:1). Borderline — verify with color picker or DevTools.",
  "advisoryGuidance": "Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement.",
  "confidence": 0.68
}
\`\`\`

---

## 8️⃣ OUTPUT FORMAT FOR POTENTIAL RISK (Sampling Unreliable)

\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "potential",
  "samplingMethod": "inferred",
  "inputType": "screenshots",
  "elementRole": "label",
  "evidence": "FormField → Helper text",
  "elementDescription": "Helper text appears low contrast",
  "potentialRiskReason": "Multi-sample consistency failed: ratios varied by 0.4 across positions",
  "colorApproximate": true,
  "diagnosis": "Helper text may have insufficient contrast. Ratio not computed (unreliable sampling).",
  "advisoryGuidance": "Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement.",
  "confidence": 0.55
}
\`\`\`

**POTENTIAL RISK REASONS (use specific failure reason):**
- "Hex-to-ratio verification failed: measured X.X vs recomputed Y.Y"
- "Insufficient foreground pixels for reliable sampling"
- "Foreground and background too similar for reliable measurement"
- "Foreground variance too high (stddev > 15) — text rendering unstable"
- "Background variance too high (stddev > 20) — non-uniform background"
- "Multi-sample consistency failed: ratios varied by X.X across positions"

---

## 9️⃣ PER-ELEMENT ANALYSIS WORKFLOW (Report each element separately)

For EACH visible text element:
1. **Identify location** — Component and element role (badge, caption, label, heading, etc.)
2. **Sample text region pixels** — Collect 50-200 pixels from text bounding box
3. **Extract foreground** — Select darkest 30-40% by luminance (interior strokes)
4. **Extract background** — Sample ring around text, exclude dark pixels
5. **Compute median RGB** — For both foreground and background
6. **Run reliability checks:**
   - Hex-to-ratio verification (±0.2)
   - Pixel support (≥15 fg pixels)
   - Color distance (≥20 luminance units)
   - Foreground variance (stddev ≤15)
   - Background variance (stddev ≤20)
   - Multi-sample consistency (3 samples, ±0.2)
7. **Classify:**
   - All checks pass + ratio < 4.0 → **Confirmed Fail** (blocking)
   - All checks pass + ratio 4.0-4.5 → **Borderline** (non-blocking)
   - Any check fails → **Potential Risk** (non-blocking)
   - All checks pass + ratio ≥ 4.5 → **Pass** (no output)
8. **Report RAW sampled hex** — Never snap to Tailwind/palette tokens

---

## 🔟 MANDATORY FIELDS FOR ALL A1 FINDINGS

- \`samplingMethod\`: "pixel" (reliable) or "inferred" (unreliable/borderline)
- \`inputType\`: "screenshots"
- \`colorApproximate: true\` (always for screenshots)
- \`status\`: "confirmed", "borderline", or "potential"

**CONFIRMED requires:**
- \`contrastRatio\`, \`foregroundHex\`, \`backgroundHex\` (RAW sampled)
- \`samplingReliability\` object with all check results
- Confidence 85-95%

**BORDERLINE/POTENTIAL requires:**
- \`potentialRiskReason\` with specific failure reason
- \`advisoryGuidance\`
- Confidence 50-75%

**DO NOT:**
- Include PASS results in violations array
- Snap colors to Tailwind tokens — report RAW sampled hex only
- Include "heuristic" or "non-blocking" labels in diagnosis text
- Mark as Confirmed if ANY reliability check fails
- Mark borderline (4.0-4.5:1) as Confirmed
` : ''}

Report violations ONLY if there is strong visual evidence.

Accessibility rules to check:
${rules.accessibility.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## PASS 2 — Usability (HCI)
Independently reason about the UI based on HCI principles. Do NOT rely solely on code warnings.
Perform qualitative judgment based on UI intent and visual hierarchy.

### U1 (Unclear primary action) — COMPREHENSIVE EVIDENCE-BASED DETECTION RULES:

**GOAL:** Detect unclear primary action issues whenever visual hierarchy fails, based only on observable visual evidence. Do not speculate. Do not infer intent.

**CRITICAL — VISUAL EMPHASIS DETECTION:**
When analyzing button styling in screenshots, carefully distinguish between:
- **FILLED/PRIMARY button**: Solid background color (e.g., blue, dark, primary color filled)
- **OUTLINED button**: Border only, transparent/white background
- **GHOST button**: No border, transparent background, text only
- **TEXT/LINK button**: Just text, possibly underlined, no background or border

---

**ACTION GROUP DETECTION (CRITICAL - expanded container patterns):**
Treat ANY of the following as an action group for U1 detection:
1. **Dialog footers / modal footers**: Action areas at bottom of dialogs/modals
2. **Card footers / CardActions**: Card action areas at bottom of cards
3. **Footer button rows**: Horizontal button arrangements at bottom of containers
4. **Action bars / toolbars**: Rows of action buttons
5. **Button groups**: Multiple buttons visually grouped together in a row
6. **Form action sections**: Buttons at the end of forms
7. **Any horizontal flex container with multiple buttons**: Parent containing 2+ button-like elements

**CTA/BUTTON RECOGNITION (expanded - avoid missing styled buttons):**
Treat ALL of the following as CTAs for U1 analysis:
- Buttons with visible labels (Save, Share, Apply, Submit, Create, Delete, etc.)
- Icon-only action buttons with clear action intent
- Buttons in card footers, dialog footers, or action bars
- Any element that appears clickable with action-oriented text

---

**U1 MUST TRIGGER if ANY of the following evidence-based cases are met:**

---

**CASE A — Equal emphasis between primary and secondary actions**

Trigger U1 when ALL are true:
- Two or more actions are VISUALLY present in the same action area (dialog footer, card actions, button group)
- A primary action is identifiable (e.g., Submit, Save, Confirm, Apply, Create, Send, Continue)
- The primary action has equal or lower visual emphasis than at least one secondary action
  (e.g., BOTH appear as outlined buttons, or secondary appears more prominent)

**Example evidence for CASE A:**
"Dialog footer shows 'Cancel' and 'Submit'. BOTH appear as outlined buttons with identical visual weight."

---

**CASE B — Multiple equally emphasized actions (competing primaries) [CRITICAL]**

**TRIGGER CONDITION:** Emit U1 when ALL are true within ONE detected action group:
1. Two or more CTAs (>=2 is sufficient) are VISUALLY present in the SAME action group/container
2. Two or more CTAs appear with HIGH emphasis styling (filled/solid backgrounds)
3. The HIGH emphasis CTAs share the SAME visual prominence (no single dominant CTA)

**HIGH-EMPHASIS VISUAL INDICATORS:**
A button is HIGH emphasis if it shows:
- Solid/filled background color (blue, dark, primary color)
- Prominent visual weight compared to container background
- Colored/dark fill (not just border or transparent)

**LOW/MEDIUM-EMPHASIS VISUAL INDICATORS:**
A button is LOW/MEDIUM emphasis if it shows:
- Only a border/outline (transparent background)
- Ghost styling (minimal visual presence)
- Text-only or link appearance

**ACTION GROUP DETECTION (expanded):**
Treat ALL of the following as action groups for Case B detection:
- Dialog footers (DialogFooter, modal footer)
- Card footers and action areas (CardFooter, card actions, CardActions)
- Footer button rows
- Action bars (action bar, toolbar)
- Button groups (sibling buttons within same parent container/row)
- Form action sections

**CRITICAL FOR CASE B:**
- Does NOT require a de-emphasized action to exist
- Detection is based on observable visual styles, NOT inferred intent from labels
- If multiple buttons all appear with filled/solid backgrounds → TRIGGER
- Confidence: 70-80% when 2+ filled/primary-styled buttons are detected

**FALSE POSITIVE AVOIDANCE:**
- Do NOT trigger if exactly one button is high-emphasis and others are outline/ghost/link
- Do NOT trigger if only one action exists in the group
- Do NOT trigger if actions are clearly separated by context (e.g., one in header, one in footer)

**Example evidence for CASE B (use these patterns):**
"Card footer shows 'Save', 'Share', and 'Apply' buttons. All three appear as filled buttons with identical visual prominence - no clear primary action."
"Form footer shows 'Apply' and 'Submit' buttons. Both appear as filled buttons with identical visual prominence."
"CardActions area shows multiple CTAs (Save, Share, Apply). All appear equally emphasized with solid backgrounds."
"Action bar shows Save, Share, Apply buttons. All appear as filled/primary buttons with equal visual weight."

**Output wording for CASE B:**
- Describe as "multiple equally emphasized actions" or "no clear primary action among high-emphasis buttons"
- List affected components/locations (e.g., ProposalCard / CardActions, SettingsForm / footer)
- Do NOT mention secondary actions being weaker (since none are in Case B)

---

**CASE C — Hidden affordance in default state**

Trigger U1 when ALL are true:
- An important action lacks clear button affordance in its visible DEFAULT state
- The element appears as plain text or has minimal styling that doesn't suggest clickability
- Button-like styling (background, border, shadow) is not visible in the screenshot

**Example evidence for CASE C:**
"Primary action appears as plain text without visible button styling (no background, border, or shadow visible)."

---

**CASE D — Primary action visually de-emphasized**

Trigger U1 when ALL are true:
- A primary action is visible (submit, confirm, save, etc.)
- It appears with low emphasis styling (outlined, ghost, or text-only)
- Secondary or less important actions appear with higher emphasis (filled/solid background)

**Example evidence for CASE D:**
"Submit button appears outlined while Cancel button appears filled. Primary action is less prominent than secondary."

---

**STRICT FALSE-POSITIVE PREVENTION — DO NOT TRIGGER U1 if ANY are true:**
- Only ONE action is visible (no competing actions)
- The primary action is clearly MORE visually prominent (filled/solid background) than others (outlined/ghost)
- Action hierarchy cannot be evaluated due to incomplete visibility
- The issue relies on speculation ("if", "could", "might", "would")
- Cannot visually determine styling for BOTH actions in the screenshot

---

**NO SPECULATION RULE — ABSOLUTE:**
- If you cannot SEE both the primary and secondary actions in the screenshot → DO NOT emit U1
- If you cannot determine the styling difference from the visual → DO NOT emit U1
- If the primary button appears FILLED and secondary appears OUTLINED → that is CORRECT hierarchy, NOT a violation
- DO NOT use conditional language ("if", "could", "might", "would", "may") to justify a violation
- DO NOT speculate about buttons that might exist outside the visible area

---

**OUTPUT FORMAT (when evidence is complete):**
\`\`\`json
{
  "ruleId": "U1",
  "ruleName": "Unclear primary action",
  "category": "usability",
  "caseType": "A" | "B" | "C" | "D",
  "evidence": "[Specific visual observation for the triggered case - mention container, buttons, visual appearance]",
  "primaryAction": "[Button label and visual appearance]",
  "secondaryAction": "[Button label and visual appearance]" (if applicable),
  "stylingComparison": "[Explicit comparison of visual treatments observed]",
  "affectedContainer": "[CardFooter | DialogFooter | button group | action bar | etc.]",
  "diagnosis": "Users may struggle to identify the main action because [evidence-based reason]. [Explain visual hierarchy failure].",
  "contextualHint": "In [location], make '[primary action label]' the filled/prominent button and demote '[other actions]' to outline/ghost styling.",
  "confidence": 0.65-0.80
}
\`\`\`

---

**PASS-SILENCE POLICY — ABSOLUTE:**
U1 must produce output ONLY when a violation is detected. All other cases must be SILENT.

**EXPLICIT PASS CASES (DO NOT OUTPUT ANYTHING):**
1. **Single action present**: Only one button/action exists in an action group → PASS (no output)
2. **Utility action alone**: A single utility action (Clear, Reset, Refresh, Filter, Cancel) without competing actions → PASS (no output)
3. **Clear hierarchy exists**: Primary action is filled/solid AND secondary actions are outlined/ghost → PASS (no output)
4. **One dominant action**: Multiple actions exist but exactly one is visually dominant (filled/solid) → PASS (no output)
5. **No visual hierarchy issue**: Action styling is appropriate for context → PASS (no output)

**FORBIDDEN FOR PASS CASES:**
- DO NOT emit text explaining why something is acceptable
- DO NOT emit confidence scores for PASS cases
- DO NOT emit corrective prompts for PASS cases
- DO NOT emit contextual hints for PASS cases
- DO NOT include PASS cases in the violations array

**VIOLATION-ONLY OUTPUT:**
- Only emit U1 when one of Cases A, B, C, or D is TRIGGERED with complete evidence
- If none apply → produce NO OUTPUT for U1 (do not include in violations array)

---

**AGGREGATION:**
- Emit ONE aggregated U1 entry per run (only when violated)
- Reference only detected UI components or locations (not guideline text as component names)
- Use heuristic language ("may reduce clarity", "may increase cognitive load")
- Confidence: 65–80% depending on clarity of evidence

For EACH of the following rules, explicitly decide whether it is violated or not:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

Consider:
- Visual hierarchy and primary action clarity
- Typography consistency
- Color palette coherence
- Element grouping and alignment
- Feedback mechanisms
- Navigation clarity

## PASS 3 — Ethical & Dark Pattern Risks
Reason about potential manipulation or deceptive design:
- Visual emphasis that may nudge unintended choices
- Opt-out visibility and accessibility
- Urgency cues and their appropriateness
- Hierarchy suggesting mandatory vs optional actions

Ethics rules to check:
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## IMPORTANT CONSTRAINTS
- Even if no code-level violations are found, usability and ethical analysis MUST still be performed
- Absence of evidence does NOT imply absence of usability or ethical issues
- For each category, output triggered rules OR explicitly state "No violations detected after reasoning"
- Be thorough but avoid false positives - only report violations with clear evidence
${includesA1 ? '- For A1 (contrast): Use "confirmed" status when pixel sampling succeeds (solid backgrounds, uniform text regions). Use "potential" ONLY when sampling truly fails (gradients, images, overlays).' : ''}

## OUTPUT FORMAT (JSON)
For EACH violation, you MUST provide:
1. **diagnosis**: Detailed, evidence-based explanation of WHY the rule is violated. Reference UI elements conceptually (e.g., "success message", "filter chips", "primary button").
2. **contextualHint**: A short (1 sentence) high-level hint summarizing WHERE the issue appears and WHAT kind of adjustment is needed. Keep it descriptive, not implementation-level.
${includesA1 ? `3. For A1 only: Include "status": "confirmed" (pixel-sampled, solid backgrounds) or "potential" (complex backgrounds only), plus "evidence" describing what you observed.` : ''}

IMPORTANT CONSTRAINTS:
- Do NOT include file paths, class names, or code snippets in diagnosis or contextualHint
- Do NOT provide implementation-level fixes
- Keep contextualHint tool-agnostic and reusable across Bolt, Replit, and Lovable

If A1 is selected, you MUST ALSO include an additional top-level array **a1TextElements** for pixel sampling.

**CRITICAL: a1TextElements MUST include ALL visible text elements. NO EXCLUSIONS.**

## TEXT DETECTION OVERRIDE FOR A1 (MANDATORY)

The text detection pipeline MUST expose ALL visible text elements to A1 evaluation.
Do NOT filter out text based on:
- Font size (small text MUST be included)
- Font weight (light/thin text MUST be included)
- Bounding box size (tiny elements MUST be included)
- Visual prominence (muted/faded text MUST be included)
- Semantic role (metadata, labels, secondary text MUST be included)
- Color brightness or luminance (light-colored text MUST be included)
- Perceived importance (low-priority text MUST be included)

Any text visible to users that conveys information MUST be passed to A1 evaluation:
- Descriptions, summaries, body text
- Author names, usernames, handles
- Metadata, timestamps, dates
- Tags, labels, badges, chips
- Colored text (yellow, gray, blue, light colors)
- Small or muted text
- Placeholder text, helper text
- Footer text, copyright notices

Filtering rules that apply to other analyses (A2, A4, etc.) MUST NOT apply to A1.
If you can read it, it MUST be in a1TextElements.

## TEXT SIZE CLASSIFICATION FOR WCAG THRESHOLDS (CRITICAL)

You MUST classify each text element as "normal" or "large" to apply the correct WCAG threshold:

**LARGE TEXT (textSize: "large")** — uses 3:1 minimum contrast:
- Text height ≥ 18pt (~24px at 96dpi) for normal-weight text
- Text height ≥ 14pt (~18.7px at 96dpi) AND appears bold (heavier stroke weight)
- Visual indicators of large text:
  - Main headings (h1, h2, large titles)
  - Hero text, banner headlines
  - Bold section headers with significant height
  - Text that visually dominates as a major element

**NAVIGATION EXCEPTION — ALWAYS LARGE (regardless of font size):**
Top-level navigation items and primary menu links MUST be classified as "large" (3:1 threshold),
EVEN IF their font size is technically below 18pt. Apply this exception when:
- Text appears in a top navigation bar or header menu
- Text is a primary navigation link or menu item
- Text is in a sidebar main navigation section
- Text is a prominent tab label in a primary tab bar

Do NOT apply this exception if:
- The navigation text is visually comparable to body paragraph text (same size/weight)
- The text is a secondary link (footer links, breadcrumbs, utility links)

**NORMAL TEXT (textSize: "normal")** — uses 4.5:1 minimum contrast:
- All other text elements
- Body text, descriptions, paragraphs
- Labels, metadata, captions, badges
- Small headings (h3-h6) unless visually large
- Button text (unless it's a primary nav button)
- Muted or secondary text of standard size
- Footer links, breadcrumbs, utility navigation

**How to estimate from bounding box:**
- Compare bbox.h (normalized height) to the screenshot height
- If bbox.h * screenshotHeight >= ~24px → consider "large" if normal weight
- If bbox.h * screenshotHeight >= ~18.7px AND text appears bold → "large"
- If text is in top navigation/primary menu → classify as "large" (navigation exception)
- When uncertain about size, default to "normal" (conservative approach)
- When uncertain about navigation, check visual context (header position, menu styling)

## FOREGROUND SAMPLING VALIDATION (MANDATORY - v25.3)

Before computing any contrast ratio, the backend will validate that the sampled
foreground color truly represents the rendered text glyphs. The AI MUST NOT
guess or estimate contrast ratios — only identify candidate text regions.

**Foreground Sampling Rules (enforced by backend):**
1. Sample foreground colors ONLY from pixels strictly inside detected text glyph shapes.
   Do NOT sample from:
   - Container backgrounds
   - Padding areas
   - Borders
   - Shadows
   - Anti-aliased outer edges

2. If sampled foreground is visually similar to surrounding background
   (luminance difference < 10%), foreground sampling is treated as incorrect.

3. In such cases, the backend will re-sample using:
   - The lightest 20% of glyph pixels AND
   - The darkest 20% of glyph pixels
   The variant producing higher contrast ratio is selected.

4. If re-sampling yields a foreground color visually inconsistent with
   rendered text appearance (e.g., dark text reported where text appears light),
   the measurement is discarded.

**Classification Rules (backend enforcement):**
- CONFIRMED: Foreground AND background both confidently identified,
  contrast < threshold, sampled colors match visible appearance.
- POTENTIAL with FG_SAMPLING_UNRELIABLE: Foreground extraction fails after re-sampling.
- Never report confirmed violation for text that is visually high-contrast
  (e.g., light text on dark background appears correctly visible).

"a1TextElements": [
  {
    "screenshotIndex": 1,
    "bbox": { "x": 0.12, "y": 0.42, "w": 0.25, "h": 0.04 },
    "location": "Secondary label in a card header",
    "elementRole": "metadata" | "caption" | "badge" | "label" | "body text" | "heading" | "muted" | "colored",
    "elementDescription": "Short description text",
    "isSecondary": true,
    "textSize": "normal" | "large"
  }
]

**MANDATORY COVERAGE EXAMPLES (must include elements like these):**
- Gray/muted secondary text: Include with elementRole "muted" or "secondary"
- Colored price labels: Include with elementRole "colored" or "label"
- Badge/chip text: Include with elementRole "badge"
- Timestamp/metadata: Include with elementRole "metadata"
- Description paragraphs: Include with elementRole "body text" or "caption"
- Author names: Include with elementRole "metadata"

IMPORTANT:
- For A1, DO NOT guess colors or contrast ratios in the AI output. ONLY identify candidate text regions (bounding boxes) and context.
- Bounding box coordinates MUST be normalized fractions (0..1) relative to the screenshot size.
- The backend will compute contrast ratios from screenshot pixels using interior-stroke sampling.
- Include EVERY readable text element — the backend will determine pass/fail.

Respond with a JSON object in this exact structure:
{
  "violations": [
    {
      "ruleId": "A1",
      "ruleName": "Insufficient text contrast",
      "category": "accessibility",
      "status": "potential",
      "evidence": "Light gray descriptive text appears against a white background in the card components",
      "diagnosis": "The secondary text in card components may have insufficient contrast. The light gray color against the white background appears to fall below WCAG AA standards, though exact measurement requires code inspection.",
      "contextualHint": "Verify and increase contrast for secondary text in card components.",
      "confidence": 0.7
    },
    {
      "ruleId": "U1",
      "ruleName": "Unclear primary action",
      "category": "usability",
      "diagnosis": "Multiple buttons with similar visual weight compete for attention...",
      "contextualHint": "Establish clearer visual hierarchy between primary and secondary actions.",
      "confidence": 0.85
    }
  ],
  "a1TextElements": [],
  "passNotes": {
    "accessibility": "Summary of accessibility pass findings",
    "usability": "Summary of usability pass findings",
    "ethics": "Summary of ethics pass findings"
  }
}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================================
    // RESILIENT BODY READING (handles large payloads + connection issues)
    // ============================================================
    // The "error reading a body from connection" occurs when:
    // 1. Request body is very large (multiple screenshots = large base64)
    // 2. Connection times out or is interrupted during body read
    // 3. Client disconnects before server finishes reading
    //
    // Solution: Read body with explicit error handling and timeout awareness
    // ============================================================
    let requestBody: { images?: string[]; categories?: string[]; selectedRules?: string[]; inputType?: string; toolUsed?: string };
    
    try {
      // Read the raw text first to handle partial reads gracefully
      const bodyText = await req.text();
      
      if (!bodyText || bodyText.trim().length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "Empty request body received" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Parse the JSON
      try {
        requestBody = JSON.parse(bodyText);
      } catch (jsonError) {
        console.error("Failed to parse request body as JSON:", (jsonError as Error).message);
        console.error("Body length:", bodyText.length, "First 200 chars:", bodyText.substring(0, 200));
        return new Response(
          JSON.stringify({ success: false, error: "Invalid JSON in request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (bodyReadError) {
      // This catches the "error reading a body from connection" TypeError
      const errorMessage = (bodyReadError as Error).message || String(bodyReadError);
      console.error("Error reading request body:", errorMessage);
      
      // Return a clear error message that indicates the issue
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Request body could not be read. This may occur with large image payloads. Try reducing the number or size of screenshots, or retry the request."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const { images, categories = [], selectedRules = [], inputType, toolUsed = 'unknown' } = requestBody;

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No images provided for analysis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate selectedRules
    const selectedRulesSet = new Set(selectedRules);
    if (selectedRulesSet.size === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No rules selected for analysis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Selected rules for analysis: ${Array.from(selectedRulesSet).join(', ')}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`Starting 3-pass analysis for ${images.length} image(s)`);
    console.log(`Categories: ${categories.join(', ')}`);
    console.log(`Tool used: ${toolUsed}`);

    // Build the analysis prompt
    const systemPrompt = buildAnalysisPrompt(categories, selectedRules);

    // Prepare messages with images
    const imageContents = images.map((img: string) => ({
      type: "image_url",
      image_url: {
        url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
      },
    }));

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze the following UI screenshot(s) from a ${toolUsed} project. Perform the complete 3-pass analysis (Accessibility, Usability, Ethics) and return findings in the specified JSON format.`,
          },
          ...imageContents,
        ],
      },
    ];

    // Call the AI gateway with vision capabilities and automatic retry
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let responseText = "";
    let aiResponse: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`AI gateway call attempt ${attempt}/${MAX_RETRIES}`);
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro", // Using pro for better vision analysis
            messages,
            temperature: 0.3, // Lower temperature for more consistent analysis
            max_tokens: 16000, // Ensure sufficient tokens for complete response
          }),
        });

        if (!response.ok) {
          if (response.status === 429) {
            return new Response(
              JSON.stringify({ success: false, error: "Rate limit exceeded. Please try again later." }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (response.status === 402) {
            return new Response(
              JSON.stringify({ success: false, error: "Payment required. Please add credits to your workspace." }),
              { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const errorText = await response.text();
          console.error("AI gateway error:", response.status, errorText);
          throw new Error(`AI gateway error: ${response.status}`);
        }

        // Handle potentially truncated or empty AI response body
        responseText = await response.text();
        if (!responseText || responseText.trim().length === 0) {
          console.error(`AI gateway returned empty response body (attempt ${attempt})`);
          throw new Error("AI gateway returned empty response");
        }

        try {
          aiResponse = JSON.parse(responseText);
        } catch (jsonParseError) {
          console.error("Failed to parse AI gateway response:", responseText.substring(0, 500));
          console.error("Parse error:", jsonParseError);
          throw new Error("AI gateway returned invalid JSON");
        }

        const content = aiResponse.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("No content in AI response");
        }

        // Success - exit retry loop
        console.log(`AI response received on attempt ${attempt}, parsing...`);
        lastError = null;
        break;

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Attempt ${attempt} failed:`, lastError.message);
        
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError || !aiResponse) {
      throw new Error(lastError?.message || "AI gateway failed after all retries - please retry");
    }

    const content = aiResponse.choices?.[0]?.message?.content;
    const finishReason = aiResponse.choices?.[0]?.finish_reason;

    if (!content) {
      throw new Error("No content in AI response");
    }

    // Check if response was truncated due to token limits
    if (finishReason === 'length') {
      console.warn("AI response was truncated due to token limits, attempting to salvage partial response");
    }

    // Parse the JSON response from the AI with improved error handling
    let analysisResult;
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      let jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      // Clean up the JSON string
      jsonStr = jsonStr.trim();
      
      // If response appears truncated (ends mid-string or mid-object), try to repair
      if (!jsonStr.endsWith('}') && !jsonStr.endsWith(']')) {
        console.warn("JSON appears truncated, attempting repair...");
        
        // Find last complete object in violations array
        const lastCompleteMatch = jsonStr.match(/([\s\S]*"contextualHint"\s*:\s*"[^"]*"[^}]*})/);
        if (lastCompleteMatch) {
          jsonStr = lastCompleteMatch[1];
          
          // Count remaining open structures
          const openBraces = (jsonStr.match(/{/g) || []).length;
          const closeBraces = (jsonStr.match(/}/g) || []).length;
          const openBrackets = (jsonStr.match(/\[/g) || []).length;
          const closeBrackets = (jsonStr.match(/\]/g) || []).length;
          
          // Close violations array if needed
          if (openBrackets > closeBrackets) {
            jsonStr += ']';
          }
          // Add empty passNotes and close root object
          if (!jsonStr.includes('"passNotes"')) {
            jsonStr += ', "passNotes": {}';
          }
          if (openBraces > closeBraces) {
            jsonStr += '}';
          }
        } else {
          // Fallback: return empty result if we can't salvage
          console.error("Could not salvage truncated response, returning empty result");
          analysisResult = { violations: [], passNotes: {} };
        }
      }
      
      if (!analysisResult) {
        analysisResult = JSON.parse(jsonStr);
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      
      // Final fallback: return empty violations with error note
      console.warn("Using fallback empty result due to parse failure");
      analysisResult = { 
        violations: [], 
        passNotes: { 
          _error: "AI response parsing failed - please retry analysis" 
        } 
      };
    }

    // Enhance violations with corrective prompts from our rule registry
    // Also ensure A1 violations from screenshots are marked as "potential"
    // Separate A2 violations for aggregation, filter out invalid A5 cases
    
    const allRulesForViolations = [...rules.accessibility, ...rules.usability, ...rules.ethics];
    
    // CRITICAL: Filter violations to ONLY include selected rules
    // This ensures unselected rules are never reported, even if AI returns them
    const shouldComputeA1FromPixels = inputType === 'screenshots' && selectedRulesSet.has('A1');

    // Compute screenshot-only A1 via pixel sampling (anti-alias resistant)
    let computedA1Violations: any[] = [];
    if (shouldComputeA1FromPixels) {
      const candidates = Array.isArray((analysisResult as any).a1TextElements)
        ? ((analysisResult as any).a1TextElements as A1TextElement[])
        : [];
      try {
        computedA1Violations = await computeA1ViolationsFromScreenshots(images, candidates, toolUsed);
      } catch (e) {
        console.error('A1 pixel sampling failed:', e);
        computedA1Violations = [
          {
            ruleId: 'A1',
            ruleName: 'Insufficient text contrast',
            category: 'accessibility',
            status: 'potential',
            samplingMethod: 'inferred',
            inputType: 'screenshots',
            evidence: 'A1 pixel sampling failed to run for the provided screenshot(s).',
            diagnosis: 'Contrast could not be computed due to a runtime error in pixel sampling.',
            contextualHint: 'Retry with PNG screenshots at 100% zoom, or verify with DevTools/axe.',
            confidence: 0.55,
            potentialRiskReason: 'Pixel sampling runtime error',
            advisoryGuidance: 'Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement.',
          },
        ];
      }
    }

    const filteredBySelection = (analysisResult.violations || []).filter((v: any) => {
      const isSelected = selectedRulesSet.has(v.ruleId);
      if (!isSelected) {
        console.log(`Filtering out violation for unselected rule: ${v.ruleId}`);
      }
      // For screenshot-based A1, we ignore any AI-provided A1 and use pixel sampling instead.
      if (shouldComputeA1FromPixels && v.ruleId === 'A1') return false;
      return isSelected;
    });
    
    console.log(`Filtered ${(analysisResult.violations || []).length - filteredBySelection.length} violations from unselected rules`);
    
    // Separate A1, A2, A4, and A5 violations for aggregation (only from selected rules)
    const a1Violations: any[] = [];
    const a2Violations: any[] = [];
    const a4Violations: any[] = [];
    const a5Violations: any[] = [];
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A1') {
        a1Violations.push(v);
      } else if (v.ruleId === 'A2') {
        a2Violations.push(v);
      } else if (v.ruleId === 'A4') {
        a4Violations.push(v);
      } else if (v.ruleId === 'A5') {
        a5Violations.push(v);
      } else {
        otherViolations.push(v);
      }
    });

    if (shouldComputeA1FromPixels) {
      a1Violations.push(...computedA1Violations);
    }
    
    // ========== U1 EVIDENCE GATING (Cases A, B, C, D) ==========
    // Filter out speculative U1 violations that lack proper evidence
    // Supports 4 cases: A (equal emphasis), B (competing primaries), C (hidden affordance), D (de-emphasized primary)
    const u1Violations: any[] = [];
    const nonU1OtherViolations: any[] = [];
    
    otherViolations.forEach((v: any) => {
      if (v.ruleId === 'U1') {
        u1Violations.push(v);
      } else {
        nonU1OtherViolations.push(v);
      }
    });
    
    // Validate U1 violations with strict evidence requirements for all 4 cases
    // PASS-SILENCE POLICY: Only true violations pass through; all PASS cases are silently filtered
    const validatedU1Violations = u1Violations.filter((v: any) => {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const contextualHint = (v.contextualHint || '').toLowerCase();
      const caseType = (v.caseType || '').toUpperCase();
      const combined = evidence + ' ' + diagnosis + ' ' + contextualHint;
      
      // ========== PASS CASE SUPPRESSION ==========
      // Filter out any PASS explanations or non-violation outputs
      
      // PASS FILTER 1: Explicit PASS language or explanatory non-violation text
      const isPassExplanation = /(?:is\s+)?(?:appropriate|acceptable|correct|clear|proper|adequate|sufficient)|hierarchy\s+is\s+(?:clear|correct|appropriate)|no\s+(?:issue|violation|problem)|pass(?:es)?|not\s+a\s+(?:concern|issue|violation)|(?:single|lone)\s+(?:action|button)\s+(?:is|does)|utility\s+(?:action|button)\s+(?:is|does)|correctly\s+(?:styled|emphasized)|proper\s+(?:hierarchy|emphasis)/.test(combined);
      if (isPassExplanation) {
        console.log(`U1: Filtering out PASS explanation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // PASS FILTER 2: Single action contexts (no competing actions)
      const mentionsSingleAction = /(?:only|single|lone|one)\s+(?:action|button|cta)|no\s+(?:other|competing|secondary)\s+(?:action|button)|standalone\s+(?:action|button)/.test(combined);
      const noMultipleActions = !/(?:two|both|multiple|several|2|3)\s+(?:action|button)|(?:action|button)s?\s+(?:and|,)/.test(combined);
      if (mentionsSingleAction || (noMultipleActions && !/equal|competing|same|identical|no.*clear|multiple|both/.test(combined))) {
        // Check if this is truly describing a single action scenario
        const buttonCount = (combined.match(/\bbutton/g) || []).length;
        const actionCount = (combined.match(/\baction/g) || []).length;
        if (buttonCount <= 1 && actionCount <= 1) {
          console.log(`U1: Filtering out single action context (PASS): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
      }
      
      // PASS FILTER 3: Utility action alone without competing primary
      const isUtilityActionAlone = /(?:clear|reset|refresh|filter|cancel|dismiss|close)\s+(?:all\s+)?(?:button|action|filter).*(?:alone|only|single|standalone)|only\s+(?:a\s+)?(?:clear|reset|refresh|filter)\s+(?:button|action)/.test(combined);
      if (isUtilityActionAlone) {
        console.log(`U1: Filtering out utility action alone (PASS): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // PASS FILTER 4: Clear hierarchy stated (primary filled, secondary outlined)
      const statesCorrectHierarchy = /primary\s+(?:is|appears?)\s+(?:filled|solid|prominent).*secondary\s+(?:is|appears?)\s+(?:outlined?|ghost)|(?:submit|confirm|save).*filled.*(?:cancel|dismiss).*(?:outlined?|ghost)|clear\s+(?:visual\s+)?hierarchy|(?:filled|solid)\s+primary.*(?:outlined?|ghost)\s+secondary/.test(combined);
      if (statesCorrectHierarchy && !/equal|competing|same|identical|no.*clear|multiple.*filled/.test(combined)) {
        console.log(`U1: Filtering out correct hierarchy description (PASS): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // ========== SPECULATIVE LANGUAGE FILTER ==========
      // FILTER: Speculative language indicates incomplete evidence (applies to ALL cases)
      const hasSpeculativeLanguage = /\bif\b.*\b(also|uses?|were?|is)\b|\bcould\b|\bmight\b|\bwould\b|\bmay\b(?!\s+struggle)|\bpossibly\b|\bpotentially\b|\bassuming\b|\bif the\b/.test(combined);
      if (hasSpeculativeLanguage) {
        console.log(`U1: Filtering out speculative violation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // ========== CASE A: Equal emphasis between primary and secondary ==========
      const isCaseA = caseType === 'A' || /equal.*emphasis|identical|same.*styl|both.*outline|both.*ghost|both.*filled|no.*distinction|equal.*weight/.test(combined);
      
      if (isCaseA) {
        // Must mention at least two distinct actions/buttons
        const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
        const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
        if (!hasTwoActions && !mentionsMultipleButtons) {
          console.log(`U1 Case A: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must identify visual styling comparison
        const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|filled|identical|equal.*emphasis|similar.*appearance|same.*styl|no.*distinction|equal.*weight|visual.*weight/.test(combined);
        if (!hasStylingEvidence) {
          console.log(`U1 Case A: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Check for false positives: primary is filled AND secondary is outline/ghost → PASS
        const primaryIsFilled = /(?:submit|primary|confirm|save|create|send|continue).*(?:filled|solid|prominent|dark|colored|bg-)/.test(combined) ||
                                /primary.*(?:filled|solid|prominent)/.test(combined);
        const secondaryIsOutlined = /(?:cancel|secondary|dismiss|close).*(?:outline|ghost|transparent|border)/.test(combined) ||
                                    /secondary.*(?:outline|ghost)/.test(combined);
        
        if (primaryIsFilled && secondaryIsOutlined) {
          console.log(`U1 Case A: Filtering out - correct hierarchy (primary=filled, secondary=outlined): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must explicitly state BOTH buttons appear similar
        const claimsEqualEmphasis = /equal.*emphasis|identical|same.*styl|both.*outline|both.*ghost|both.*filled|no.*distinction|equal.*weight/.test(combined);
        const explicitlyBothSimilar = /both.*(?:appear|look|are|use).*(?:outline|ghost|filled|identical|same)|neither.*(?:filled|prominent)|no.*visual.*distinction/.test(combined);
        
        if (claimsEqualEmphasis && !explicitlyBothSimilar) {
          console.log(`U1 Case A: Filtering out - claims equal emphasis without explicit comparison: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case A: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE B: Multiple competing primary actions ==========
      // Expanded to detect competing primaries in Card footers, action bars, button groups
      // Key patterns: multiple filled buttons, card/footer context, multiple action labels
      // CRITICAL: For shadcn Button - when variant prop is omitted, defaults to variant="default" (filled/high emphasis)
      const isCaseB = caseType === 'B' || 
        /(?:two|2|multiple|both|all).*(?:filled|primary|high.*emphasis)/.test(combined) ||
        /competing.*(?:primary|action)/.test(combined) ||
        /all.*(?:filled|prominent)/.test(combined) ||
        /no.*(?:clear|single).*(?:primary|dominant|hierarchy)/.test(combined) ||
        /equally.*(?:emphasized|prominent)/.test(combined) ||
        /same.*(?:emphasis|prominence|visual)/.test(combined) ||
        /multiple.*equally/.test(combined) ||
        /identical.*(?:visual|prominence|weight|styling)/.test(combined) ||
        // Card/footer context with action labels
        /(?:card|footer|cardfooter|cardactions|action\s*(?:bar|area|group)).*(?:save|share|apply|submit|publish)/.test(combined) ||
        // Multiple action labels together
        /(?:save|share|apply).*(?:and|,|\/)\s*(?:save|share|apply|submit|publish)/.test(combined) ||
        // ProposalCard or similar card components with multiple actions
        /(?:proposal|settings|edit|detail).*(?:card|panel|section).*(?:save|share|apply|submit)/.test(combined);
      
      if (isCaseB) {
        // Must evidence 2+ actions or buttons (>=2 is enough to trigger)
        const hasTwoOrMore = /two|2|both|multiple|all.*button|several|three|3/.test(combined);
        const buttonCount = (combined.match(/\bbutton/g) || []).length;
        const ctaCount = (combined.match(/\bcta/g) || []).length;
        // Expanded action label detection
        const actionLabels = (combined.match(/\b(save|share|apply|submit|publish|send|create|confirm|delete|remove|draft|update|export|download)\b/g) || []);
        const uniqueActionLabels = new Set(actionLabels);
        
        // Count action mentions even without explicit "button" word
        const hasMultipleActionMentions = uniqueActionLabels.size >= 2;
        
        if (!hasTwoOrMore && buttonCount < 2 && ctaCount < 2 && !hasMultipleActionMentions) {
          console.log(`U1 Case B: Filtering out - does not evidence 2+ actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Evidence for high emphasis: filled/solid styling (visual inspection for screenshots)
        // CRITICAL: For vision analysis, look for buttons that appear equally styled/prominent
        const hasMultipleHighEmphasis = 
          // Explicit multiple high-emphasis mentions
          /(?:both|two|2|all|multiple|three|3).*(?:filled|primary|solid|prominent|dark|colored|high.*emphasis)/.test(combined) ||
          // Multiple filled patterns
          /(?:filled|primary|solid).*(?:and|,|\/)\s*(?:filled|primary|solid)/.test(combined) ||
          // No clear/single primary
          /no.*(?:single|clear).*(?:dominant|primary|hierarchy)/.test(combined) ||
          // Equal emphasis
          /equally.*(?:emphasized|prominent|styled|weighted)/.test(combined) ||
          /same.*(?:emphasis|prominence|styling|visual|weight|color|background)/.test(combined) ||
          /multiple.*equally/.test(combined) ||
          // All appear as filled/solid
          /all\s+(?:three|two|2|3|\d+)?\s*(?:buttons?|ctas?|actions?)\s*(?:appear|look|are|have)/.test(combined) ||
          /(?:buttons?|ctas?)\s+all\s+(?:appear|look|are)/.test(combined) ||
          // Identical visual treatment
          /identical.*(?:styling|visual|weight|prominence|appearance|color)/.test(combined) ||
          // No visually distinguished
          /no.*(?:visually?\s+)?(?:distinguished|dominant|clear\s+primary)/.test(combined) ||
          // Equal visual weight/prominence
          /equal\s+(?:visual\s+)?(?:weight|prominence|emphasis)/.test(combined);
        
        // Also check for card action group context with multiple action labels
        const isCardActionContext = 
          /(?:card|cardfooter|cardactions|footer|action\s*(?:bar|area|group)|button\s*(?:group|row))/.test(combined);
        
        // If we have card context + multiple action labels, that's strong evidence for Case B
        const cardWithMultipleActions = isCardActionContext && hasMultipleActionMentions;
        
        if (!hasMultipleHighEmphasis && !cardWithMultipleActions) {
          console.log(`U1 Case B: Filtering out - no evidence of multiple high-emphasis actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // FALSE POSITIVE CHECK: If exactly one action is clearly dominant with demoted others, this is NOT Case B
        const singlePrimaryExists = /(?:single|one|only).*(?:primary|filled|prominent)/.test(combined) && 
                                    !/no.*(?:single|clear)|(?:two|both|multiple)/.test(combined);
        const othersAreDemoted = /(?:other|rest|remaining).*(?:outline|ghost|secondary|demoted)/.test(combined);
        if (singlePrimaryExists && othersAreDemoted) {
          console.log(`U1 Case B: Filtering out - single primary action exists with demoted others (correct hierarchy): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Check for false positive: actions are clearly separated by context (header vs footer)
        const separatedByContext = /(?:header|top).*(?:footer|bottom)|one\s+in\s+(?:header|top).*one\s+in\s+(?:footer|bottom)/.test(combined);
        if (separatedByContext) {
          console.log(`U1 Case B: Filtering out - actions separated by context (header/footer): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case B: Valid violation - multiple equally emphasized actions: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE C: Hidden affordance in default state ==========
      const isCaseC = caseType === 'C' || /hidden.*affordance|no.*visible.*(?:background|border|styling)|plain.*text|lacks.*button.*styling|discover.*click/.test(combined);
      
      if (isCaseC) {
        // Must evidence lack of button affordance
        const hasHiddenAffordanceEvidence = /no.*(?:background|border|shadow)|text.*only|plain.*text|link.*style|minimal.*styling|lacks.*affordance|not.*visible|no.*button.*styling/.test(combined);
        if (!hasHiddenAffordanceEvidence) {
          console.log(`U1 Case C: Filtering out - no evidence of hidden affordance: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must identify the element as a primary/important action
        const isPrimaryAction = /(?:submit|confirm|save|create|send|primary|important|main).*(?:action|button)/.test(combined);
        if (!isPrimaryAction) {
          console.log(`U1 Case C: Filtering out - element not identified as primary action: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case C: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE D: Primary action visually de-emphasized ==========
      const isCaseD = caseType === 'D' || /primary.*(?:outline|ghost|less.*prominent)|secondary.*(?:more|higher).*(?:prominent|emphasis)|inverted.*hierarchy/.test(combined);
      
      if (isCaseD) {
        // Must evidence primary has low emphasis
        const primaryLowEmphasis = /(?:submit|confirm|save|primary).*(?:outline|ghost|text|de-emphasis|less.*prominent)|primary.*(?:appears?|looks?).*(?:outline|ghost|secondary)/.test(combined);
        if (!primaryLowEmphasis) {
          console.log(`U1 Case D: Filtering out - no evidence of primary de-emphasis: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must evidence secondary has higher emphasis
        const secondaryHighEmphasis = /(?:cancel|secondary|dismiss).*(?:filled|solid|more.*prominent|higher.*emphasis)|secondary.*(?:appears?|looks?).*(?:filled|primary|prominent)/.test(combined);
        if (!secondaryHighEmphasis) {
          console.log(`U1 Case D: Filtering out - no evidence of secondary having higher emphasis: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case D: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== Fallback: Generic U1 validation for untagged cases ==========
      // Must mention at least two distinct actions/buttons
      const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
      const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
      if (!hasTwoActions && !mentionsMultipleButtons) {
        console.log(`U1: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Must identify styling comparison
      const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|filled|identical|equal.*emphasis|similar.*appearance|same.*styl|no.*distinction|equal.*weight|visual.*weight/.test(combined);
      if (!hasStylingEvidence) {
        console.log(`U1: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Check for false positives
      const primaryIsFilled = /(?:submit|primary|confirm|save|create|send|continue).*(?:filled|solid|prominent|dark|colored|bg-)/.test(combined) ||
                              /primary.*(?:filled|solid|prominent)/.test(combined);
      const secondaryIsOutlined = /(?:cancel|secondary|dismiss|close).*(?:outline|ghost|transparent|border)/.test(combined) ||
                                  /secondary.*(?:outline|ghost)/.test(combined);
      
      if (primaryIsFilled && secondaryIsOutlined) {
        console.log(`U1: Filtering out - correct hierarchy (primary=filled, secondary=outlined): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      console.log(`U1: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
      return true;
    });
    
    if (u1Violations.length > 0 && validatedU1Violations.length === 0) {
      console.log(`U1: No valid violations found (${u1Violations.length} filtered out as speculative or lacking evidence)`);
    }
    
    // Process non-A1/A2/A4/A5/U1 violations
    const filteredOtherViolations = [...nonU1OtherViolations, ...validatedU1Violations]
      .map((v: any) => {
        const rule = allRulesForViolations.find(r => r.id === v.ruleId);
        
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
        };
      });

    // ========== A1 AGGREGATION LOGIC (Screenshot Analysis - PER-ELEMENT DETERMINISTIC) ==========
    // For screenshots: A1 evaluates EACH text element INDIVIDUALLY:
    // - Confirmed Violation: ratio clearly < threshold (< 4.3:1 for normal text)
    // - Borderline Contrast: ratio near threshold (4.3:1 to 4.5:1) - reduced confidence
    // - Pass: ratio meets threshold (DO NOT include in violations)
    // - Potential Risk: ONLY when measurement is genuinely impossible
    interface A1AffectedItemUI {
      screenshotIndex?: number; // Which screenshot (1-based)
      location: string; // UI region description
      componentName?: string; // Component if identifiable
      elementRole?: string; // Semantic role: caption, badge, metadata, heading, etc.
      elementDescription?: string; // What type of text element
      foregroundHex?: string; // Sampled foreground color (REQUIRED for confirmed)
      backgroundHex?: string; // Sampled background color (REQUIRED for confirmed)
      contrastRatio?: number; // Computed contrast ratio (REQUIRED for confirmed)
      thresholdUsed?: number; // 4.5 or 3.0 based on text size
      potentialRiskReason?: string; // Why ratio couldn't be computed (for potential only)
      riskLevel: 'high' | 'medium' | 'low';
      status: 'confirmed' | 'borderline' | 'potential'; // Per-element classification
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a1DedupeMapUI = new Map<string, A1AffectedItemUI>();
    
    for (const v of a1Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // Extract screenshot index if mentioned
      const screenshotMatch = (v.evidence || '').match(/screenshot\s*#?(\d+)/i);
      const screenshotIndex = screenshotMatch ? parseInt(screenshotMatch[1], 10) : undefined;
      
      // Extract location from evidence
      const locationMatch = (v.evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|button|navigation|content|page|screen|badge|text|label|metadata)?)/i);
      const location = locationMatch?.[1]?.trim() || v.evidence || v.contextualHint || 'UI element';
      
      // Extract component name if mentioned (PascalCase)
      const componentMatch = (v.evidence || '').match(/\b([A-Z][a-zA-Z0-9]*(?:Card|Button|Dialog|Modal|Form|Header|Footer|Nav|Sidebar|Panel|Badge|Label|Text|Description)?)\b/);
      const componentName = componentMatch?.[1] && componentMatch[1].length > 3 ? componentMatch[1] : undefined;
      
      // Extract element role for per-element reporting
      const elementRole = v.elementRole || 
        (/badge/i.test(combined) ? 'badge' :
         /caption/i.test(combined) ? 'caption' :
         /metadata|date|time|credit/i.test(combined) ? 'metadata' :
         /heading|title/i.test(combined) ? 'heading' :
         /button|cta/i.test(combined) ? 'button label' :
         /body|paragraph/i.test(combined) ? 'body text' :
         /label/i.test(combined) ? 'label' :
         'text element');
      
      // Parse contrastRatio as number if it's a string
      let contrastRatio: number | undefined = undefined;
      if (v.contrastRatio !== undefined) {
        contrastRatio = typeof v.contrastRatio === 'string' 
          ? parseFloat(v.contrastRatio.replace(':1', '').trim())
          : v.contrastRatio;
      }
      
      // Determine threshold based on text size
      const threshold = v.thresholdUsed || 4.5;
      const borderlineThreshold = threshold === 4.5 ? 4.3 : 2.7; // ~95% of threshold for borderline zone
      
      // PER-ELEMENT STATUS CLASSIFICATION:
      // 1. If ratio >= threshold → PASS (exclude from violations entirely)
      // 2. If ratio between borderlineThreshold and threshold → BORDERLINE (near-threshold, reduced confidence)
      // 3. If ratio < borderlineThreshold → CONFIRMED VIOLATION
      // 4. If measurement impossible → POTENTIAL
      let status: 'confirmed' | 'borderline' | 'potential' = 'confirmed';
      let potentialRiskReason: string | undefined = undefined;
      
      // First check if element PASSES (meets threshold) - EXCLUDE from violations
      if (contrastRatio !== undefined && contrastRatio >= threshold) {
        console.log(`A1 PASS: ${v.evidence || 'element'} has ratio ${contrastRatio}:1 >= ${threshold}:1 threshold`);
        continue; // Skip this element - it passes WCAG AA
      }
      
      // Check for borderline vs confirmed violation
      if (v.status === 'potential' && v.potentialRiskReason) {
        // Legitimate potential risk - measurement genuinely impossible
        status = 'potential';
        potentialRiskReason = v.potentialRiskReason;
      } else if (v.status === 'borderline' || 
                 (contrastRatio !== undefined && contrastRatio >= borderlineThreshold && contrastRatio < threshold)) {
        // Borderline contrast - near threshold (4.3-4.5:1 zone for normal text)
        status = 'borderline';
      } else if (contrastRatio !== undefined && v.foregroundHex && v.backgroundHex) {
        // Clear violation with computed data
        status = 'confirmed';
      } else if (/gradient|image|overlay|transparent|non-uniform|cannot sample|cannot compute/.test(combined)) {
        // LLM indicated measurement is impossible
        status = 'potential';
        potentialRiskReason = 'Background complexity prevents stable contrast measurement';
      } else {
        // Default to confirmed for screenshot input
        status = 'confirmed';
      }
      
      // Determine risk level based on contrast ratio or description
      let riskLevel: 'high' | 'medium' | 'low' = v.riskLevel || 'medium';
      if (contrastRatio !== undefined) {
        // Risk level based on how far below threshold
        const threshold = v.thresholdUsed || 4.5;
        if (contrastRatio < threshold * 0.5) riskLevel = 'high'; // Less than 50% of threshold
        else if (contrastRatio < threshold * 0.75) riskLevel = 'medium'; // 50-75% of threshold
        else riskLevel = 'low'; // Close to threshold
      } else if (!v.riskLevel) {
        // Infer from description for potential risks
        if (/very light|very faint|barely visible|hard to read|extremely light/.test(combined)) {
          riskLevel = 'high';
        } else if (/light gray|faint|low contrast/.test(combined)) {
          riskLevel = 'medium';
        }
      }
      
      // CONFIDENCE BASED ON STATUS AND DATA QUALITY:
      // - Confirmed (ratio < 4.3:1) with full data: 0.88-0.95
      // - Confirmed without full data: 0.80-0.88
      // - Borderline (ratio 4.3-4.5:1): 0.65-0.75 (reduced due to threshold proximity)
      // - Potential (measurement impossible): 0.50-0.70
      let confidence = v.confidence || 0.55;
      if (status === 'confirmed') {
        if (contrastRatio !== undefined && v.foregroundHex && v.backgroundHex) {
          // Full data available → high confidence
          confidence = Math.min(Math.max(confidence, 0.88), 0.95);
        } else {
          // Confirmed but missing some data
          confidence = Math.min(Math.max(confidence, 0.80), 0.88);
        }
      } else if (status === 'borderline') {
        // Borderline contrast - reduced confidence due to threshold proximity
        confidence = Math.min(Math.max(confidence, 0.65), 0.75);
      } else {
        // Potential risk - measurement was impossible
        confidence = Math.min(Math.max(confidence, 0.50), 0.70);
      }
      
      // Build rationale based on status and available data
      let rationale = v.diagnosis || '';
      if (!rationale) {
        const thresholdVal = v.thresholdUsed || 4.5;
        const colorInfo = v.foregroundHex && v.backgroundHex 
          ? ` (${v.foregroundHex} on ${v.backgroundHex})`
          : '';
        
        if (status === 'confirmed') {
          const ratioInfo = contrastRatio !== undefined
            ? ` has ${contrastRatio}:1 contrast, failing WCAG AA minimum of ${thresholdVal}:1.`
            : ' fails to meet WCAG AA contrast requirements.';
          rationale = `${v.elementDescription || elementRole || `Text in ${location}`}${colorInfo}${ratioInfo}`;
        } else if (status === 'borderline') {
          rationale = `${v.elementDescription || elementRole || `Text in ${location}`}${colorInfo} has ${contrastRatio}:1 contrast—borderline near WCAG AA ${thresholdVal}:1 threshold.`;
        } else {
          rationale = `Text in ${location} cannot be measured for contrast due to ${potentialRiskReason || 'background complexity'}. Manual verification recommended.`;
        }
      }
      
      // Deduplication key - include contrastRatio in key for precise deduping
      const dedupeKey = `${screenshotIndex || 0}|${location}|${contrastRatio || 'unknown'}`;
      
      if (a1DedupeMapUI.has(dedupeKey)) {
        const existing = a1DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
        // Upgrade to confirmed if any finding in same location is confirmed
        if (status === 'confirmed') {
          existing.status = 'confirmed';
        }
      } else {
        const item: A1AffectedItemUI = {
          screenshotIndex,
          location,
          componentName,
          elementRole,
          elementDescription: v.elementDescription,
          foregroundHex: v.foregroundHex,
          backgroundHex: v.backgroundHex,
          contrastRatio: contrastRatio,
          thresholdUsed: v.thresholdUsed,
          potentialRiskReason: potentialRiskReason,
          riskLevel,
          status,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a1DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a1AffectedItemsUI = Array.from(a1DedupeMapUI.values());
    
    // ========== A1 ELEMENT-LEVEL REPORTING (NO AGGREGATION) ==========
    // Per authoritative A1 rule: NEVER aggregate A1 findings into a single message.
    // Always report per element with explicit reason codes for potential findings.
    
    const perElementA1Violations: any[] = [];
    
    for (const item of a1AffectedItemsUI) {
      // Build element identifier
      const elementIdentifier = `Screenshot #${item.screenshotIndex || 1}${item.location ? ` — ${item.location}` : ''}${item.elementDescription ? ` (${item.elementDescription})` : ''}`;
      
      // Build reason codes for potential findings (MANDATORY per A1 rule)
      const reasonCodes: string[] = [];
      if (item.status === 'potential' || item.status === 'borderline') {
        if (item.potentialRiskReason) {
          // Parse reason from potentialRiskReason
          const reason = item.potentialRiskReason.toLowerCase();
          if (reason.includes('mixed') || reason.includes('multiple')) reasonCodes.push('BG_MIXED');
          if (reason.includes('gradient')) reasonCodes.push('BG_GRADIENT');
          if (reason.includes('image') || reason.includes('texture')) reasonCodes.push('BG_IMAGE');
          if (reason.includes('overlay') || reason.includes('transparent')) reasonCodes.push('BG_OVERLAY');
          if (reason.includes('insufficient') || reason.includes('small region')) reasonCodes.push('BG_TOO_SMALL_REGION');
          if (reason.includes('anti-alias') || reason.includes('unstable')) reasonCodes.push('FG_ANTIALIASING');
          if (reason.includes('ambiguity') || reason.includes('enclosed')) reasonCodes.push('FG_BG_AMBIGUITY');
        }
        if (item.confidence < 0.75) reasonCodes.push('LOW_CONFIDENCE');
        // Ensure at least one reason code
        if (reasonCodes.length === 0) reasonCodes.push('LOW_CONFIDENCE');
      }
      
      // Determine background status
      const backgroundStatus: 'certain' | 'uncertain' | 'unmeasurable' = 
        item.status === 'confirmed' ? 'certain' :
        item.contrastRatio !== undefined ? 'uncertain' : 'unmeasurable';
      
      // Build diagnosis per element
      const diagnosis = (() => {
        if (item.status === 'confirmed') {
          return `Text contrast ${item.contrastRatio}:1 is below WCAG AA minimum ${item.thresholdUsed || 4.5}:1. ` +
                 `Foreground ${item.foregroundHex || 'unknown'} on background ${item.backgroundHex || 'unknown'}.`;
        }
        if (item.status === 'potential') {
          const reasons = reasonCodes.map(code => {
            switch (code) {
              case 'BG_MIXED': return 'multiple background colors detected';
              case 'BG_GRADIENT': return 'gradient background';
              case 'BG_IMAGE': return 'image or textured background';
              case 'BG_OVERLAY': return 'transparency or overlay suspected';
              case 'BG_TOO_SMALL_REGION': return 'insufficient background pixels';
              case 'FG_ANTIALIASING': return 'glyph sampling unstable';
              case 'FG_BG_AMBIGUITY': return 'foreground/background ambiguity in enclosed component';
              case 'LOW_CONFIDENCE': return 'combined confidence below threshold';
              default: return code;
            }
          }).join(', ');
          return `Potential contrast issue: ${reasons}. ` +
                 (item.contrastRatio !== undefined 
                   ? `Estimated ratio ${item.contrastRatio}:1 requires verification.`
                   : 'Contrast could not be measured.');
        }
        // borderline
        return `Contrast ratio ${item.contrastRatio}:1 is near WCAG AA threshold ${item.thresholdUsed || 4.5}:1.`;
      })();
      
      // Actionable guidance per element
      const actionableGuidance = item.status === 'confirmed'
        ? `Increase contrast to at least ${item.thresholdUsed || 4.5}:1 by darkening text or lightening background.`
        : item.status === 'potential'
          ? `Verify contrast with browser DevTools. If ratio < ${item.thresholdUsed || 4.5}:1, adjust colors.`
          : `Consider increasing contrast slightly above ${item.thresholdUsed || 4.5}:1 for safety margin.`;
      
      // ============================================================
      // ELEMENT-SPECIFIC CORRECTIVE PROMPT (CONFIRMED A1 ONLY)
      // ============================================================
      // Format:
      //   Corrective Prompt — A1: Insufficient Text Contrast
      //   [Element type] '[Text content]' ([Location / UI group])
      //   Issue reason: [Measured contrast] vs [Required threshold]
      //   Recommended fix: [Specific design change applied consistently to this UI group]
      // ============================================================
      const correctivePrompt = (() => {
        if (item.status !== 'confirmed') {
          return ''; // No corrective prompt for potential/borderline
        }
        
        // Determine element type from role or description
        const elementType = item.elementRole || 'text element';
        
        // Extract text content hint from element description or location
        const textContent = item.elementDescription || item.location || 'element';
        
        // Determine UI group/location context
        const uiGroup = item.location || 'UI section';
        
        // Build issue reason with measured contrast vs threshold
        const threshold = item.thresholdUsed || 4.5;
        const issueReason = item.contrastRatio !== undefined
          ? `${item.contrastRatio.toFixed(1)}:1 measured vs ${threshold}:1 required (WCAG AA)`
          : `Contrast below ${threshold}:1 required (WCAG AA)`;
        
        // Build recommended fix that applies to UI group
        const colorContext = item.foregroundHex && item.backgroundHex
          ? ` (currently ${item.foregroundHex} on ${item.backgroundHex})`
          : '';
        const recommendedFix = `Increase text contrast for all ${elementType} elements in this group${colorContext} by darkening the text color, lightening the background, or applying a higher-contrast design token so that all similar elements consistently meet WCAG 2.1 AA (≥ ${threshold}:1).`;
        
        return `${elementType} '${textContent}' (${uiGroup})\n\nIssue reason: ${issueReason}\n\nRecommended fix: ${recommendedFix}`;
      })();
      
      // Build per-element violation
      perElementA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: item.status,
        inputType: 'screenshots',
        samplingMethod: 'pixel',
        // Element identification (required per A1 rule)
        elementIdentifier,
        elementDescription: item.elementDescription,
        elementRole: item.elementRole,
        componentName: item.componentName,
        screenshotIndex: item.screenshotIndex,
        location: item.location,
        // Foreground color data
        foregroundHex: item.foregroundHex,
        foregroundConfidence: item.confidence, // Use overall confidence as foreground confidence
        // Background color data
        backgroundHex: item.backgroundHex,
        backgroundStatus,
        // Contrast data
        contrastRatio: item.contrastRatio,
        thresholdUsed: item.thresholdUsed || 4.5,
        // Reason codes for potential findings (MANDATORY per A1 rule)
        reasonCodes: reasonCodes.length > 0 ? reasonCodes : undefined,
        potentialRiskReason: item.potentialRiskReason,
        // Diagnosis and guidance
        diagnosis,
        contextualHint: item.status === 'potential' 
          ? 'Verify contrast with browser DevTools or accessibility testing tools.'
          : 'Increase text/background contrast for this element.',
        actionableGuidance,
        correctivePrompt,
        // Confidence and risk
        confidence: item.confidence,
        riskLevel: item.riskLevel,
        // Convergence: Confirmed blocks, potential/borderline does not
        blocksConvergence: item.status === 'confirmed',
      });
    }
    
    console.log(`A1 per-element: ${perElementA1Violations.length} individual violations (${perElementA1Violations.filter(v => v.status === 'confirmed').length} confirmed, ${perElementA1Violations.filter(v => v.status === 'potential').length} potential, ${perElementA1Violations.filter(v => v.status === 'borderline').length} borderline)`);
    // ========== A2 AGGREGATION LOGIC (Screenshot Analysis) ==========
    interface A2AffectedItemUI {
      component_name: string;
      location: string;
      size_estimate: string;
      semantic_role: string;
      severity: 'violation' | 'warning';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const dedupeMapUI = new Map<string, A2AffectedItemUI>();
    
    for (const v of a2Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // FILTER: Normal-sized text (~14px or larger) should NOT be reported
      const mentionsNormalSize = /normal size|normal-sized|adequate|14px|~14px|approximately 14|appears normal/.test(combined);
      const mentionsSmall = /noticeably small|very small|tiny|<13|smaller than 13|clearly small/.test(combined);
      
      // If text appears normal sized and not explicitly small, filter out
      if (mentionsNormalSize && !mentionsSmall) {
        console.log(`Filtering out A2 (normal text size): ${v.evidence}`);
        continue;
      }
      
      // ============================================================
      // A2 STRICT SCOPE ENFORCEMENT: ONLY primary body text allowed
      // ============================================================
      // Exclude: badges, chips, pills, tags, status indicators
      const isBadgeChip = /\bbadge\b|\bchip\b|\bpill\b|\btag\b|\bstatus\s*(?:indicator|badge|chip|text)?\b/i.test(combined);
      if (isBadgeChip) {
        console.log(`Filtering out A2 (badge/chip/tag — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: headings, titles, subtitles
      const isHeadingTitle = /\bheading\b|\btitle\b|\bsubtitle\b|\bh[1-6]\b|\bsection\s*title\b|\bpage\s*title\b|\bheader\s*(?:text|subtitle|label)?\b/i.test(combined);
      if (isHeadingTitle && !/description|body\s*text|paragraph|content\s*block|prose/i.test(combined)) {
        console.log(`Filtering out A2 (heading/title — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: navigation, menu items, breadcrumbs
      const isNavigation = /\bnavigation\b|\bnav[-\s]|\bmenu\s*item\b|\bbreadcrumb\b|\btab\s*label\b|\bsidebar\s*(?:link|item|nav)\b/i.test(combined);
      if (isNavigation) {
        console.log(`Filtering out A2 (navigation — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: buttons, CTAs, interactive elements
      const isButton = /\bbutton\b|\bbtn\b|\bcta\b|\baction\s*button\b|\binteractive\s*element\b|\bicon[-\s]?button\b/i.test(combined);
      if (isButton && !/description|body\s*text|paragraph/i.test(combined)) {
        console.log(`Filtering out A2 (button/CTA — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: metadata, timestamps, dates, author names
      const isMetadata = /\bmetadata\b|\btimestamp\b|\bdate\s*(?:display|text)?\b|\btime\s*ago\b|\bauthor\b|\binstructor\b|\bcreated\s*(?:at|on)\b|\bupdated\s*(?:at|on)\b/i.test(combined);
      if (isMetadata) {
        console.log(`Filtering out A2 (metadata/timestamp — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: captions, tooltips, keyboard shortcuts, code blocks
      const isMicrocopy = /\bcaption\b|\btooltip\b|\bkeyboard\s*shortcut\b|\bkbd\b|\bcode\s*block\b|\bmonospace\b|\bplaceholder\b/i.test(combined);
      if (isMicrocopy) {
        console.log(`Filtering out A2 (microcopy/caption — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: icon-only elements
      const isIconOnly = /\bicon\b/i.test(combined) && !/description|paragraph|body/i.test(combined);
      if (isIconOnly) {
        console.log(`Filtering out A2 (icon element — not body text): ${v.evidence}`);
        continue;
      }
      
      // Extract info from evidence/diagnosis for screenshots
      // Priority: 1) Named UI element, 2) Location description, 3) Fallback to location only
      const locationMatch = (v.evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|tooltip|popover|alert|banner)?)/i);
      const componentMatch = (v.evidence || '').match(/([A-Z][a-zA-Z0-9]*(?:Description|Label|Text|Badge|Caption|Content|Title|Subtitle|Header|Footer)?)/);
      
      // Resolve component name - avoid placeholders like "Text" alone
      let componentName = '';
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      }
      // If no specific component, leave empty and rely on location
      
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      
      // Determine size estimate
      const sizeEstimate = mentionsSmall ? '<13px (visually estimated)' : '13-14px (visually estimated)';
      
      // Determine semantic role
      const semanticRole = /description|label|helper|caption|alert|dialog|form|body text/i.test(combined)
        ? 'informational' 
        : 'secondary';
      
      // Determine severity
      const severity: 'violation' | 'warning' = mentionsSmall ? 'violation' : 'warning';
      
      // Calculate confidence (lower for screenshot analysis)
      let confidence = v.confidence || 0.55;
      if (semanticRole === 'informational') confidence = Math.min(confidence + 0.1, 0.75);
      if (mentionsSmall) confidence = Math.min(confidence + 0.05, 0.75);
      else confidence = Math.max(confidence - 0.1, 0.35);
      
      const rationale = v.diagnosis || `Text appears ${severity === 'violation' ? 'noticeably small' : 'borderline small'} for ${semanticRole} content.`;
      
      // Deduplication key
      const dedupeKey = `${location}|${componentName}|${severity}`;
      
      if (dedupeMapUI.has(dedupeKey)) {
        const existing = dedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A2AffectedItemUI = {
          component_name: componentName,
          location,
          size_estimate: sizeEstimate,
          semantic_role: semanticRole,
          severity,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        dedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const affectedItemsUI = Array.from(dedupeMapUI.values());
    
    // Create aggregated A2 result if there are any items
    let aggregatedA2UI: any = null;
    if (affectedItemsUI.length > 0) {
      // Calculate overall confidence
      const highImpactItems = affectedItemsUI.filter(i => i.semantic_role === 'informational');
      let overallConfidence: number;
      let confidenceReason: string;
      
      if (highImpactItems.length > 0) {
        overallConfidence = Math.max(...highImpactItems.map(i => i.confidence));
        confidenceReason = `Based on maximum confidence (${overallConfidence.toFixed(2)}) from ${highImpactItems.length} informational element(s).`;
      } else {
        const sortedConfidences = affectedItemsUI.map(i => i.confidence).sort((a, b) => a - b);
        const midIdx = Math.floor(sortedConfidences.length / 2);
        overallConfidence = sortedConfidences.length % 2 === 0
          ? (sortedConfidences[midIdx - 1] + sortedConfidences[midIdx]) / 2
          : sortedConfidences[midIdx];
        confidenceReason = `Based on median confidence (${overallConfidence.toFixed(2)}) across ${affectedItemsUI.length} secondary element(s).`;
      }
      
      const violationCount = affectedItemsUI.filter(i => i.severity === 'violation').length;
      const warningCount = affectedItemsUI.filter(i => i.severity === 'warning').length;
      
      // Build summary with DEDUPLICATED and FILTERED component/location names
      // 1. Extract unique names, filtering out invalid identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'text',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of affectedItemsUI) {
        // Prefer component_name, then location
        const name = item.component_name || item.location || '';
        // Filter out invalid identifiers (case-insensitive check)
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          // Also filter out generic location names
          if (!/^(the\s+)?ui\s*(area|section|component)?$/i.test(name)) {
            uniqueNames.add(name);
          }
        }
      }
      
      // 2. Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      // 3. Build summary with "X unique area(s)" wording
      const locationList = displayedNames.join(', ');
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique area(s): ${locationList}${moreText}`
        : `${affectedItemsUI.length} location(s)`;
      
      const summary = `Small text size visually detected in ${areaCountText}. ` +
        `${violationCount > 0 ? `${violationCount} appear noticeably small` : ''}` +
        `${violationCount > 0 && warningCount > 0 ? ' and ' : ''}` +
        `${warningCount > 0 ? `${warningCount} appear borderline` : ''}. ` +
        `WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.`;
      
      const a2Rule = allRulesForViolations.find(r => r.id === 'A2');
      
      // Build a2Elements array for the aggregated card UI
      const a2Elements = affectedItemsUI.map((item, idx) => {
        // Format location to match A1 structure: "Screenshot #X — Screenshot (Context label)"
        const screenshotIdx = item.screenshot_index || (idx + 1);
        // Clean context label: use component_name if available, otherwise derive a short label
        // Strip diagnostic phrases like "appears smaller than", "body text for", etc.
        let rawLabel = item.component_name || item.location || 'UI element';
        rawLabel = rawLabel
          .replace(/\b(appears?\s+smaller\s+than|body\s+text\s+for|text\s+for)\b.*/i, '')
          .replace(/\b(appears?\s+to\s+be|seems?\s+to|looks?\s+like)\b.*/i, '')
          .trim();
        // Capitalize first letter and ensure it's a clean short label
        const contextLabel = rawLabel.length > 2 ? rawLabel : 'UI element';
        const formattedLocation = `Screenshot #${screenshotIdx} — Screenshot (${contextLabel})`;
        
        // Also clean elementLabel the same way
        let cleanElementLabel = item.component_name || `Body text element ${idx + 1}`;
        cleanElementLabel = cleanElementLabel
          .replace(/\b(appears?\s+smaller\s+than|body\s+text\s+for|text\s+for)\b.*/i, '')
          .replace(/\b(appears?\s+to\s+be|seems?\s+to|looks?\s+like)\b.*/i, '')
          .trim();
        if (cleanElementLabel.length < 3) cleanElementLabel = `Body text element ${idx + 1}`;

        // Parse estimated font size from size_estimate (e.g., "~12px", "approximately 14px")
        let estimatedFontSize: number | undefined = undefined;
        let estimationFailed = false;
        if (item.size_estimate) {
          const match = item.size_estimate.match(/(\d+(?:\.\d+)?)\s*px/i);
          if (match) {
            estimatedFontSize = Math.round(parseFloat(match[1]));
          } else {
            estimationFailed = true;
          }
        } else {
          estimationFailed = true;
        }

        return {
        elementLabel: cleanElementLabel,
        textSnippet: undefined,
        location: formattedLocation,
        computedFontSize: undefined, // Screenshot-based: cannot deterministically measure
        estimatedFontSize, // Visual estimation from bounding box analysis
        estimationFailed, // True if estimation could not be performed
        fontSizeSource: undefined,
        detectionMethod: 'heuristic' as const,
        thresholdPx: 16,
        explanation: item.rationale,
        confidence: item.confidence,
        correctivePrompt: undefined, // Potential findings: no corrective prompts
        deduplicationKey: `${item.location}|${item.component_name}`,
        };
      });

      aggregatedA2UI = {
        ruleId: 'A2',
        ruleName: 'Small body font size',
        category: 'accessibility',
        status: 'potential', // Screenshot-based A2 is ALWAYS potential (visual estimation)
        blocksConvergence: false, // Never blocks convergence for screenshot input
        inputType: 'screenshots',
        isA2Aggregated: true,
        a2Elements,
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: affectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          size_estimate: item.size_estimate,
          semantic_role: item.semantic_role,
          severity: item.severity,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: `${a2Elements.length} text element${a2Elements.length !== 1 ? 's' : ''} with potential font size issues detected. These require manual verification due to measurement uncertainty.`,
        contextualHint: 'Increase body text to at least 16px (text-base) for primary content areas.',
        correctivePrompt: a2Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
        advisoryGuidance: 'Static visual estimation cannot determine exact computed font sizes. For deterministic measurement, upload the rendered source code (ZIP file) or provide a GitHub repository.',
      };
      
      console.log(`A2 aggregated: ${affectedItemsUI.length} items → 1 result (${violationCount} violations, ${warningCount} warnings)`);
    }
    
    // ========== A4 AGGREGATION LOGIC (Screenshot Analysis) ==========
    interface A4AffectedItemUI {
      component_name: string;
      location: string;
      size_estimate: string;
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a4DedupeMapUI = new Map<string, A4AffectedItemUI>();
    const detectedSizeRangesUI = new Set<string>();
    
    // Invalid identifiers for A4 component naming - filter out non-component strings
    const a4InvalidComponentNamesUI = new Set([
      'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
      'element', 'elements', 'interactive', 'dimensions', 'target', 'targets',
      'minimum', 'size', 'sizes', 'width', 'height', 'padding', 'constraint',
      'button', 'buttons', 'icon', 'icons', 'control', 'controls',
      'component', 'components', 'item', 'items', 'unknown', 'default',
      'variants', 'variant', 'props', 'className', 'style', 'styles'
    ]);
    
    // Helper to validate component name (must be PascalCase, no spaces, no verbs/instructions)
    function isValidA4ComponentNameUI(name: string): boolean {
      if (!name || name.length < 3) return false;
      // Must start with uppercase (PascalCase)
      if (!/^[A-Z]/.test(name)) return false;
      // No spaces allowed
      if (/\s/.test(name)) return false;
      // No instructional/verb phrases
      if (/^(Increase|Ensure|Add|Use|Apply|Set|Get|Make|Create|Should|Must|Will|Can)/i.test(name)) return false;
      // Not in invalid set
      if (a4InvalidComponentNamesUI.has(name.toLowerCase())) return false;
      return true;
    }
    
    for (const v of a4Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // Extract component/element info from evidence - prioritize compound PascalCase names
      const compoundMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Previous|Next|Button|Icon|Close|Nav|Toggle|Trigger|Control|Action|Arrow|Pagination|Calendar|Carousel))\b/);
      const simpleMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]{3,})\b/);
      const locationMatch = (evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|carousel|navigation)?)/i);
      
      // Resolve component name with strict validation
      let componentName = '';
      
      // 1. Try compound component name first (e.g., CarouselPrevious, CalendarNavButton)
      if (compoundMatch?.[1] && isValidA4ComponentNameUI(compoundMatch[1])) {
        componentName = compoundMatch[1];
      }
      // 2. Try simple PascalCase component
      else if (simpleMatch?.[1] && isValidA4ComponentNameUI(simpleMatch[1])) {
        componentName = simpleMatch[1];
      }
      
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      
      // Estimate size from visual description - be more specific when possible
      let sizeEstimate = '<44px (visual estimate)';
      if (/very small|tiny|noticeably small|~24|~28/.test(combined)) { 
        sizeEstimate = '~24-28px (visual estimate)'; 
        detectedSizeRangesUI.add('~24-28px'); 
      } else if (/small|compact|~32|~36/.test(combined)) { 
        sizeEstimate = '~32-36px (visual estimate)'; 
        detectedSizeRangesUI.add('~32-36px'); 
      } else if (/~40|borderline/.test(combined)) {
        sizeEstimate = '~40px (visual estimate)';
        detectedSizeRangesUI.add('~40px');
      } else { 
        sizeEstimate = '<44px (visual estimate)'; 
        detectedSizeRangesUI.add('<44px'); 
      }
      
      // Calculate confidence (lower for screenshot analysis due to visual estimation)
      let confidence = v.confidence || 0.50;
      // Reduce confidence since visual inspection cannot measure exact dimensions
      confidence = Math.min(confidence, 0.65);
      
      const rationale = v.diagnosis || `Interactive element appears to be below the commonly recommended touch target size of 44×44 CSS px. Visual inspection cannot confirm actual dimensions.`;
      
      // Deduplication key - by component name or location (but filter out generic locations)
      const dedupeKey = componentName || (location !== 'UI area' ? location : 'unknown');
      
      if (a4DedupeMapUI.has(dedupeKey)) {
        const existing = a4DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
          existing.size_estimate = sizeEstimate;
        }
      } else {
        const item: A4AffectedItemUI = {
          component_name: componentName,
          location,
          size_estimate: sizeEstimate,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a4DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a4AffectedItemsUI = Array.from(a4DedupeMapUI.values());
    
    // Create aggregated A4 result if there are any items
    let aggregatedA4UI: any = null;
    if (a4AffectedItemsUI.length > 0) {
      // Calculate overall confidence (max of all findings - deterministic)
      const overallConfidence = Math.max(...a4AffectedItemsUI.map(i => i.confidence));
      const confidenceReason = `Confidence is based on visual size assessment of interactive elements. Screenshot analysis cannot measure exact rendered dimensions, so findings are based on visual estimation.`;
      
      // Build unique component/location names list - filter out non-component strings
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area',
        // Instructional/guideline words that should never be component names
        'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
        'interactive', 'dimensions', 'target', 'targets', 'minimum', 'size', 'sizes'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of a4AffectedItemsUI) {
        // Prefer component_name (PascalCase), then location (if descriptive)
        const name = item.component_name || '';
        // Validate: must be PascalCase, no spaces
        if (name && name.length > 2 && 
            /^[A-Z][a-zA-Z0-9]+$/.test(name) && 
            !invalidIdentifiers.has(name.toLowerCase())) {
          uniqueNames.add(name);
        } else if (item.location && item.location !== 'UI area') {
          // Fall back to location, but only if descriptive and not generic
          const loc = item.location;
          if (loc.length > 3 && !invalidIdentifiers.has(loc.toLowerCase()) &&
              !/^(the\s+)?ui\s*(area|section|component)?$/i.test(loc)) {
            uniqueNames.add(loc);
          }
        }
      }
      
      // Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique element(s): ${displayedNames.join(', ')}${moreText}`
        : `${a4AffectedItemsUI.length} element(s)`;
      
      
      const sizeRangesText = detectedSizeRangesUI.size > 0 
        ? `Estimated size ranges: ${Array.from(detectedSizeRangesUI).join(', ')}.`
        : '';
      
      const summary = `Interactive elements in ${areaCountText} appear to be below the commonly recommended touch target size of 44×44 CSS px. ${sizeRangesText} ` +
        `44×44 CSS px is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). ` +
        `Visual inspection cannot confirm actual rendered dimensions; padding or layout constraints may increase the clickable area.`;
      
      const a4Rule = allRulesForViolations.find(r => r.id === 'A4');
      
      aggregatedA4UI = {
        ruleId: 'A4',
        ruleName: 'Small tap / click targets',
        category: 'accessibility',
        typeBadge: 'Potential Risk (Heuristic)',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        detected_size_ranges: Array.from(detectedSizeRangesUI),
        affected_items: a4AffectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          size_estimate: item.size_estimate,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Explicitly enforce minimum dimensions (44×44 CSS px) for interactive elements using visible padding or size constraints.',
        correctivePrompt: a4Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A4 aggregated: ${a4Violations.length} findings → 1 result (${uniqueNamesArray.length} unique elements, sizes: ${Array.from(detectedSizeRangesUI).join(', ')})`);
    }
    
    // ========== A5 AGGREGATION LOGIC (Screenshot Analysis) ==========
    // Process and aggregate A5 violations into a single result object
    // Only report A5 when there is visual evidence of missing focus indicator
    interface A5AffectedItemUI {
      component_name: string;
      location: string;
      typeBadge: 'Confirmed' | 'Heuristic';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a5DedupeMapUI = new Map<string, A5AffectedItemUI>();
    const a5ValidViolationsUI: any[] = [];
    
    // First pass: filter A5 violations to only include actual violations
    for (const v of a5Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // Check for indicators that this is a PASS (has visible focus)
      // Use positive checks for visible focus indicators
      const hasVisibleFocusRing = /has.*ring|visible ring|shows.*ring|focus ring|ring.*focus/i.test(combined);
      const hasVisibleFocusBorder = /has.*border|visible border|shows.*border|focus border|border.*focus/i.test(combined);
      const hasVisibleFocusIndicator = /has.*focus indicator|visible focus indicator|clear focus/i.test(combined);
      
      const hasVisibleReplacement = hasVisibleFocusRing || hasVisibleFocusBorder || hasVisibleFocusIndicator;
      
      // Check if explicitly marked as acceptable
      // IMPORTANT: Avoid matching negative phrases like "no visible", "lacks", etc.
      const mentionsAcceptable = /(?<!no\s)(?<!without\s)(?<!lacks?\s)(?<!missing\s)(?:acceptable|compliant|proper focus|adequate)/i.test(combined);
      const explicitlyPasses = /\bpass\b(?!word)/i.test(combined) && !/does not pass|doesn't pass|fail/i.test(combined);
      
      // If evidence shows visible focus or acceptable, this is a PASS - skip entirely
      if (hasVisibleReplacement) {
        console.log(`A5 PASS (has visible focus indicator): ${evidence}`);
        continue;
      }
      
      if (mentionsAcceptable || explicitlyPasses) {
        console.log(`A5 PASS (explicitly acceptable): ${evidence}`);
        continue;
      }
      
      // Check if screenshot cannot determine focus state
      const cannotDetermine = /cannot determine|unable to assess|not visible in screenshot|no focus state shown/.test(combined);
      if (cannotDetermine) {
        console.log(`A5 SKIP (cannot determine from screenshot): ${evidence}`);
        continue;
      }
      
      // Check for weak indicators (background-only focus)
      const hasBackgroundOnlyFocus = /only.*background|background.*change|background.*color|relies on.*background/.test(combined);
      
      // This is a valid violation - add it
      console.log(`A5 VIOLATION: ${evidence} [background-only: ${hasBackgroundOnlyFocus}]`);
      a5ValidViolationsUI.push({
        ...v,
        isHeuristicRisk: hasBackgroundOnlyFocus,
      });
    }
    
    // Second pass: aggregate valid A5 violations
    // Invalid identifiers for component naming - single words, utility tokens, non-UI terms
    const a5InvalidComponentNamesUI = new Set([
      'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
      'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
      'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right',
      'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled',
      'button', 'link', 'input', 'icon', 'text', 'label', 'container', 'wrapper',
      'component', 'element', 'item', 'items', 'default', 'variants', 'variant'
    ]);
    
    for (const v of a5ValidViolationsUI) {
      const evidence = (v.evidence || '');
      const combined = (evidence + ' ' + (v.diagnosis || '')).toLowerCase();
      
      // Extract location description for screenshots (no file paths in screenshots)
      const locationMatch = (evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar)?)/i);
      
      // Extract PascalCase component names (prioritize compound names like CloseButton, NavToggle)
      const componentMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Button|Close|Toggle|Trigger|Nav|Icon|Control|Action|Link|Card|Dialog|Modal|Menu|Header|Footer|Sidebar|Panel|Form))\b/);
      const simpleComponentMatch = evidence.match(/(?:the\s+)?([A-Z][a-zA-Z0-9]{3,})/);
      
      // Resolve component name - prioritize compound PascalCase names
      let componentName = '';
      
      // 1. Try compound component name first (e.g., CloseButton, NavToggle)
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      }
      // 2. Try simple PascalCase component (but not single-word utility names)
      else if (simpleComponentMatch?.[1] && simpleComponentMatch[1].length > 3) {
        const candidate = simpleComponentMatch[1];
        if (!a5InvalidComponentNamesUI.has(candidate.toLowerCase())) {
          componentName = candidate;
        }
      }
      
      // Extract location from matched text
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      // Determine type badge
      const typeBadge: 'Confirmed' | 'Heuristic' = v.isHeuristicRisk ? 'Heuristic' : 'Confirmed';
      
      // Calculate confidence (lower for screenshot analysis)
      let confidence = v.confidence || 0.55;
      if (v.isHeuristicRisk) {
        confidence = Math.min(confidence, 0.45); // Lower confidence for heuristic
      }
      confidence = Math.min(confidence, 0.65); // Cap for screenshot analysis
      
      const rationale = v.isHeuristicRisk 
        ? 'Focus indication appears to rely only on background color change, which may be insufficient.'
        : 'Interactive element appears to lack a visible focus indicator for keyboard users.';
      
      // Deduplication key
      const dedupeKey = componentName || location || 'unknown';
      
      if (a5DedupeMapUI.has(dedupeKey)) {
        const existing = a5DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A5AffectedItemUI = {
          component_name: componentName,
          location,
          typeBadge,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a5DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a5AffectedItemsUI = Array.from(a5DedupeMapUI.values());
    
    // Create aggregated A5 result ONLY if there are actual violations
    let aggregatedA5UI: any = null;
    if (a5AffectedItemsUI.length > 0) {
      // Calculate overall confidence (max of all findings)
      const overallConfidence = Math.max(...a5AffectedItemsUI.map(i => i.confidence));
      
      const confirmedCount = a5AffectedItemsUI.filter(i => i.typeBadge === 'Confirmed').length;
      const heuristicCount = a5AffectedItemsUI.filter(i => i.typeBadge === 'Heuristic').length;
      
      const confidenceReason = `Confidence is based on visual assessment of focus indicators. Screenshot analysis cannot confirm actual focus behavior, so findings are based on visual observation.`;
      
      // Build unique component/location names list - filter out non-semantic identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area',
        // Single words that are not UI components
        'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
        'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
        'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of a5AffectedItemsUI) {
        const name = item.component_name || item.location || '';
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          if (!/^(the\s+)?ui\s*(area|section|component)?$/i.test(name)) {
            uniqueNames.add(name);
          }
        }
      }
      
      // Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique element(s): ${displayedNames.join(', ')}${moreText}`
        : `${a5AffectedItemsUI.length} element(s)`;
      
      const typeBreakdown = [
        confirmedCount > 0 ? `${confirmedCount} appear to lack visible focus` : '',
        heuristicCount > 0 ? `${heuristicCount} may rely only on background color` : '',
      ].filter(Boolean).join(' and ');
      
      const summary = `Focus visibility issues detected in ${areaCountText}. ${typeBreakdown}. ` +
        `Interactive elements should have visible focus indicators for keyboard accessibility.`;
      
      const a5Rule = allRulesForViolations.find(r => r.id === 'A5');
      
      aggregatedA5UI = {
        ruleId: 'A5',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: a5AffectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          typeBadge: item.typeBadge,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Interactive elements appear to lack visible focus indicators for keyboard users.',
        correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements. Do not alter layout structure or component behavior beyond focus styling.',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A5 aggregated: ${a5Violations.length} findings → ${a5AffectedItemsUI.length} valid violations → 1 result (${confirmedCount} confirmed, ${heuristicCount} heuristic)`);
    } else {
      console.log(`A5: No valid violations found (${a5Violations.length} filtered out as PASS or NOT APPLICABLE)`);
    }
    
    // ========== A1 AGGREGATION LOGIC (v22) ==========
    // Aggregate per-element A1 findings into at most 2 cards:
    // - One for Confirmed (Blocking) findings
    // - One for Potential (Non-blocking) findings
    // Each card contains element sub-items with full details.
    // Deduplication by (screenId + bbox + textSnippet)
    
    const confirmedA1Elements = perElementA1Violations.filter((v: any) => v.status === 'confirmed');
    const potentialA1Elements = perElementA1Violations.filter((v: any) => v.status === 'potential');
    
    // Helper to build deduplication key
    const buildDedupeKey = (v: any): string => {
      const screenPart = v.evidence?.match(/Screenshot #(\d+)/)?.[1] || '0';
      const textPart = v.textSnippet || v.elementDescription || '';
      return `${screenPart}-${textPart}`.toLowerCase().replace(/\s+/g, '');
    };
    
    // Helper to build A1ElementSubItem from raw violation
    const buildA1SubItem = (v: any): any => {
      const dedupeKey = buildDedupeKey(v);
      
      // Determine if near-threshold (within small margin, NOT for values far below)
      // Near threshold: ratio between (threshold - 0.3) and threshold
      const ratio = v.contrastRatio || v.contrastRange?.min;
      const threshold = v.thresholdUsed || 4.5;
      const isNearThreshold = ratio !== undefined && ratio >= (threshold - 0.3) && ratio < threshold;
      
      // Extract uiRole from elementRole
      const uiRole = v.elementRole || 'text element';
      
      // Extract patternGroup from location or context
      const patternGroup = v.location || 'UI section';
      
      return {
        elementLabel: v.elementDescription || v.elementRole || 'Text element',
        textSnippet: v.textSnippet,
        location: v.evidence || v.elementIdentifier || 'Unknown location',
        uiRole, // Semantic UI role
        patternGroup, // UI pattern group
        screenshotIndex: parseInt(v.evidence?.match(/Screenshot #(\d+)/)?.[1] || '1'),
        foregroundHex: v.foregroundHex,
        foregroundConfidence: v.foregroundConfidence,
        backgroundStatus: v.backgroundStatus || 'uncertain',
        backgroundHex: v.backgroundHex,
        backgroundCandidates: v.backgroundCandidates,
        contrastRatio: v.contrastRatio,
        contrastRange: v.contrastRange,
        contrastNotMeasurable: v.backgroundStatus === 'unmeasurable',
        thresholdUsed: v.thresholdUsed || 4.5,
        explanation: v.diagnosis,
        reasonCodes: v.reasonCodes,
        nearThreshold: isNearThreshold,
        deduplicationKey: dedupeKey,
        // Element-specific corrective prompt (from per-element violation)
        correctivePrompt: v.correctivePrompt,
      };
    };
    
    // Deduplicate elements by key
    const deduplicateElements = (elements: any[]): any[] => {
      const seen = new Map<string, any>();
      for (const el of elements) {
        const key = el.deduplicationKey;
        if (seen.has(key)) {
          // Merge reason codes
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
    
    // Build aggregated Confirmed A1 card (if any confirmed elements exist)
    if (confirmedA1Elements.length > 0) {
      const elements = deduplicateElements(confirmedA1Elements.map(buildA1SubItem));
      const avgConfidence = confirmedA1Elements.reduce((sum: number, v: any) => sum + (v.confidence || 0.8), 0) / confirmedA1Elements.length;
      
      aggregatedA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'confirmed',
        isA1Aggregated: true,
        a1Elements: elements,
        diagnosis: `${elements.length} text element${elements.length !== 1 ? 's' : ''} with confirmed insufficient contrast detected. These elements have measured contrast ratios below WCAG AA thresholds.`,
        correctivePrompt: 'Increase text contrast to meet WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) by darkening text or lightening background.',
        contextualHint: 'Adjust foreground/background colors to meet WCAG AA contrast thresholds.',
        confidence: Math.round(avgConfidence * 100) / 100,
        blocksConvergence: true,
        inputType: 'screenshots',
        samplingMethod: 'pixel',
      });
      
      console.log(`A1 aggregated: ${confirmedA1Elements.length} confirmed elements → 1 Confirmed card (${elements.length} unique)`);
    }
    
    // Build aggregated Potential A1 card (if any potential elements exist)
    if (potentialA1Elements.length > 0) {
      const elements = deduplicateElements(potentialA1Elements.map(buildA1SubItem));
      const avgConfidence = potentialA1Elements.reduce((sum: number, v: any) => sum + (v.confidence || 0.55), 0) / potentialA1Elements.length;
      
      // Collect all unique reason codes across elements
      const allReasonCodes = new Set<string>();
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
        diagnosis: `${elements.length} text element${elements.length !== 1 ? 's' : ''} with potential contrast issues detected. These require manual verification due to measurement uncertainty.`,
        correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools or accessibility testing tools.',
        contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools.',
        confidence: Math.round(avgConfidence * 100) / 100,
        reasonCodes: Array.from(allReasonCodes),
        potentialRiskReason: Array.from(allReasonCodes).join(', '),
        advisoryGuidance: 'Upload screenshots at 100% zoom or verify with DevTools/axe for accurate measurement.',
        blocksConvergence: false,
        inputType: 'screenshots',
        samplingMethod: 'pixel',
      });
      
      console.log(`A1 aggregated: ${potentialA1Elements.length} potential elements → 1 Potential card (${elements.length} unique)`);
    }
    
    // Combine all violations - A1 uses aggregated cards (max 2)
    const enhancedViolations = [
      ...filteredOtherViolations,
      ...aggregatedA1Violations, // Aggregated A1 findings (max 2 cards: confirmed + potential)
      ...(aggregatedA2UI ? [aggregatedA2UI] : []),
      ...(aggregatedA4UI ? [aggregatedA4UI] : []),
      ...(aggregatedA5UI ? [aggregatedA5UI] : []),
    ];

    console.log(`Analysis complete: ${enhancedViolations.length} violations found`);

    return new Response(
      JSON.stringify({
        success: true,
        violations: enhancedViolations,
        passNotes: analysisResult.passNotes || {},
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analysis error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Analysis failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});