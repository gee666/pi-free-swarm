import { FileQuestion } from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  CommentView,
  PostDetailResponse,
  PostLinkView,
  PostLinksResponse,
  UserPostAttention,
} from "../../../../src/api-types";
import { displayName, USER_NAME } from "../../api/agents";
import { ApiError, postJson } from "../../api/http";
import { Button } from "../../components/Button";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Avatar } from "../../components/Avatar";
import { AgentName } from "../../components/AgentName";
import { Pill } from "../../components/Pill";
import { EntityHeader } from "../../components/EntityHeader";
import { Panel, PanelBody } from "../../components/Panel";
import { RichText, MentionText } from "../../components/RichText";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import styles from "./Wall.module.css";
import { commentCountLabel } from "./wallModel";
import { PostSubscriptionButton } from "./PostSubscriptionButton";
import { WallLinks, linkRequest, type WallLink } from "./WallLinks";
import { workUrl } from "../work-items/useWorkData";

interface PostViewProps {
  mentionNames?: readonly string[];
  detail: PostDetailResponse | undefined;
  error: Error | undefined;
  banners: ReactNode;
  onSubscriptionChange?: (state: UserPostAttention) => void;
  onLinksChange?: (links: PostLinkView[]) => void;
  onRetry?: () => void;
}

/** Main panel of the Wall tab: the post, then its comments. */
export function PostView({
  detail,
  error,
  banners,
  onSubscriptionChange,
  onLinksChange,
  onRetry,
  mentionNames,
}: PostViewProps) {
  const [linkError, setLinkError] = useState<Error>();
  const changeLink = async (action: "link" | "unlink", link: WallLink) => {
    if (!detail) return;
    setLinkError(undefined);
    try {
      const result = await postJson<PostLinksResponse>(
        workUrl(String(detail.post.swarmId), `posts/${detail.post.id}/${action}`),
        linkRequest([link]),
      );
      onLinksChange?.(result.links);
    } catch (failure) {
      setLinkError(failure instanceof Error ? failure : new Error(String(failure)));
    }
  };
  if (!detail) {
    const missing = error instanceof ApiError && error.code === "not_found";
    return (
      <Panel aria-label="Post">
        {banners}
        {missing ? (
          <EmptyState icon={FileQuestion} text="Post not found" />
        ) : error ? (
          <ErrorBanner
            action={<Button onClick={onRetry}>Retry</Button>}
          >{`Could not load the post: ${error.message}`}</ErrorBanner>
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
        title={<MentionText text={post.title} names={mentionNames} />}
        titleLabel={post.title}
        actions={
          <PostSubscriptionButton
            swarmId={post.swarmId}
            postId={post.id}
            subscribed={post.userSubscribed}
            onChange={onSubscriptionChange}
          />
        }
        subtitle={
          <>
            <AgentName name={author} /> {post.broadcast && <Pill>Broadcast</Pill>} · {formatTimestamp(post.createdAt)}
          </>
        }
      />
      <PanelBody key={post.id} className={styles.postBody}>
        {linkError && <ErrorBanner>{linkError.message}</ErrorBanner>}
        <WallLinks
          swarmId={String(post.swarmId)}
          links={detail.links ?? []}
          onAdd={(link) => void changeLink("link", link)}
          onRemove={(link) => void changeLink("unlink", link)}
        />
        <RichText mentionNames={mentionNames} text={post.text} className={styles.postText} />
        <hr className={styles.divider} />
        <h2 className={styles.commentsTitle}>{commentCountLabel(comments.length)}</h2>
        <ol className={styles.comments}>
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} mentionNames={mentionNames} />
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}

function Comment({ comment, mentionNames }: { comment: CommentView; mentionNames?: readonly string[] }) {
  return (
    <AuthoredEntry
      author={displayName(comment.author)}
      time={formatTimestamp(comment.createdAt)}
      own={comment.author === USER_NAME}
    >
      <RichText mentionNames={mentionNames} text={comment.text} />
    </AuthoredEntry>
  );
}
