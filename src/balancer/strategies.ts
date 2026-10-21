import { AlgoName, ServerNode, Strategy } from './types';

class RoundRobin implements Strategy {
  private i = 0;
  pick(pool: ServerNode[]) {
    return pool.length ? pool[this.i++ % pool.length] : null;
  }
}

// nginx-style smooth weighted round robin
class WeightedRoundRobin implements Strategy {
  pick(pool: ServerNode[]) {
    let total = 0;
    let best: ServerNode | null = null;
    for (const s of pool) {
      s.credit += s.weight;
      total += s.weight;
      if (!best || s.credit > best.credit) best = s;
    }
    if (best) best.credit -= total;
    return best;
  }
}

class LeastConnections implements Strategy {
  pick(pool: ServerNode[]) {
    return pool.reduce<ServerNode | null>((b, s) => (!b || s.active < b.active ? s : b), null);
  }
}

class IpHash implements Strategy {
  pick(pool: ServerNode[], clientId: number) {
    if (!pool.length) return null;
    return pool[(Math.imul(clientId + 1, 2654435761) >>> 0) % pool.length];
  }
}

class RandomPick implements Strategy {
  pick(pool: ServerNode[]) {
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
}

export const ALGORITHMS: AlgoName[] = ['round-robin', 'weighted-round-robin', 'least-connections', 'ip-hash', 'random'];

export const createStrategies = (): Record<AlgoName, Strategy> => ({
  'round-robin': new RoundRobin(),
  'weighted-round-robin': new WeightedRoundRobin(),
  'least-connections': new LeastConnections(),
  'ip-hash': new IpHash(),
  random: new RandomPick(),
});
