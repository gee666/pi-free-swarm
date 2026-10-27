import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Puzzle } from "lucide-react";
import type { SkillResponse, SkillsResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";
import { Button } from "../../components/Button";
import { EntityHeader } from "../../components/EntityHeader";
import { FileLink } from "../../components/FilePreview";
import { PathText } from "../../components/RichText";
import { TextField } from "../../components/Field";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList, rowFocusProps } from "../../components/RowList";
import { Section } from "../../components/Section";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import { PanelLayout } from "../../shell/AppShell";
import styles from "./Skills.module.css";

export function SkillsPage() {
  const { id = "", name } = useParams();
  const stream = useSwarmStream();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<SkillsResponse["items"]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setCursor(undefined);
      setPrevious([]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
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
      setCursor(undefined);
      setPrevious([]);
      list.reload();
      detail.reload();
    }
  });
  const items = [...previous, ...(list.data?.items ?? [])];
  const selected = detail.data?.name === name ? detail.data : undefined;
  return (
    <PanelLayout
      list={
        <Panel>
          <PanelHeader title="Skills" />
          <p className={styles.helper}>
            Agents add skills by writing folders to <PathText text=".pi/swarm/skills/<name>" />
          </p>
          <div className={styles.search}>
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
                  <Link
                    {...rowFocusProps}
                    className={styles.row}
                    aria-label={`${skill.name} ${skill.error ? `Invalid: ${skill.error}` : skill.description} rev ${skill.revision}`}
                    aria-current={skill.name === name ? "page" : undefined}
                    key={skill.name}
                    to={`/s/${id}/skills/${encodeURIComponent(skill.name)}`}
                  >
                    <Puzzle size={16} />
                    <span className={styles.rowText}>
                      <span className={styles.name}>{skill.name}</span>
                      <span className={skill.error ? styles.invalid : styles.description}>
                        {skill.error ? `Invalid: ${skill.error}` : skill.description}
                      </span>
                    </span>
                    <span className={styles.revision}>rev {skill.revision}</span>
                  </Link>
                ))}
                {list.data?.nextCursor && (
                  <Button
                    onClick={() => {
                      setPrevious(items);
                      setCursor(list.data?.nextCursor ?? undefined);
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
            <EmptyState icon={Puzzle} text="Select a skill" />
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
                  <EntityHeader avatar={<Puzzle size={24} />} title={selected.name} subtitle={selected.description} />
                  <PanelBody className={styles.detail}>
                    <p className={styles.meta}>
                      <FileLink reference={selected.path}>{selected.path}</FileLink> · rev {selected.revision} ·{" "}
                      {formatTimestamp(selected.updatedAt)}
                    </p>
                    {selected.error && <ErrorBanner>Invalid: {selected.error}</ErrorBanner>}
                    <Section title="Files">
                      {selected.files.length === 0 ? (
                        <EmptyState icon={Puzzle} text="No files" />
                      ) : (
                        selected.files.map((file) => (
                          <FileLink key={file} reference={`${selected?.path}/${file}`}>
                            {file}
                          </FileLink>
                        ))
                      )}
                    </Section>
                    <Section title="SKILL.md">
                      {selected.content ? (
                        <Markdown source={selected.content} />
                      ) : (
                        <EmptyState icon={Puzzle} text="SKILL.md not available" />
                      )}
                    </Section>
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
