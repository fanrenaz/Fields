import type { UIChatMessage } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import { MarkdownMessageBody } from '../../../features/conversation/MarkdownMessageBody';
import { QuickReplyStatus } from '../../../features/conversation/QuickReplyStatus';
import { useConversationStore } from '../store';
import ProcessFold from './ProcessFold';
import WorkflowCollapse, { type FieldsAssistantContentBlock } from './WorkflowCollapse';

export interface AssistantGroupProps {
  message: UIChatMessage;
  onLinkPress?: (url: string) => void;
}

const AssistantGroup = memo<AssistantGroupProps>(({ message, onLinkPress = () => undefined }) => {
  const blocks = (message.children ?? []) as FieldsAssistantContentBlock[];
  const generating = useConversationStore((state) => (
    state.generatingMessageIds.includes(message.id)
  ));
  const projectedProcess = Array.isArray(message.metadata?.fieldsProcessBlocks)
    ? message.metadata.fieldsProcessBlocks as FieldsAssistantContentBlock[]
    : null;
  const process = projectedProcess ?? blocks.filter((block) => (
    block.fieldsTool
      || (block.metadata?.fieldsTools?.length ?? 0) > 0
      || block.reasoning?.content
      || block.error
  ));
  const final = [...blocks].reverse().find((block) => (
    !block.fieldsTool
      && block.metadata?.fieldsProcessKind === undefined
      && block.content.trim().length > 0
  ));
  const finalContent = message.content || final?.content || '';
  const summary = typeof message.metadata?.fieldsProcessSummary === 'string'
    ? message.metadata.fieldsProcessSummary
    : null;
  return (
    <Flexbox gap={10}>
      {process.length > 0 ? (
        <ProcessFold
          durationText={durationText(message.performance?.duration)}
          running={generating}
          stepCount={process.length}
          summary={summary}
        >
          <Flexbox gap={8}>
            {process.some((block) => block.fieldsTool || (block.metadata?.fieldsTools?.length ?? 0) > 0) ? (
              <WorkflowCollapse assistantMessageId={message.id} blocks={process} inline />
            ) : null}
            {process.flatMap((block) => {
              const rendered: ReactNode[] = [];
              if (block.content.trim()) {
                rendered.push(
                  <MarkdownMessageBody
                    key={`${block.id}:content`}
                    markdown={block.content}
                    mentions={[]}
                    onLinkPress={onLinkPress}
                  />,
                );
              }
              if (block.reasoning?.content) {
                rendered.push(
                  <MarkdownMessageBody
                    key={`${block.id}:reasoning`}
                    markdown={block.reasoning.content}
                    mentions={[]}
                    onLinkPress={onLinkPress}
                  />,
                );
              }
              if (block.error?.message) {
                rendered.push(
                  <Text key={`${block.id}:error`} type="danger">
                    {block.error.message}
                  </Text>,
                );
              }
              return rendered;
            })}
          </Flexbox>
        </ProcessFold>
      ) : generating && !finalContent ? <QuickReplyStatus /> : null}
      {finalContent ? (
        <MarkdownMessageBody markdown={finalContent} mentions={[]} onLinkPress={onLinkPress} />
      ) : null}
    </Flexbox>
  );
});

function durationText(duration?: number): string | undefined {
  if (!duration || duration <= 0) return undefined;
  if (duration < 1_000) return `${duration}ms`;
  const seconds = Math.round(duration / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

AssistantGroup.displayName = 'AssistantGroup';

export default AssistantGroup;
