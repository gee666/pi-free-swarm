import { useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { TextField } from "../../components/Field";
import { FilterMenu, FilterPill } from "../work-items/FilterMenu";
import { useDebounced } from "../../lib/useDebounced";
import workStyles from "../work-items/WorkItems.module.css";
import { navigationLinkIds, useWallPrefill } from "./useWallPrefill";
import { Button } from "../../components/Button";
import { FileQuestion, MessageSquare } from "lucide-react";
import { USER_BODY_PREVIEW_CHARS } from "../../../../src/limits";
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
  const location = useLocation();
  const navigationState: unknown = location.state;
  const navigationLinks = navigationLinkIds(navigationState);
  const stream = useSwarmStream();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const author = params.get("author") ?? "";
  const task = params.get("task");
  const criterion = params.get("criterion");
  const request = new URLSearchParams();
  if (query) request.set("query", query);
  if (author) request.set("author", author);
  if (task) request.set("taskId", task);
  if (criterion) request.set("criterionId", criterion);
  const posts = usePosts(swarmId, request.toString());
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
  const prefill = useWallPrefill(
    swarmId,
    route === NEW_POST_ROUTE ? (task ? Number(task) : navigationLinks.taskId) : undefined,
    route === NEW_POST_ROUTE ? (criterion ? Number(criterion) : navigationLinks.criterionId) : undefined,
  );
  const removeFilter = (key: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      return next;
    });
  const mentionNames =
    swarm.data?.participants
      .filter((participant) => participant.kind === "agent" && participant.retiredAt == null)
      .map((participant) => participant.name) ?? [];

  const reconnecting = stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>;
  const newPost = route === NEW_POST_ROUTE && (
    <NewPostForm
      swarmId={swarmId}
      initialLinks={prefill.links}
      mentionNames={mentionNames}
      banners={
        <>
          {reconnecting}
          {prefill.error && (
            <ErrorBanner action={<Button onClick={prefill.reload}>Retry</Button>}>{prefill.error.message}</ErrorBanner>
          )}
        </>
      }
      onCancel={() => navigate(wallUrl)}
      onCreated={(created) => {
        if (request.size > 0) posts.reload();
        else posts.update((current) => current && withPost(current, created));
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
        onRetry={post.reload}
        onLinksChange={(links) => post.update((current) => current && { ...current, links })}
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
          onRetry={posts.reload}
          filters={
            <div className={workStyles.toolbar}>
              <TextField label="Search posts" placeholder="Search posts" value={search} onChange={setSearch} />
              <div className={workStyles.line}>
                <FilterMenu
                  label="Author"
                  items={[
                    { key: "", label: "Anyone" },
                    { key: "User", label: "Me" },
                    ...Array.from(
                      new Set([
                        ...(swarm.data?.participants
                          .filter((participant) => participant.kind === "agent")
                          .map((participant) => participant.name) ?? []),
                        ...(posts.data?.posts.map((item) => item.author).filter((name) => name !== "User") ?? []),
                      ]),
                    ).map((name) => ({ key: name, label: name })),
                  ].map((item) => ({ ...item, selected: item.key === author }))}
                  onSelect={(value) =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      if (value) next.set("author", value);
                      else next.delete("author");
                      return next;
                    })
                  }
                />
                {author && <FilterPill label={author} onRemove={() => removeFilter("author")} />}
                {task && <FilterPill label={`Linked to task #${task}`} onRemove={() => removeFilter("task")} />}
                {criterion && (
                  <FilterPill label={`Linked to criterion #${criterion}`} onRemove={() => removeFilter("criterion")} />
                )}
              </div>
              {posts.data?.notes?.map((note) => (
                <p key={note} className={workStyles.muted}>
                  {note}
                </p>
              ))}
            </div>
          }
          posts={posts.data?.posts}
          error={posts.error}
          more={posts}
          selected={postId}
          unreadComments={unreadComments}
          onSelect={(id) => navigate(`${wallUrl}/${id}?${params}`)}
          onNewPost={() => navigate(`${wallUrl}/${NEW_POST_ROUTE}?${params}`)}
        />
      }
      main={main}
      compose={
        post.data && (
          <ComposeBox
            key={postId}
            uploadSwarmId={swarmId}
            text={composer.text}
            onTextChange={composer.setText}
            onSend={composer.send}
            placeholder="Write a comment…"
            sendLabel="Comment"
            mentionNames={mentionNames}
            attachmentThreshold={USER_BODY_PREVIEW_CHARS}
            busy={composer.busy}
          />
        )
      }
    />
  );
}
