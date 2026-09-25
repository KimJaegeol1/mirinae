// 가짜 팝빌 SDK (로컬 mock 전용)
//
// wrangler.mock.jsonc 의 alias 설정이 `import popbillSdk from "popbill"` 를 이 파일로 바꿔치기한다.
// 그래서 팀 코드(src/popbill.ts, src/index.ts)는 한 줄도 바꾸지 않고 "은행"만 가짜가 된다.
// 실제 popbill SDK 중 src/popbill.ts 가 쓰는 EasyFinBankService 메서드만 흉내 낸다.
//
// 가짜 은행 규칙 (README_MOCK.md 에도 있음)
//   - 등록되는 계좌의 초기 잔액 = 계좌번호 끝 4자리 × 1,000원  (…1234 → 1,234,000원)
//   - 계좌번호가 0000 으로 끝나면 등록 실패 (팝빌 코드 -18021027: 빠른조회 미신청)
//   - 계좌번호가 9999 로 끝나면 첫 잔액조회만 "처리 중"으로 남아 202(pending) 경로를 탄다. 두 번째부터는 정상
//   - 잔액은 /mock/bank/balance (또는 http://localhost:8787/mock/ 페이지) 로 바꿀 수 있다
//   - 상태는 메모리에만 있어서 `wrangler dev` 를 다시 켜면 초기화된다

export interface FakeAccount {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  balance: number;
  registeredAt: string;
  jobRequests: number;
}

const accounts = new Map<string, FakeAccount>();
const jobs = new Map<string, { key: string; pending: boolean }>();
let jobSequence = 0;

function key(bankCode: string, accountNumber: string): string {
  return `${bankCode}:${accountNumber}`;
}

function seedBalance(accountNumber: string): number {
  const last4 = Number.parseInt(accountNumber.slice(-4), 10);
  return (Number.isFinite(last4) ? last4 : 500) * 1000;
}

type Success<T> = (value: T) => void;
type Failure = (error: { code?: number; message?: string }) => void;

export const fakeBank = {
  list(): FakeAccount[] {
    return [...accounts.values()];
  },

  find(accountNumber: string): FakeAccount | undefined {
    return [...accounts.values()].find((item) => item.accountNumber === accountNumber);
  },

  setBalance(accountNumber: string, balance: number): FakeAccount {
    const account = this.find(accountNumber);
    if (!account) throw new Error(`등록된 가짜 계좌가 없어요: ${accountNumber}`);
    account.balance = Math.max(0, Math.round(balance));
    return account;
  },

  adjust(accountNumber: string, delta: number): FakeAccount {
    const account = this.find(accountNumber);
    if (!account) throw new Error(`등록된 가짜 계좌가 없어요: ${accountNumber}`);
    return this.setBalance(accountNumber, account.balance + delta);
  },

  reset(): void {
    accounts.clear();
    jobs.clear();
  },
};

const service = {
  registBankAccount(
    _corpNum: string,
    account: Record<string, unknown>,
    _userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void {
    const bankCode = String(account.BankCode ?? "");
    const accountNumber = String(account.AccountNumber ?? "");
    if (accountNumber.endsWith("0000")) {
      failure({ code: -18021027 });
      return;
    }
    const id = key(bankCode, accountNumber);
    if (!accounts.has(id)) {
      accounts.set(id, {
        bankCode,
        accountNumber,
        accountName: String(account.AccountName ?? ""),
        balance: seedBalance(accountNumber),
        registeredAt: new Date().toISOString(),
        jobRequests: 0,
      });
    }
    success({ code: 1, message: "mock: 등록 완료" });
  },

  updateBankAccount(
    _corpNum: string,
    bankCode: string,
    accountNumber: string,
    _account: Record<string, unknown>,
    _userId: string,
    success: Success<unknown>,
    failure: Failure,
  ): void {
    if (!accounts.has(key(bankCode, accountNumber))) {
      failure({ code: -18021027 });
      return;
    }
    success({ code: 1, message: "mock: 수정 완료" });
  },

  deleteBankAccount(
    _corpNum: string,
    bankCode: string,
    accountNumber: string,
    _userId: string,
    success: Success<unknown>,
    _failure: Failure,
  ): void {
    accounts.delete(key(bankCode, accountNumber));
    success({ code: 1, message: "mock: 삭제 완료" });
  },

  closeBankAccount(
    _corpNum: string,
    bankCode: string,
    accountNumber: string,
    _closeType: string,
    _userId: string,
    success: Success<unknown>,
    _failure: Failure,
  ): void {
    accounts.delete(key(bankCode, accountNumber));
    success({ code: 1, message: "mock: 해지 완료" });
  },

  requestJob(
    _corpNum: string,
    bankCode: string,
    accountNumber: string,
    _startDate: string,
    _endDate: string,
    _userId: string,
    success: Success<string>,
    failure: Failure,
  ): void {
    if (accountNumber.endsWith("0000")) {
      failure({ code: -18021027 });
      return;
    }
    // 서버(wrangler dev)를 껐다 켜면 메모리가 비워진다. 서버 DB 에는 연결이 남아 있으므로
    // 잔액 조회가 들어오면 초기 잔액으로 조용히 다시 등록해 준다 (실제 팝빌은 등록이 유지되는 것과 같은 효과).
    let account = accounts.get(key(bankCode, accountNumber));
    if (!account) {
      account = {
        bankCode,
        accountNumber,
        accountName: "다시 등록된 계좌",
        balance: seedBalance(accountNumber),
        registeredAt: new Date().toISOString(),
        jobRequests: 0,
      };
      accounts.set(key(bankCode, accountNumber), account);
    }
    account.jobRequests += 1;
    jobSequence += 1;
    const jobId = `mockjob-${jobSequence}`;
    jobs.set(jobId, {
      key: key(bankCode, accountNumber),
      pending: accountNumber.endsWith("9999") && account.jobRequests === 1,
    });
    success(jobId);
  },

  getJobState(
    _corpNum: string,
    jobId: string,
    _userId: string,
    success: Success<{ jobState: string | number; errorCode: number }>,
    failure: Failure,
  ): void {
    const job = jobs.get(jobId);
    if (!job) {
      failure({ code: -18021002 });
      return;
    }
    success(job.pending ? { jobState: 2, errorCode: 1 } : { jobState: 3, errorCode: 1 });
  },

  search(
    _corpNum: string,
    jobId: string,
    _tradeTypes: string[],
    _searchString: string,
    _page: number,
    _perPage: number,
    _order: string,
    _userId: string,
    success: Success<{ balance: string }>,
    failure: Failure,
  ): void {
    const job = jobs.get(jobId);
    const account = job ? accounts.get(job.key) : undefined;
    if (!account) {
      failure({ code: -18021002 });
      return;
    }
    success({ balance: String(account.balance) });
  },
};

const fakePopbillSdk = {
  config(_value: Record<string, unknown>): void {
    // 실제 SDK 는 LinkID/SecretKey 를 저장한다. mock 은 아무것도 하지 않는다.
  },
  EasyFinBankService(): unknown {
    return service;
  },
};

export default fakePopbillSdk;
