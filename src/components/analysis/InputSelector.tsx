import { useState, useCallback } from 'react';
import { Image, FileArchive, Github, Upload, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { InputType, ScreenshotInput, ZipInput, GithubInput } from '@/types/project';

interface InputSelectorProps {
  inputType: InputType;
  onInputTypeChange: (type: InputType) => void;
  inputData: ScreenshotInput | ZipInput | GithubInput;
  onInputDataChange: (data: ScreenshotInput | ZipInput | GithubInput) => void;
}

export function InputSelector({
  inputType,
  onInputTypeChange,
  inputData,
  onInputDataChange,
}: InputSelectorProps) {
  const [currentPreview, setCurrentPreview] = useState(0);

  const handleScreenshotUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const previews = files.map(file => URL.createObjectURL(file));
    onInputDataChange({
      type: 'screenshots',
      files,
      previews,
    });
  }, [onInputDataChange]);

  const handleZipUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    onInputDataChange({
      type: 'zip',
      file,
      fileName: file.name,
    });
  }, [onInputDataChange]);

  const handleGithubChange = useCallback((url: string) => {
    onInputDataChange({
      type: 'github',
      url,
    });
  }, [onInputDataChange]);

  const removeScreenshot = (index: number) => {
    const data = inputData as ScreenshotInput;
    const newFiles = data.files.filter((_, i) => i !== index);
    const newPreviews = data.previews.filter((_, i) => i !== index);
    URL.revokeObjectURL(data.previews[index]);
    onInputDataChange({
      type: 'screenshots',
      files: newFiles,
      previews: newPreviews,
    });
    if (currentPreview >= newPreviews.length) {
      setCurrentPreview(Math.max(0, newPreviews.length - 1));
    }
  };

  const inputOptions = [
    { value: 'screenshots', label: 'Screenshots', icon: Image, description: 'Upload one or more UI images' },
    { value: 'zip', label: 'ZIP File', icon: FileArchive, description: 'Upload exported project folder' },
    { value: 'github', label: 'GitHub', icon: Github, description: 'Paste public repository URL' },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-base font-medium">Input Type</Label>
        <p className="text-sm text-muted-foreground mb-4">
          Select one input type for this iteration
        </p>
        <RadioGroup
          value={inputType}
          onValueChange={(v) => onInputTypeChange(v as InputType)}
          className="grid grid-cols-3 gap-4"
        >
          {inputOptions.map((option) => (
            <Label
              key={option.value}
              htmlFor={option.value}
              className={cn(
                'flex flex-col items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all',
                inputType === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              )}
            >
              <RadioGroupItem value={option.value} id={option.value} className="sr-only" />
              <option.icon className={cn(
                'h-8 w-8',
                inputType === option.value ? 'text-primary' : 'text-muted-foreground'
              )} />
              <div className="text-center">
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.description}</div>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>

      {/* Input Content */}
      <div className={cn('input-section', inputType && 'input-section-active')}>
        {inputType === 'screenshots' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <label className="flex flex-col items-center gap-2 cursor-pointer">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Upload Screenshots</span>
                <span className="text-xs text-muted-foreground">PNG, JPG, or WEBP</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleScreenshotUpload}
                  className="hidden"
                />
              </label>
            </div>

            {(inputData as ScreenshotInput).previews.length > 0 && (
              <div className="space-y-3">
                <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                  <img
                    src={(inputData as ScreenshotInput).previews[currentPreview]}
                    alt={`Screenshot ${currentPreview + 1}`}
                    className="w-full h-full object-contain"
                  />
                  <button
                    onClick={() => removeScreenshot(currentPreview)}
                    className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-background transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  {(inputData as ScreenshotInput).previews.length > 1 && (
                    <>
                      <button
                        onClick={() => setCurrentPreview(p => Math.max(0, p - 1))}
                        disabled={currentPreview === 0}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-background/80 hover:bg-background disabled:opacity-50 transition-colors"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setCurrentPreview(p => Math.min((inputData as ScreenshotInput).previews.length - 1, p + 1))}
                        disabled={currentPreview === (inputData as ScreenshotInput).previews.length - 1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-background/80 hover:bg-background disabled:opacity-50 transition-colors"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-center gap-1">
                  {(inputData as ScreenshotInput).previews.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentPreview(idx)}
                      className={cn(
                        'h-2 w-2 rounded-full transition-colors',
                        idx === currentPreview ? 'bg-primary' : 'bg-muted-foreground/30'
                      )}
                    />
                  ))}
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {(inputData as ScreenshotInput).files.length} image(s) selected
                </p>
              </div>
            )}
          </div>
        )}

        {inputType === 'zip' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <label className="flex flex-col items-center gap-2 cursor-pointer">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium">Upload ZIP File</span>
                <span className="text-xs text-muted-foreground">Exported project folder</span>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleZipUpload}
                  className="hidden"
                />
              </label>
            </div>

            {(inputData as ZipInput).fileName && (
              <div className="flex items-center justify-center gap-2 p-3 bg-muted rounded-lg">
                <FileArchive className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{(inputData as ZipInput).fileName}</span>
              </div>
            )}
          </div>
        )}

        {inputType === 'github' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="https://github.com/username/repository"
                value={(inputData as GithubInput).url}
                onChange={(e) => handleGithubChange(e.target.value)}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Enter the URL of a public GitHub repository
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
