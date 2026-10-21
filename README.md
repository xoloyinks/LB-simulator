# Load Balancer Simulator

An interactive load balancer simulator. A NestJS backend runs the simulation engine and streams its state over Server-Sent Events. A single-file HTML and Tailwind dashboard animates the traffic and lets you change the algorithm, change the traffic rate, add servers, and take servers down.

The goal is to make the trade-offs between balancing strategies visible, not just describe them.

```
 ┌──────────────┐   REST (config, servers)    ┌─────────────────────────────┐
 │  Dashboard   │ ──────────────────────────▶ │  NestJS                     │
 │  HTML +      │                             │  ├─ BalancerController      │
 │  Tailwind +  │ ◀────────────────────────── │  ├─ BalancerService (engine)│
 │  canvas      │   SSE: snapshot every 100ms │  └─ strategies.ts           │
 └──────────────┘                             └─────────────────────────────┘
```

## Run it

```bash
npm install
npm run start:dev     # http://localhost:3000
```

Open http://localhost:3000. The dashboard is served by the same Nest process, so no extra setup is needed. If you open `public/index.html` from another origin, it calls `http://localhost:3000` directly, or whatever you pass as `?api=<url>`.

---

## Algorithms

Every algorithm implements one interface and is selected at runtime:

```ts
interface Strategy {
  pick(pool: ServerNode[], clientId: number): ServerNode | null;
}
```

`pool` contains only servers the balancer currently believes are healthy. Being an interface, new algorithms can be added without touching the engine (open/closed principle).

| Algorithm | Time per pick | State kept | Considers server size | Considers current load | Client affinity |
|---|---|---|---|---|---|
| Round robin | O(1) | 1 counter | No | No | No |
| Weighted round robin (smooth) | O(n) | 1 credit per server | Yes | No | No |
| Least connections | O(n) | none (reads live counts) | No | Yes | No |
| IP hash | O(1) | none | No | No | Yes |
| Random | O(1) | none | No | No | No |

### 1. Round robin

**How it works:** keep a counter and return `pool[counter++ % pool.length]`.

**Why it works:** if requests cost about the same and servers are identical, each server receives exactly 1/n of the traffic. There is no variance, which is better than random.

**Where it breaks:**
- It ignores server capacity, so a small server gets the same share as a large one and overloads first.
- It ignores request duration. If a few requests are slow, one server can pile up long-running work while the rotation keeps feeding it.
- The counter is taken modulo the *current* pool size, so the rotation shifts slightly when a server joins or leaves.

**Use it when:** servers are homogeneous and requests are short and similar.

### 2. Weighted round robin (smooth)

Plain weighted round robin repeats each server `weight` times in a row. With weights 3, 2, 1, 1 that sends bursts of three requests to server 1, then two to server 2. Over a window the share is right, but short-term load is spiky.

This project implements the **smooth** variant (the one nginx uses), which interleaves picks:

1. Each server keeps a running `credit`, starting at 0.
2. On every pick, add each server's `weight` to its `credit`.
3. Choose the server with the highest `credit`.
4. Subtract the sum of all weights from the chosen server's `credit`.

Worked example with weights `S1=3, S2=2, S3=1, S4=1` (total 7). Each row shows credits after adding weights, then the pick:

| Pick | S1 | S2 | S3 | S4 | Chosen |
|---|---|---|---|---|---|
| 1 | 3 | 2 | 1 | 1 | S1 |
| 2 | -1 | 4 | 2 | 2 | S2 |
| 3 | 2 | -1 | 3 | 3 | S3 (ties go to the earlier server) |
| 4 | 5 | 1 | -3 | 4 | S1 |
| 5 | 1 | 3 | -2 | 5 | S4 |
| 6 | 4 | 5 | -1 | -1 | S2 |
| 7 | 7 | 0 | 0 | 0 | S1 |

The sequence is `S1 S2 S3 S1 S4 S2 S1`. Over 7 picks S1 gets 3, S2 gets 2, and S3 and S4 get 1 each, with no run of three in a row. After 7 picks every credit returns to 0, so the pattern repeats exactly.

**Why it is correct:** the credits always sum to zero after a pick, and a server's credit grows in proportion to its weight while it is not chosen. A server with weight `w` therefore wins about `w / total` of the time.

**Limitation:** weights are static. If a server slows down for reasons unrelated to its weight, this algorithm does not notice.

### 3. Least connections

**How it works:** scan the pool and return the server with the fewest in-flight connections (`active`). Ties go to the first server in the pool.

**Why it is useful:** it is feedback-driven. If one server is stuck on slow requests, its connection count stays high and new requests go elsewhere. Round robin cannot do this. It is the right default when request durations vary a lot.

**Limitations and how they show up in the simulator:**
- It compares raw counts, so a server with capacity 4 and a server with capacity 12 look equally "free" at 3 connections. The natural fix is *weighted* least connections, which compares `active / weight`.
- It needs live connection counts. With several balancers each holding only a local view, they can all rush the same "least loaded" server at once (a herd effect). A common remedy is *power of two choices*: sample two random servers and take the less loaded. This gets most of the benefit of full least connections with far less coordination, and it reduces the worst-case imbalance from roughly `ln n / ln ln n` (pure random) to about `ln ln n`.

### 4. IP hash

**How it works:** hash the client identifier, then take it modulo the pool size:

```ts
pool[(Math.imul(clientId + 1, 2654435761) >>> 0) % pool.length]
```

`2654435761` is Knuth's multiplicative hash constant (about 2^32 divided by the golden ratio), which spreads sequential ids well. `Math.imul` keeps the multiplication in 32-bit integer arithmetic, and `>>> 0` turns the result into an unsigned integer.

**Why it is useful:** the same client always reaches the same server, which gives session stickiness without cookies and improves cache hit rates on the backend.

**Limitations:**
- **Remapping on topology change.** With modulo hashing, changing the pool size from n to n-1 changes the result for most clients. Try it in the simulator: take a server down under IP hash and watch clients move. The production fix is *consistent hashing* or *rendezvous hashing*, which only remaps about 1/n of keys.
- **Uneven load.** Hashing ignores load, and a few heavy clients can pin one server. The simulator uses only 16 distinct clients, so the imbalance is deliberately easy to see.
- **NAT problem.** Many users can share one IP, so a large office behaves like a single very heavy client.

### 5. Random

**How it works:** pick a healthy server uniformly at random.

**Why include it:** it is the baseline. It needs no state, so it scales across many balancers with no coordination. Its expected load per server is equal, but the *variance* is not zero: short windows are visibly lumpy. Comparing it with round robin shows what deterministic rotation buys you.

---

## The simulation model

Understanding the engine makes the results interpretable.

- **Arrivals:** requests are generated at `rate` per second from 16 virtual clients. A fractional accumulator keeps the rate accurate even though the engine ticks every 100 ms.
- **Capacity:** each server has a maximum number of concurrent connections (default `weight × 4`). A request that arrives when `active >= capacity` fails as **overloaded**, like an HTTP 503.
- **Service time:** `U(500, 1000) ms × (1 + 1.5 × active / capacity)`. A busier server is slower, which is the effect that makes load-aware algorithms matter.
- **Two notions of "up":** `up` is the server's real state and `healthy` is what the balancer believes. A health check copies `up` to `healthy` every 2 seconds. If a server dies, requests sent before the next check fail as **refused**. This models real detection delay.
- **Failure on shutdown:** when a server is taken down, its in-flight connections are dropped and counted as failed.
- **Outcomes:** `accepted`, `refused` (server down, not yet detected), `overloaded` (at capacity) and `no_server` (empty pool).

### A useful sanity check: Little's Law

The average number of concurrent requests is `L = λ × W`, where λ is the arrival rate and W is the average time in the system. With the default servers the total capacity is 12 + 8 + 4 + 4 = 28 connections. Since W is roughly 0.75 to 1.5 seconds depending on load, the system saturates at somewhere around 20 to 35 requests per second, no matter which algorithm you use. Past that point no strategy can avoid failures. The interesting differences appear *below* saturation, where a good algorithm avoids overloading individual servers.

### Experiments to try

| Setup | What you should see |
|---|---|
| Round robin vs weighted round robin at about 20 req/s | Round robin gives each server the same share, so the two small servers hit capacity and start failing. Weighted round robin sends them proportionally less and stays healthy. |
| Least connections, then "Send burst" | Connections spread evenly in count because the algorithm steers away from busy servers. |
| IP hash, then take one server down | After detection, clients are remapped across the remaining servers. Before detection, requests to the dead server fail. |
| Any algorithm, take a server down and watch the first 2 seconds | The detection window: failures appear until the health check removes the server from the pool. |
| Add a high-weight, high-capacity server mid-run | Weighted round robin and least connections start using it immediately. |

---

## Design decisions

- **Strategy pattern:** each algorithm is an isolated class behind one interface, which makes them easy to unit test and compare.
- **Engine and transport are separate:** `BalancerService` holds the simulation, and the controller only translates HTTP to service calls.
- **Server-Sent Events instead of WebSockets:** data only flows server to client, SSE reconnects automatically, and it works over plain HTTP.
- **Event draining:** each snapshot carries the requests dispatched since the previous snapshot, so the client can animate individual requests without polling.
- **Input validation:** DTOs use `class-validator`, and the global `ValidationPipe` strips unknown fields and rejects invalid values with a 400.
- **In-memory state:** keeps the project dependency-free. A persistence layer is a natural next step.

## API

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/state` | | Current snapshot |
| GET | `/api/stream` | | SSE, one snapshot every 100 ms |
| POST | `/api/servers` | `{ name?, weight?, capacity? }` | Add a server |
| PATCH | `/api/servers/:id/toggle` | | Take a server down or bring it back |
| DELETE | `/api/servers/:id` | | Remove a server |
| PUT | `/api/config` | `{ algorithm?, rate? }` | Change algorithm or traffic rate |
| POST | `/api/burst` | | Send 40 extra requests |
| POST | `/api/reset` | | Reset counters and bring all servers up |

Algorithm ids: `round-robin`, `weighted-round-robin`, `least-connections`, `ip-hash`, `random`.

## Project layout

```
src/
  main.ts                       bootstrap, validation, static files
  app.module.ts
  balancer/
    types.ts                    ServerNode, Strategy, SimEvent
    strategies.ts               the five algorithms
    balancer.service.ts         simulation engine and health checks
    balancer.controller.ts      REST and SSE endpoints
    dto.ts                      validated request bodies
public/
  index.html                    dashboard (Tailwind CDN + canvas)
```

## Limitations and roadmap

- It simulates traffic and does not proxy real HTTP requests. A real reverse-proxy mode with Docker backends is the next step.
- Not yet implemented: weighted least connections, power of two choices, consistent or rendezvous hashing, least response time, and circuit breakers with slow-start for recovering servers.
- Health checks are binary and fixed at 2 seconds. Real systems use failure thresholds (for example, eject after 3 failures, restore after 2 successes) to avoid flapping.
- Unit tests for each strategy, such as the weighted round robin sequence above, are planned.

## Further reading

- Mitzenmacher, *The Power of Two Choices in Randomized Load Balancing*
- Karger et al., *Consistent Hashing and Random Trees*
- nginx `upstream` module documentation (smooth weighted round robin)
- Little, *A Proof for the Queuing Formula: L = λW*