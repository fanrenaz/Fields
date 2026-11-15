import type { ComponentType } from 'react';
import { create } from 'zustand';

export type BrowserSafeTool = {
  id: string;
  namespace: string | null;
  name: string;
  displayName: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'declined' | 'interrupted';
  content: readonly unknown[];
  progress: readonly string[];
  error: { code: string; message: string } | null;
  durationMs: number | null;
  intervention?: {
    status: 'pending' | 'approved' | 'rejected' | 'aborted';
    interactionId?: string;
  } | null;
};

export type ToolRendererProps = {
  tool: BrowserSafeTool;
};

export type ToolInspectorProps = {
  tool: BrowserSafeTool;
};

export type ToolInterventionProps = {
  tool: BrowserSafeTool;
};

type ToolStore = {
  inspectors: Record<string, ComponentType<ToolInspectorProps>>;
  interventions: Record<string, ComponentType<ToolInterventionProps>>;
  renderers: Record<string, ComponentType<ToolRendererProps>>;
  inspectorFor: (tool: BrowserSafeTool) => ComponentType<ToolInspectorProps> | null;
  interventionFor: (tool: BrowserSafeTool) => ComponentType<ToolInterventionProps> | null;
  registerInspector: (key: string, inspector: ComponentType<ToolInspectorProps>) => void;
  registerIntervention: (
    key: string,
    intervention: ComponentType<ToolInterventionProps>,
  ) => void;
  registerRenderer: (key: string, renderer: ComponentType<ToolRendererProps>) => void;
  rendererFor: (tool: BrowserSafeTool) => ComponentType<ToolRendererProps> | null;
};

function toolKey(tool: Pick<BrowserSafeTool, 'namespace' | 'name'>): string {
  return `${tool.namespace ?? 'unknown'}:${tool.name}`;
}

function registeredComponent<T extends object>(
  registry: Record<string, ComponentType<T>>,
  tool: Pick<BrowserSafeTool, 'namespace' | 'name'>,
): ComponentType<T> | null {
  return registry[toolKey(tool)] ?? registry[tool.name] ?? null;
}

export const useToolStore = create<ToolStore>((set, get) => ({
  inspectors: {},
  interventions: {},
  renderers: {},
  inspectorFor: (tool) => registeredComponent(get().inspectors, tool),
  interventionFor: (tool) => registeredComponent(get().interventions, tool),
  registerInspector: (key, inspector) => set((state) => ({
    inspectors: { ...state.inspectors, [key]: inspector },
  })),
  registerIntervention: (key, intervention) => set((state) => ({
    interventions: { ...state.interventions, [key]: intervention },
  })),
  registerRenderer: (key, renderer) => set((state) => ({
    renderers: { ...state.renderers, [key]: renderer },
  })),
  rendererFor: (tool) => registeredComponent(get().renderers, tool),
}));
