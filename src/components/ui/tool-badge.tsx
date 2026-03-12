import { cn } from '@/lib/utils';
import type { ToolType } from '@/types/project';

interface ToolBadgeProps {
  tool: ToolType;
  className?: string;
}

const toolConfig: Record<ToolType, { label: string; className: string }> = {
  bolt: { 
    label: 'Bolt', 
    className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' 
  },
  replit: { 
    label: 'Replit', 
    className: 'bg-orange-500/10 text-orange-700 border-orange-500/20' 
  },
  lovable: { 
    label: 'Lovable', 
    className: 'bg-pink-500/10 text-pink-700 border-pink-500/20' 
  },
  human: { 
    label: 'Human Developed', 
    className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' 
  },
};

export function ToolBadge({ tool, className }: ToolBadgeProps) {
  const config = toolConfig[tool];
  
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
