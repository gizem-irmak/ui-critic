import { supabase } from '@/integrations/supabase/client';
import type { Violation } from '@/types/project';

export interface AnalysisRequest {
  images?: string[]; // base64 encoded images (for screenshots)
  zipBase64?: string; // base64 encoded zip file
  githubUrl?: string; // GitHub repository URL
  categories: string[];
  selectedRules: string[];
  inputType: 'screenshots' | 'zip' | 'github';
  toolUsed: string;
}

export interface AnalysisResponse {
  success: boolean;
  violations?: Violation[];
  passNotes?: {
    accessibility?: string;
    usability?: string;
    ethics?: string;
  };
  error?: string;
  filesAnalyzed?: number;
  stackDetected?: string;
  repoInfo?: {
    owner: string;
    repo: string;
  };
}

export async function runUIAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  // Route to appropriate edge function based on input type
  let functionName: string;
  let body: Record<string, unknown>;

  if (request.inputType === 'zip') {
    functionName = 'analyze-zip';
    body = {
      zipBase64: request.zipBase64,
      categories: request.categories,
      selectedRules: request.selectedRules,
      toolUsed: request.toolUsed,
    };
  } else if (request.inputType === 'github') {
    functionName = 'analyze-github';
    body = {
      githubUrl: request.githubUrl,
      categories: request.categories,
      selectedRules: request.selectedRules,
      toolUsed: request.toolUsed,
    };
  } else {
    functionName = 'analyze-ui';
    body = {
      images: request.images,
      categories: request.categories,
      selectedRules: request.selectedRules,
      inputType: request.inputType,
      toolUsed: request.toolUsed,
    };
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    console.error('Analysis error:', error);
    return {
      success: false,
      error: error.message || 'Failed to run analysis',
    };
  }

  return data as AnalysisResponse;
}

/**
 * Convert a File to base64 data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a File to raw base64 string (without data URL prefix)
 */
export function fileToRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get raw base64
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
