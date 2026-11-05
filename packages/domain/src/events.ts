// Internal event envelope v0 (SPEC §3.3). Domain code builds drafts; the database layer assigns `id` and `occurredAt`
// when it publishes them, so this package stays free of clocks and randomness.

export interface AggregateRef {
  type: string;
  id: string;
}

export interface EventDraft<P = unknown> {
  type: string;
  /** Payload schema version for this event type. */
  version: number;
  aggregate: AggregateRef;
  /** The payment (or other flow) this event belongs to. */
  correlationId: string;
  /** The event or inbox record that caused this one; `null` for a command from outside. */
  causationId: string | null;
  payload: P;
}

export interface DomainEvent<P = unknown> extends EventDraft<P> {
  id: string;
  occurredAt: string;
}
