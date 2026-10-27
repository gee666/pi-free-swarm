import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCriteria } from "../../src/broker/criterion-status.js";
import { criterionListItems } from "../../src/server/work-projection.js";
import { insertCriterion, listCriteria } from "../../src/store/criteria.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

for (const read of [assessCriteria, criterionListItems]) {
  test(`${read.name} keeps one snapshot when another handle inserts a criterion between queries`, (t) => {
    const temp = createTempDb();
    t.after(() => temp.cleanup());
    const { db } = temp;
    const swarm = seedSwarm(db);
    const writer = openSwarmDb(db.path, { create: false });
    t.after(() => writer.close());
    const before = listCriteria(db, swarm.id).map((item) => item.id);
    const prepare = db.sql.prepare.bind(db.sql);
    let lists = 0;
    let inserted = false;
    t.mock.method(db.sql, "prepare", (query: string) => {
      const statement = prepare(query);
      return {
        get: statement.get.bind(statement),
        run: statement.run.bind(statement),
        all(...params: Parameters<typeof statement.all>) {
          if (query.startsWith("SELECT * FROM criteria WHERE")) lists++;
          const insertBefore = read === criterionListItems && lists === 2;
          const rows = insertBefore ? undefined : statement.all(...params);
          if (
            !inserted &&
            (insertBefore || (read === assessCriteria && query.includes("SELECT * FROM work_criteria")))
          ) {
            inserted = true;
            writer.write(() =>
              insertCriterion(
                writer,
                swarm.id,
                {
                  group: "Concurrent",
                  title: "New criterion",
                  body: "Inserted by another process",
                  verification: "Test",
                  source: "",
                },
                "Maria",
                T0 + 1,
              ),
            );
          }
          return rows ?? statement.all(...params);
        },
      };
    });
    assert.deepEqual(
      read(db, swarm.id).map((item) => item.id),
      before,
    );
    assert.equal(inserted, true, "the other connection committed between the reads");
    assert.equal(listCriteria(db, swarm.id).length, before.length + 1);
    assert.equal(db.sql.isTransaction, false);
  });
}

test("read is deferred, reentrant, joins writes and rejects async callbacks without leaking a transaction", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const { db } = temp;
  const swarm = seedSwarm(db);
  const writer = openSwarmDb(db.path, { create: false });
  t.after(() => writer.close());
  const insert = () =>
    writer.write(() =>
      insertCriterion(
        writer,
        swarm.id,
        {
          group: "Concurrent",
          title: "New",
          body: "Body",
          verification: "Test",
          source: "",
        },
        "Maria",
        T0,
      ),
    );
  const before = listCriteria(db, swarm.id).length;
  db.read(() => {
    insert();
    assert.equal(listCriteria(db, swarm.id).length, before + 1, "BEGIN does not pin the snapshot until the first read");
    insert();
    assert.equal(
      db.read(() => listCriteria(db, swarm.id).length),
      before + 1,
    );
  });
  assert.equal(listCriteria(db, swarm.id).length, before + 2);
  const callbacks: string[] = [];
  db.write(() => {
    db.read(() => db.afterCommit(() => callbacks.push("committed")));
    assert.deepEqual(callbacks, []);
  });
  assert.deepEqual(callbacks, ["committed"]);
  for (const callback of [() => Promise.resolve(), () => db.read(() => Promise.resolve())]) {
    assert.throws(() => db.read(callback), /db.read callback must be synchronous/);
    assert.equal(db.sql.isTransaction, false);
  }
  assert.throws(
    () =>
      db.read(() => {
        throw new Error("read failed");
      }),
    /read failed/,
  );
  assert.equal(
    db.read(() => db.read(() => 7)),
    7,
  );
  assert.equal(db.sql.isTransaction, false);
});
