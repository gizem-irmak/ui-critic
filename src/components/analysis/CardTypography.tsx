import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ReactNode } from 'react';

/**
 * Reusable typography primitives for violation cards.
 * Enforces consistent font sizes, weights, spacing, and hierarchy across all A1–A6, U1–U6, E1–E3 cards.
 *
 * Hierarchy:
 *   SectionHeader  → text-xl font-semibold  (e.g., "Confirmed Violations (Blocking)")
 *   RuleHeader     → text-lg font-semibold  (e.g., "A2 Poor Focus Visibility")
 *   ComponentTitle → text-sm font-medium    (e.g., "context-menu")
 *   FieldLabel     → text-sm font-medium text-muted-foreground  (fixed width)
 *   FieldValue     → text-sm font-normal
 *   SecondaryText  → text-sm text-muted-foreground
 *   CodeTag        → text-xs font-mono bg-muted px-1.5 py-0.5 rounded
 *   ConfidenceValue → font-mono font-medium text-warning
 *   MethodBadge    → text-xs font-medium (colored border)
 *   AdvisoryBlock  → muted bg, border, consistent padding
 */

/* ─── Section Header ─── */
export function SectionHeader({ icon, children, count, compact }: {
  icon?: ReactNode;
  children: ReactNode;
  count?: number;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      {icon}
      <h3 className="text-xl font-semibold text-foreground">{children}</h3>
      {count != null && (
        <span className="text-sm text-muted-foreground">
          — {count} issue{count !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

/* ─── Rule Header (inside CardTitle) ─── */
export function RuleHeader({ ruleId, title, compact }: {
  ruleId: string;
  title: string;
  compact?: boolean;
}) {
  return (
    <span className="text-lg font-semibold leading-snug">{title}</span>
  );
}

/* ─── Component / Element Title (accordion trigger) ─── */
export function ComponentTitle({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className="text-sm font-medium text-left">{children}</span>
  );
}

/* ─── Field Row (label + value) ─── */
export function FieldRow({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">{children}</div>
  );
}

export function FieldLabel({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className="text-sm font-medium text-muted-foreground w-24 flex-shrink-0">
      {children}
    </span>
  );
}

export function FieldValue({ children, mono, compact }: {
  children: ReactNode;
  mono?: boolean;
  compact?: boolean;
}) {
  return (
    <span className={cn('text-sm font-normal', mono && 'font-mono')}>
      {children}
    </span>
  );
}

/* ─── Secondary / Explanatory Text ─── */
export function SecondaryText({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className="text-sm text-muted-foreground">{children}</span>
  );
}

/* ─── Code Tag (inline class token) ─── */
export function CodeTag({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
      {children}
    </span>
  );
}

/* ─── Confidence Value ─── */
export function ConfidenceValue({ value }: { value: number }) {
  return (
    <span className="font-mono text-sm font-medium text-warning">
      {Math.round(value * 100)}%
    </span>
  );
}

/* ─── Method Badge ─── */
export function MethodBadge({ method }: { method: string }) {
  const isDeterministic = method === 'deterministic';
  return (
    <Badge variant="outline" className={cn(
      'text-xs font-medium',
      isDeterministic
        ? 'border-blue-500/50 text-blue-600'
        : 'border-amber-500/50 text-amber-600'
    )}>
      {isDeterministic ? 'Deterministic' : 'LLM-Assisted'}
    </Badge>
  );
}

/* ─── Element Count Badge ─── */
export function ElementCountBadge({ count, isConfirmed }: {
  count: number;
  isConfirmed: boolean;
}) {
  return (
    <Badge className={cn(
      "gap-1 text-xs font-medium",
      isConfirmed
        ? "bg-destructive/10 text-destructive border-destructive/30"
        : "bg-warning/10 text-warning border-warning/30"
    )}>
      {count} element{count !== 1 ? 's' : ''}
    </Badge>
  );
}

/* ─── Rule ID Badge ─── */
export function RuleIdBadge({ ruleId, isConfirmed, categoryClass }: {
  ruleId: string;
  isConfirmed: boolean;
  categoryClass: string;
}) {
  return (
    <span className={cn(
      'category-badge flex-shrink-0 text-xs font-medium',
      isConfirmed ? categoryClass : 'bg-warning/10 text-warning border border-warning/20'
    )}>
      {ruleId}
    </span>
  );
}

/* ─── Detail Container (expandable content area) ─── */
export function DetailContainer({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 pt-2 mt-2 border-t border-border/50 text-sm">
      {children}
    </div>
  );
}

/* ─── Advisory Guidance Block ─── */
export function AdvisoryBlock({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'bg-muted/30 rounded-md border border-border text-sm',
      compact ? 'p-3' : 'p-3'
    )}>
      <p className="text-sm font-medium text-muted-foreground">💡 Advisory Guidance</p>
      <p className="text-sm text-muted-foreground mt-1">{children}</p>
    </div>
  );
}

/* ─── Card Description (under header) ─── */
export function CardDescription({ children, compact }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <p className="text-sm text-muted-foreground mt-2">{children}</p>
  );
}

/* ─── Element Item Wrapper (the colored border box) ─── */
export function ElementItemWrapper({ children, isConfirmed, compact }: {
  children: ReactNode;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border space-y-0',
      isConfirmed
        ? 'bg-destructive/5 border-destructive/20'
        : 'bg-warning/5 border-warning/20',
      compact ? 'p-2' : 'p-3'
    )}>
      {children}
    </div>
  );
}
