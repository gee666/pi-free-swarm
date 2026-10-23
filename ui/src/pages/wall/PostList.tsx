import type { ReactNode } from "react";
import { MessageSquare, Plus } from "lucide-react";
import type { PostSummary } from "../../../../src/api-types";
import { displayName } from "../../api/agents";
import type { LoadMore } from "../../api/useLoadMore";
import { Button } from "../../components/Button";
import { CountBadge } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { AgentName } from "../../components/AgentName";
import { Panel, PanelBody } from "../../components/Panel";
import styles from "./Wall.module.css";
import { RowList } from "../../components/RowList";
import { ShowMore } from "../../components/ShowMore";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import { commentCountLabel } from "./wallModel";

interface PostListProps {
  posts: readonly PostSummary[] | undefined;
  error: Error | undefined;
  more: LoadMore;
  selected: number | undefined;
  unreadComments: (post: PostSummary) => number;
  onSelect: (postId: number) => void;
  onNewPost: () => void;
  newPost?: ReactNode;
}

/** List panel of the Wall tab. */
export function PostList({
  posts,
  error,
  more,
  selected,
  unreadComments,
  onSelect,
  onNewPost,
  newPost,
}: PostListProps) {
  return (
    <Panel aria-label="Wall">
      <div className={styles.toolbar}>
        <Button size="sm" icon={Plus} onClick={onNewPost}>
          New post
        </Button>
      </div>
      {newPost}
      {error && <ErrorBanner>{`Could not load posts: ${error.message}`}</ErrorBanner>}
      {posts === undefined ? (
        !error && <SkeletonRows avatar count={8} />
      ) : posts.length === 0 ? (
        <EmptyState icon={MessageSquare} text="No posts yet" />
      ) : (
        <PanelBody>
          <RowList>
            {posts.map((post) => {
              const author = displayName(post.author);
              return (
                <ListRow
                  key={post.id}
                  avatar={author}
                  avatarSize="sm"
                  title={post.title}
                  subtitle={
                    <>
                      <AgentName name={author} /> · {formatTimestamp(post.createdAt)}
                    </>
                  }
                  selected={post.id === selected}
                  onSelect={() => onSelect(post.id)}
                  trailing={
                    <>
                      {post.contract && (
                        <span className={styles.commentCount} title={`Contract revision ${post.contract.revision}`}>
                          Contract r{post.contract.revision}
                        </span>
                      )}
                      {post.claims && post.claims.length > 0 && (
                        <span
                          className={styles.commentCount}
                          title={post.claims.map((claim) => `${claim.role}: ${claim.agent}`).join("\n")}
                        >
                          {post.claims.length} {post.claims.length === 1 ? "claim" : "claims"}
                        </span>
                      )}
                      {post.commentCount > 0 && (
                        <span className={styles.commentCount} title={commentCountLabel(post.commentCount)}>
                          💬 {post.commentCount}
                        </span>
                      )}
                      <CountBadge count={unreadComments(post)} label="new comments" reserveSpace />
                    </>
                  }
                />
              );
            })}
          </RowList>
          <ShowMore more={more} />
        </PanelBody>
      )}
    </Panel>
  );
}
