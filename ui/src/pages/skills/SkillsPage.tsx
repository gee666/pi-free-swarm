import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Puzzle } from "lucide-react";
import type { SkillResponse, SkillsResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";
import { Button } from "../../components/Button";
import { DetailHeader } from "../../components/DetailHeader";
import { WorkRow } from "../../components/WorkRow";
import { FileLink } from "../../components/FilePreview";
import { TextField } from "../../components/Field";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList } from "../../components/RowList";
import { Section } from "../../components/Section";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";
import { useDebounced } from "../../lib/useDebounced";
import styles from "./Skills.module.css";
import moreStyles from "../../components/ShowMore.module.css";
import workStyles from "../work-items/WorkItems.module.css";

export function SkillsPage() {
  const { id = "", name } = useParams();
  const navigate = useNavigate();
  const stream = useSwarmStream();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const [pagination, setPagination] = useState<{
    query: string;
    cursor?: string;
    previous: SkillsResponse["items"];
  }>({ query: "", previous: [] });
  const { cursor, previous } = pagination.query === query ? pagination : { previous: [] };
  const root = `/api/swarms/${encodeURIComponent(id)}/skills`;
  const params = new URLSearchParams({ query });
  if (cursor) params.set("cursor", cursor);
  const list = useAsync(
    (signal) => getJson<SkillsResponse>(`${root}?${params}`, signal),
    [id, query, cursor, stream.openCount],
    stream.openCount > 0,
  );
  const detail = useAsync(
    (signal) => getJson<SkillResponse>(`${root}/${encodeURIComponent(name ?? "")}`, signal),
    [id, name, stream.openCount],
    name !== undefined && stream.openCount > 0,
  );
  useStreamListener(stream, (event) => {
    if (event.type === "skill.changed") {
      setPagination({ query, previous: [] });
      list.reload();
      detail.reload();
    }
  });
  const items = [...previous, ...(list.data?.items ?? [])];
  const selected = detail.data?.name === name ? detail.data : undefined;
  return (
    <PanelLayout
      listWidth="clamp(380px, 40%, 560px)"
      list={
        <Panel>
          <PanelHeader title="Skills" />
          <div className={workStyles.toolbar}>
            <TextField value={search} onChange={setSearch} label="Search skills" placeholder="Search skills" />
          </div>
          {list.error && (
            <ErrorBanner action={<Button onClick={list.reload}>Retry</Button>}>{list.error.message}</ErrorBanner>
          )}
          {list.data?.notes.map((note) => (
            <p key={note} role="status" className={styles.helper}>
              {note}
            </p>
          ))}
          <PanelBody>
            {!list.data && !list.error ? (
              <SkeletonRows />
            ) : items.length === 0 ? (
              !list.error && <EmptyState icon={Puzzle} text="No skills found" />
            ) : (
              <RowList>
                {items.map((skill) => (
                  <WorkRow
                    key={skill.name}
                    glyph={<Puzzle size={14} />}
                    title={skill.name}
                    mono
                    selected={skill.name === name}
                    subtitle={skill.error ? `Invalid: ${skill.error}` : skill.description}
                    trailing={`rev ${skill.revision}`}
                    onSelect={() => navigate(`/s/${id}/skills/${encodeURIComponent(skill.name)}`)}
                  />
                ))}
                {list.data?.nextCursor && (
                  <Button
                    className={moreStyles.loadMore}
                    onClick={() => {
                      setPagination({ query, previous: items, cursor: list.data?.nextCursor ?? undefined });
                    }}
                    disabled={list.loading}
                  >
                    Load more
                  </Button>
                )}
              </RowList>
            )}
          </PanelBody>
        </Panel>
      }
      main={
        <Panel>
          {!name ? (
            !list.data && !list.error ? (
              <SkeletonRows />
            ) : (
              <EmptyState icon={Puzzle} text="Select a skill" />
            )
          ) : (
            <>
              {detail.error && (
                <ErrorBanner action={<Button onClick={detail.reload}>Retry</Button>}>
                  {detail.error.message}
                </ErrorBanner>
              )}
              {!selected ? (
                !detail.error && <SkeletonRows />
              ) : (
                <>
                  <DetailHeader
                    glyph={<Puzzle size={14} />}
                    title={selected.name}
                    meta={<span>{selected.description}</span>}
                    metaLabel={selected.description}
                  />
                  <PanelBody className={workStyles.body}>
                    {selected.error && <ErrorBanner>Invalid: {selected.error}</ErrorBanner>}
                    {selected.files.length > 0 && (
                      <Section title="Files">
                        <div>
                          {selected.files.map((file) => (
                            <div key={file} className={styles.fileRow}>
                              <FileLink reference={`${selected.path}/${file}`}>{file}</FileLink>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}
                    {selected.content && (
                      <Section title="SKILL.md">
                        <Markdown source={selected.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")} />
                      </Section>
                    )}
                  </PanelBody>
                </>
              )}
            </>
          )}
        </Panel>
      }
    />
  );
}
