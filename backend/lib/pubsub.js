/**
 * pubsub.js — Redis Pub/Sub bridge between Worker process and API server.
 *
 * THE PROBLEM THIS SOLVES:
 * When running in production (separate processes), the Worker process
 * does all the heavy data processing, but the API server owns the Socket.IO
 * connection to browsers. The worker can't directly emit Socket.IO events
 * because it's a completely separate Node.js process.
 *
 * THE SOLUTION — Redis Pub/Sub:
 * Redis Pub/Sub is like an internal radio broadcast system:
 * - The Worker "publishes" (broadcasts) a message to a channel
 * - The API server "subscribes" (listens) to that channel
 * - When a message arrives, the API server re-broadcasts it via Socket.IO
 *
 * DATA FLOW:
 *   Worker finishes processing → publishSocketEvent("DATA_UPDATED", {...})
 *     → Redis channel "worker:socket-events" receives the message
 *       → API server's subscriber picks it up
 *         → io.emit("DATA_UPDATED", {...}) pushes to all browsers
 *           → React Zustand store handles the event and refreshes UI
 *
 * WHY NOT JUST USE Socket.IO ADAPTER?
 * Socket.IO has a Redis adapter (@socket.io/redis-adapter) that could handle
 * this, but it requires both processes to be Socket.IO servers. Our worker
 * is NOT a Socket.IO server — it's a pure background processor. Custom Pub/Sub
 * is simpler and doesn't require the worker to initialize Socket.IO.
 *
 * WHY TWO SEPARATE CHANNELS:
 * "worker:socket-events" — Generic Socket.IO events (SYNC_PROGRESS, DATA_UPDATED)
 * "worker:roster-updated" — Roster-specific updates (triggers a different handler
 *   in the API server that may refresh cached roster data before emitting)
 */

import Redis from "ioredis";
import logger from "../config/logger.js";

/**
 * WHY TWO SEPARATE CLIENTS (pubClient vs subClient):
 * Redis Pub/Sub has a rule: once a client calls SUBSCRIBE, it can ONLY
 * receive messages — it can't send regular commands (GET, SET, PUBLISH).
 * So we need separate connections:
 * - pubClient → used by Worker to PUBLISH messages (never subscribes)
 * - subClient → used by API server to SUBSCRIBE and listen (never publishes)
 *
 * This is a Redis-level constraint, not a BullMQ or code design choice.
 */
let pubClient = null;
let subClient = null;

/**
 * initPublisher — Called by the WORKER process during startup.
 *
 * WHY lazyConnect: true:
 * Don't connect immediately when the Redis object is created.
 * Instead, connect explicitly with .connect(). This gives us control
 * over error handling during the connection attempt.
 *
 * WHY retryStrategy:
 * If Redis disconnects, retry with increasing delays (2s, 4s, 6s...)
 * up to 30 seconds max. This handles transient Redis restarts without
 * giving up permanently. The worker keeps trying to reconnect.
 *
 * WHY maxRetriesPerRequest: null:
 * By default, ioredis will fail a command after a certain number of retries.
 * Setting null means "never give up" — keep retrying forever. This is
 * important for a long-running worker that should survive Redis blips.
 */
export const initPublisher = (redisUrl) => {
  if (!redisUrl) return;
  pubClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 2000, 30000),
  });
  pubClient.connect().catch((err) =>
    logger.error({ err }, "PubSub publisher connect failed"),
  );
};

/**
 * publishSocketEvent — Worker calls this to broadcast a Socket.IO event.
 *
 * WHY JSON.stringify:
 * Redis Pub/Sub only transmits strings. We package the event name and
 * payload into a JSON string, and the subscriber parses it back.
 *
 * WHY THE SILENT RETURN IF !pubClient:
 * In hybrid mode (API + Worker in same process), the publisher might
 * not be initialized because Socket.IO events can be emitted directly.
 * The silent return prevents crashes in that scenario.
 */
export const publishSocketEvent = async (event, payload) => {
  if (!pubClient) return;
  try {
    await pubClient.publish(
      "worker:socket-events",
      JSON.stringify({ event, payload }),
    );
  } catch (e) {
    logger.error({ err: e }, "PubSub publish error");
  }
};

/**
 * publishRosterUpdated — Notifies the API server that roster data changed.
 *
 * WHY A SEPARATE FUNCTION (not just publishSocketEvent("ROSTER_UPDATED")):
 * Roster updates trigger a different flow — the API server may need to
 * refresh its own cached roster data BEFORE notifying browsers.
 * Using a separate channel lets the API server handle it differently
 * via the onRosterUpdated callback in initSubscriber.
 */
export const publishRosterUpdated = async () => {
  if (!pubClient) return;
  try {
    await pubClient.publish(
      "worker:roster-updated",
      JSON.stringify({ updatedAt: new Date().toISOString() }),
    );
  } catch (e) {
    logger.error({ err: e }, "Roster PubSub error");
  }
};

/**
 * initSubscriber — Called by the API SERVER during startup.
 *
 * @param redisUrl — Redis connection string
 * @param io — The Socket.IO server instance (to emit events to browsers)
 * @param onRosterUpdated — Callback function for roster-specific updates
 *
 * HOW IT WORKS:
 * 1. Creates a Redis client dedicated to subscribing
 * 2. Subscribes to both worker channels
 * 3. On every message, parses the JSON and either:
 *    a) Emits a Socket.IO event to all connected browsers (socket-events channel)
 *    b) Calls the roster callback (roster-updated channel)
 */
export const initSubscriber = (redisUrl, io, onRosterUpdated) => {
  if (!redisUrl) return;
  subClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 2000, 30000),
  });

  subClient.connect().catch((err) =>
    logger.error({ err }, "PubSub subscriber connect failed"),
  );

  /**
   * Subscribe to both channels in one call.
   * Redis subscription is persistent — once subscribed, every message
   * on these channels will trigger the "message" event handler below.
   */
  subClient.subscribe("worker:socket-events", "worker:roster-updated", (err) => {
    if (err) {
      logger.error({ err }, "PubSub subscribe error");
    } else {
      logger.info("Subscribed to worker PubSub channels");
    }
  });

  /**
   * MESSAGE HANDLER — The core of the bridge.
   *
   * WHY WE CHECK `channel`:
   * Both subscriptions funnel into the same "message" event.
   * We use the channel name to decide how to handle each message.
   *
   * WHY try/catch AROUND JSON.parse:
   * If a malformed message arrives (shouldn't happen, but defensive coding),
   * we log it instead of crashing the entire API server.
   */
  subClient.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === "worker:socket-events" && io) {
        /**
         * io.emit(data.event, data.payload) broadcasts to ALL connected browsers.
         * data.event is something like "SYNC_PROGRESS" or "DATA_UPDATED"
         * data.payload contains the actual data (e.g., { progress: 75 })
         *
         * The frontend Zustand store listens for these events in connectSocket()
         * and updates the UI accordingly — no page refresh needed.
         */
        io.emit(data.event, data.payload);
      } else if (channel === "worker:roster-updated" && onRosterUpdated) {
        /**
         * Roster updates get special treatment — the callback might
         * refresh the API server's own Redis cache before notifying browsers.
         */
        onRosterUpdated();
      }
    } catch (e) {
      logger.error({ err: e }, "PubSub message parse error");
    }
  });
};
