import { Accordion, AccordionItem, Flexbox, Icon, Text } from '@lobehub/ui';
import { LoaderCircle } from 'lucide-react';
import { type Key, memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PROCESS_KEY = 'process';

interface ProcessFoldProps {
  /** Rendered process (reasoning + tools + intermediate prose); shown only when expanded. */
  children: ReactNode;
  /** Whether the process starts expanded. */
  defaultExpanded?: boolean;
  /** Formatted turn duration, e.g. "3m 37s". Hidden when absent. */
  durationText?: string;
  /** Number of steps in the turn = count of assistant (call_llm) messages. */
  stepCount: number;
  /** The latest live process summary. */
  summary?: string | null;
  /** Whether this turn is still running. */
  running?: boolean;
}

/**
 * Codex-style "已处理 {duration}" header that folds a finished turn's *process*
 * (reasoning + tool calls + intermediate narration) into one persistent,
 * toggleable row. The turn's final answer is rendered separately and stays
 * visible regardless of this state. Reuses the same Accordion chrome as
 * WorkflowCollapse so the right-aligned expand chevron matches. Purely a view
 * affordance — never persisted.
 */
const ProcessFold = memo<ProcessFoldProps>(
  ({
    children,
    durationText,
    stepCount,
    summary,
    running = false,
    defaultExpanded = false,
  }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const expandedKeys = useMemo(() => (expanded ? [PROCESS_KEY] : []), [expanded]);

    const title = (
      <Flexbox align="center" gap={8} horizontal style={{ minWidth: 0 }}>
        {running ? <Icon icon={LoaderCircle} size="small" spin /> : null}
        <Text ellipsis style={{ minWidth: 0 }} type="secondary">
          {running
            ? summary || t('timeline.turnProcessStatus.running')
            : durationText
              ? t('timeline.turnProcessStatus.ranFor', { count: stepCount, duration: durationText })
              : t('timeline.turnProcessStatus.done', { count: stepCount })}
        </Text>
      </Flexbox>
    );

    return (
      <Accordion
        expandedKeys={expandedKeys}
        variant={'borderless'}
        onExpandedChange={(keys: Key[]) => setExpanded(keys.includes(PROCESS_KEY))}
      >
        <AccordionItem itemKey={PROCESS_KEY} paddingBlock={4} paddingInline={4} title={title}>
          {children}
        </AccordionItem>
      </Accordion>
    );
  },
);

ProcessFold.displayName = 'ProcessFold';

export default ProcessFold;
