import { cn } from '@/lib/utils';

interface LocationBadgeProps {
  filePath?: string;
  displayName?: string;
  showIcon?: boolean;
  compact?: boolean;
  className?: string;
}

function extractBasename(path: string): string {
  if (!path) return '';
  const cleaned = path.replace(/\\/g, '/').split('/');
  return cleaned[cleaned.length - 1] || path;
}

export function LocationBadge({
  filePath,
  displayName,
  showIcon = true,
  compact = false,
  className,
}: LocationBadgeProps) {
  const label = displayName || (filePath ? extractBasename(filePath) : 'global');

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-muted-foreground flex-shrink-0',
      compact ? 'text-xs' : 'text-xs',
      className
    )}>
      {showIcon && <span className="font-medium">📍</span>}
      <span className="truncate max-w-40">{label}</span>
    </span>
  );
}
