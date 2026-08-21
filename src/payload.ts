export const OpCode = {
  Dispatch: 0,
  HttpCallbackAck: 12,
  CallbackValidation: 13,
} as const;

export interface Payload<T = unknown> {
  id?: string;
  op: number;
  d?: T;
  s?: number;
  t?: string;
}

export interface CallbackValidationData {
  plain_token: string;
  event_ts: string;
}
