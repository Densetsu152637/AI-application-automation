// Domain ports stay independent of framework, driver, filesystem and environment APIs.
export interface Clock { now(): Date; monotonicMilliseconds(): number; }
export interface OperationContext { correlationId: string; signal: AbortSignal; }
