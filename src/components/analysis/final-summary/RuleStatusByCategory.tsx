import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface RuleStatus {
  ruleId: string;
  ruleName: string;
  category: string;
  status: 'passed' | 'warning' | 'remaining';
  count: number;
}

interface RuleStatusByCategoryProps {
  ruleStatuses: RuleStatus[];
  type: 'passed' | 'warning' | 'remaining';
}

const categoryLabels: Record<string, string> = {
  accessibility: 'Accessibility',
  usability: 'Usability',
  ethics: 'Ethical UI',
};

const categoryOrder = ['accessibility', 'usability', 'ethics'];

export function RuleStatusByCategory({ ruleStatuses, type }: RuleStatusByCategoryProps) {
  const filteredRules = ruleStatuses.filter(r => r.status === type);
  
  if (filteredRules.length === 0) return null;
  
  // Group by category
  const groupedByCategory = categoryOrder.reduce((acc, cat) => {
    const rulesInCat = filteredRules.filter(r => r.category === cat);
    if (rulesInCat.length > 0) {
      acc[cat] = rulesInCat;
    }
    return acc;
  }, {} as Record<string, RuleStatus[]>);
  
  const getBadgeStyles = () => {
    switch (type) {
      case 'passed':
        return 'bg-success/10 text-success border-success/30';
      case 'warning':
        return 'bg-warning/10 text-warning border-warning/30';
      case 'remaining':
        return 'bg-destructive/10 text-destructive border-destructive/30';
    }
  };
  
  const getTypeLabel = () => {
    switch (type) {
      case 'passed':
        return 'Passed';
      case 'warning':
        return 'Low-Severity Remaining';
      case 'remaining':
        return 'Issues Remaining';
    }
  };
  
  const getRuleStyles = () => {
    switch (type) {
      case 'passed':
        return 'bg-success/10 text-success border-success/20';
      case 'warning':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'remaining':
        return 'bg-destructive/10 text-destructive border-destructive/20';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn('gap-1', getBadgeStyles())}>
          {type === 'passed' && <CheckCircle2 className="h-3 w-3" />}
          {getTypeLabel()}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {filteredRules.length} rule{filteredRules.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="space-y-3">
        {Object.entries(groupedByCategory).map(([category, rules]) => (
          <div key={category} className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {categoryLabels[category]} ({rules.length} rule{rules.length !== 1 ? 's' : ''})
            </div>
            <div className="flex flex-wrap gap-2">
              {rules.map(rule => (
                <span 
                  key={rule.ruleId}
                  className={cn(
                    'px-2 py-1 rounded text-xs border',
                    getRuleStyles()
                  )}
                >
                  {rule.ruleId}: {rule.ruleName}
                  {type !== 'passed' && ` (${rule.count})`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
