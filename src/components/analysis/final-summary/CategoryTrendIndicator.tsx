import { TrendingDown, TrendingUp, Minus, ArrowDown, ArrowDownRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CategoryTrendIndicatorProps {
  iterations: Array<{
    violationCount: number;
  }>;
  category: string;
}

type TrendType = 'fast-decrease' | 'slow-decrease' | 'no-change' | 'increase';

export function CategoryTrendIndicator({ iterations, category }: CategoryTrendIndicatorProps) {
  if (iterations.length < 2) return null;

  const trend = calculateTrend(iterations);
  
  return (
    <Badge 
      variant="outline" 
      className={cn(
        'gap-1 text-xs font-normal',
        trend.type === 'fast-decrease' && 'bg-success/10 text-success border-success/30',
        trend.type === 'slow-decrease' && 'bg-success/5 text-success/80 border-success/20',
        trend.type === 'no-change' && 'bg-muted text-muted-foreground border-border',
        trend.type === 'increase' && 'bg-warning/10 text-warning border-warning/30'
      )}
    >
      {trend.icon}
      {trend.label}
    </Badge>
  );
}

function calculateTrend(iterations: Array<{ violationCount: number }>): { type: TrendType; label: string; icon: React.ReactNode } {
  const first = iterations[0].violationCount;
  const last = iterations[iterations.length - 1].violationCount;
  const totalChange = first - last;
  
  if (totalChange === 0) {
    return {
      type: 'no-change',
      label: 'No change',
      icon: <Minus className="h-3 w-3" />,
    };
  }
  
  if (totalChange < 0) {
    return {
      type: 'increase',
      label: 'Increased',
      icon: <TrendingUp className="h-3 w-3" />,
    };
  }
  
  // Calculate rate of decrease
  const avgChangePerIteration = totalChange / (iterations.length - 1);
  const isFast = avgChangePerIteration >= 2 || (totalChange / first) >= 0.5;
  
  if (isFast) {
    return {
      type: 'fast-decrease',
      label: 'Fast decrease',
      icon: <ArrowDown className="h-3 w-3" />,
    };
  }
  
  return {
    type: 'slow-decrease',
    label: 'Slow decrease',
    icon: <ArrowDownRight className="h-3 w-3" />,
  };
}

// Sparkline component for visual trend
export function TrendSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  
  const max = Math.max(...data, 1);
  const height = 20;
  const width = 60;
  const stepX = width / (data.length - 1);
  
  const points = data.map((val, i) => {
    const x = i * stepX;
    const y = height - (val / max) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg 
      width={width} 
      height={height} 
      className="inline-block ml-2"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="text-muted-foreground"
      />
    </svg>
  );
}
