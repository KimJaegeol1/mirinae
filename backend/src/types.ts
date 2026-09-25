export interface Env {
  DB: D1Database;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  POPBILL_MODE: "test" | "production";
  POPBILL_LINK_ID: string;
  POPBILL_SECRET_KEY: string;
  POPBILL_CORP_NUM: string;
  POPBILL_USER_ID: string;
  POPBILL_CLOSE_TYPE?: "중도" | "일반";
  POPBILL_IP_RESTRICT: string;
  POPBILL_USE_PERIOD?: string;
  DATA_ENCRYPTION_KEY: string;
  PILOT_INVITE_CODE: string;
  PILOT_ADMIN_TOKEN?: string;
  RETENTION_DAYS: string;
  BALANCE_CACHE_MINUTES: string;
  EMERGENCY_HIDE_AMOUNTS: string;
}

export type FixedCostCategory =
  | "rent"
  | "maintenance"
  | "mobile"
  | "electricity"
  | "gas"
  | "water"
  | "insurance"
  | "other";

export type FixedCostRecurrence = "monthly" | "once";
export type FixedCostResolutionStatus = "paid" | "waived";

export interface FixedCostResolution {
  period: string;
  status: FixedCostResolutionStatus;
  resolvedAt: string;
}

export interface FixedCost {
  id: string;
  category: FixedCostCategory;
  name: string;
  amount: number;
  dueDate: string;
  recurrence?: FixedCostRecurrence;
  resolutions?: FixedCostResolution[];
  /** 이전 1개월 설정을 안전하게 읽기 위한 호환 필드 */
  paidAt?: string;
}

export interface Budget {
  nextIncomeDate: string;
  incomeMode?: "monthly" | "irregular";
  incomeDay?: number;
  incomeGraceDays?: number;
  safetyBuffer: number;
  fixedCosts: FixedCost[];
}

export interface Balance {
  balanceAmount: number;
  availableAmount: number;
  bankName: string;
  productName: string;
  syncedAt: string;
  provider: "popbill";
}

export interface ConnectionPayload {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  maskedAccountNumber: string;
  balance?: Balance;
  budget?: Budget;
}

export interface FixedCostObligation {
  fixedCostId: string;
  name: string;
  amount: number;
  period: string;
  dueDate: string;
  state: "upcoming" | "overdue";
}

export interface WidgetSummary {
  spendableAmount: number;
  shortageAmount: number;
  availableAmount: number;
  reservedFixedCosts: number;
  upcomingFixedCosts: number;
  overdueFixedCosts: number;
  overdueCount: number;
  fixedCostItems: FixedCostObligation[];
  safetyBuffer: number;
  nextIncomeDate: string;
  daysUntilIncome: number;
  incomeDateKnown: boolean;
  incomeWindowStart?: string;
  incomeWindowEnd?: string;
  nextFixedCostDate?: string;
  daysUntilNextFixedCost?: number;
  syncedAt: string;
  needsUpdate: boolean;
  displayAmount: boolean;
  provider: "popbill";
  riskScore: number;
  riskLevel: "safe" | "caution" | "danger" | "critical";
  shakeLevel: 0 | 1 | 2 | 3;
  status: "fresh" | "delayed" | "stale";
}

export interface StoredConnection {
  id: string;
  encrypted_payload: string;
  payload_iv: string;
  created_at: number;
  expires_at: number;
  last_sync_at: number | null;
  sync_status: string;
  disconnected_at: number | null;
}
