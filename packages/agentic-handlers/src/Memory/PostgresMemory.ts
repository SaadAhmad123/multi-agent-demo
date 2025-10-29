import { Pool } from 'pg';
import type { IMachineMemory } from 'arvo-event-handler';

export interface PostgresMachineMemoryConfig {
  connectionString: string;
  lockTTLSeconds?: number;
  readMaxRetries?: number;
  readBaseDelayMs?: number;
  lockMaxRetries?: number;
  lockBaseDelayMs?: number;
  unlockMaxRetries?: number;
  unlockBaseDelayMs?: number;
  poolConfig?: {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

export class PostgresMachineMemory<T extends Record<string, unknown>> implements IMachineMemory<T> {
  private pool: Pool;
  private lockTTLSeconds: number;
  private readMaxRetries: number;
  private readBaseDelayMs: number;
  private lockMaxRetries: number;
  private lockBaseDelayMs: number;
  private unlockMaxRetries: number;
  private unlockBaseDelayMs: number;

  constructor(config: PostgresMachineMemoryConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolConfig?.max ?? 20,
      idleTimeoutMillis: config.poolConfig?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config.poolConfig?.connectionTimeoutMillis ?? 5000,
    });

    this.lockTTLSeconds = config.lockTTLSeconds ?? 300;
    this.readMaxRetries = config.readMaxRetries ?? 3;
    this.readBaseDelayMs = config.readBaseDelayMs ?? 100;
    this.lockMaxRetries = config.lockMaxRetries ?? 3;
    this.lockBaseDelayMs = config.lockBaseDelayMs ?? 100;
    this.unlockMaxRetries = config.unlockMaxRetries ?? 2;
    this.unlockBaseDelayMs = config.unlockBaseDelayMs ?? 50;

    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS machine_memory (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS machine_locks (
          id VARCHAR(255) PRIMARY KEY,
          locked_at TIMESTAMP NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_machine_locks_expires ON machine_locks(expires_at);
      `);
    } finally {
      client.release();
    }
  }

  async read(id: string): Promise<T | null> {
    for (let attempt = 0; attempt < this.readMaxRetries; attempt++) {
      try {
        const result = await this.pool.query('SELECT data, version FROM machine_memory WHERE id = $1', [id]);

        if (result.rows.length === 0) {
          return null;
        }
        const data = {
          ...(result.rows[0].data ?? {}),
          __postgres_version_counter_data__: result.rows[0].version,
        } as T;
        return data;
      } catch (error) {
        if (attempt === this.readMaxRetries - 1) {
          throw new Error(`Failed to read machine memory for ${id}: ${(error as Error).message}`);
        }
        await this.sleep(this.readBaseDelayMs * 2 ** attempt);
      }
    }

    return null;
  }

  async write(id: string, data: T, prevData: T | null): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      if (prevData === null) {
        await client.query(
          `INSERT INTO machine_memory (id, data, version, updated_at) 
           VALUES ($1, $2, 1, NOW())`,
          [id, JSON.stringify(data)],
        );
      } else {
        const result = await client.query(
          `UPDATE machine_memory 
           SET data = $2, version = version + 1, updated_at = NOW() 
           WHERE id = $1 AND version = $3
           RETURNING id`,
          [id, JSON.stringify(data), prevData.__postgres_version_counter_data__],
        );

        if (result.rowCount === 0) {
          throw new Error(`Optimistic locking failed for ${id}: data was modified by another process`);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to write machine memory for ${id}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  async lock(id: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.lockMaxRetries; attempt++) {
      try {
        await this.cleanupExpiredLocks();

        const expiresAt = new Date(Date.now() + this.lockTTLSeconds * 1000);

        const result = await this.pool.query(
          `INSERT INTO machine_locks (id, locked_at, expires_at) 
           VALUES ($1, NOW(), $2)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [id, expiresAt],
        );

        if ((result.rowCount ?? 0) > 0) {
          return true;
        }

        if (attempt < this.lockMaxRetries - 1) {
          await this.sleep(this.lockBaseDelayMs * 2 ** attempt);
        }
      } catch (error) {
        if (attempt === this.lockMaxRetries - 1) {
          throw new Error(`Failed to acquire lock for ${id}: ${(error as Error).message}`);
        }
        await this.sleep(this.lockBaseDelayMs * 2 ** attempt);
      }
    }

    return false;
  }

  async unlock(id: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.unlockMaxRetries; attempt++) {
      try {
        const result = await this.pool.query('DELETE FROM machine_locks WHERE id = $1 RETURNING id', [id]);
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        if (attempt === this.unlockMaxRetries - 1) {
          console.error(`Failed to unlock ${id}: ${(error as Error).message}`);
          return false;
        }
        await this.sleep(this.unlockBaseDelayMs);
      }
    }

    return false;
  }

  private async cleanupExpiredLocks(): Promise<void> {
    try {
      await this.pool.query('DELETE FROM machine_locks WHERE expires_at < NOW()');
    } catch (error) {
      console.error('Failed to cleanup expired locks:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
