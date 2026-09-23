import { FileQuestion } from "lucide-react";
import type { ReactNode } from "react";
import type { CommentView, PostDetailResponse } from "../../../../src/api-types";
import { displayName, USER_NAME } from "../../api/agents";
import { ApiError } from "../../api/http";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Avatar } from "../../components/Avatar";
import { EntityHeader } from "../../components/EntityHeader";
import { Panel, PanelBody } from "../../components/Panel";
import { RichText } from "../../components/RichText";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import styles from "./Wall.module.css";
import { commentCountLabel } from "./wallModel";

interface PostViewProps {
  detail: PostDetailResponse | undefined;
  error: Error | undefined;
  banners: ReactNode;
}

/** Main panel of the Wall tab: the post, then its comments. */
export function PostView({ detail, error, banners }: PostViewProps) {
  if (!detail) {
    const missing = error instanceof ApiError && error.code === "not_found";
    return (
      <Panel aria-label="Post">
        {banners}
        {missing ? (
          <EmptyState icon={FileQuestion} text="This post doesn't exist" />
        ) : error ? (
          <ErrorBanner>{`Could not load the post: ${error.message}`}</ErrorBanner>
        ) : (
          <SkeletonRows count={3} />
        )}
      </Panel>
    );
  }
  const { post, comments } = detail;
  const author = displayName(post.author);
  return (
    <Panel aria-label="Post">
      {banners}
      <EntityHeader
        avatar={<Avatar name={author} size="lg" accent />}
        title={post.title}
        subtitle={`Posted by ${author} · ${formatTimestamp(post.createdAt)}`}
      />
      <PanelBody key={post.id} className={styles.postBody}>
        <RichText text={post.text} className={styles.postText} />
        <hr className={styles.divider} />
        <h2 className={styles.commentsTitle}>{commentCountLabel(comments.length)}</h2>
        <ol className={styles.comments}>
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} />
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}

function Comment({ comment }: { comment: CommentView }) {
  return (
    <AuthoredEntry
      author={displayName(comment.author)}
      time={formatTimestamp(comment.createdAt)}
      own={comment.author === USER_NAME}
    >
      <RichText text={comment.text} />
    </AuthoredEntry>
  );
}
