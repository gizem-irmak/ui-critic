import { MapPin } from 'lucide-react';
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
  const cleaned = path.replace(/\\/g, '/');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || path;
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
      'inline-flex items-center gap-1 text-muted-foreground flex-shrink-0',
      compact ? 'text-xs' : 'text-sm',
      className
    )}>
      {showIcon && <MapPin className="h-3 w-3" />}
      <span className="truncate max-w-40">{label}</span>
    </span>
  );
}
