import { MessageCircle, MessageSquare, Plus } from "lucide-react";
import type { PostSummary } from "../../../../src/api-types";
import { displayName } from "../../api/agents";
import type { LoadMore } from "../../api/useLoadMore";
import { Button } from "../../components/Button";
import { CountBadge } from "../../components/Indicators";
import { ListRow } from "../../components/ListRow";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { Pill } from "../../components/Pill";
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
}

/** List panel of the Wall tab. */
export function PostList({ posts, error, more, selected, unreadComments, onSelect, onNewPost }: PostListProps) {
  return (
    <Panel aria-label="Wall">
      <PanelHeader
        title="Wall"
        action={
          <Button icon={Plus} onClick={onNewPost}>
            New post
          </Button>
        }
      />
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
                  subtitle={`${author} · ${formatTimestamp(post.createdAt)}`}
                  selected={post.id === selected}
                  onSelect={() => onSelect(post.id)}
                  trailing={
                    <>
                      <Pill icon={MessageCircle} title={commentCountLabel(post.commentCount)}>
                        {post.commentCount}
                      </Pill>
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
