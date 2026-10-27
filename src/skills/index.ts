import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { SKILLS_DIR, SWARM_DIR } from "../constants.js";
import { runSearch, type SearchResult } from "../search/index.js";
import { isRecord, type SearchConfiguration } from "../search/settings.js";
import type { SwarmDb } from "../store/db.js";
import { readSkillFolder, type SkillFiles } from "./files.js";

export interface Skill {
  name: string;
  title: string;
  description: string;
  path: string;
  contentHash: string;
  revision: number;
  error: string | null;
  updatedAt: number;
}

export interface SkillChange {
  name: string;
  kind: "added" | "updated" | "removed";
  revision: number;
}

export interface SkillDetail extends Skill {
  content: string | null;
  files: string[];
}

interface Snapshot {
  skill: Skill;
  folder: SkillFiles;
}

export function syncSkills(db: SwarmDb, now = Date.now()): { skills: Skill[]; changes: SkillChange[] } {
  const { snapshots, changes } = synchronize(db, now);
  return { skills: snapshots.map((snapshot) => snapshot.skill), changes };
}

export async function searchSkills(options: {
  db: SwarmDb;
  query?: string;
  cursor?: string;
  limit?: number;
  settings?: SearchConfiguration;
}): Promise<SearchResult<Skill> & { changes: SkillChange[] }> {
  const { skills, changes } = syncSkills(options.db);
  // Catalogue discovery stays lexical even when remote ranking is enabled for swarm content.
  const result = await runSearch({
    ...options,
    kind: "skill",
    settings: {
      search: {
        maxResults: options.settings?.search?.maxResults,
        timeoutMs: options.settings?.search?.timeoutMs,
      },
    },
    candidates: skills.map((skill) => ({ ...skill, id: skill.name, text: `${skill.name}\n${skill.description}` })),
  });
  return {
    ...result,
    items: result.items.map(({ id: _id, text: _text, ...skill }) => skill),
    changes,
  };
}

export function getSkill(db: SwarmDb, name: string): { skill: SkillDetail | null; changes: SkillChange[] } {
  const { snapshots, changes } = synchronize(db, Date.now());
  const snapshot = snapshots.find((entry) => entry.skill.name === name);
  return {
    skill:
      snapshot === undefined
        ? null
        : { ...snapshot.skill, content: snapshot.folder.text, files: snapshot.folder.files },
    changes,
  };
}

function synchronize(db: SwarmDb, now: number): { snapshots: Snapshot[]; changes: SkillChange[] } {
  const root = path.join(db.dataDir, SKILLS_DIR);
  const scanned = folderNames(root).map((name) => {
    const folder = readSkillFolder(path.join(root, name));
    const metadata = parseMetadata(name, folder);
    return { name, folder, metadata };
  });
  // Skills have no swarm id. Return changes rather than inventing a swarm-scoped outbox recipient.
  return db.write(() => {
    const oldNames = new Set(
      db.sql
        .prepare("SELECT name FROM skills")
        .all()
        .map((row) => String(row.name)),
    );
    const changes: SkillChange[] = [];
    const snapshots = scanned.map(({ name, folder, metadata }) => {
      const old = db.sql.prepare("SELECT * FROM skills WHERE name = ?").get(name);
      oldNames.delete(name);
      const changed = old === undefined || old.content_hash !== folder.hash || old.error !== metadata.error;
      const revision = Number(old?.revision ?? 0) + (changed ? 1 : 0);
      const skill: Skill = {
        name,
        ...metadata,
        path: path.posix.join(SWARM_DIR, SKILLS_DIR, name),
        contentHash: folder.hash,
        revision,
        updatedAt: changed ? now : Number(old?.updated_at),
      };
      if (changed) {
        db.sql
          .prepare(
            `INSERT INTO skills (name, title, description, path, content_hash, revision, error, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET title = excluded.title,
          description = excluded.description, path = excluded.path, content_hash = excluded.content_hash,
          revision = excluded.revision, error = excluded.error, updated_at = excluded.updated_at`,
          )
          .run(name, skill.title, skill.description, skill.path, folder.hash, revision, skill.error, now);
        db.sql.prepare("DELETE FROM search_embeddings WHERE kind = 'skill' AND ref_id = ?").run(name);
        changes.push({ name, kind: old === undefined ? "added" : "updated", revision });
      }
      return { skill, folder };
    });
    for (const name of oldNames) {
      const old = db.sql.prepare("SELECT revision FROM skills WHERE name = ?").get(name);
      db.sql.prepare("DELETE FROM skills WHERE name = ?").run(name);
      db.sql.prepare("DELETE FROM search_embeddings WHERE kind = 'skill' AND ref_id = ?").run(name);
      changes.push({ name, kind: "removed", revision: Number(old?.revision) });
    }
    snapshots.sort((a, b) => b.skill.updatedAt - a.skill.updatedAt || a.skill.name.localeCompare(b.skill.name));
    return { snapshots, changes };
  });
}

function folderNames(root: string): string[] {
  try {
    if (!lstatSync(root).isDirectory()) throw new Error("skills root must be a directory, not a symlink");
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function parseMetadata(name: string, folder: SkillFiles): { title: string; description: string; error: string | null } {
  if (folder.error !== null || folder.text === null) return { title: name, description: "", error: folder.error };
  try {
    const { frontmatter, body } = parseFrontmatter(folder.text);
    if (!isRecord(frontmatter) || frontmatter.name !== name) throw new Error("frontmatter name must equal folder name");
    if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
      throw new Error("frontmatter description is required and must be nonempty");
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
    return { title: heading?.trim() || name, description: frontmatter.description.trim(), error: null };
  } catch (error) {
    return { title: name, description: "", error: error instanceof Error ? error.message : "invalid frontmatter" };
  }
}
