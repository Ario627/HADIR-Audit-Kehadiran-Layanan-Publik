import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { NEWS_CACHE_TTL_S, NEWS_MEMORY_TTL_MS } from './news.constants';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export class NewsCache implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsCache.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private client: RedisClientType | null = null;

  constructor(private readonly url: string | null) {}

  async onModuleInit(): Promise<void> {
    if (this.url === null || this.url.length === 0) {
      return;
    }
    const client = createClient({
      url: this.url,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
      },
    });
    client.on('error', (error: unknown) => {
      this.logger.warn(
        `Redis cache berita error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    try {
      await client.connect();
      this.client = client;
    } catch (error) {
      this.logger.warn(
        `Redis cache berita tidak tersambung: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client === null) {
      return;
    }
    try {
      await client.quit();
    } catch {
      return;
    }
  }

  private readMemory(key: string, now: number): string | null {
    const entry = this.memory.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt <= now) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private writeMemory(key: string, value: string, now: number): void {
    if (this.memory.size >= 32) {
      const oldest = [...this.memory.entries()].sort(
        (left, right) => left[1].expiresAt - right[1].expiresAt,
      )[0];
      if (oldest !== undefined) {
        this.memory.delete(oldest[0]);
      }
    }
    this.memory.set(key, { value, expiresAt: now + NEWS_MEMORY_TTL_MS });
  }

  async get(key: string, now: number): Promise<string | null> {
    if (this.client !== null) {
      try {
        const value = await this.client.get(key);
        if (typeof value === 'string') {
          return value;
        }
      } catch {
        return this.readMemory(key, now);
      }
    }
    return this.readMemory(key, now);
  }

  async set(key: string, value: string, now: number, ttlSeconds = NEWS_CACHE_TTL_S): Promise<void> {
    this.writeMemory(key, value, now);
    if (this.client === null) {
      return;
    }
    try {
      await this.client.set(key, value, { EX: ttlSeconds });
    } catch {
      return;
    }
  }
}