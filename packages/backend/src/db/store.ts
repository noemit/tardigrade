import Database from "better-sqlite3";
import { config } from "../config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    initializeSchema();
  }
  return db;
}

function initializeSchema(): void {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      rubric_set_id TEXT,
      goal TEXT,
      browser TEXT,
      viewport TEXT,
      max_duration_seconds INTEGER,
      batch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      token_count INTEGER,
      llm_call_count INTEGER,
      cached_token_count INTEGER,
      evaluation_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      action TEXT NOT NULL,
      screenshot_path TEXT,
      dom_snapshot_path TEXT,
      console_logs TEXT,
      network_errors TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      rubric_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL,
      score REAL NOT NULL,
      max_score REAL NOT NULL,
      evidence TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rubric_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rubrics TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_captures (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER,
      screenshot_path TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      frame_index INTEGER NOT NULL,
      screenshot_path TEXT NOT NULL,
      url TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS looks (
      id TEXT PRIMARY KEY,
      frame_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      frame_index INTEGER NOT NULL,
      look_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      screenshot_path TEXT,
      x INTEGER,
      y INTEGER,
      width INTEGER,
      height INTEGER,
      commentary_text TEXT,
      action TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (frame_id) REFERENCES frames(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS thoughts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);
    CREATE INDEX IF NOT EXISTS idx_findings_run_id ON findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_captures_run_id ON timeline_captures(run_id);
    CREATE INDEX IF NOT EXISTS idx_frames_run_id ON frames(run_id);
    CREATE INDEX IF NOT EXISTS idx_looks_frame_id ON looks(frame_id);
    CREATE INDEX IF NOT EXISTS idx_looks_run_id ON looks(run_id);
    CREATE INDEX IF NOT EXISTS idx_thoughts_run_id ON thoughts(run_id);

    CREATE TABLE IF NOT EXISTS debug_log (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_debug_log_run_id ON debug_log(run_id);
  `);

  // Migrate existing databases that don't yet have newer columns.
  const migrations = [
    `ALTER TABLE runs ADD COLUMN goal TEXT`,
    `ALTER TABLE runs ADD COLUMN browser TEXT`,
    `ALTER TABLE runs ADD COLUMN viewport TEXT`,
    `ALTER TABLE runs ADD COLUMN max_duration_seconds INTEGER`,
    `ALTER TABLE runs ADD COLUMN batch_id TEXT`,
    `ALTER TABLE runs ADD COLUMN evaluation_summary TEXT`,
    `ALTER TABLE runs ADD COLUMN cached_token_count INTEGER`,
    `ALTER TABLE looks ADD COLUMN frame_index INTEGER`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists; ignore.
    }
  }

  // Clean up any leftover runs_old table from a previously-aborted migration.
  try {
    db.exec(`PRAGMA foreign_keys = off;`);
    const runsOldExists = db
      .prepare(`SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='runs_old'`)
      .get() as { present: number } | undefined;
    const runsExists = db
      .prepare(`SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='runs'`)
      .get() as { present: number } | undefined;

    if (runsOldExists) {
      if (runsExists) {
        db.exec(`DROP TABLE IF EXISTS runs_old;`);
      } else {
        db.exec(`ALTER TABLE runs_old RENAME TO runs;`);
      }
    }
    db.exec(`PRAGMA foreign_keys = on;`);
  } catch {
    // Ignore cleanup errors; the table may already be gone or renamed.
    try {
      db.exec(`PRAGMA foreign_keys = on;`);
    } catch {
      // best effort
    }
  }

  // Older databases may have foreign keys that still reference a temporary
  // `runs_old` table left over from a prior migration. SQLite does not update
  // foreign keys in other tables when a table is renamed, so rebuild any
  // dependent tables whose FKs point to `runs_old`.
  rebuildFksPointingToRunsOld(db, [
    "sessions",
    "findings",
    "timeline_captures",
    "frames",
    "looks",
  ]);

  // Migrate rubric_set_id from NOT NULL to nullable (older databases).
  const rubricCol = db
    .prepare(`SELECT "notnull" FROM pragma_table_info('runs') WHERE name = 'rubric_set_id'`)
    .get() as { notnull: number } | undefined;
  if (rubricCol && rubricCol.notnull === 1) {
    db.exec(`PRAGMA foreign_keys = off;`);

    // Use ALTER COLUMN instead of recreating the table. This avoids copying
    // rows and hitting NOT NULL constraints on legacy rows that may contain
    // NULL values. SQLite 3.35+ supports DROP COLUMN / RENAME COLUMN.
    db.exec(`
      ALTER TABLE runs ADD COLUMN rubric_set_id_new TEXT;
      UPDATE runs SET rubric_set_id_new = rubric_set_id;
      ALTER TABLE runs DROP COLUMN rubric_set_id;
      ALTER TABLE runs RENAME COLUMN rubric_set_id_new TO rubric_set_id;
    `);

    db.exec(`PRAGMA foreign_keys = on;`);
  }
}

function rebuildFksPointingToRunsOld(
  db: Database.Database,
  tableNames: string[]
): void {
  db.exec(`PRAGMA foreign_keys = off;`);

  for (const tableName of tableNames) {
    const hasStaleFk = db
      .prepare(
        `SELECT 1 AS stale FROM pragma_foreign_key_list(?) WHERE "table" = 'runs_old'`
      )
      .get(tableName) as { stale: number } | undefined;

    if (!hasStaleFk) continue;

    const tempName = `${tableName}_fkfix`;
    const columns = db
      .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`)
      .all(tableName) as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

    const columnDefs = columns
      .map((col) => {
        let def = `"${col.name}" ${col.type}`;
        if (col.notnull) def += " NOT NULL";
        if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
        if (col.pk) def += " PRIMARY KEY";
        return def;
      })
      .join(", ");

    const columnNames = columns.map((col) => `"${col.name}"`).join(", ");

    // Preserve FK constraints but make sure they reference `runs`.
    const fks = db
      .prepare(`SELECT * FROM pragma_foreign_key_list(?)`)
      .all(tableName) as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>;

    const fkGroups = new Map<
      number,
      Array<{ from: string; to: string }>
    >();
    for (const fk of fks) {
      const group = fkGroups.get(fk.id) ?? [];
      group.push({ from: fk.from, to: fk.to });
      fkGroups.set(fk.id, group);
    }

    const fkDefs: string[] = [];
    for (const [id, cols] of fkGroups) {
      const fkMeta = fks.find((f) => f.id === id);
      if (!fkMeta) continue;
      const parentTable = fkMeta.table === "runs_old" ? "runs" : fkMeta.table;
      const fromCols = cols.map((c) => `"${c.from}"`).join(", ");
      const toCols = cols.map((c) => `"${c.to}"`).join(", ");
      fkDefs.push(
        `FOREIGN KEY (${fromCols}) REFERENCES ${parentTable}(${toCols}) ON DELETE ${fkMeta.on_delete || "NO ACTION"}`
      );
    }

    const createSql = `CREATE TABLE ${tempName} (${columnDefs}${
      fkDefs.length ? ", " + fkDefs.join(", ") : ""
    })`;

    // Capture indexes before dropping the original table.
    const indexes = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`
      )
      .all(tableName) as Array<{ name: string; sql: string }>;

    db.exec(`DROP TABLE IF EXISTS ${tempName};`);
    db.exec(createSql);
    db.exec(`INSERT INTO ${tempName} (${columnNames}) SELECT ${columnNames} FROM ${tableName};`);
    db.exec(`DROP TABLE ${tableName};`);
    db.exec(`ALTER TABLE ${tempName} RENAME TO ${tableName};`);

    // Recreate any indexes that were lost when dropping the table.
    for (const idx of indexes) {
      try {
        db.exec(idx.sql);
      } catch {
        // Ignore index creation errors; they are non-fatal.
      }
    }
  }

  db.exec(`PRAGMA foreign_keys = on;`);
}
