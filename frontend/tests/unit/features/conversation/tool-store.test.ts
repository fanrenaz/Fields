import assert from "node:assert/strict";
import test from "node:test";

import {
  type BrowserSafeTool,
  type ToolInspectorProps,
  type ToolInterventionProps,
  type ToolRendererProps,
  useToolStore,
} from "../../../../vendor/lobehub/store/tool-store";

const tool: BrowserSafeTool = {
  id: "tool-1",
  namespace: "codex",
  name: "command",
  displayName: "Command",
  status: "running",
  content: [{ text: "safe output" }],
  progress: ["running"],
  error: null,
  durationMs: null,
  intervention: {
    status: "pending",
    interactionId: "interaction-1",
  },
};

test("Tool Store registers renderer, inspector, and intervention by namespace and API name", () => {
  const previous = useToolStore.getState();
  const Renderer = (_props: ToolRendererProps) => null;
  const Inspector = (_props: ToolInspectorProps) => null;
  const Intervention = (_props: ToolInterventionProps) => null;
  try {
    useToolStore.setState({
      inspectors: {},
      interventions: {},
      renderers: {},
    });
    const registry = useToolStore.getState();
    registry.registerRenderer("codex:command", Renderer);
    registry.registerInspector("codex:command", Inspector);
    registry.registerIntervention("codex:command", Intervention);

    const registered = useToolStore.getState();
    assert.equal(registered.rendererFor(tool), Renderer);
    assert.equal(registered.inspectorFor(tool), Inspector);
    assert.equal(registered.interventionFor(tool), Intervention);
    assert.equal(registered.rendererFor({ ...tool, namespace: "other" }), null);
  } finally {
    useToolStore.setState({
      inspectors: previous.inspectors,
      interventions: previous.interventions,
      renderers: previous.renderers,
    });
  }
});

test("Tool Store supports provider-neutral API fallbacks without executing tools", () => {
  const previous = useToolStore.getState();
  const Renderer = (_props: ToolRendererProps) => null;
  const Inspector = (_props: ToolInspectorProps) => null;
  const Intervention = (_props: ToolInterventionProps) => null;
  try {
    useToolStore.setState({
      inspectors: {},
      interventions: {},
      renderers: {},
    });
    const registry = useToolStore.getState();
    registry.registerRenderer("command", Renderer);
    registry.registerInspector("command", Inspector);
    registry.registerIntervention("command", Intervention);

    const registered = useToolStore.getState();
    assert.equal(registered.rendererFor({ ...tool, namespace: null }), Renderer);
    assert.equal(registered.inspectorFor({ ...tool, namespace: null }), Inspector);
    assert.equal(registered.interventionFor({ ...tool, namespace: null }), Intervention);
    assert.equal("execute" in registered, false);
  } finally {
    useToolStore.setState({
      inspectors: previous.inspectors,
      interventions: previous.interventions,
      renderers: previous.renderers,
    });
  }
});
