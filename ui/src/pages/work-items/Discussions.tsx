import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import type { PostSummary } from "../../../../src/api-types";
import { Section } from "../../components/Section";
import { relativeTime } from "../../lib/time";
import styles from "./WorkItems.module.css";

export function discussionUrl(swarmId: string, kind: "task" | "criterion", id: number) {
  return `/s/${swarmId}/wall/new?${kind}=${id}`;
}

export function Discussions({
  swarmId,
  kind,
  id,
  posts,
}: {
  swarmId: string;
  kind: "task" | "criterion";
  id: number;
  posts: PostSummary[];
}) {
  const navigate = useNavigate();
  return (
    <Section
      title="Discussions"
      action={
        <Button size="sm" onClick={() => navigate(discussionUrl(swarmId, kind, id))}>
          Start discussion
        </Button>
      }
    >
      {posts.length === 0 && <p className={styles.muted}>No discussions yet</p>}
      {posts.map((post) => (
        <Link className={styles.row} key={post.id} to={`/s/${swarmId}/wall/${post.id}`}>
          <span className={styles.rowText}>{post.title}</span>
          <span className={styles.muted}>
            {post.commentCount} comments · {relativeTime(post.createdAt)}
          </span>
        </Link>
      ))}
    </Section>
  );
}
