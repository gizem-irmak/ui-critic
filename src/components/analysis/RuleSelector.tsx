import { useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { rules, ruleCategories, getRulesByCategory } from '@/data/rules';

interface RuleSelectorProps {
  selectedCategories: string[];
  selectedRules: string[];
  onCategoriesChange: (categories: string[]) => void;
  onRulesChange: (rules: string[]) => void;
}

export function RuleSelector({
  selectedCategories,
  selectedRules,
  onCategoriesChange,
  onRulesChange,
}: RuleSelectorProps) {
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const toggleCategory = (categoryId: string) => {
    if (selectedCategories.includes(categoryId)) {
      onCategoriesChange(selectedCategories.filter(c => c !== categoryId));
      // Remove all rules from this category
      const categoryRuleIds = getRulesByCategory(categoryId).map(r => r.id);
      onRulesChange(selectedRules.filter(r => !categoryRuleIds.includes(r)));
    } else {
      onCategoriesChange([...selectedCategories, categoryId]);
      // Add all rules from this category
      const categoryRuleIds = getRulesByCategory(categoryId).map(r => r.id);
      onRulesChange([...new Set([...selectedRules, ...categoryRuleIds])]);
    }
  };

  const toggleRule = (ruleId: string, categoryId: string) => {
    if (selectedRules.includes(ruleId)) {
      const newRules = selectedRules.filter(r => r !== ruleId);
      onRulesChange(newRules);
      // Check if any rules from this category are still selected
      const categoryRuleIds = getRulesByCategory(categoryId).map(r => r.id);
      if (!categoryRuleIds.some(r => newRules.includes(r))) {
        onCategoriesChange(selectedCategories.filter(c => c !== categoryId));
      }
    } else {
      onRulesChange([...selectedRules, ruleId]);
      if (!selectedCategories.includes(categoryId)) {
        onCategoriesChange([...selectedCategories, categoryId]);
      }
    }
  };

  const toggleExpand = (categoryId: string) => {
    setExpandedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const selectAll = () => {
    onCategoriesChange(ruleCategories.map(c => c.id));
    onRulesChange(rules.map(r => r.id));
  };

  const clearAll = () => {
    onCategoriesChange([]);
    onRulesChange([]);
  };

  const getCategoryBadgeClass = (categoryId: string) => {
    switch (categoryId) {
      case 'accessibility': return 'category-accessibility';
      case 'usability': return 'category-usability';
      case 'ethics': return 'category-ethics';
      default: return '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base font-medium">Rule Categories</Label>
          <p className="text-sm text-muted-foreground">
            Select categories or expand to pick individual rules
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {ruleCategories.map((category) => {
          const categoryRules = getRulesByCategory(category.id);
          const isExpanded = expandedCategories.includes(category.id);
          const isSelected = selectedCategories.includes(category.id);
          const selectedCount = categoryRules.filter(r => selectedRules.includes(r.id)).length;

          return (
            <Collapsible
              key={category.id}
              open={isExpanded}
              onOpenChange={() => toggleExpand(category.id)}
            >
              <div className={cn(
                'rounded-lg border transition-colors',
                isSelected ? 'border-primary/50 bg-primary/5' : 'border-border'
              )}>
                <div className="flex items-center gap-3 p-4">
                  <Checkbox
                    id={`cat-${category.id}`}
                    checked={isSelected}
                    onCheckedChange={() => toggleCategory(category.id)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`cat-${category.id}`}
                        className="font-medium cursor-pointer"
                      >
                        {category.name}
                      </Label>
                      <span className={cn('category-badge', getCategoryBadgeClass(category.id))}>
                        {selectedCount}/{categoryRules.length}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{category.description}</p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent>
                  <div className="border-t border-border px-4 py-3 space-y-2">
                    {categoryRules.map((rule) => (
                      <div
                        key={rule.id}
                        className={cn(
                          'flex items-start gap-3 p-2 rounded-md transition-colors',
                          selectedRules.includes(rule.id) ? 'bg-muted' : 'hover:bg-muted/50'
                        )}
                      >
                        <Checkbox
                          id={`rule-${rule.id}`}
                          checked={selectedRules.includes(rule.id)}
                          onCheckedChange={() => toggleRule(rule.id, category.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <Label
                            htmlFor={`rule-${rule.id}`}
                            className="text-sm font-medium cursor-pointer"
                          >
                            {rule.id} – {rule.name}
                          </Label>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {rule.diagnosis}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-success" />
        <span>{selectedRules.length} rules selected across {selectedCategories.length} categories</span>
      </div>
    </div>
  );
}
