import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, Iteration, Analysis, ToolType, InputType } from '@/types/project';

interface ProjectStore {
  projects: Project[];
  currentProject: Project | null;
  
  // Project actions
  createProject: (name: string, toolUsed: ToolType, threshold: number) => Project;
  getProject: (id: string) => Project | undefined;
  setCurrentProject: (project: Project | null) => void;
  deleteProject: (id: string) => void;
  
  // Iteration actions
  createIteration: (projectId: string, inputType: InputType) => Iteration;
  updateIteration: (projectId: string, iterationId: string, updates: Partial<Iteration>) => void;
  getLatestIteration: (projectId: string) => Iteration | undefined;
  
  // Analysis actions
  setAnalysis: (projectId: string, iterationId: string, analysis: Analysis) => void;
  
  // Convergence helpers
  isProjectConverged: (projectId: string) => boolean;
  getConvergenceIteration: (projectId: string) => number | null;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProject: null,

      createProject: (name, toolUsed, threshold) => {
        const project: Project = {
          id: generateId(),
          name,
          toolUsed,
          threshold,
          createdAt: new Date(),
          iterations: [],
          convergedAtIteration: null,
          convergedAt: null,
        };
        set((state) => ({ projects: [...state.projects, project] }));
        return project;
      },

      getProject: (id) => {
        return get().projects.find((p) => p.id === id);
      },

      setCurrentProject: (project) => {
        set({ currentProject: project });
      },

      deleteProject: (id) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProject: state.currentProject?.id === id ? null : state.currentProject,
        }));
      },

      createIteration: (projectId, inputType) => {
        const project = get().getProject(projectId);
        if (!project) throw new Error('Project not found');

        const iteration: Iteration = {
          id: generateId(),
          projectId,
          iterationNumber: project.iterations.length + 1,
          inputType,
          inputData: inputType === 'screenshots' 
            ? { type: 'screenshots', files: [], previews: [] }
            : inputType === 'zip'
            ? { type: 'zip', file: null as any, fileName: '' }
            : { type: 'github', url: '' },
          selectedCategories: ['accessibility', 'usability', 'ethics'],
          selectedRules: [],
          analysis: null,
          createdAt: new Date(),
        };

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...p, iterations: [...p.iterations, iteration] }
              : p
          ),
        }));

        return iteration;
      },

      updateIteration: (projectId, iterationId, updates) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  iterations: p.iterations.map((i) =>
                    i.id === iterationId ? { ...i, ...updates } : i
                  ),
                }
              : p
          ),
        }));
      },

      getLatestIteration: (projectId) => {
        const project = get().getProject(projectId);
        if (!project || project.iterations.length === 0) return undefined;
        return project.iterations[project.iterations.length - 1];
      },

      setAnalysis: (projectId, iterationId, analysis) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;
            
            // Update the iteration with analysis
            const updatedIterations = p.iterations.map((i) =>
              i.id === iterationId ? { ...i, analysis } : i
            );
            
            // Find the iteration to check if this is a convergence event
            const iteration = updatedIterations.find((i) => i.id === iterationId);
            
            // CRITICAL: Only set convergence if not already converged AND analysis is acceptable
            // Once convergedAtIteration is set, it is IMMUTABLE
            const shouldSetConvergence = 
              p.convergedAtIteration === null && 
              analysis.isAcceptable &&
              iteration;
            
            return {
              ...p,
              iterations: updatedIterations,
              // Set convergence fields only once - never modify after first convergence
              convergedAtIteration: shouldSetConvergence 
                ? iteration!.iterationNumber 
                : p.convergedAtIteration,
              convergedAt: shouldSetConvergence 
                ? new Date() 
                : p.convergedAt,
            };
          }),
        }));
      },

      // Helper: Check if a project has ever converged
      isProjectConverged: (projectId) => {
        const project = get().getProject(projectId);
        return project?.convergedAtIteration !== null && project?.convergedAtIteration !== undefined;
      },

      // Helper: Get the iteration number where convergence was first reached
      getConvergenceIteration: (projectId) => {
        const project = get().getProject(projectId);
        return project?.convergedAtIteration ?? null;
      },
    }),
    {
      name: 'ui-critic-projects',
      partialize: (state) => ({ projects: state.projects }),
    }
  )
);
