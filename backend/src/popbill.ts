import popbillSdk from "popbill";
import type { Balance, Env } from "./types";

interface PopbillError {
  code?: number;
}

interface JobState {
  jobState?: string | number;
  errorCode?: number;
}

interface SearchResult {
  balance?: string;
}

type Success<T> = (value: T) => void;
type Failure = (error: PopbillError) => void;

interface EasyFinBankService {
  registBankAccount(
    corpNum: string,
    account: Record<string, unknown>,
    userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void;
  updateBankAccount(
    corpNum: string,
    bankCode: string,
    accountNumber: string,
    account: Record<string, unknown>,
    userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void;
  deleteBankAccount(
    corpNum: string,
    bankCode: string,
    accountNumber: string,
    userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void;
  closeBankAccount(
    corpNum: string,
    bankCode: string,
    accountNumber: string,
    closeType: string,
    userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void;
  requestJob(
    corpNum: string,
    bankCode: string,
    accountNumber: string,
    startDate: string,
    endDate: string,
    userId: string,
    success: Success<string>,
    failure: Failure,
  ): void;
  getJobState(
    corpNum: string,
    jobId: string,
    userId: string,
    success: Success<JobState>,
    failure: Failure,
  ): void;
  search(
    corpNum: string,
    jobId: string,
    tradeTypes: string[],
    searchString: string,
    page: number,
    perPage: number,
    order: "D" | "A",
    userId: string,
    success: Success<SearchResult>,
    failure: Failure,
  ): void;
}

export interface PopbillRegistration {
  bankCode: string;
  accountNumber: string;
  accountPassword: string;
  identityNumber: string;
  accountName: string;
  bankId?: string;
  fastId?: string;
  fastPassword?: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerCode: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

function errorMessage(code: number | undefined): string {
  if (code === -18021027) {
    return "해당 은행에서 빠른조회·간편계좌조회를 먼저 신청한 뒤 다시 연결해 주세요. · 팝빌 코드 -18021027";
  }
  return `팝빌 요청을 처리하지 못했습니다. · 팝빌 코드 ${String(code ?? "UNKNOWN")}`;
}

function callback<T>(
  invoke: (success: Success<T>, failure: Failure) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke(resolve, (error) => {
      reject(new ProviderError(
        errorMessage(error.code),
        String(error.code ?? "UNKNOWN"),
      ));
    });
  });
}

function service(env: Env): EasyFinBankService {
  popbillSdk.config({
    LinkID: env.POPBILL_LINK_ID,
    SecretKey: env.POPBILL_SECRET_KEY,
    IsTest: env.POPBILL_MODE === "test",
    // Cloudflare Workers do not provide a stable egress IP. Keep this
    // configurable so a future fixed-egress deployment can enable it.
    IPRestrictOnOff: env.POPBILL_IP_RESTRICT === "true",
    UseStaticIP: false,
    UseLocalTimeYN: true,
  });
  return popbillSdk.EasyFinBankService() as EasyFinBankService;
}

function usePeriod(env: Env): number {
  const value = Number.parseInt(env.POPBILL_USE_PERIOD ?? "1", 10);
  return Number.isFinite(value) && value >= 1 && value <= 12 ? value : 1;
}

export async function registerAccount(
  env: Env,
  input: PopbillRegistration,
): Promise<void> {
  const easyFinBank = service(env);
  try {
    await callback<unknown>((success, failure) => {
      easyFinBank.registBankAccount(env.POPBILL_CORP_NUM, {
        BankCode: input.bankCode,
        AccountNumber: input.accountNumber,
        AccountPWD: input.accountPassword,
        AccountType: "개인",
        IdentityNumber: input.identityNumber,
        AccountName: input.accountName,
        ...(input.bankId ? { BankID: input.bankId } : {}),
        ...(input.fastId ? { FastID: input.fastId } : {}),
        ...(input.fastPassword ? { FastPWD: input.fastPassword } : {}),
        UsePeriod: usePeriod(env),
        Memo: "미리내 연구 파일럿",
      }, env.POPBILL_USER_ID, success, failure);
    });
  } catch (registrationError) {
    if (!(registrationError instanceof ProviderError)) throw registrationError;
    try {
      await callback<unknown>((success, failure) => {
        easyFinBank.updateBankAccount(
          env.POPBILL_CORP_NUM,
          input.bankCode,
          input.accountNumber,
          {
            AccountPWD: input.accountPassword,
            AccountName: input.accountName,
            ...(input.bankId ? { BankID: input.bankId } : {}),
            ...(input.fastId ? { FastID: input.fastId } : {}),
            ...(input.fastPassword ? { FastPWD: input.fastPassword } : {}),
            Memo: "미리내 연구 파일럿",
          },
          env.POPBILL_USER_ID,
          success,
          failure,
        );
      });
    } catch (updateError) {
      if (!(updateError instanceof ProviderError)) throw updateError;
      throw new ProviderError(
        `${updateError.message} (계좌 등록 코드 ${registrationError.providerCode})`,
        updateError.providerCode,
        updateError.status,
      );
    }
  }
}

export async function fetchBalance(
  env: Env,
  bankCode: string,
  accountNumber: string,
  bankName: string,
): Promise<Balance> {
  const easyFinBank = service(env);
  const end = dateKey(new Date());
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const start = dateKey(startDate);
  const jobId = await callback<string>((success, failure) => {
    easyFinBank.requestJob(
      env.POPBILL_CORP_NUM,
      bankCode,
      accountNumber,
      start,
      end,
      env.POPBILL_USER_ID,
      success,
      failure,
    );
  });

  let state: JobState | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    state = await callback<JobState>((success, failure) => {
      easyFinBank.getJobState(
        env.POPBILL_CORP_NUM,
        jobId,
        env.POPBILL_USER_ID,
        success,
        failure,
      );
    });
    if (String(state.jobState) === "3") break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (!state || String(state.jobState) !== "3") {
    throw new ProviderError("은행 잔액 확인이 지연되고 있습니다.", "PENDING", 503);
  }
  if (state.errorCode !== 1) {
    throw new ProviderError(
      errorMessage(state.errorCode),
      String(state.errorCode ?? "UNKNOWN"),
    );
  }

  const result = await callback<SearchResult>((success, failure) => {
    easyFinBank.search(
      env.POPBILL_CORP_NUM,
      jobId,
      [],
      "",
      1,
      1,
      "D",
      env.POPBILL_USER_ID,
      success,
      failure,
    );
  });
  if (!result.balance || !/^-?\d+$/.test(result.balance)) {
    throw new ProviderError("팝빌 잔액 응답 형식이 올바르지 않습니다.", "INVALID_BALANCE");
  }
  const amount = Number.parseInt(result.balance, 10);
  return {
    balanceAmount: amount,
    availableAmount: amount,
    bankName,
    productName: "팝빌 연결 계좌",
    syncedAt: new Date().toISOString(),
    provider: "popbill",
  };
}

export async function removeAccount(
  env: Env,
  bankCode: string,
  accountNumber: string,
): Promise<void> {
  const easyFinBank = service(env);
  if (env.POPBILL_MODE === "test") {
    await callback<unknown>((success, failure) => {
      easyFinBank.deleteBankAccount(
        env.POPBILL_CORP_NUM,
        bankCode,
        accountNumber,
        env.POPBILL_USER_ID,
        success,
        failure,
      );
    });
    return;
  }
  if (!env.POPBILL_CLOSE_TYPE) {
    throw new ProviderError(
      "팝빌 해지유형이 확정되지 않아 운영 계좌를 안전하게 해지할 수 없습니다.",
      "CLOSE_TYPE_REQUIRED",
      503,
    );
  }
  await callback<unknown>((success, failure) => {
    easyFinBank.closeBankAccount(
      env.POPBILL_CORP_NUM,
      bankCode,
      accountNumber,
      env.POPBILL_CLOSE_TYPE!,
      env.POPBILL_USER_ID,
      success,
      failure,
    );
  });
}

function dateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
}
