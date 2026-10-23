export interface PostClaim {
  postId: number;
  role: string;
  agent: string;
  createdAt: number;
}

export interface PostContract {
  postId: number;
  revision: number;
  text: string;
  updatedBy: string;
  updatedAt: number;
}

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
  claims?: PostClaim[];
  contract?: Omit<PostContract, "text"> | null;
}

export interface CommentView {
  id: number;
  postId: number;
  swarmId: number;
  author: string;
  text: string;
  createdAt: number;
}
