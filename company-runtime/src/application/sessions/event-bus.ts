import type { CodexAgentRuntimeEnvelope } from "@fields/contracts/internal/agent-runtime";

const DEFAULT_BACKLOG_LIMIT = 200;

type Subscriber = {
  push: (event: CodexAgentRuntimeEnvelope) => void;
  terminate: (terminal: TerminalState) => void;
};

type TerminalState = {
  error: unknown | null;
};

export class MemberTurnEventBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly memberSubscribers = new Map<string, Set<Subscriber>>();
  private readonly backlog = new Map<string, CodexAgentRuntimeEnvelope[]>();
  private readonly terminals = new Map<string, TerminalState>();
  private readonly backlogLimit: number;

  constructor(input: { backlogLimit?: number } = {}) {
    this.backlogLimit = input.backlogLimit ?? DEFAULT_BACKLOG_LIMIT;
  }

  publish(memberId: string, threadId: string, event: CodexAgentRuntimeEnvelope): void {
    const key = eventBusKey(memberId, threadId);
    if (event.method === "turn/started") {
      this.backlog.delete(key);
      this.terminals.delete(key);
    } else if (this.terminals.has(key)) {
      return;
    }
    const events = this.backlog.get(key) ?? [];
    events.push(event);
    if (events.length > this.backlogLimit) {
      events.splice(0, events.length - this.backlogLimit);
    }
    this.backlog.set(key, events);

    for (const subscriber of this.subscribers.get(key) ?? []) {
      subscriber.push(event);
    }
    for (const subscriber of this.memberSubscribers.get(memberId) ?? []) subscriber.push(event);
  }

  clear(memberId: string, threadId: string): void {
    const key = eventBusKey(memberId, threadId);
    this.backlog.delete(key);
    this.terminals.delete(key);
  }

  clearMember(memberId: string): void {
    const prefix = `${memberId}\u0000`;
    for (const [key, subscribers] of this.subscribers) {
      if (!key.startsWith(prefix)) continue;
      for (const subscriber of subscribers) {
        subscriber.terminate({ error: null });
      }
      this.subscribers.delete(key);
    }
    for (const key of this.backlog.keys()) {
      if (key.startsWith(prefix)) this.backlog.delete(key);
    }
    for (const key of this.terminals.keys()) {
      if (key.startsWith(prefix)) this.terminals.delete(key);
    }
    for (const subscriber of this.memberSubscribers.get(memberId) ?? []) subscriber.terminate({ error: null });
    this.memberSubscribers.delete(memberId);
  }

  complete(memberId: string, threadId: string): void {
    this.terminate(memberId, threadId, { error: null });
  }

  fail(memberId: string, threadId: string, error: unknown): void {
    this.terminate(memberId, threadId, { error });
  }

  listenerCount(memberId: string, threadId: string): number {
    return this.subscribers.get(eventBusKey(memberId, threadId))?.size ?? 0;
  }

  async *subscribe(
    memberId: string,
    threadId: string,
    input: { signal?: AbortSignal | null } = {},
  ): AsyncGenerator<CodexAgentRuntimeEnvelope> {
    const key = eventBusKey(memberId, threadId);
    const pending = [...(this.backlog.get(key) ?? [])];
    let notify: (() => void) | null = null;
    let aborted = false;
    let terminal = this.terminals.get(key) ?? null;
    const subscriber: Subscriber = {
      push: (event) => {
        pending.push(event);
        notify?.();
        notify = null;
      },
      terminate: (value) => {
        terminal = value;
        notify?.();
        notify = null;
      },
    };
    const abort = () => {
      aborted = true;
      notify?.();
      notify = null;
    };
    const actorSubscribers = this.subscribers.get(key) ?? new Set<Subscriber>();
    if (terminal === null) {
      actorSubscribers.add(subscriber);
      this.subscribers.set(key, actorSubscribers);
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) {
      abort();
    }

    try {
      while (!aborted) {
        const event = pending.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }
        if (terminal !== null) {
          if (terminal.error !== null) {
            throw terminal.error;
          }
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      actorSubscribers.delete(subscriber);
      if (actorSubscribers.size === 0 && this.subscribers.get(key) === actorSubscribers) {
        this.subscribers.delete(key);
      }
    }
  }

  async *subscribeMember(memberId: string, input: { signal?: AbortSignal | null } = {}): AsyncGenerator<CodexAgentRuntimeEnvelope> {
    const pending: CodexAgentRuntimeEnvelope[] = [];
    let notify: (() => void) | null = null;
    let terminal = false;
    const subscriber: Subscriber = {
      push: (event) => { pending.push(event); notify?.(); notify = null; },
      terminate: (_state) => { terminal = true; notify?.(); notify = null; },
    };
    const subscribers = this.memberSubscribers.get(memberId) ?? new Set();
    subscribers.add(subscriber);
    this.memberSubscribers.set(memberId, subscribers);
    const abort = () => subscriber.terminate({ error: null });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    try {
      while (!terminal) {
        const event = pending.shift();
        if (event) { yield event; continue; }
        await new Promise<void>((resolve) => { notify = () => resolve(); });
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.memberSubscribers.delete(memberId);
    }
  }

  private terminate(memberId: string, threadId: string, terminal: TerminalState): void {
    const key = eventBusKey(memberId, threadId);
    if (this.terminals.has(key)) {
      return;
    }
    this.terminals.set(key, terminal);
    const subscribers = this.subscribers.get(key);
    for (const subscriber of subscribers ?? []) {
      subscriber.terminate(terminal);
    }
    if (subscribers) {
      this.subscribers.delete(key);
    }
  }
}

function eventBusKey(memberId: string, threadId: string): string {
  return `${memberId}\u0000${threadId}`;
}
