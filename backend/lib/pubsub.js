import Redis from "ioredis";

let pubClient = null;
let subClient = null;

/**
 * Initialize the Redis Pub/Sub publisher (Worker process calls this).
 */
export const initPublisher = (redisUrl) => {
  if (!redisUrl) return;
  pubClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 2000, 30000),
  });
  pubClient.connect().catch((err) =>
    console.error("PubSub publisher connect failed:", err.message),
  );
};

/**
 * Publish a Socket.IO event from the Worker to be re-broadcast by the API server.
 */
export const publishSocketEvent = async (event, payload) => {
  if (!pubClient) return;
  try {
    await pubClient.publish(
      "worker:socket-events",
      JSON.stringify({ event, payload }),
    );
  } catch (e) {
    console.error("PubSub publish error:", e.message);
  }
};

/**
 * Publish a roster-updated notification from the Worker.
 */
export const publishRosterUpdated = async () => {
  if (!pubClient) return;
  try {
    await pubClient.publish(
      "worker:roster-updated",
      JSON.stringify({ updatedAt: new Date().toISOString() }),
    );
  } catch (e) {
    console.error("Roster PubSub error:", e.message);
  }
};

/**
 * Initialize the Redis Pub/Sub subscriber (API Server calls this).
 * Subscribes to worker channels and re-broadcasts via Socket.IO.
 */
export const initSubscriber = (redisUrl, io, onRosterUpdated) => {
  if (!redisUrl) return;
  subClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 2000, 30000),
  });

  subClient.connect().catch((err) =>
    console.error("PubSub subscriber connect failed:", err.message),
  );

  subClient.subscribe("worker:socket-events", "worker:roster-updated", (err) => {
    if (err) {
      console.error("PubSub subscribe error:", err.message);
    } else {
      console.log("📡 Subscribed to worker PubSub channels");
    }
  });

  subClient.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === "worker:socket-events" && io) {
        io.emit(data.event, data.payload);
      } else if (channel === "worker:roster-updated" && onRosterUpdated) {
        onRosterUpdated();
      }
    } catch (e) {
      console.error("PubSub message parse error:", e.message);
    }
  });
};
