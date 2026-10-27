# Board event recovery

Work graph events include `criterion.changed`, `task.changed`, `project.changed` and `post.links.changed`. Catalogue changes emit `skill.changed` for each swarm. Clients refetch affected records and lists.

The board opens its SSE stream before fetching snapshots. Every successful open, including a reconnect, triggers the existing snapshot refresh once. Events written while a snapshot request is in flight remain available on that open stream.

Outbox scans track raw row progress separately from recognized events. Unsupported event types advance the scan without being sent. Invalid JSON or a non-object payload for a supported type fails the scan visibly and closes clients rather than silently skipping the row.

Pruning atomically records the highest deleted event ID for each swarm. The picker has a separate watermark for `swarm.updated` only. A gap is established by these deletion records, never by nonconsecutive global IDs. Older databases gain the retention table through migration; deletions made before that migration cannot be reconstructed.

A reconnect whose `Last-Event-ID` precedes its stream's deletion watermark receives a named `retention-gap` SSE control event. Its JSON data includes `after`, `prunedThrough` and `recovery: "snapshot"`. The stream does not replay incomplete history. The open-triggered snapshot refresh recovers current state, so this control event must not trigger a second refresh. Clients that do not recognize named events continue using their existing open refresh.

If pruning overtakes an active stream before the tail scans it, the server closes that affected stream. EventSource reconnects and the same snapshot recovery runs. Unaffected swarm streams remain connected. Session append notifications are live hints, not durable outbox history.

The synchronous `db.write` callback receives a narrow SQL transaction handle. Updated state and outbox mutations can share it without depending on the complete database lifecycle API. Existing zero-argument callbacks remain valid, nested writes join the outer transaction, and thrown errors roll back state, events and pruning watermarks together. Raw SQL remains an internal escape hatch, not a compile-time guarantee of atomic writes.
