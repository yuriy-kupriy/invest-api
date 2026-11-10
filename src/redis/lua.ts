/** Lua scripts, registered on every connection by connections.ts (sent as EVALSHA). */

// Compare-and-delete: DEL alone could remove a lock another client took after ours expired.
export const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Sliding-window log, atomically: trimming, counting and adding in separate
 * commands would let two pods both see "limit - 1" and both pass.
 * Time comes from Redis, not from each pod: drifting pod clocks would trim each other's entries.
 * Returns 0 when allowed, otherwise milliseconds until the oldest entry leaves the window.
 */
export const SLIDING_WINDOW = `
local key, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3]
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - window)
if redis.call("ZCARD", key) < limit then
  redis.call("ZADD", key, now, member)
  redis.call("PEXPIRE", key, window)
  return 0
end
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
return math.max(1, tonumber(oldest[2]) + window - now)
`;
