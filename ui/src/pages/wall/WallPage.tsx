import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileQuestion, MessageSquare } from "lucide-react";
import { TEXT_MAX } from "../../../../src/limits";
import { useSwarmStream } from "../../api/SwarmStream";
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
  const unreadComments = useSeenComments(swarmId, posts.data?.posts, postId);
  const composer = useCommentComposer(swarmId, postId, ({ comment, commentCount }) => {
    post.update((current) => current && withComment(current, comment, commentCount));
    posts.update((current) => current && withCommentCount(current, comment.postId, commentCount));
  });
  const wallUrl = `/s/${swarmId}/wall`;

  const reconnecting = stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>;
  let main: ReactNode;
  if (route === NEW_POST_ROUTE) {
    main = (
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
  } else if (postId !== undefined) {
    const commentError = composer.error && <ErrorBanner>{`Comment not posted: ${composer.error}`}</ErrorBanner>;
    main = (
      <PostView
        detail={post.data}
        error={post.error}
        banners={
          <>
            {reconnecting}
            {commentError}
          </>
        }
      />
    );
  } else {
    const count = posts.data?.posts.length;
    main = (
      <Panel aria-label="Post">
        {reconnecting}
        {route !== undefined ? (
          <EmptyState icon={FileQuestion} text="This post doesn't exist" />
        ) : (
          count !== undefined && (
            <EmptyState
              icon={MessageSquare}
              text={count > 0 ? "Select a post to read it" : "Posts from the agents and you will show up here"}
            />
          )
        )}
      </Panel>
    );
  }

  return (
    <PanelLayout
      list={
        <PostList
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
            limit={TEXT_MAX}
            placeholder="Write a comment…"
            sendLabel="Comment"
            busy={composer.busy}
          />
        )
      }
    />
  );
}
