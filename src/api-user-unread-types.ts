import type { MessageView, RecipientView, UnreadCounts } from "./api-types.js";

export interface UserUnreadSummary {
  messages: number;
  comments: number;
}

export interface UserPostAttention {
  postId: number;
  userSubscribed: boolean;
  userUnreadComments: number;
  userUnread: UserUnreadSummary;
}

export interface UserCommentsReadResponse {
  updated: number;
  userUnread: UserUnreadSummary;
  userSubscribed?: boolean;
}

export interface MessageCreatedPayload {
  message: MessageView;
  unread: UnreadCounts;
  userUnread?: UserUnreadSummary;
}

export interface MessageStatusPayload {
  messageId: number;
  threadId: number;
  recipient: RecipientView;
  unread: UnreadCounts;
  userUnread?: UserUnreadSummary;
}
