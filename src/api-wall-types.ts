export interface PostSummary {
  id: number;
  swarmId: number;
  author: string;
  title: string;
  text: string;
  commentCount: number;
  createdAt: number;
  userSubscribed?: boolean;
  userUnreadComments?: number;
}

export interface CommentView {
  id: number;
  postId: number;
  swarmId: number;
  author: string;
  text: string;
  createdAt: number;
}
