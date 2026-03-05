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
    
    // SCREENSHOT A1: ALWAYS potential, never confirmed.
    // Pixel sampling from screenshots lacks DOM context for WCAG-grade confirmation.
    const finalStatus: 'confirmed' | 'potential' = 'potential';

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
      // Screenshot A1 is always potential — no confirmed branch
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
      // Screenshot A1: never blocks convergence
      blocksConvergence: false,
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
    { id: 'A2', name: 'Poor focus visibility', diagnosis: 'Lack of visible focus reduces keyboard accessibility.', correctivePrompt: 'Ensure all interactive elements have clearly visible focus states.' },
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

const buildAnalysisPrompt = (categories: string[], selectedRules: string[]) => {
  const selectedRulesSet = new Set(selectedRules);
  const includesA1 = selectedRulesSet.has('A1');
  
  return `You are an expert UI/UX auditor performing a comprehensive 3-pass analysis of a user interface. Analyze the provided screenshot(s) following this structured methodology:

## PASS 1 — Accessibility (WCAG AA)
Run visual inspection for accessibility issues:
- Text contrast ratios (minimum 4.5:1 for normal text)
- Font sizes (minimum 16px for body text)
- Focus indicator visibility

### A2 (Poor focus visibility) — SCREENSHOT DETECTION RULES:

**SCOPE:** Interactive elements only: buttons, links, inputs, selects, textareas, tabs, menu items.

**THREE-TIER CLASSIFICATION:**

1. **NOT EVALUATED (status: "not_evaluated"):** If the screenshot does NOT display any element in a focused state (no visible focus ring, outline, or border change on any element), report:
   - status: "not_evaluated"
   - potentialReason: "Focus state not observable in provided screenshot."
   - confidence: 0.0
   - This means focus visibility CANNOT be assessed from this screenshot.

2. **POTENTIAL (status: "potential"):** If the screenshot DOES show a focused element (e.g., an element with a visible focus ring or outline) but another interactive element lacks a visible focus indicator, report:
   - status: "potential"
   - potentialReason: "No visible focus indicator observed."
   - confidence: 0.55-0.75

3. **NO FINDING:** If the screenshot shows visible focus indicators on focused elements, do NOT report any A2 finding.

**NEVER mark screenshot A2 as "confirmed" — focus visibility requires runtime keyboard testing.**

**OUTPUT FORMAT FOR A2 FINDINGS:**
When focus state is NOT observable (most common case):
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "status": "not_evaluated",
  "typeBadge": "NOT_EVALUATED",
  "evidence": "No focused state observable in screenshot",
  "diagnosis": "Focus visibility cannot be assessed — no element appears in a focused state in the provided screenshot.",
  "contextualHint": "Upload source code for deterministic focus visibility analysis, or provide a screenshot showing a focused element.",
  "confidence": 0.0,
  "potentialReason": "Focus state not observable in provided screenshot."
}
\`\`\`

When a focused element is shown but lacks indicator:
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "status": "potential",
  "typeBadge": "POTENTIAL",
  "evidence": "Focused element visible but no focus indicator detected",
  "diagnosis": "A focused interactive element appears to lack a visible focus indicator for keyboard users.",
  "contextualHint": "Add visible focus-visible indicators (ring, outline, border) for keyboard accessibility.",
  "confidence": 0.6,
  "potentialReason": "No visible focus indicator observed."
}
\`\`\`

**STRICT RULES:**
- If no focused state is shown → status: "not_evaluated" (NOT "potential")
- If focused element shown but no indicator → status: "potential"
- If visible focus indicator shown → NO finding
- NEVER mark screenshot A2 as "confirmed"
- Focus visibility requires runtime keyboard testing — screenshots show only one state
- Do NOT report non-interactive elements (headings, paragraphs, images)
- Do NOT flag elements that appear to have visible focus indicators

### IMPORTANT — Rules NOT evaluated for screenshots:
**A3 (Incomplete Keyboard Operability), A4 (Missing Semantic Structure), A5 (Missing Form Labels), A6 (Missing Accessible Names), and U5 (Insufficient Interaction Feedback) require DOM inspection or runtime interaction and CANNOT be evaluated from screenshots. Do NOT generate any findings for these rules. They will be marked as "Not Evaluated" automatically.**

    ### A4 (Small tap / click targets) — DESKTOP WEB UI EVALUATION (Screenshot):

**SCOPE:** Only primary actionable controls: buttons, submit inputs, role="button" elements.
**EXCLUDE:** Breadcrumb links, dropdown menu items, navigation triggers, pagination controls, compact toolbar icons, table row action icons, secondary UI chrome (Badge, Tag, Chip, Label).

**VISUAL ANALYSIS LIMITATION:**
Visual inspection cannot measure exact rendered dimensions. Always classify as Potential Risk from screenshots — never Confirmed.

**DESKTOP THRESHOLDS (NOT mobile 44px):**
- Estimated size < 20px → Potential Risk (High confidence)
- 20px ≤ estimated size < 24px → Potential Risk (Low confidence)
- ≥ 24px → No finding (silent)

Detection label: Screenshot-based bounding box estimation.
Confidence: heuristic.

**DO NOT:**
- Use 44px as the threshold
- Report elements inside dropdowns, breadcrumbs, navigation, pagination, or toolbars
- Report as Confirmed — screenshots are always heuristic
- Mention internal glyphs or icon characters

**Report each potentially undersized primary control SEPARATELY** — do not group into one violation

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
### A1 (Insufficient Text Contrast) — PERCEPTUAL ASSESSMENT (Screenshot Modality)

**MODALITY: Screenshot — LLM Perceptual Assessment Only (WCAG 1.4.3)**
Input constraint: Only screenshots are available (no DOM, no CSS tokens, no source code).
A1 applies ONLY to WCAG 1.4.3 Text Contrast — readable text content only.

**YOUR ROLE: Identify text that VISUALLY APPEARS to have insufficient contrast.**
You are the SOLE evaluator. There is NO pixel measurement stage.

**CRITICAL RULES:**
- Do NOT output numeric contrast ratios — you cannot compute them from screenshots
- Do NOT output foreground/background hex color values — you cannot reliably sample them
- Do NOT output bounding box coordinates — they are not needed
- Only report findings where you have CLEAR visual evidence of low contrast
- All findings are POTENTIAL (never Confirmed) — screenshots cannot prove WCAG non-compliance
- If contrast appears clearly adequate (dark text on light bg, white text on dark bg), do NOT report

**DETECTION SCOPE — HIGH-CONFIDENCE ONLY:**
Report ONLY when there is obvious visual evidence of low contrast:
- Light gray text on white or near-white backgrounds
- Low-contrast placeholder-style text used as actual content
- Subtle text on tinted/colored card backgrounds
- Low-contrast button labels, badge text, or tag text
- Faded metadata text that appears hard to read

DO NOT REPORT:
- Text that appears clearly readable (good contrast)
- Dark text on light backgrounds with obvious contrast
- White/light text on dark backgrounds with obvious contrast
- SVG icons, decorative graphics, non-text elements
- Elements where you are uncertain about contrast

**OUTPUT FORMAT — A1 Findings (in violations array, NOT in a1Candidates):**
For screenshot A1, output findings directly in the violations array:

\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "potential",
  "evidence": "Screenshot #1 — [area description]",
  "elementDescription": "[what the text element is]",
  "diagnosis": "[1-2 sentences explaining why contrast appears low]",
  "contextualHint": "Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.",
  "confidence": 0.65,
  "textSize": "normal",
  "elementRole": "metadata"
}
\`\`\`

**FIELD DESCRIPTIONS:**
- evidence: Screenshot number and location within the screenshot
- elementDescription: Short human-readable description of the text element
- diagnosis: Visual rationale — WHY the contrast appears insufficient (1-2 sentences)
- contextualHint: Always use the standard advisory text shown above
- confidence: 0.55–0.80 based on how clearly the contrast issue is visible
- textSize: "normal" | "large" based on visual estimate
- elementRole: "metadata|caption|badge|label|body text|heading|muted|colored|navigation|placeholder"

**DO NOT output a1Candidates array — put A1 findings directly in violations.**
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
- **SAME-TASK SUPPRESSION:** Multiple buttons lead to the SAME user task or flow, even if they appear in different UI regions. Examples:
  - "Compose" in header + "Send your first message" in empty state → SAME task → DO NOT trigger
  - "Add item" in toolbar + "Create first item" in empty state → SAME task → DO NOT trigger
  - "New project" in header + "Create your first project" in empty state → SAME task → DO NOT trigger
  These are redundant entry points, NOT competing actions. Only trigger when buttons perform DIFFERENT tasks that create decision ambiguity (e.g., "Upgrade plan" vs "Start free trial").

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
${rules.usability.filter(r => selectedRulesSet.has(r.id) && r.id !== 'U5').map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

Consider:
- Visual hierarchy and primary action clarity (U1)
- Navigation WAYFINDING ONLY: Can users know where they are, where they can go, and navigate back? (U2) — Do NOT flag just because breadcrumbs are missing. Active nav highlight + page heading = sufficient. Do NOT comment on layout grouping (U6), truncation (U3), step indicators (U4), exit/cancel absence (E3), or landmark semantics (A-rules). Confidence: 0.60–0.80, cap at 0.80.
- Content truncation, overflow, and text visibility (U3) — see U3 CONSTRAINTS below
- Recognition vs recall: visible options, labels, contextual cues (U4) — see U4 CONSTRAINTS below

- Layout grouping, alignment, and visual coherence (U6)

### U3 (Truncated or Inaccessible Content) — CONSTRAINTS FOR SCREENSHOT ANALYSIS:
**STRICT VISUAL-ONLY GATING — Only report U3 when at least ONE of these visual cues is present:**
1. Visible ellipsis (…) indicating text truncation
2. Text visibly cut off at container edge (characters truncated mid-line)
3. A fade/mask/gradient overlay indicating overflow
4. Text overlapping other UI elements or exiting its bounding area

**If NONE of these visual cues are present, do NOT report U3.**

**RECOVERY MECHANISM CHECK — MANDATORY, EXECUTE BEFORE EVERY U3 DECISION:**
For EACH content region where truncation is suspected, FIRST scan the SAME container/table/card for:
1. **Horizontal scrollbar** — a scrollbar track/thumb visible at the BOTTOM edge of the table or container
2. **Vertical scrollbar** — a scrollbar track/thumb visible on the RIGHT edge of the table or container
3. **"Show more" / "Expand" / "View all"** control near the truncated content
4. **Tooltip** or hover affordance on truncated text (only if confidently visible)
5. **Wrapped text** that flows to additional lines (not truncated)

**DECISION LOGIC (apply in this exact order):**
- IF truncation cue detected AND scrollbar visible (horizontal OR vertical) in the same container → **DO NOT REPORT U3** (set recoveryObserved to "Scrollable region observed" internally, then OMIT from output)
- IF truncation cue detected AND expand/show-more control visible → **DO NOT REPORT U3** (set recoveryObserved to "Expandable control observed" internally, then OMIT from output)
- IF truncation cue detected AND tooltip affordance confidently visible → **DO NOT REPORT U3** (set recoveryObserved to "Tooltip likely" internally, then OMIT from output)
- IF truncation cue detected AND recovery is ambiguous/uncertain → **REPORT U3 as Potential** with recoveryObserved: "Uncertain", confidence 0.55–0.65
- IF truncation cue detected AND NO recovery mechanism visible → **REPORT U3 as Potential** with recoveryObserved: "None observed", confidence 0.60–0.75
- IF no truncation cue → **DO NOT REPORT U3**

**recoveryObserved MUST be exactly one of these values:**
- "Scrollable region observed" (scrollbar visible — SUPPRESSES U3)
- "Expandable control observed" (show more/expand — SUPPRESSES U3)
- "Tooltip likely" (tooltip affordance visible — SUPPRESSES U3)
- "None observed" (no recovery mechanism found)
- "Uncertain" (cannot determine if recovery exists)

**CRITICAL: A table/container with a visible scrollbar at the bottom or right edge means content IS accessible via scrolling. This is a recovery mechanism. Do NOT report U3.**

**FORBIDDEN:** Do NOT use code-centric language: "static analysis", "truncate class", "expand: none", "CSS", "overflow-hidden".
**Use visual-only language:** "visually clipped", "text appears cut off", "ellipsis observed", "content extends beyond container".

**U3 is ALWAYS "status": "potential" — NEVER "confirmed" for screenshots.**
**Confidence range:** 0.55–0.75 (cap at 0.75). If recovery is uncertain, cap at 0.65.

**OUTPUT FORMAT for U3 screenshot findings (ONLY for findings that passed the recovery check above):**
\`\`\`json
{
  "ruleId": "U3",
  "ruleName": "Truncated or inaccessible content",
  "category": "usability",
  "status": "potential",
  "isU3Aggregated": true,
  "u3Elements": [
    {
      "elementLabel": "Text content region (e.g., Reason / Notes)",
      "location": "Screenshot #1",
      "detection": "Short visual-based statement of what is observed",
      "evidence": "What in the screenshot indicates clipping (e.g., ellipsis visible, text cut off at edge)",
      "recoveryObserved": "None observed | Uncertain",
      "confidence": 0.65,
      "classification": "potential",
      "subCheck": "U3.D1",
      "subCheckLabel": "Visual content truncation",
      "deduplicationKey": "U3-screenshot-region-description"
    }
  ],
  "diagnosis": "Visual inspection suggests content may be clipped; verify in context.",
  "confidence": 0.65,
  "advisoryGuidance": "Ensure long table values are readable (wrap, tooltip on hover, expandable cell, or scroll)."
}
\`\`\`
- If NO visual truncation cues found, do NOT include U3 in the violations array.
- If a scrollbar (horizontal or vertical) is visible in the same container, do NOT include U3.
- If an expand/show-more control is visible, do NOT include U3.

### U4 (Recognition-to-Recall Regression) — CONSTRAINTS FOR SCREENSHOT ANALYSIS:
**CRITICAL ANTI-HALLUCINATION RULES:**
- Do NOT use file names, component names, page titles, or any "test" wording (e.g., "U4 Recall Test") as evidence or reasoning.
- Do NOT infer developer intent from naming conventions.
- Base conclusions ONLY on user-visible UI content observed in the screenshot:
  - Step indicators ("Step 3 of 3", "Confirm Order")
  - Presence/absence of summary/review content
  - CTA labels ("Continue", "Confirm") and whether they explain what happens next
  - Missing examples/helper text where it increases recall burden
- If visual evidence is insufficient, return NO U4 finding — do not guess.
- U4 is ALWAYS "status": "potential" — NEVER "confirmed".
- Confidence range: 0.60–0.80 (cap at 0.80).
- Each U4 finding must cite specific visible UI text as evidence.


### U6 (Weak Grouping / Layout Coherence) — CONSTRAINTS FOR SCREENSHOT ANALYSIS:
**SCOPE: U6 evaluates visual grouping and spatial organization of UI elements, NOT content overflow or text truncation (those belong to U3).**

**TRUE U6 TRIGGERS (report only when these are present):**
- Elements that should be grouped together appear scattered without visual containers, borders, or proximity
- Inconsistent alignment between related elements (e.g., form labels misaligned with inputs)
- Irregular spacing between items that should have uniform spacing
- Missing section boundaries where content topics change
- Floating elements that break the visual hierarchy
- Overlapping elements that obscure content

**U6 MUST NOT TRIGGER when:**
- The layout is a **structured data table** with consistent columns, aligned headers, and uniform row heights — even if the table uses horizontal scrolling. Horizontal scrolling in tables is an intentional layout pattern, not a grouping failure.
- The issue is **text truncation or content overflow** — that belongs to U3, not U6. Do not duplicate U3 detection.
- The layout uses a **standard grid/card pattern** with consistent sizing and spacing.
- The page is a **well-structured admin panel** with sidebar navigation, header, and content area.

**DATA TABLE SUPPRESSION RULE:**
If the screenshot shows a data table with ALL of these properties:
1. Consistent column headers aligned with cell content
2. Uniform row heights across data rows
3. Visible grid lines, borders, or alternating row backgrounds
4. Horizontal or vertical scrollbar for overflow content
→ **DO NOT report U6.** The table layout is functioning correctly.

- U6 is ALWAYS "status": "potential" — NEVER "confirmed".
- Confidence range: 0.60–0.80 (cap at 0.80).
- Do NOT use page/component/test names as evidence.
- Each U6 finding must reference specific visible layout patterns as evidence.
- Output U6 using structured u6Elements format:
\`\`\`json
{
  "ruleId": "U6",
  "ruleName": "Weak grouping / layout coherence",
  "category": "usability",
  "status": "potential",
  "isU6Aggregated": true,
  "u6Elements": [
    {
      "elementLabel": "Form section",
      "elementType": "section",
      "location": "Screenshot #1",
      "detection": "Related form fields lack visual grouping",
      "evidence": "Input fields for name, email, and phone appear as a flat list without section headers or visual containers",
      "recommendedFix": "Group related fields under section headings or visual containers",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary...",
  "confidence": 0.70
}
\`\`\`
- If NO U6 issues found, do NOT include U6 in the violations array.

## PASS 3 — Ethics
Reason about patterns that may undermine user autonomy or informed consent:
- Imbalanced choice architecture: visual weight, pre-selection, or ordering that nudges users (E2)
- Obscured user controls: opt-out, cancel, dismiss, or unsubscribe options that are suppressed (E3)

### E1 (Insufficient Transparency in High-Impact Actions) — LLM PERCEPTUAL:
Assess whether high-impact actions (delete, purchase, subscribe, reset) visibly disclose consequences, costs, or data implications.
- Look for: visible price/billing near purchase buttons, irreversibility warnings near destructive actions, confirmation steps, data/consent explanations.
- E1 is ALWAYS "Potential" — NEVER "Confirmed". Confidence: 0.60–0.80.
- Do NOT infer malicious intent. Use neutral language.
- Return structured e1Elements:
\`\`\`json
{
  "ruleId": "E1", "ruleName": "Insufficient transparency in high-impact actions", "category": "ethics",
  "status": "potential", "isE1Aggregated": true,
  "e1Elements": [{ "elementLabel": "...", "elementType": "button", "location": "Screenshot #1", "detection": "...", "evidence": "...", "recommendedFix": "...", "confidence": 0.70 }]
}
\`\`\`

### E2 (Imbalanced Choice Architecture in High-Impact Decisions) — LLM PERCEPTUAL:
E2 flags choice imbalance ONLY in high-impact decision contexts: consent/privacy, monetization/payment, irreversible actions, data sharing.
- **HIGH-IMPACT GATE (REQUIRED):** Only evaluate if visible CTA context includes: consent, cookie, payment, subscribe, upgrade, delete, confirm, privacy, data sharing keywords.
- **MUST NOT FLAG:** Standard "Sign Up" primary + "Sign In" secondary on landing pages. Navigation vs auth buttons. Marketing layouts without consent/monetization context.
- **SAFETY PATTERN EXCLUSION (CRITICAL):** A destructive action styled in red/warning color (e.g., red "Delete" button) paired with a clearly visible neutral cancel/keep/go-back button is a STANDARD SAFETY PATTERN, not manipulative architecture. This includes: red destructive button + neutral cancel button, confirmation dialogs with warning text, additional acknowledgement checkboxes. If both options are clearly visible and accessible, do NOT report E2.
- **REQUIRE 2+ imbalance signals:** visual dominance asymmetry, size difference, language bias, default selection, ambiguous alternative.
- Do NOT infer malicious intent. Use neutral phrasing ("imbalance risk", "may nudge").
- E2 is ALWAYS "Potential" — NEVER "Confirmed". Confidence: 0.55–0.75 (cap at 0.75).
- If no high-impact context visible or only 1 signal → do NOT report E2.
- Return structured e2Elements:
\`\`\`json
{
  "ruleId": "E2", "ruleName": "Imbalanced choice architecture in high-impact decision", "category": "ethics",
  "status": "potential", "isE2Aggregated": true,
  "e2Elements": [{ "elementLabel": "...", "elementType": "button-group", "location": "Screenshot #1", "detection": "...", "evidence": "...", "recommendedFix": "Present confirm/decline options with comparable visual weight.", "confidence": 0.65 }]
}
\`\`\`

### E3 (Structural Absence of Exit/Cancel for High-Impact Actions) — LLM PERCEPTUAL:
E3 triggers ONLY if a high-impact action (delete, payment, subscribe, account deletion) is visible AND no cancel/close/back/exit control is seen in the same region.
- Do NOT flag: visual imbalance between buttons (that is E2), missing consequence text (that is E1), or wizard/step navigation (that is U4).
- If cancel/close/back/exit IS visible near the high-impact action → do NOT report E3.
- If uncertainty exists → downgrade confidence below 0.65 and suppress.
- E3 is ALWAYS "Potential" — NEVER "Confirmed". Confidence: 0.65–0.80 (cap at 0.80).
- Return structured e3Elements:
\`\`\`json
{
  "ruleId": "E3", "ruleName": "Obscured or restricted user control", "category": "ethics",
  "status": "potential", "isE3Aggregated": true,
  "e3Elements": [{ "elementLabel": "Delete dialog without cancel", "elementType": "dialog", "location": "Screenshot #1", "detection": "...", "evidence": "...", "recommendedFix": "...", "confidence": 0.75 }]
}
\`\`\`

Ethics rules to check:
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## IMPORTANT CONSTRAINTS
- Even if no code-level violations are found, usability and ethical analysis MUST still be performed
- Absence of evidence does NOT imply absence of usability or ethical issues
- For each category, output triggered rules OR explicitly state "No violations detected after reasoning"
- Be thorough but avoid false positives - only report violations with clear evidence
${includesA1 ? '- For A1 (contrast): All screenshot findings are status "potential" with perceptual assessment. No numeric ratios. No confirmed status.' : ''}

## OUTPUT FORMAT (JSON)
For EACH violation, you MUST provide:
1. **diagnosis**: Detailed, evidence-based explanation of WHY the rule is violated. Reference UI elements conceptually (e.g., "success message", "filter chips", "primary button").
2. **contextualHint**: A short (1 sentence) high-level hint summarizing WHERE the issue appears and WHAT kind of adjustment is needed. Keep it descriptive, not implementation-level.
${includesA1 ? `3. For A1 only: Include "status": "potential", "perceivedContrast": "low", "perceptualRationale", and "suggestedFix" fields. No numeric ratios.` : ''}

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

## NOTE ON A1 PERCEPTUAL MODE
A1 findings for screenshots use perceptual assessment only. The AI outputs perceivedContrast, perceptualRationale, and suggestedFix fields directly in the violations array. No a1TextElements array is needed.

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
    // A1 for screenshots is now fully LLM-based perceptual — no pixel sampling
    
    const allRulesForViolations = [...rules.accessibility, ...rules.usability, ...rules.ethics];
    
    // CRITICAL: Filter violations to ONLY include selected rules
    const includesA1 = selectedRulesSet.has('A1');
    const includesA2 = selectedRulesSet.has('A2');

    // A1 screenshot: LLM outputs findings directly in violations array (no a1Candidates pipeline)
    // No pixel sampling, no two-stage hybrid — pure perceptual
    let computedA1Violations: any[] = [];
    console.log(`A1 screenshot mode: fully LLM-based perceptual (no pixel sampling)`);

    const filteredBySelection = (analysisResult.violations || []).filter((v: any) => {
      const isSelected = selectedRulesSet.has(v.ruleId);
      if (!isSelected) {
        console.log(`Filtering out violation for unselected rule: ${v.ruleId}`);
      }
      return isSelected;
    });
    
    console.log(`Filtered ${(analysisResult.violations || []).length - filteredBySelection.length} violations from unselected rules`);
    
    // Separate A1 and A2 violations for aggregation
    // A1 now comes directly from LLM violations (perceptual) — no pixel pipeline
    const a1Violations: any[] = [];
    const a2Violations: any[] = [];
    const otherViolations: any[] = [];
    
    // Filter LLM violations — A1 accepted directly (perceptual), A3/A4/A5/A6 suppressed
    const screenshotSuppressedRuleIds = new Set(['A3', 'A4', 'A5', 'A6']);
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A1') {
        // A1 is now perceptual LLM-based — accept and normalize
        v.status = 'potential'; // Screenshot A1 always potential
        v.blocksConvergence = false;
        v.a1Method = 'LLM-perceptual';
        v.evaluationMethod = 'llm_assisted';
        v.samplingMethod = 'inferred';
        v.inputType = 'screenshots';
        v.perceivedContrast = 'low';
        v.perceptualRationale = v.diagnosis || 'Perceptual assessment detected potential low contrast.';
        v.contextualHint = 'Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.';
        // Clamp confidence to valid range (suppression happens in post-processing)
        v.confidence = Math.max(0.40, Math.min(0.90, v.confidence || 0.65));
        a1Violations.push(v);
      } else if (screenshotSuppressedRuleIds.has(v.ruleId)) {
        console.log(`${v.ruleId}: Suppressed (requires DOM, not evaluable from screenshots): ${(v.evidence || '').substring(0, 80)}`);
        return;
      } else if (v.ruleId === 'A2' || v.ruleId === 'A5') {
        v.ruleId = 'A2';
        a2Violations.push(v);
      } else {
        otherViolations.push(v);
      }
    });

    // A1 perceptual summary
    console.log(`A1 screenshot (perceptual): ${a1Violations.length} findings from LLM`);

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
      
      // ========== SAME-TASK SUPPRESSION ==========
      // Multiple buttons that lead to the same user task/flow are redundant entry points, not competing actions.
      // e.g., "Compose" in header + "Send your first message" in empty state
      const primaryAction = (v.primaryAction || '').toLowerCase();
      const secondaryAction = (v.secondaryAction || '').toLowerCase();
      const allActions = `${primaryAction} ${secondaryAction} ${combined}`;
      
      // Detect empty-state CTA patterns (redundant entry points)
      const hasEmptyStateSignal = /empty\s*state|no\s+(?:items?|data|results?|messages?|projects?)|get\s+started|first\s+(?:item|message|project|entry)|send\s+your\s+first|create\s+your\s+first|add\s+your\s+first/.test(allActions);
      const hasHeaderToolbarSignal = /header|toolbar|top\s*bar|nav(?:igation)?|sidebar/.test(allActions);
      
      // Detect same-task synonyms (compose/send, add/create, new/create)
      const sameTaskPairs = [
        [/\b(?:compose|write|draft)\b/, /\b(?:send|create|new)\b/],
        [/\b(?:add|create|new)\b/, /\b(?:create|add|new)\b/],
        [/\b(?:start|begin|get\s+started)\b/, /\b(?:create|new|add)\b/],
        [/\b(?:upload|import)\b/, /\b(?:add|create)\b/],
      ];
      
      const isSameTask = sameTaskPairs.some(([pat1, pat2]) => 
        (pat1.test(primaryAction) && pat2.test(secondaryAction)) || 
        (pat2.test(primaryAction) && pat1.test(secondaryAction))
      );
      
      if ((hasEmptyStateSignal && hasHeaderToolbarSignal) || (isSameTask && hasEmptyStateSignal)) {
        console.log(`U1: Filtering out same-task redundant entry points: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Also suppress if different regions are explicitly mentioned
      const hasDifferentRegions = /(?:header|toolbar|top).*(?:empty\s*state|main\s*content|body|center)|(?:empty\s*state|main\s*content|body).*(?:header|toolbar|top)/.test(allActions);
      if (hasDifferentRegions && isSameTask) {
        console.log(`U1: Filtering out same-task buttons in different regions: ${v.evidence?.substring(0, 100)}`);
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
    
    // ========== U1 SCREENSHOT CONFIDENCE GATE ==========
    // For screenshot modality, only report U1 with confidence ≥ 60% (aligned with global perceptual policy)
    const confidenceGatedU1 = validatedU1Violations.filter((v: any) => {
      const conf = v.confidence || 0.65;
      if (conf < 0.60) {
        console.log(`U1: Suppressed (screenshot confidence ${Math.round(conf * 100)}% < 60%): ${(v.evidence || '').substring(0, 100)}`);
        return false;
      }
      return true;
    });
    
    if (validatedU1Violations.length > 0 && confidenceGatedU1.length === 0) {
      console.log(`U1: All ${validatedU1Violations.length} findings suppressed by confidence gate (<60%)`);
    }
    
    // Process non-A1/A2/U1 violations
    let filteredOtherViolations = [...nonU1OtherViolations, ...confidenceGatedU1]
      .map((v: any) => {
        const rule = allRulesForViolations.find(r => r.id === v.ruleId);
        // HARD GUARDRAIL: U4, U6 are ALWAYS Potential (non-blocking), never Confirmed
        // U5 is NOT evaluated for screenshots — filter it out
        if (v.ruleId === 'U5') return null;
        const isU4 = v.ruleId === 'U4';
        const isU6 = v.ruleId === 'U6';
        const isU3 = v.ruleId === 'U3';
        // Tag with evaluationMethod — all screenshot LLM violations are llm_assisted
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
          evaluationMethod: 'llm_assisted',
          ...(isU3 ? {
            status: 'potential',
            blocksConvergence: false,
            confidence: Math.min(v.confidence || 0.60, 0.75),
            inputType: 'screenshots',
          } : {}),
          ...(isU4 ? {
            status: 'potential',
            blocksConvergence: false,
            confidence: Math.min(v.confidence || 0.65, 0.80),
          } : {}),
          ...(isU6 ? {
            status: 'potential',
            blocksConvergence: false,
            confidence: Math.min(v.confidence || 0.65, 0.80),
            isU6Aggregated: v.isU6Aggregated || false,
          } : {}),
        };
      }).filter(Boolean);

    // ========== U3 SCREENSHOT POST-PROCESSING ==========
    // Enforce visual-cue gating: only keep U3 findings with actual truncation evidence
    // Also standardize fields for screenshot modality
    const u3ScreenshotViolations = filteredOtherViolations.filter((v: any) => v.ruleId === 'U3');
    const nonU3Violations = filteredOtherViolations.filter((v: any) => v.ruleId !== 'U3');
    
    const validU3Screenshots: any[] = [];
    for (const v of u3ScreenshotViolations) {
      const combined = `${v.evidence || ''} ${v.diagnosis || ''} ${v.detection || ''}`.toLowerCase();
      
      // Strict visual-cue gating
      const hasEllipsis = /ellipsis|…|\.\.\./.test(combined);
      const hasCutOff = /cut.?off|truncat|clip|cropped|mid.?line|overflow/.test(combined);
      const hasFade = /fade|mask|gradient.*overflow|overlay/.test(combined);
      const hasOverlap = /overlap|exit.*bound|beyond.*container|outside.*area/.test(combined);
      
      if (!hasEllipsis && !hasCutOff && !hasFade && !hasOverlap) {
        console.log(`U3 screenshot: Filtering out — no visual truncation cue: ${(v.evidence || v.diagnosis || '').substring(0, 100)}`);
        continue;
      }
      
      // ========== RECOVERY MECHANISM SUPPRESSION ==========
      // Check ALL text fields (evidence, diagnosis, recoveryObserved, u3Elements) for recovery cues
      const allText = combined + ` ${(v.recoveryObserved || '')} ${(v.contextualHint || '')}`.toLowerCase();
      // Also check u3Elements for recovery signals
      const elementRecovery = (v.isU3Aggregated && Array.isArray(v.u3Elements))
        ? v.u3Elements.map((el: any) => `${el.recoveryObserved || ''} ${(el.recoverySignals || []).join(' ')} ${el.evidence || ''} ${el.detection || ''}`).join(' ').toLowerCase()
        : '';
      const recoveryText = allText + ' ' + elementRecovery;
      
      // Detect recovery mechanisms across all text
      const hasHScrollbar = /horizontal\s*scroll|scroll.?bar.*bottom|bottom.*scroll|scrollable\s*region/i.test(recoveryText);
      const hasVScrollbar = /vertical\s*scroll|scroll.?bar.*right|right.*scroll/i.test(recoveryText);
      const hasScrollbar = hasHScrollbar || hasVScrollbar || /scrollable|scroll\s*observed|scrollbar\s*visible|scroll\s*track|scroll\s*thumb/i.test(recoveryText);
      const hasExpandControl = /show\s*more|expand(able)?(\s*control)?|view\s*all|view\s*more/i.test(recoveryText);
      const hasTooltip = /tooltip\s*(observed|likely|on\s*hover|visible)/i.test(recoveryText);
      
      if (hasScrollbar || hasExpandControl || hasTooltip) {
        const recoveryType = hasHScrollbar ? 'horizontal scrollbar' : hasVScrollbar ? 'vertical scrollbar' : hasScrollbar ? 'scrollbar' : hasExpandControl ? 'expand control' : 'tooltip';
        console.log(`U3 screenshot: Suppressed — recovery mechanism detected (${recoveryType}): ${(v.evidence || '').substring(0, 80)}`);
        continue;
      }
      
      // Sanitize code-centric language from diagnosis
      let cleanDiagnosis = (v.diagnosis || '').replace(/static analysis\s*(flagged|identified|detected)?/gi, 'Visual inspection suggests');
      
      // Normalize recoveryObserved to enum values
      const normalizeRecovery = (raw: string | undefined): string => {
        if (!raw) return 'None observed';
        const lower = raw.toLowerCase();
        if (/scroll/i.test(lower)) return 'Scrollable region observed';
        if (/expand|show\s*more|view\s*(all|more)/i.test(lower)) return 'Expandable control observed';
        if (/tooltip/i.test(lower)) return 'Tooltip likely';
        if (/uncertain|ambiguous|unclear/i.test(lower)) return 'Uncertain';
        if (/none/i.test(lower)) return 'None observed';
        return raw;
      };
      
      // If the violation is already aggregated with u3Elements, sanitize each element
      if (v.isU3Aggregated && Array.isArray(v.u3Elements)) {
        v.u3Elements = v.u3Elements.filter((el: any) => {
          // Check element-level recovery from all fields
          const elAllText = `${el.recoveryObserved || ''} ${(el.recoverySignals || []).join(' ')} ${el.evidence || ''} ${el.detection || ''}`.toLowerCase();
          const elHasScroll = /scroll/i.test(elAllText) && !/none|uncertain/i.test(el.recoveryObserved || '');
          const elHasExpand = /show\s*more|expand|view\s*(all|more)/i.test(elAllText) && !/none|uncertain/i.test(el.recoveryObserved || '');
          const elHasTooltip = /tooltip\s*(observed|likely|visible)/i.test(elAllText);
          if (elHasScroll || elHasExpand || elHasTooltip) {
            console.log(`U3 screenshot element suppressed — recovery: ${elAllText.substring(0, 60)}`);
            return false;
          }
          return true;
        });
        
        v.u3Elements = v.u3Elements.map((el: any) => ({
          ...el,
          classification: 'potential',
          recoveryObserved: normalizeRecovery(el.recoveryObserved || (el.recoverySignals && el.recoverySignals.length > 0 ? el.recoverySignals.join(', ') : undefined)),
          inputType: 'screenshots',
        }));
        
        // If all elements were suppressed, skip the entire violation
        if (v.u3Elements.length === 0) {
          console.log(`U3 screenshot: All elements suppressed by recovery — skipping card`);
          continue;
        }
      }
      
      v.diagnosis = cleanDiagnosis || 'Visual inspection suggests content may be clipped; verify in context.';
      
      // Context-aware advisory: detect table/admin vs review/confirm context
      const contextText = `${v.evidence || ''} ${v.diagnosis || ''} ${v.contextualHint || ''}`.toLowerCase();
      const isTableContext = /table|admin|list|grid|column|row|cell|doctor|patient|record/i.test(contextText);
      const isReviewContext = /review|confirm|summary|checkout|submit|verify|order/i.test(contextText);
      
      if (isTableContext) {
        v.advisoryGuidance = 'Ensure long table values are readable (wrap, tooltip on hover, expandable cell, or scroll).';
      } else if (isReviewContext) {
        v.advisoryGuidance = 'Ensure long user-entered text wraps or can be expanded (e.g., Show more, tooltip, scroll) on the review/confirmation screen so users can fully verify inputs before submission.';
      } else {
        v.advisoryGuidance = 'Ensure content is fully readable. Consider wrapping, tooltips, expandable sections, or scrollable regions for long text.';
      }
      
      v.inputType = 'screenshots';
      
      validU3Screenshots.push(v);
      console.log(`U3 screenshot: Kept finding with visual cue: ${(v.evidence || '').substring(0, 80)}`);
    }
    
    filteredOtherViolations = [...nonU3Violations, ...validU3Screenshots];

    // ========== U6 SCREENSHOT POST-PROCESSING ==========
    // Suppress U6 findings about data tables with scrolling or truncation (belongs to U3)
    const u6ScreenshotViolations = filteredOtherViolations.filter((v: any) => v.ruleId === 'U6');
    const nonU6Violations = filteredOtherViolations.filter((v: any) => v.ruleId !== 'U6');
    
    const validU6Screenshots: any[] = [];
    for (const v of u6ScreenshotViolations) {
      const combined = `${v.evidence || ''} ${v.diagnosis || ''} ${v.contextualHint || ''}`.toLowerCase();
      const elemTexts = (v.isU6Aggregated && Array.isArray(v.u6Elements))
        ? v.u6Elements.map((el: any) => `${el.evidence || ''} ${el.detection || ''}`).join(' ').toLowerCase()
        : '';
      const allText = combined + ' ' + elemTexts;
      
      // Suppress if finding is about a structured data table with scrolling
      const isTableContext = /\btable\b|data.?table|admin.?table|data.?grid|\bcolumn\b.*\brow\b|\brow\b.*\bcolumn\b/i.test(allText);
      const hasScrollMention = /scroll|overflow|horizontal/i.test(allText);
      const hasAlignedStructure = /align|column.*header|header.*column|consistent.*row|uniform|grid.?line|border.*row/i.test(allText);
      
      if (isTableContext && (hasScrollMention || hasAlignedStructure)) {
        console.log(`U6 screenshot: Suppressed — structured data table: ${(v.evidence || '').substring(0, 80)}`);
        continue;
      }
      
      // Suppress if finding is actually about truncation/overflow (belongs to U3)
      const isTruncationIssue = /truncat|ellipsis|text.?cut.?off|clip|overflow.*content|content.*overflow|text.*overflow/i.test(allText);
      if (isTruncationIssue && !/(overlap|scatter|misalign|irregular.?spacing|missing.?section|float|break.*hierarchy)/i.test(allText)) {
        console.log(`U6 screenshot: Suppressed — truncation belongs to U3: ${(v.evidence || '').substring(0, 80)}`);
        continue;
      }
      
      // Filter individual u6Elements if aggregated
      if (v.isU6Aggregated && Array.isArray(v.u6Elements)) {
        v.u6Elements = v.u6Elements.filter((el: any) => {
          const elText = `${el.evidence || ''} ${el.detection || ''}`.toLowerCase();
          const elIsTable = /\btable\b|data.?table|column.*row|row.*column/i.test(elText);
          const elIsScroll = /scroll|overflow/i.test(elText);
          const elIsTruncation = /truncat|ellipsis|text.?cut|clip/i.test(elText);
          if ((elIsTable && elIsScroll) || (elIsTruncation && !/(overlap|scatter|misalign)/i.test(elText))) {
            console.log(`U6 element suppressed — table/truncation: ${elText.substring(0, 60)}`);
            return false;
          }
          return true;
        });
        if (v.u6Elements.length === 0) {
          console.log(`U6 screenshot: All elements suppressed — skipping card`);
          continue;
        }
      }
      
      validU6Screenshots.push(v);
    }
    
    filteredOtherViolations = [...nonU6Violations, ...validU6Screenshots];

    // ========== A1 PROCESSING (Screenshot — LLM Perceptual Only) ==========
    // For screenshots: A1 is fully LLM-based perceptual. No pixel sampling, no hex colors, no contrast ratios.
    // All findings are Potential. Deduplication by screenshot + elementDescription.
    
    const perElementA1Violations: any[] = [];
    
    const a1DedupeSet = new Set<string>();
    let a1SuppressedCount = 0;
    for (const v of a1Violations) {
      const dedupeKey = `${v.evidence || ''}|${v.elementDescription || ''}`.toLowerCase().replace(/\s+/g, '');
      if (a1DedupeSet.has(dedupeKey)) continue;
      a1DedupeSet.add(dedupeKey);
      
      const thresholdUsed = v.textSize === 'large' ? 3.0 : 4.5;
      
      // ========== CONFIDENCE-BASED SUPPRESSION (Screenshot A1) ==========
      // Badge/pill label detection: status badges with colored backgrounds
      // and white/light text are often well-designed — reduce confidence
      let adjustedConfidence = v.confidence || 0.65;
      const elementDesc = (v.elementDescription || v.elementRole || '').toLowerCase();
      const evidenceText = (v.evidence || '').toLowerCase();
      const diagnosisText = (v.diagnosis || '').toLowerCase();
      const combinedA1 = `${elementDesc} ${evidenceText} ${diagnosisText}`;
      
      const isBadgeOrPill = /\b(badge|pill|tag|chip|label|status|indicator)\b/.test(combinedA1) &&
        /\b(active|available|scheduled|pending|approved|completed|enabled|disabled|online|offline|open|closed|new|draft|published|verified|inactive|busy|away|expired|paused|archived|cancelled|confirmed|resolved)\b/i.test(combinedA1);
      const isColoredBgWhiteText = /(?:colored|tinted|colored?\s+background).*(?:white|light)\s+text|(?:white|light)\s+text.*(?:colored|tinted)\s+(?:background|bg)|(?:green|blue|red|orange|yellow|purple|teal|cyan|indigo|emerald|amber|rose)\s+(?:background|bg|pill|badge)/.test(combinedA1);
      
      if (isBadgeOrPill || isColoredBgWhiteText) {
        adjustedConfidence -= 0.20;
        console.log(`A1 screenshot: Badge/pill penalty applied (-20%) → ${Math.round(adjustedConfidence * 100)}%: ${(v.evidence || '').substring(0, 80)}`);
      }
      
      // Clamp to valid range
      adjustedConfidence = Math.max(0, Math.min(0.90, adjustedConfidence));
      
      // Suppress below 60% threshold
      if (adjustedConfidence < 0.60) {
        a1SuppressedCount++;
        console.log(`A1 screenshot: Suppressed (confidence ${Math.round(adjustedConfidence * 100)}% < 60%): ${(v.evidence || v.elementDescription || '').substring(0, 100)}`);
        continue;
      }
      
      perElementA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        inputType: 'screenshots',
        a1Method: 'LLM-perceptual',
        samplingMethod: 'inferred',
        evaluationMethod: 'llm_assisted',
        // Element identification
        elementDescription: v.elementDescription || v.elementRole || 'Text element',
        elementRole: v.elementRole,
        evidence: v.evidence || 'Screenshot',
        textSize: v.textSize || 'normal',
        textSnippet: v.textSnippet,
        // Perceptual fields (NO hex colors, NO contrast ratios)
        perceivedContrast: 'low',
        perceptualRationale: v.diagnosis || 'Perceptual assessment detected potential low contrast.',
        diagnosis: v.diagnosis || 'Perceptual assessment detected potential low contrast.',
        contextualHint: 'Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.',
        thresholdUsed,
        // Confidence (already validated ≥ 0.60)
        confidence: Math.round(adjustedConfidence * 100) / 100,
        blocksConvergence: false,
      });
    }
    
    console.log(`A1 per-element (perceptual): ${perElementA1Violations.length} findings, ${a1SuppressedCount} suppressed (<60% confidence)`);
    // ========== A2 AGGREGATION LOGIC (Screenshot — Focus Visibility, three-tier) ==========
    // For screenshot input: A2 uses three-tier classification:
    //   1. not_evaluated (informational) — no focused state observable in screenshot
    //   2. potential — focused element shown but no visible indicator
    //   3. no finding — visible focus indicator shown (PASS)
    // A2 is NEVER confirmed from screenshots.
    interface A2FocusItemUI {
      component_name: string;
      location: string;
      typeBadge: 'Heuristic';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }

    const a2DedupeMapUI = new Map<string, A2FocusItemUI>();
    const a2ValidViolationsUI: any[] = [];
    let a2HasNotEvaluated = false;

    for (const v of a2Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      const status = (v.status || '').toLowerCase();

      // NOT EVALUATED: no focused state observable in screenshot
      if (status === 'not_evaluated' || /cannot.*assess|not observable|no focused state|no focus state shown|cannot determine|unable to assess|not visible in screenshot/.test(combined)) {
        console.log(`A2 NOT_EVALUATED (focus state not observable): ${evidence}`);
        a2HasNotEvaluated = true;
        continue;
      }

      // PASS: has visible focus ring/border/indicator
      const hasVisibleFocusRing = /has.*ring|visible ring|shows.*ring|focus ring|ring.*focus/i.test(combined);
      const hasVisibleFocusBorder = /has.*border|visible border|shows.*border|focus border|border.*focus/i.test(combined);
      const hasVisibleFocusIndicator = /has.*focus indicator|visible focus indicator|clear focus/i.test(combined);
      if (hasVisibleFocusRing || hasVisibleFocusBorder || hasVisibleFocusIndicator) {
        console.log(`A2 PASS (has visible focus indicator): ${evidence}`);
        continue;
      }

      // PASS: explicitly acceptable
      const mentionsAcceptable = /(?<!no\s)(?<!without\s)(?<!lacks?\s)(?<!missing\s)(?:acceptable|compliant|proper focus|adequate)/i.test(combined);
      const explicitlyPasses = /\bpass\b(?!word)/i.test(combined) && !/does not pass|doesn't pass|fail/i.test(combined);
      if (mentionsAcceptable || explicitlyPasses) {
        console.log(`A2 PASS (explicitly acceptable): ${evidence}`);
        continue;
      }

      console.log(`A2 VIOLATION (screenshot heuristic — potential): ${evidence}`);
      a2ValidViolationsUI.push(v);
    }

    // Aggregate valid A2 violations (potential — focused element with no indicator)
    for (const v of a2ValidViolationsUI) {
      const evidence = (v.evidence || '');
      const combined = (evidence + ' ' + (v.diagnosis || '')).toLowerCase();

      const locationMatch = (evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar)?)/i);
      const componentMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Button|Close|Toggle|Trigger|Nav|Icon|Control|Action|Link|Card|Dialog|Modal|Menu|Header|Footer|Sidebar|Panel|Form))\b/);
      const simpleComponentMatch = evidence.match(/(?:the\s+)?([A-Z][a-zA-Z0-9]{3,})/);

      let componentName = '';
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      } else if (simpleComponentMatch?.[1] && simpleComponentMatch[1].length > 3) {
        componentName = simpleComponentMatch[1];
      }

      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      let confidence = v.confidence || 0.55;
      confidence = Math.min(confidence, 0.75); // Cap for screenshot

      const rationale = 'Interactive element appears to lack a visible focus indicator for keyboard users.';

      // ── A2 confidence suppression: suppress findings below 60% ──
      if (confidence < 0.60) {
        console.log(`A2 SUPPRESSED (<60% confidence: ${Math.round(confidence * 100)}%): ${componentName || location || 'unknown'}`);
        continue;
      }

      const dedupeKey = componentName || location || 'unknown';

      if (a2DedupeMapUI.has(dedupeKey)) {
        const existing = a2DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) existing.confidence = confidence;
      } else {
        a2DedupeMapUI.set(dedupeKey, {
          component_name: componentName,
          location,
          typeBadge: 'Heuristic',
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        });
      }
    }

    const a2AffectedItemsUI = Array.from(a2DedupeMapUI.values());

    let aggregatedA2UI: any = null;

    if (a2AffectedItemsUI.length > 0) {
      // Tier 2: Potential — focused element shown but no visible indicator
      const overallConfidence = Math.max(...a2AffectedItemsUI.map(i => i.confidence));

      const a2Elements = a2AffectedItemsUI.map((item, idx) => {
        const screenshotIdx = idx + 1;
        const contextLabel = item.component_name || item.location || 'Interactive element';
        const formattedLocation = `Screenshot #${screenshotIdx} — Screenshot (${contextLabel})`;

        let elementType = 'interactive element';
        const combinedName = (item.component_name + ' ' + item.location).toLowerCase();
        if (/button/i.test(combinedName)) elementType = 'button';
        else if (/link/i.test(combinedName)) elementType = 'link';
        else if (/input/i.test(combinedName)) elementType = 'input';

        return {
          elementLabel: item.component_name || `Interactive element ${idx + 1}`,
          elementType,
          textSnippet: undefined,
          location: formattedLocation,
          detection: 'Visual heuristic: focused element lacks visible focus indicator',
          detectionMethod: 'llm_assisted' as const,
          focusClasses: [],
          classification: 'potential' as const,
          potentialSubtype: 'accuracy' as const,
          potentialReason: 'No visible focus indicator observed.',
          explanation: item.rationale,
          confidence: item.confidence,
          correctivePrompt: undefined,
          deduplicationKey: `${item.location}|${item.component_name}`,
        };
      });

      aggregatedA2UI = {
        ruleId: 'A2',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        status: 'potential',
        potentialSubtype: 'accuracy',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA2Aggregated: true,
        a2Elements,
        evaluationMethod: 'llm_assisted',
        diagnosis: `${a2Elements.length} interactive element${a2Elements.length !== 1 ? 's' : ''} with missing focus indicators detected in screenshot.`,
        contextualHint: 'Add visible focus-visible indicators (ring, outline, border) for keyboard accessibility.',
        correctivePrompt: '',
        confidence: Math.round(overallConfidence * 100) / 100,
        advisoryGuidance: 'Visual inspection suggests potential focus visibility issues. Focus indicators require keyboard interaction and code inspection for confirmation.',
      };

      console.log(`A2 aggregated (screenshot): ${a2Violations.length} findings → ${a2AffectedItemsUI.length} potential (after ≥60% confidence gate) → 1 result`);
    } else if (a2HasNotEvaluated && includesA2) {
      // Tier 1: Not Evaluated — no focused state observable in screenshot
      aggregatedA2UI = {
        ruleId: 'A2',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA2Aggregated: false,
        evaluationMethod: 'llm_assisted',
        diagnosis: 'Focus state not observable in provided screenshot. Focus visibility cannot be assessed without a captured focused state.',
        contextualHint: 'Upload source code for deterministic focus visibility analysis, or provide a screenshot showing a focused element.',
        correctivePrompt: '',
        confidence: 0,
        potentialReason: 'Focus state not observable in provided screenshot.',
        advisoryGuidance: 'Focus visibility requires either source code analysis or a screenshot that captures a focused interactive element. Upload ZIP or GitHub for deterministic evaluation.',
      };

      console.log(`A2 not_evaluated (screenshot): no focused state observable — emitting informational card`);
    } else {
      console.log(`A2: No valid violations found (${a2Violations.length} filtered out as PASS or NOT APPLICABLE)`);
    }
    
    // ========== A1 AGGREGATION (Screenshot — Perceptual Only) ==========
    // All screenshot A1 findings are Potential. No Confirmed card for screenshots.
    // Build simple perceptual sub-items with no hex/ratio fields.
    
    const aggregatedA1Violations: any[] = [];
    
    if (perElementA1Violations.length > 0) {
      const elements = perElementA1Violations.map((v: any) => {
        const screenPart = v.evidence?.match(/Screenshot #(\d+)/)?.[1] || '1';
        const dedupeKey = `${screenPart}-${(v.elementDescription || '').toLowerCase().replace(/\s+/g, '')}`;
        return {
          elementLabel: v.elementDescription || v.elementRole || 'Text element',
          textSnippet: v.textSnippet,
          location: v.evidence || 'Screenshot',
          screenshotIndex: parseInt(screenPart),
          thresholdUsed: v.thresholdUsed || 4.5,
          explanation: v.diagnosis,
          deduplicationKey: dedupeKey,
          a1Method: 'LLM-perceptual',
          // Perceptual-only fields
          perceivedContrast: 'low',
          perceptualRationale: v.perceptualRationale || v.diagnosis || '',
          contrastNotMeasurable: true,
          screenshotTextSize: v.textSize || 'normal',
          textType: v.textSize === 'large' ? 'large' : 'normal',
          appliedThreshold: v.thresholdUsed || 4.5,
          wcagCriterion: '1.4.3',
          confidence: v.confidence,
        };
      });
      
      const avgConfidence = perElementA1Violations.reduce((sum: number, v: any) => sum + (v.confidence || 0.65), 0) / perElementA1Violations.length;
      
      aggregatedA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        isA1Aggregated: true,
        a1Elements: elements,
        diagnosis: `${elements.length} text element${elements.length !== 1 ? 's' : ''} with potential contrast concerns detected via perceptual assessment. Manual verification with developer tools required.`,
        correctivePrompt: '',
        contextualHint: 'Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.',
        confidence: Math.round(avgConfidence * 100) / 100,
        advisoryGuidance: 'Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.',
        blocksConvergence: false,
        inputType: 'screenshots',
        samplingMethod: 'inferred',
        evaluationMethod: 'llm_assisted',
        perceivedContrast: 'low',
      });
      
      console.log(`A1 aggregated (perceptual): ${perElementA1Violations.length} elements → 1 Potential card`);
    }
    
    // ========== A3 Screenshot Mode (advisory only) ==========
    let aggregatedA3UI: any = null;
    if (selectedRulesSet.has('A3')) {
      aggregatedA3UI = {
        ruleId: 'A3',
        ruleName: 'Incomplete keyboard operability',
        category: 'accessibility',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA3Aggregated: false,
        diagnosis: 'Keyboard operability requires DOM and event handler analysis (tabIndex, role, key handlers), which cannot be determined from static screenshots.',
        contextualHint: 'Upload source code (ZIP file or GitHub repository) to enable deterministic keyboard accessibility evaluation.',
        correctivePrompt: '',
        confidence: 0,
        evidence: 'Input type: Screenshot',
      };
    }
    
    // ========== A4 Screenshot Mode (NOT EVALUATED) ==========
    let aggregatedA4UI: any = null;
    if (selectedRulesSet.has('A4')) {
      aggregatedA4UI = {
        ruleId: 'A4',
        ruleName: 'Missing Semantic Structure',
        category: 'accessibility',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA4Aggregated: false,
        diagnosis: 'Semantic structure cannot be verified from a static screenshot. Detection of headings (<h1>–<h6>), landmarks (<main>, <nav>, <header>), ARIA roles, and list semantics requires DOM or source code inspection, which is not observable from an image.',
        contextualHint: 'Upload source code (ZIP file or GitHub repository) to enable deterministic semantic structure analysis.',
        correctivePrompt: '',
        confidence: 0,
        evidence: 'Input type: Screenshot',
      };
    }
    
    // ========== A5 Screenshot Mode (NOT EVALUATED) ==========
    let aggregatedA5UI: any = null;
    if (selectedRulesSet.has('A5')) {
      aggregatedA5UI = {
        ruleId: 'A5',
        ruleName: 'Missing form labels (Input clarity)',
        category: 'accessibility',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA5Aggregated: false,
        diagnosis: 'Form label associations require DOM/HTML analysis; screenshot-only input cannot be evaluated reliably.',
        contextualHint: 'Upload source code (ZIP file or GitHub repository) to enable form label evaluation.',
        correctivePrompt: '',
        confidence: 0,
        evidence: 'Input type: Screenshot',
      };
    }
    
    // ========== A6 Screenshot Mode (NOT EVALUATED) ==========
    let aggregatedA6UI: any = null;
    if (selectedRulesSet.has('A6')) {
      aggregatedA6UI = {
        ruleId: 'A6',
        ruleName: 'Missing accessible names (Name, Role, Value)',
        category: 'accessibility',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isA6Aggregated: false,
        diagnosis: 'Accessible names require DOM/HTML analysis; screenshot-only input cannot be evaluated reliably.',
        contextualHint: 'Upload source code (ZIP file or GitHub repository) to enable accessible name evaluation.',
        correctivePrompt: '',
        confidence: 0,
        evidence: 'Input type: Screenshot',
      };
    }
    
    // ========== U5 Screenshot Mode (NOT EVALUATED) ==========
    let aggregatedU5UI: any = null;
    if (selectedRulesSet.has('U5')) {
      aggregatedU5UI = {
        ruleId: 'U5',
        ruleName: 'Insufficient interaction feedback',
        category: 'usability',
        status: 'informational',
        blocksConvergence: false,
        inputType: 'screenshots',
        isU5Aggregated: false,
        diagnosis: 'Interaction feedback such as loading states, button disabling, or progress indicators occurs during runtime interaction and cannot be reliably assessed from static screenshots.',
        contextualHint: 'Upload source code or provide interaction recordings to evaluate feedback mechanisms during user actions.',
        correctivePrompt: '',
        confidence: 0,
        evidence: 'Input type: Screenshot',
      };
    }
    
    // ========== E1 POST-PROCESSING (Screenshot — LLM perceptual) ==========
    const aggregatedE1UIList: any[] = [];
    if (selectedRulesSet.has('E1')) {
      const e1FromLLM = filteredOtherViolations.filter((v: any) => v.ruleId === 'E1');
      filteredOtherViolations = filteredOtherViolations.filter((v: any) => v.ruleId !== 'E1');

      if (e1FromLLM.length > 0) {
        const aggregatedOne = e1FromLLM.find((v: any) => v.isE1Aggregated && v.e1Elements?.length > 0);
        const e1Elements = aggregatedOne
          ? (aggregatedOne.e1Elements || []).map((el: any) => ({
              elementLabel: el.elementLabel || 'High-impact action',
              elementType: el.elementType || 'action',
              location: el.location || 'Screenshot',
              detection: el.detection || '',
              evidence: el.evidence || '',
              recommendedFix: el.recommendedFix || '',
              confidence: Math.min(el.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_perceptual' as const,
              deduplicationKey: el.deduplicationKey || `E1|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : e1FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'High-impact action',
              elementType: 'action',
              location: 'Screenshot',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || '',
              confidence: Math.min(v.confidence || 0.65, 0.80),
              evaluationMethod: 'llm_perceptual' as const,
              deduplicationKey: `E1|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...e1Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedE1UIList.push({
          ruleId: 'E1', ruleName: 'Insufficient transparency in high-impact actions', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'screenshots', isE1Aggregated: true, e1Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Transparency issues: ${e1Elements.length} potential risk(s) detected via visual analysis.`,
          contextualHint: 'Ensure high-impact actions disclose consequences, costs, or data implications.',
          advisoryGuidance: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E1 aggregated (UI): ${e1FromLLM.length} finding(s) → ${e1Elements.length} element(s)`);
      }
    }

    // ========== E2 POST-PROCESSING (Screenshot — High-Impact Gate + LLM perceptual) ==========
    const aggregatedE2UIList: any[] = [];
    if (selectedRulesSet.has('E2')) {
      const e2FromLLM = filteredOtherViolations.filter((v: any) => v.ruleId === 'E2');
      filteredOtherViolations = filteredOtherViolations.filter((v: any) => v.ruleId !== 'E2');

      if (e2FromLLM.length > 0) {
        const aggregatedOne = e2FromLLM.find((v: any) => v.isE2Aggregated && v.e2Elements?.length > 0);
        const e2Elements = aggregatedOne
          ? (aggregatedOne.e2Elements || []).map((el: any) => ({
              elementLabel: el.elementLabel || 'Choice group',
              elementType: el.elementType || 'button-group',
              location: el.location || 'Screenshot',
              detection: el.detection || '',
              evidence: el.evidence || '',
              recommendedFix: el.recommendedFix || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
              confidence: Math.min(el.confidence || 0.60, 0.75),
              evaluationMethod: 'llm_perceptual' as const,
              deduplicationKey: el.deduplicationKey || `E2|${el.location || ''}|${el.elementLabel || ''}`,
            }))
          : e2FromLLM.map((v: any) => ({
              elementLabel: v.evidence?.split('.')[0] || 'Choice group',
              elementType: 'button-group',
              location: 'Screenshot',
              detection: v.diagnosis || '',
              evidence: v.evidence || '',
              recommendedFix: v.contextualHint || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
              confidence: Math.min(v.confidence || 0.60, 0.75),
              evaluationMethod: 'llm_perceptual' as const,
              deduplicationKey: `E2|${v.evidence || 'unknown'}`,
            }));

        const overallConfidence = Math.min(Math.max(...e2Elements.map((e: any) => e.confidence)), 0.75);
        aggregatedE2UIList.push({
          ruleId: 'E2', ruleName: 'Imbalanced choice architecture in high-impact decision', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'screenshots', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
          diagnosis: `Choice architecture imbalance: ${e2Elements.length} potential risk(s) in high-impact decision context.`,
          contextualHint: 'Present confirm/decline options with comparable visual weight and equal discoverability.',
          advisoryGuidance: 'Present confirm/decline options with comparable visual weight and equal discoverability. Avoid preselected consent/paid options; ensure opt-out is as easy as opt-in.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E2 aggregated (UI): ${e2FromLLM.length} finding(s) → ${e2Elements.length} element(s)`);
      }
    }

    // ========== E3 POST-PROCESSING (Structural Exit Absence — LLM perceptual) ==========
    const aggregatedE3UIList: any[] = [];
    if (selectedRulesSet.has('E3')) {
      const e3FromLLM = filteredOtherViolations.filter((v: any) => v.ruleId === 'E3');
      filteredOtherViolations = filteredOtherViolations.filter((v: any) => v.ruleId !== 'E3');

      if (e3FromLLM.length > 0) {
        const aggregatedOne = e3FromLLM.find((v: any) => v.isE3Aggregated && v.e3Elements?.length > 0);
        const e3Elements = aggregatedOne
          ? (aggregatedOne.e3Elements || [])
              .map((el: any) => ({
                elementLabel: el.elementLabel || 'High-impact action without exit',
                elementType: el.elementType || 'unknown',
                location: el.location || 'Screenshot',
                subCheck: el.subCheck,
                detection: el.detection || '',
                evidence: el.evidence || '',
                recommendedFix: el.recommendedFix || '',
                confidence: Math.min(el.confidence || 0.60, 0.80),
                evaluationMethod: 'llm_perceptual' as const,
                deduplicationKey: el.deduplicationKey || `E3|${el.location || ''}|${el.elementLabel || ''}`,
              }))
              .filter((el: any) => el.confidence >= 0.65)
          : e3FromLLM
              .map((v: any) => ({
                elementLabel: v.evidence?.split('.')[0] || 'High-impact action without exit',
                elementType: 'unknown',
                location: 'Screenshot',
                detection: v.diagnosis || '',
                evidence: v.evidence || '',
                recommendedFix: v.contextualHint || '',
                confidence: Math.min(v.confidence || 0.60, 0.80),
                evaluationMethod: 'llm_perceptual' as const,
                deduplicationKey: `E3|${v.evidence || 'unknown'}`,
              }))
              .filter((el: any) => el.confidence >= 0.65);

        if (e3Elements.length > 0) {
          const overallConfidence = Math.min(Math.max(...e3Elements.map((e: any) => e.confidence)), 0.80);
          aggregatedE3UIList.push({
            ruleId: 'E3', ruleName: 'Obscured or restricted user control', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'screenshots', isE3Aggregated: true, e3Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Structural exit absence: ${e3Elements.length} high-impact action(s) without visible cancel/close/exit mechanism.`,
            contextualHint: 'Verify that high-impact actions provide clear exit controls.',
            advisoryGuidance: 'Analysis flagged potential restriction of user control; verify structural exit mechanisms for high-impact actions.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
          console.log(`E3 aggregated (UI): ${e3FromLLM.length} finding(s) → ${e3Elements.length} element(s)`);
        } else {
          console.log('E3: All screenshot findings suppressed (below 0.65 confidence)');
        }
      }
    }

    // Combine all violations - A1 uses aggregated cards (max 2), A2 uses aggregated card
    const allViolationsPreSuppression = [
      ...filteredOtherViolations,
      ...aggregatedA1Violations,
      ...aggregatedE1UIList,
      ...aggregatedE2UIList,
      ...aggregatedE3UIList,
      ...(aggregatedA2UI ? [aggregatedA2UI] : []),
      ...(aggregatedA3UI ? [aggregatedA3UI] : []),
      ...(aggregatedA4UI ? [aggregatedA4UI] : []),
      ...(aggregatedA5UI ? [aggregatedA5UI] : []),
      ...(aggregatedA6UI ? [aggregatedA6UI] : []),
      ...(aggregatedU5UI ? [aggregatedU5UI] : []),
    ];

    // ========== POSITIVE FINDING FILTER (Issues-Only Guardrail) ==========
    const { applyCrossRuleSuppression, filterPositiveFindings } = await import('../_shared/cross-rule-suppression.ts');
    const { kept: issuesOnly } = filterPositiveFindings(allViolationsPreSuppression);
    console.log(`Positive-filter: ${allViolationsPreSuppression.length} → ${issuesOnly.length} (removed ${allViolationsPreSuppression.length - issuesOnly.length} non-issues)`);

    // ========== CROSS-RULE SUPPRESSION (S1–S10 + fallback priority) ==========
    const { kept: enhancedViolations, suppressedElements } = applyCrossRuleSuppression(issuesOnly);
    console.log(`Analysis complete: ${allViolationsPreSuppression.length} pre-suppression → ${enhancedViolations.length} violations (${suppressedElements.length} element(s) suppressed)`);

    // ========== SCREENSHOT-SPECIFIC USABILITY CROSS-RULE SUPPRESSION ==========
    // Prevent duplicate findings where multiple rules describe the same root cause.
    // Priority: U3 > U4, U6 > U1, U2 > U1
    const ruleIds = new Set(enhancedViolations.map((v: any) => v.ruleId));
    const hasU3 = ruleIds.has('U3');
    const hasU6 = ruleIds.has('U6');
    const hasU2 = ruleIds.has('U2');

    const screenshotSuppressed: string[] = [];
    const finalViolations = enhancedViolations.filter((v: any) => {
      // ========== U2 SCREENSHOT CONFIDENCE GATE ==========
      // Aligned with global perceptual policy (≥60%)
      if (v.ruleId === 'U2') {
        const conf = v.confidence || 0.65;
        if (conf < 0.60) {
          console.log(`U2: Suppressed (screenshot confidence ${Math.round(conf * 100)}% < 60%): ${(v.evidence || '').substring(0, 100)}`);
          return false;
        }
      }

      // ========== U3 SCREENSHOT CONFIDENCE GATE ==========
      // Aligned with global perceptual policy (≥60%)
      if (v.ruleId === 'U3') {
        const conf = v.confidence || 0.65;
        if (conf < 0.60) {
          console.log(`U3: Suppressed (screenshot confidence ${Math.round(conf * 100)}% < 60%): ${(v.evidence || '').substring(0, 100)}`);
          return false;
        }
      }

      // ========== U4 SCREENSHOT CONFIDENCE GATE ==========
      // Aligned with global perceptual policy (≥60%), capped at 0.75
      if (v.ruleId === 'U4') {
        const conf = v.confidence || 0.65;
        if (conf < 0.60) {
          console.log(`U4: Suppressed (screenshot confidence ${Math.round(conf * 100)}% < 60%): ${(v.evidence || '').substring(0, 100)}`);
          return false;
        }
        // Cap U4 screenshot confidence at 0.75
        if (v.confidence > 0.75) v.confidence = 0.75;
      }

      // S-SS1: U3 suppresses U4 (truncation causes recall regression on review screens)
      if (v.ruleId === 'U4' && hasU3) {
        const u4Text = `${v.diagnosis || ''} ${v.evidence || ''} ${v.contextualHint || ''}`.toLowerCase();
        const isReviewContext = /review|confirm|summar|verif|check.*before|final.*step/.test(u4Text);
        const isTruncationCaused = /truncat|clip|hidden|cut.?off|ellipsis|inaccessible|cannot.*see|not.*visible/.test(u4Text);
        if (isReviewContext || isTruncationCaused) {
          console.log(`Screenshot suppression: U4 suppressed by U3 (truncation→recall on review screen)`);
          screenshotSuppressed.push('U4 (by U3)');
          return false;
        }
      }


      // S-SS3: U6 suppresses U1 (weak grouping explains unclear primary action)
      if (v.ruleId === 'U1' && hasU6) {
        const u1Text = `${v.diagnosis || ''} ${v.evidence || ''}`.toLowerCase();
        const isGroupingCaused = /group|hierarchy|layout|section|visual.*weight|spacing|alignment|cluster|scattered/.test(u1Text);
        if (isGroupingCaused) {
          console.log(`Screenshot suppression: U1 suppressed by U6 (grouping→unclear action)`);
          screenshotSuppressed.push('U1 (by U6)');
          return false;
        }
      }

      // S-SS4: U2 suppresses U1 (navigation ambiguity explains unclear primary action)
      if (v.ruleId === 'U1' && hasU2) {
        const u1Text = `${v.diagnosis || ''} ${v.evidence || ''}`.toLowerCase();
        const isNavCaused = /navigat|wayfind|where.*am|location|breadcrumb|menu|path|route/.test(u1Text);
        if (isNavCaused) {
          console.log(`Screenshot suppression: U1 suppressed by U2 (navigation→unclear action)`);
          screenshotSuppressed.push('U1 (by U2)');
          return false;
        }
      }

      return true;
    });

    // Add impact annotations to surviving parent rules
    if (screenshotSuppressed.some(s => s.startsWith('U4 (by U3)'))) {
      const u3Violation = finalViolations.find((v: any) => v.ruleId === 'U3');
      if (u3Violation) {
        u3Violation.impactAnnotation = 'This truncation may force users to recall previously entered information instead of recognizing it during verification.';
      }
    }
    if (screenshotSuppressed.some(s => s.startsWith('U1 (by U6)'))) {
      const u6Violation = finalViolations.find((v: any) => v.ruleId === 'U6');
      if (u6Violation) {
        u6Violation.impactAnnotation = 'Weak visual grouping may make the primary action harder to identify, contributing to unclear action hierarchy.';
      }
    }
    if (screenshotSuppressed.some(s => s.startsWith('U1 (by U2)'))) {
      const u2Violation = finalViolations.find((v: any) => v.ruleId === 'U2');
      if (u2Violation) {
        u2Violation.impactAnnotation = 'Navigation ambiguity may contribute to unclear primary action identification.';
      }
    }

    if (screenshotSuppressed.length > 0) {
      console.log(`Screenshot cross-rule suppression: ${screenshotSuppressed.length} finding(s) suppressed: ${screenshotSuppressed.join(', ')}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        violations: finalViolations,
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