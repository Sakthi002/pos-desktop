export interface Migration {
  /** Monotonic, never reused, never reordered. */
  version: number;
  name: string;
  /** Executed inside a transaction by the migrator. */
  up: string;
}
