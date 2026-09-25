#!/usr/bin/env python3
"""Read-only usage and coordination measurements; not an acceptance validator."""

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sqlite3
import time


def session_metrics(path):
    result = {
        "assistant_turns": 0,
        "cost": 0,
        "tokens": 0,
        "coordination_only_turns": 0,
        "coordination_only_cost": 0,
        "length_rejections": 0,
        "tool_errors": 0,
        "wall_read_characters": 0,
        "wall_delta_calls": 0,
        "retry_wait_seconds": 0,
        "extension_retries": 0,
    }
    tools = Counter()
    models = defaultdict(lambda: {"turns": 0, "cost": 0, "tokens": 0})
    calls = {}
    with path.open() as stream:
        for raw in stream:
            # A live session may end in a partially written JSONL record.
            if not raw.endswith("\n"):
                break
            entry = json.loads(raw)
            if entry.get("type") == "custom" and entry.get("customType") == "limits-wait":
                data = entry.get("data", {})
                result["retry_wait_seconds"] += data.get("totalWaitingTime", 0)
                result["extension_retries"] += data.get("retries_total", 0)
            message = entry.get("message", {})
            role = message.get("role")
            if role == "assistant":
                usage = message.get("usage", {})
                cost = usage.get("cost", {}).get("total", 0)
                tokens = usage.get("totalTokens", 0)
                result["assistant_turns"] += 1
                result["cost"] += cost
                result["tokens"] += tokens
                model = models[f'{message.get("provider")}/{message.get("model")}']
                model["turns"] += 1
                model["cost"] += cost
                model["tokens"] += tokens
                batch = [item for item in message.get("content", []) if item.get("type") == "toolCall"]
                if batch and all(item["name"].startswith("swarm_") for item in batch):
                    result["coordination_only_turns"] += 1
                    result["coordination_only_cost"] += cost
                for call in batch:
                    calls[call["id"]] = call["name"]
                    tools[call["name"]] += 1
                    if call["name"] == "swarm_read_posts" and call.get("arguments", {}).get("after"):
                        result["wall_delta_calls"] += 1
            elif role == "toolResult":
                text = "\n".join(item.get("text", "") for item in message.get("content", []) if item.get("type") == "text")
                result["length_rejections"] += text.startswith("Too long:")
                result["tool_errors"] += bool(message.get("isError"))
                if calls.get(message.get("toolCallId")) == "swarm_read_posts":
                    result["wall_read_characters"] += len(text)
    return {**result, "tools": dict(tools), "models": dict(models)}


def collect(database, swarm_id, parent):
    now = int(time.time() * 1000)
    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row

    def query(sql):
        return [dict(row) for row in connection.execute(sql, (swarm_id,))]

    # A read transaction gives all database measurements one consistent snapshot.
    connection.execute("BEGIN")
    swarms = query("SELECT * FROM swarms WHERE id = ?")
    if not swarms:
        raise ValueError(f"Swarm {swarm_id} does not exist")
    runs = query("SELECT * FROM swarm_runs WHERE swarm_id = ? ORDER BY run")
    usage = query("""SELECT run, model, kind, COUNT(*) turns, SUM(input) input,
        SUM(output) output, SUM(cache_read) cache_read, SUM(cache_write) cache_write,
        SUM(cost) cost FROM usage WHERE swarm_id = ? GROUP BY run, model, kind""")
    agents = query("""SELECT name, status, session_file, revive_count FROM participants
        WHERE swarm_id = ? AND kind = 'agent' ORDER BY launch_order""")
    spans = query("SELECT * FROM agent_runs WHERE swarm_id = ?")
    counts = {}
    for table in ("posts", "comments", "messages", "message_recipients"):
        counts[table] = query(f"SELECT COUNT(*) count FROM {table} WHERE swarm_id = ?")[0]["count"]
    acceptance = None
    if connection.execute("SELECT 1 FROM sqlite_master WHERE name = 'acceptance'").fetchone():
        acceptance = query("SELECT * FROM acceptance WHERE swarm_id = ?")
    connection.close()
    sessions = {}
    for agent in agents:
        path = database.parent / agent["session_file"]
        if path.exists():
            sessions[agent["name"]] = session_metrics(path)
    worker_cost = sum(row["cost"] for row in usage)
    parent_metrics = session_metrics(parent) if parent else None
    session_cost = sum(row["cost"] for row in sessions.values())
    return {
        "sampled_at_ms": now,
        "swarm": swarms[0],
        "runs": runs,
        "usage_by_run_model_kind": usage,
        "agents": agents,
        "worker_cost": worker_cost,
        "session_worker_cost": session_cost,
        "db_minus_session_cost": worker_cost - session_cost,
        "total_cost_with_parent": worker_cost + (parent_metrics["cost"] if parent_metrics else 0),
        "wall_ms": sum((r["ended_at"] or now) - r["started_at"] for r in runs),
        "active_agent_ms": sum((r["ended_at"] or now) - r["started_at"] for r in spans),
        "counts": counts,
        "acceptance": acceptance,
        "worker_sessions": sessions,
        "parent": parent_metrics,
        "caveats": [
            "Coordination-only turn cost is attribution, not a causal estimate of waste.",
            "Active time includes tools, inference, coordination and provider waits.",
            "Sessions and database are sampled separately; live totals may differ.",
            "Compaction usage may be present in the database but not assistant-message totals.",
            "This report does not establish benchmark success or exhaustive fidelity.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("swarm", type=int)
    parser.add_argument("--parent", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = collect(args.database, args.swarm, args.parent)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f'Worker cost ${report["worker_cost"]:.6f}; with parent ${report["total_cost_with_parent"]:.6f}')


if __name__ == "__main__":
    main()
