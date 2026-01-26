import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Iteration } from '@/types/project';

interface IterationMetadataProps {
  iteration: Iteration;
}

const inputTypeLabels: Record<string, string> = {
  screenshots: 'Screenshot',
  zip: 'ZIP Archive',
  github: 'GitHub Repository',
};

export function IterationMetadata({ iteration }: IterationMetadataProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Determine rule preset based on selected categories
  const getRulePreset = () => {
    const cats = iteration.selectedCategories;
    if (cats.length === 1) {
      if (cats.includes('accessibility')) return 'Accessibility-only';
      if (cats.includes('usability')) return 'Usability-only';
      if (cats.includes('ethics')) return 'Ethics-only';
    }
    if (cats.length === 3 && cats.includes('accessibility') && cats.includes('usability') && cats.includes('ethics')) {
      return 'Thesis baseline (Full)';
    }
    return `Custom (${cats.length} categories)`;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
        >
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Metadata
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="font-normal">
            Input: {inputTypeLabels[iteration.inputType]}
          </Badge>
          <Badge variant="outline" className="font-normal">
            Preset: {getRulePreset()}
          </Badge>
          <Badge variant="outline" className="font-normal font-mono">
            {iteration.selectedRules.length} rules evaluated
          </Badge>
          <Badge variant="outline" className="font-normal font-mono text-muted-foreground">
            Run ID: {iteration.id.substring(0, 8)}
          </Badge>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function getIterationMetadataSummary(iteration: Iteration) {
  const inputTypeLabels: Record<string, string> = {
    screenshots: 'Screenshot',
    zip: 'ZIP',
    github: 'GitHub',
  };

  const getRulePreset = () => {
    const cats = iteration.selectedCategories;
    if (cats.length === 1) {
      if (cats.includes('accessibility')) return 'A11y';
      if (cats.includes('usability')) return 'Usability';
      if (cats.includes('ethics')) return 'Ethics';
    }
    if (cats.length === 3) return 'Full';
    return `${cats.length}cat`;
  };

  return {
    inputType: inputTypeLabels[iteration.inputType],
    rulePreset: getRulePreset(),
    rulesCount: iteration.selectedRules.length,
    runId: iteration.id.substring(0, 8),
  };
}
