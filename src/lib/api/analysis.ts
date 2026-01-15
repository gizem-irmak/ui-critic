import { supabase } from '@/integrations/supabase/client';
import type { Violation } from '@/types/project';

export interface AnalysisRequest {
  images: string[]; // base64 encoded images
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
}

export async function runUIAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const { data, error } = await supabase.functions.invoke('analyze-ui', {
    body: request,
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
