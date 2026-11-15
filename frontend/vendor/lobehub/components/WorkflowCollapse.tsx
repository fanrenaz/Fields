import type { AssistantContentBlock } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Icon, Text } from '@lobehub/ui';
import { Check, LoaderCircle, TriangleAlert, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../store';
import { useToolStore, type BrowserSafeTool } from '../store/tool-store';

export type WorkflowExpandLevel = 'collapsed' | 'semi' | 'full';

export type WorkflowExpandLevelDefault =
  | WorkflowExpandLevel
  | { completion?: WorkflowExpandLevel; streaming?: WorkflowExpandLevel };

export type FieldsAssistantContentBlock = AssistantContentBlock & {
  fieldsTool?: BrowserSafeTool;
  metadata?: AssistantContentBlock["metadata"] & {
    fieldsTools?: BrowserSafeTool[];
  };
};

export interface WorkflowCollapseProps {
  assistantMessageId: string;
  blocks: FieldsAssistantContentBlock[];
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  inline?: boolean;
}

const WORKFLOW_KEY = 'workflow';

const WorkflowCollapse = memo<WorkflowCollapseProps>(({
  assistantMessageId,
  blocks,
  defaultWorkflowExpandLevel,
  inline = false,
}) => {
  const { t } = useTranslation();
  const generating = useConversationStore((state) => (
    state.generatingMessageIds.includes(assistantMessageId)
  ));
  const tools = useMemo(
    () => blocks.flatMap((block) => (
      block.fieldsTool
        ? [block.fieldsTool]
        : block.metadata?.fieldsTools ?? []
    )),
    [blocks],
  );
  const configured = typeof defaultWorkflowExpandLevel === 'string'
    ? defaultWorkflowExpandLevel
    : generating
      ? defaultWorkflowExpandLevel?.streaming
      : defaultWorkflowExpandLevel?.completion;
  const defaultExpanded = configured
    ? configured !== 'collapsed'
    : generating || tools.some((tool) => tool.intervention?.status === 'pending');
  const complete = tools.every((tool) => tool.status === 'completed');
  const failed = tools.some((tool) => tool.status === 'failed');
  const title = (
    <Flexbox align="center" gap={8} horizontal>
      <Icon
        icon={failed ? TriangleAlert : complete ? Check : generating ? LoaderCircle : Wrench}
        size="small"
        spin={generating && !complete}
      />
      <Text type="secondary">
        {generating
          ? t('timeline.toolsWorking', { count: tools.length })
          : t('timeline.toolCalls', { count: tools.length })}
      </Text>
    </Flexbox>
  );
  const toolBlocks = (
    <Flexbox gap={8}>
      {blocks.flatMap((block) => {
        const blockTools = block.fieldsTool
          ? [block.fieldsTool]
          : block.metadata?.fieldsTools ?? [];
        return blockTools.map((tool) => (
          <ToolBlock key={`${block.id}:${tool.id}`} tool={tool} />
        ));
      })}
    </Flexbox>
  );
  if (inline) return toolBlocks;
  return (
    <Accordion
      defaultExpandedKeys={defaultExpanded ? [WORKFLOW_KEY] : []}
      variant="borderless"
    >
      <AccordionItem itemKey={WORKFLOW_KEY} paddingBlock={4} paddingInline={4} title={title}>
        {toolBlocks}
      </AccordionItem>
    </Accordion>
  );
});

function ToolBlock({ tool }: { tool: BrowserSafeTool }) {
  const Inspector = useToolStore((state) => state.inspectorFor(tool));
  const Intervention = useToolStore((state) => state.interventionFor(tool));
  const Renderer = useToolStore((state) => state.rendererFor(tool));
  return (
    <Flexbox gap={6}>
      {Inspector ? <Inspector tool={tool} /> : null}
      {Renderer ? <Renderer tool={tool} /> : <UnknownToolInspector tool={tool} />}
      {tool.intervention ? (
        Intervention
          ? <Intervention tool={tool} />
          : <UnknownToolIntervention tool={tool} />
      ) : null}
    </Flexbox>
  );
}

function UnknownToolInspector({ tool }: { tool: BrowserSafeTool }) {
  const { t } = useTranslation();
  return (
    <div style={{
      background: 'var(--ant-color-fill-quaternary)',
      border: '1px solid var(--ant-color-border-secondary)',
      borderRadius: 10,
      padding: '9px 11px',
    }}>
      <Flexbox align="center" gap={8} horizontal>
        <Wrench aria-hidden size={15} />
        <strong>{tool.displayName ?? tool.name}</strong>
        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
          {t(`timeline.toolStatus.${tool.status}`)}
        </span>
      </Flexbox>
      {tool.progress.length > 0 ? (
        <p style={{ margin: '8px 0 0' }}>{tool.progress.at(-1)}</p>
      ) : null}
      {tool.content.length > 0 ? (
        <pre style={{ margin: '8px 0 0', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {tool.content.map(toolContentText).filter(Boolean).join('\n')}
        </pre>
      ) : null}
      {tool.error ? (
        <p style={{ color: 'var(--ant-color-error)', margin: '8px 0 0' }}>
          {tool.error.message}
        </p>
      ) : null}
    </div>
  );
}

function UnknownToolIntervention({ tool }: { tool: BrowserSafeTool }) {
  const { t } = useTranslation();
  const status = tool.intervention?.status;
  if (!status) return null;
  return (
    <div
      aria-live={status === 'pending' ? 'polite' : undefined}
      style={{
        background: 'var(--ant-color-fill-quaternary)',
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 8,
        color: 'var(--ant-color-text-secondary)',
        fontSize: 12,
        padding: '7px 10px',
      }}
    >
      {t(`timeline.interventionStatus.${status}`)}
    </div>
  );
}

function toolContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return String(value ?? '');
  const content = value as Record<string, unknown>;
  if (typeof content.markdown === 'string') return content.markdown;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.uri === 'string') return content.uri;
  return JSON.stringify(content, null, 2);
}

WorkflowCollapse.displayName = 'WorkflowCollapse';

export default WorkflowCollapse;
