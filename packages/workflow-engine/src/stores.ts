import {
  CheckpointError,
  decodeCheckpoint,
  type Checkpoint,
  type CheckpointStore,
} from "./engine.js";

export class MemoryCheckpointStore implements CheckpointStore {
  private readonly records = new Map<string, Checkpoint>();
  async load(runId: string): Promise<unknown> {
    return this.records.get(runId);
  }
  async save(
    checkpoint: Checkpoint,
    expectedRevision: number | null,
  ): Promise<void> {
    const current = this.records.get(checkpoint.runId);
    if ((current?.revision ?? null) !== expectedRevision)
      throw new CheckpointError("Concurrent checkpoint writer");
    this.records.set(checkpoint.runId, decodeCheckpoint(checkpoint));
  }
}

/** IndexedDB provides atomic compare-and-swap per checkpoint, including across tabs. */
export class IndexedDBCheckpointStore implements CheckpointStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly name = "execution-explorer-v1") {}
  private open(): Promise<IDBDatabase> {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("runs", { keyPath: "runId" });
        request.onerror = () => {
          this.database = undefined;
          reject(request.error);
        };
        request.onblocked = () => {
          this.database = undefined;
          reject(new CheckpointError("Storage upgrade blocked by another tab"));
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = undefined;
          };
          resolve(db);
        };
      });
    return this.database;
  }
  async load(runId: string): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("runs", "readonly");
      const request = tx.objectStore("runs").get(runId);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onabort = () =>
        reject(tx.error ?? new CheckpointError("Storage read aborted"));
    });
  }
  async save(
    checkpoint: Checkpoint,
    expectedRevision: number | null,
  ): Promise<void> {
    const checked = decodeCheckpoint(checkpoint);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite");
      const store = tx.objectStore("runs");
      const request = store.get(checked.runId);
      let conflict = false;
      request.onsuccess = () => {
        if ((request.result?.revision ?? null) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(checked);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          conflict
            ? new CheckpointError("Concurrent checkpoint writer")
            : (tx.error ?? new CheckpointError("Storage write aborted")),
        );
    });
  }
}
