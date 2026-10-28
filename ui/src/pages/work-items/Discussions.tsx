import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import type { PostSummary } from "../../../../src/api-types";
import { Section } from "../../components/Section";
import { WorkRow } from "../../components/WorkRow";
import { relativeTime } from "../../lib/time";

export function discussionUrl(swarmId: string, kind: "task" | "criterion", id: number) {
  return `/s/${swarmId}/wall/new?${kind}=${id}`;
}

export function Discussions({ swarmId, posts }: { swarmId: string; posts: PostSummary[] }) {
  const navigate = useNavigate();
  if (posts.length === 0) return null;
  return (
    <Section title="Discussions">
      <div>
        {posts.map((post) => (
          <WorkRow
            key={post.id}
            flush
            glyph={<MessageSquare size={14} />}
            title={post.title}
            subtitle={`${post.author} · ${post.commentCount} comments`}
            trailing={relativeTime(post.createdAt)}
            onSelect={() => navigate(`/s/${swarmId}/wall/${post.id}`)}
          />
        ))}
      </div>
    </Section>
  );
}
