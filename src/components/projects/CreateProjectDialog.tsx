import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectStore } from '@/stores/projectStore';
import type { ToolType } from '@/types/project';

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [toolUsed, setToolUsed] = useState<ToolType>('bolt');
  const [threshold, setThreshold] = useState(2);
  
  const { createProject } = useProjectStore();
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    const project = createProject(name.trim(), toolUsed, threshold);
    setOpen(false);
    setName('');
    setToolUsed('bolt');
    setThreshold(2);
    navigate(`/projects/${project.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Set up a new UI evaluation project. You can start adding iterations after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="e.g., Dashboard Redesign v2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool">Tool Used</Label>
              <Select value={toolUsed} onValueChange={(v) => setToolUsed(v as ToolType)}>
                <SelectTrigger id="tool">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bolt">Bolt</SelectItem>
                  <SelectItem value="replit">Replit</SelectItem>
                  <SelectItem value="lovable">Lovable</SelectItem>
                  <SelectItem value="human">Human Developed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">
                Acceptable Threshold
                <span className="ml-1 text-muted-foreground font-normal">
                  (max violations)
                </span>
              </Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={50}
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Analysis is acceptable when total violations ≤ this value
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
