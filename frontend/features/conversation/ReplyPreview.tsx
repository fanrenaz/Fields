import { Text } from "@lobehub/ui";
import { createStaticStyles, cssVar } from "antd-style";
import { useTranslation } from "react-i18next";

export type ConversationReplyPreview = {
  count: number;
  target: {
    content: string;
    id: string;
    senderName: string;
  } | null;
};

const styles = createStaticStyles(({ css }) => ({
  root: css`
    cursor: default;

    overflow: hidden;

    max-width: min(100%, 560px);
    padding-block: 6px;
    padding-inline: 10px;

    border-inline-start: 3px solid ${cssVar.colorBorder};
    border-radius: 4px;

    background: ${cssVar.colorFillQuaternary};
  `,
  text: css`
    overflow: hidden;
    display: block;

    max-width: 100%;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export function ReplyPreview({ reply }: { reply: ConversationReplyPreview }) {
  const { t } = useTranslation();
  const label = reply.target
    ? t("timeline.replyTo", {
      message: reply.target.content,
      name: reply.target.senderName,
    })
    : t("timeline.replyToMessages", { count: reply.count });

  return (
    <div className={styles.root}>
      <Text className={styles.text} fontSize={12} type="secondary">
        {label}
      </Text>
    </div>
  );
}
