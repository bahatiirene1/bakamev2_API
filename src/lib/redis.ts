/**
 * Upstash Redis Client Configuration
 * Provides caching and rate limiting capabilities
 */

import { Redis } from '@upstash/redis';

function getRedisUrl(): string {
  const url = process.env.UPSTASH_REDIS_URL;
  if (url === undefined || url === '') {
    throw new Error('UPSTASH_REDIS_URL is required');
  }
  return url;
}

function getRedisToken(): string {
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (token === undefined || token === '') {
    throw new Error('UPSTASH_REDIS_TOKEN is required');
  }
  return token;
}

let redisInstance: Redis | null = null;

/**
 * Get the Redis client instance (lazy initialization)
 */
export function getRedis(): Redis {
  if (redisInstance === null) {
    redisInstance = new Redis({
      url: getRedisUrl(),
      token: getRedisToken(),
    });
  }
  return redisInstance;
}

/**
 * Singleton Redis client instance
 * @deprecated Use getRedis() for lazy initialization
 */
export const redis = {
  get get() {
    return getRedis().get.bind(getRedis());
  },
  get set() {
    return getRedis().set.bind(getRedis());
  },
  get del() {
    return getRedis().del.bind(getRedis());
  },
  get setnx() {
    return getRedis().setnx.bind(getRedis());
  },
  get expire() {
    return getRedis().expire.bind(getRedis());
  },
};

/**
 * Cache helper with automatic JSON serialization
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await getRedis().get<T>(key);
  return value;
}

/**
 * Cache helper with TTL
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  await getRedis().set(key, value, { ex: ttlSeconds });
}

/**
 * Delete cache entry
 */
export async function cacheDelete(key: string): Promise<void> {
  await getRedis().del(key);
}
