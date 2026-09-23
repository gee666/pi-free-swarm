import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { UserX } from "lucide-react";
import type { ThreadView } from "../../../../src/api-types";
import { TEXT_MAX } from "../../../../src/limits";
import { USER_NAME } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";
import styles from "./Agents.module.css";
import { MailboxPanel } from "./MailboxPanel";
import { ParticipantList } from "./ParticipantList";
import { useComposer } from "./useComposer";
import { useSwarmDetail } from "./useSwarmDetail";

/** Agents tab: participants, the selected one's mailbox, and the user's compose box. */
export function AgentsPage() {
  const { id: swarmId = "", name: routeName = USER_NAME } = useParams();
  const navigate = useNavigate();
  const stream = useSwarmStream();
  const detail = useSwarmDetail(swarmId);
  const participants = detail.data?.participants;
  const selected = participants?.find((participant) => participant.name.toLowerCase() === routeName.toLowerCase());
  const agents = participants?.filter((participant) => participant.kind === "agent").map(({ name }) => name) ?? [];
  const composer = useComposer(swarmId, detail.data?.swarm, selected?.kind === "agent" ? [selected.name] : []);
  const composeSlot = useRef<HTMLDivElement>(null);
  const focusCompose = () => composeSlot.current?.querySelector("textarea")?.focus();

  const messageAgent = (name: string) => {
    composer.address([name]);
    focusCompose();
  };
  const reply = (thread: ThreadView) => {
    composer.reply(thread);
    focusCompose();
  };

  const banners = (
    <>
      {stream.status === "reconnecting" && <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>}
      {composer.error && <ErrorBanner>{`Message not sent: ${composer.error}`}</ErrorBanner>}
    </>
  );

  return (
    <PanelLayout
      list={
        <ParticipantList
          participants={participants}
          error={detail.error}
          selected={selected?.name}
          onSelect={(name) => navigate(`/s/${swarmId}/agents/${encodeURIComponent(name)}`)}
          onMessage={messageAgent}
        />
      }
      main={
        selected ? (
          <MailboxPanel
            key={selected.name}
            swarmId={swarmId}
            participant={selected}
            banners={banners}
            canSend={!composer.disabled}
            onReply={reply}
          />
        ) : (
          <Panel aria-label="Mailbox">
            {banners}
            {participants === undefined ? (
              !detail.error && <SkeletonRows />
            ) : (
              <EmptyState icon={UserX} text={`Nobody named ${routeName} is in this swarm`} />
            )}
          </Panel>
        )
      }
      compose={
        <div ref={composeSlot} className={styles.composeSlot}>
          <ComposeBox
            text={composer.text}
            onTextChange={composer.setText}
            onSend={composer.send}
            limit={TEXT_MAX}
            recipients={{ names: composer.to, options: agents, onChange: composer.setTo }}
            thread={composer.thread && { id: composer.thread.id, onCancel: composer.cancelReply }}
            disabled={composer.disabled}
            busy={composer.busy}
          />
        </div>
      }
    />
  );
}
