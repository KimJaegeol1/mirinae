declare module "popbill" {
  interface PopbillSdk {
    config(value: Record<string, unknown>): void;
    EasyFinBankService(): unknown;
  }

  const sdk: PopbillSdk;
  export default sdk;
}
