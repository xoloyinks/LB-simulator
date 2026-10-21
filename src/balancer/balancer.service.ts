import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ConfigDto, CreateServerDto } from './dto';
import { ALGORITHMS, createStrategies } from './strategies';
import { AlgoName, ServerNode, SimEvent } from './types';

interface Flight { s: ServerNode; start: number; end: number }
const blankStats = () => ({ sent: 0, ok: 0, failed: 0, avgLatencyMs: 0 });

@Injectable()
export class BalancerService implements OnModuleInit, OnModuleDestroy {
  readonly state$ = new Subject<object>();
  private strategies = createStrategies();
  private servers: ServerNode[] = [];
  private flights: Flight[] = [];
  private events: SimEvent[] = [];
  private stats = blankStats();
  private algorithm: AlgoName = 'round-robin';
  private rate = 12;
  private nextId = 1;
  private acc = 0;
  private lastTick = Date.now();
  private lastCheck = Date.now();
  private timer?: NodeJS.Timeout;

  constructor() {
    [3, 2, 1, 1].forEach((weight) => this.add({ weight }));
  }

  onModuleInit() { this.timer = setInterval(() => this.tick(), 100); }
  onModuleDestroy() { clearInterval(this.timer); }

  // ---- commands used by the controller ----
  add(dto: CreateServerDto) {
    const id = this.nextId++;
    const weight = dto.weight ?? 1;
    const s: ServerNode = {
      id, name: dto.name?.trim() || `Server ${id}`, weight, capacity: dto.capacity ?? weight * 4,
      up: true, healthy: true, active: 0, handled: 0, failed: 0, credit: 0,
    };
    this.servers.push(s);
    return this.view(s);
  }

  toggle(id: number) {
    const s = this.find(id);
    s.up = !s.up;
    if (!s.up) { // in-flight connections are dropped when a server dies
      const lost = this.flights.filter((f) => f.s === s).length;
      this.flights = this.flights.filter((f) => f.s !== s);
      s.active = 0; s.failed += lost; this.stats.failed += lost;
    }
    return this.view(s);
  }

  remove(id: number) {
    const s = this.find(id);
    this.flights = this.flights.filter((f) => f.s !== s);
    this.servers = this.servers.filter((x) => x !== s);
    return { removed: id };
  }

  configure(dto: ConfigDto) {
    if (dto.algorithm) this.algorithm = dto.algorithm;
    if (dto.rate !== undefined) this.rate = dto.rate;
    return this.snapshot();
  }

  burst(n = 40) { for (let i = 0; i < n; i++) this.dispatch(); }

  reset() {
    this.stats = blankStats();
    this.flights = [];
    this.servers.forEach((s) => Object.assign(s, { up: true, healthy: true, active: 0, handled: 0, failed: 0, credit: 0 }));
  }

  snapshot(drain = false) {
    return {
      algorithm: this.algorithm, rate: this.rate, algorithms: ALGORITHMS, stats: { ...this.stats },
      servers: this.servers.map((s) => this.view(s)), events: drain ? this.events.splice(0) : [],
    };
  }

  // ---- simulation engine ----
  private dispatch() {
    const clientId = Math.floor(Math.random() * 16);
    this.stats.sent++;
    const pool = this.servers.filter((s) => s.healthy); // the balancer only sees health-check results
    const s = this.strategies[this.algorithm].pick(pool, clientId);
    if (!s) return this.fail(null, clientId, 'no_server');
    if (!s.up) return this.fail(s, clientId, 'refused');
    if (s.active >= s.capacity) return this.fail(s, clientId, 'overloaded');
    s.active++;
    const now = Date.now();
    const serviceMs = (500 + Math.random() * 500) * (1 + (1.5 * s.active) / s.capacity); // slower under load
    this.flights.push({ s, start: now, end: now + serviceMs });
    this.events.push({ clientId, serverId: s.id, outcome: 'accepted' });
  }

  private fail(s: ServerNode | null, clientId: number, outcome: SimEvent['outcome']) {
    this.stats.failed++;
    if (s) s.failed++;
    this.events.push({ clientId, serverId: s?.id ?? null, outcome });
  }

  private tick() {
    const now = Date.now();
    this.acc += (this.rate * (now - this.lastTick)) / 1000;
    this.lastTick = now;
    while (this.acc >= 1) { this.acc--; this.dispatch(); }

    const done = this.flights.filter((f) => f.end <= now);
    if (done.length) {
      this.flights = this.flights.filter((f) => f.end > now);
      for (const f of done) {
        f.s.active--; f.s.handled++; this.stats.ok++;
        const l = now - f.start;
        this.stats.avgLatencyMs = this.stats.avgLatencyMs ? this.stats.avgLatencyMs * 0.95 + l * 0.05 : l;
      }
    }
    if (now - this.lastCheck >= 2000) { // health check
      this.lastCheck = now;
      this.servers.forEach((s) => (s.healthy = s.up));
    }
    this.state$.next(this.snapshot(true));
  }

  private find(id: number) {
    const s = this.servers.find((x) => x.id === id);
    if (!s) throw new NotFoundException(`Server ${id} not found`);
    return s;
  }
  private view(s: ServerNode) { const { credit, ...rest } = s; return rest; }
}
