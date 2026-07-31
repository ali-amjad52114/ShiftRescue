export type A1MobileSmsStatus = "sent" | "delivered";

export type OriginationMode = "outbound" | "inbound";

export interface A1MobileClaimedNumber {
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
}

export interface A1MobileResult {
  success: boolean;
  error?: string;
}

export interface A1MobileSmsResult extends A1MobileResult {
  messageId?: string;
  status?: A1MobileSmsStatus;
}

export interface A1MobileCallResult extends A1MobileResult {
  callId?: string;
  mode?: OriginationMode;
}
