export type AlgoName = 'round-robin' | 'weighted-round-robin' | 'least-connections' | 'ip-hash' | 'random';

export interface ServerNode {
  id: number;
  name: string;
  weight: number;
  capacity: number;   // max concurrent connections
  up: boolean;        // real state of the server
  healthy: boolean;   // what the balancer believes (updated by health checks)
  active: number;
  handled: number;
  failed: number;
  credit: number;     // used by smooth weighted round robin
}

export interface Strategy {
  pick(pool: ServerNode[], clientId: number): ServerNode | null;
}

export interface SimEvent {
  clientId: number;
  serverId: number | null;
  outcome: 'accepted' | 'refused' | 'overloaded' | 'no_server';
}
