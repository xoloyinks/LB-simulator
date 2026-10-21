# Load balancer simulator

NestJS backend (simulation engine, REST + Server-Sent Events) and a single-file HTML + Tailwind dashboard.

    npm install
    npm run start:dev      # http://localhost:3000

## API
| Method | Path | Purpose |
|---|---|---|
| GET | /api/state | Current snapshot |
| GET | /api/stream | SSE stream, one snapshot every 100 ms |
| POST | /api/servers | Add a server `{ name?, weight?, capacity? }` |
| PATCH | /api/servers/:id/toggle | Take a server down or bring it back |
| DELETE | /api/servers/:id | Remove a server |
| PUT | /api/config | `{ algorithm?, rate? }` |
| POST | /api/burst, /api/reset | Send 40 extra requests, reset stats |

Algorithms live in `src/balancer/strategies.ts`, one class per strategy behind a common `Strategy` interface.
