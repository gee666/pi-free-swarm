import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileQuestion, MessageSquare } from "lucide-react";
import { useSwarmStream } from "../../api/SwarmStream";
import { useSwarmDetail } from "../agents/useSwarmDetail";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorBanner } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";
import { NewPostForm } from "./NewPostForm";
import { PostList } from "./PostList";
import { PostView } from "./PostView";
import { useCommentComposer } from "./useCommentComposer";
import { usePost } from "./usePost";
import { usePosts } from "./usePosts";
import { useSeenComments } from "./useSeenComments";
import { useUserCommentRead } from "./useUserCommentRead";
import { withComment, withCommentCount, withPost } from "./wallModel";

/** `/s/:id/wall/new` opens the new-post form; any other value is a post id. */
const NEW_POST_ROUTE = "new";

function parsePostId(route: string | undefined): number | undefined {
  const id = Number(route);
  return route !== undefined && Number.isInteger(id) ? id : undefined;
}

/**
 * Wall tab: posts newest first, one open post with its comments, or the new-post form. The wall stays
 * writable whether or not the swarm runs.
 */
export function WallPage() {
  const { id: swarmId = "", postId: route } = useParams();
  const navigate = useNavigate();
  const stream = useSwarmStream();
  const posts = usePosts(swarmId);
  const postId = parsePostId(route);
  const post = usePost(swarmId, postId);
  const swarm = useSwarmDetail(swarmId);
  const readError = useUserCommentRead(swarmId, postId, post.data, swarm.data?.userUnread !== undefined);
  const unreadComments = useSeenComments(swarmId, posts.data?.posts, post.data?.post.id);
  const composer = useCommentComposer(swarmId, postId, ({ comment, commentCount }) => {
    post.update((current) => current && withComment(current, comment, commentCount));
    posts.update((current) => current && withCommentCount(current, comment.postId, commentCount));
  });
  const wallUrl = `/s/${swarmId}/wall`;

  const reconnecting = stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>;
  const newPost = route === NEW_POST_ROUTE && (
    <NewPostForm
      swarmId={swarmId}
      banners={reconnecting}
      onCancel={() => navigate(wallUrl)}
      onCreated={(created) => {
        posts.update((current) => current && withPost(current, created));
        navigate(`${wallUrl}/${created.id}`, { replace: true });
      }}
    />
  );
  let main: ReactNode;
  if (postId !== undefined) {
    const commentError = composer.error && <ErrorBanner>{`Comment not posted: ${composer.error}`}</ErrorBanner>;
    main = (
      <PostView
        detail={post.data}
        error={post.error}
        banners={
          <>
            {reconnecting}
            {commentError}
            {readError && <ErrorBanner>{`Could not confirm comment read state: ${readError}`}</ErrorBanner>}
          </>
        }
      />
    );
  } else {
    const count = posts.data?.posts.length;
    main = (
      <Panel aria-label="Post">
        {reconnecting}
        {route !== undefined && route !== NEW_POST_ROUTE ? (
          <EmptyState icon={FileQuestion} text="Post not found" />
        ) : (
          count !== undefined && <EmptyState icon={MessageSquare} text={count > 0 ? "Select a post" : "No posts yet"} />
        )}
      </Panel>
    );
  }

  return (
    <PanelLayout
      listWidth="clamp(380px, 40%, 560px)"
      list={
        <PostList
          newPost={newPost}
          posts={posts.data?.posts}
          error={posts.error}
          more={posts}
          selected={postId}
          unreadComments={unreadComments}
          onSelect={(id) => navigate(`${wallUrl}/${id}`)}
          onNewPost={() => navigate(`${wallUrl}/${NEW_POST_ROUTE}`)}
        />
      }
      main={main}
      compose={
        post.data && (
          <ComposeBox
            text={composer.text}
            onTextChange={composer.setText}
            onSend={composer.send}
            placeholder="Write a comment…"
            sendLabel="Comment"
            busy={composer.busy}
          />
        )
      }
    />
  );
}
