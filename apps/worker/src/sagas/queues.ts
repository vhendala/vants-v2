// Queue names (T-011). Consumers get one queue each (pg-boss fan-out); pumps are `stately` queues that only wake a loop
// which reads its work from the database, so at most one runs and one waits.
export const PAYOUT_SAGA = "payout-saga";
export const REFUND_SAGA = "refund-saga";
export const PAYOUT_PUMP = "payout-pump";
export const REFUND_PUMP = "refund-pump";
export const SWEEP = "payment-sweep";
