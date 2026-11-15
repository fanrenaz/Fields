import { Avatar, Flexbox, Text } from "@lobehub/ui";
import {
  ChatItem as MessageBody,
  type ChatItemProps,
} from "@lobehub/ui/chat";
import { memo } from "react";

/**
 * Presentation-only adaptation of LobeHub's application Conversation ChatItem.
 *
 * LobeHub separates the avatar/title header from the message body. The generic
 * @lobehub/ui ChatItem places both in one horizontal row, which is not the
 * layout used by the LobeHub Agent and Group conversation pages.
 */
export const ConversationChatItem = memo<ChatItemProps>(({
  avatar,
  avatarProps,
  onAvatarClick,
  placement = "left",
  showAvatar = true,
  showTitle,
  style,
  time,
  titleAddon,
  ...messageProps
}) => {
  const isUser = placement === "right";

  return (
    <Flexbox
      align={isUser ? "flex-end" : "flex-start"}
      gap={8}
      paddingBlock={8}
      style={{
        paddingInlineStart: isUser ? 36 : 0,
        width: "100%",
        ...style,
      }}
    >
      <Flexbox
        align="center"
        direction={isUser ? "horizontal-reverse" : "horizontal"}
        gap={8}
      >
        {showAvatar ? (
          <Avatar
            {...avatarProps}
            animation={messageProps.loading}
            avatar={avatar.avatar}
            background={avatar.backgroundColor}
            shape="square"
            size={avatarProps?.size ?? 28}
            title={avatar.title}
            onClick={onAvatarClick}
          />
        ) : null}
        {showTitle ? (
          <Text fontSize={14} weight={500}>
            {avatar.title}
          </Text>
        ) : null}
        {showTitle ? titleAddon : null}
        {time ? (
          <Text
            as="time"
            fontSize={12}
            title={new Date(time).toLocaleString()}
            type="secondary"
          >
            {new Date(time).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
      </Flexbox>
      <MessageBody
        {...messageProps}
        avatar={avatar}
        placement={placement}
        showAvatar={false}
        showTitle={false}
        style={{
          maxWidth: "100%",
          padding: 0,
          width: "100%",
        }}
      />
    </Flexbox>
  );
});

ConversationChatItem.displayName = "ConversationChatItem";
