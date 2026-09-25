# 미리내 금융연동 서버

> 현재 파일럿의 운영 코드는 `backend/cloudflare`이다. 팝빌 지원 일반은행만 사용한다. 이 폴더의 금융결제원 코드는 과거 검토용이며 참가자 배포나 운영에 사용하지 않는다.

## 팝빌 자격증명 전 시험

외부 은행에 접속하지 않고 Android·iOS 연결 화면과 위젯을 시험하려면 다음 값을 사용한다.

```text
OPENBANKING_MODE=disabled
POPBILL_MODE=mock
PILOT_INVITE_CODE=12자-이상의-시험용-코드
PILOT_ADMIN_TOKEN=24자-이상의-운영상태-토큰
```

mock 모드는 계좌번호 끝 네 자리로 고정된 모의 잔액을 만들며 참가자에게 배포하지 않는다.

## 검증

```text
npm ci
npm run check
npm audit --omit=dev
```

## 운영 필수값

`.env.example`을 기준으로 비밀관리 서비스에 값을 등록한다. `.env` 파일과 암호화 상태 파일은 Git·이미지·일반 백업에 넣지 않는다.

파일럿 준비 여부는 `GET /health`의 `pilotReady`로 확인한다. 다음 조건이 모두 맞아야 `true`다.

- 영구 암호화 상태 파일 경로
- 파일럿 초대코드
- 24자 이상의 운영 상태 토큰
- 팝빌 production 모드와 해지구분
- 금융결제원은 disabled
- 비상 금액 숨김이 꺼진 상태

`GET /admin/status`는 관리자 토큰으로만 접근하며 참가자별 임의 ID, 공급자, 마지막 동기화 상태, 예산 설정 여부만 반환한다. 잔액·전체 계좌번호·거래내역은 반환하지 않는다.

## 컨테이너

```text
docker build -t sseuldon-backend .
docker run --rm -p 8787:8787 \
  --env-file .env \
  -v sseuldon-data:/data \
  sseuldon-backend
```

운영에서는 `DATA_FILE_PATH=/data/state.enc`로 설정하고, 외부 로드밸런서에서 TLS 1.2 이상·HSTS·요청 제한을 적용한다. 단일 암호화 파일 저장소이므로 서버 인스턴스는 한 개만 실행한다. 다중 인스턴스가 필요해지면 먼저 트랜잭션·암호화·만료 정리가 가능한 관리형 데이터베이스로 교체해야 한다.

## 비상 숨김

잘못된 잔액 가능성이 발견되면 `PILOT_EMERGENCY_HIDE_AMOUNTS=true`로 바꾸고 서버를 재시작한다. 신규 연결이 차단되고 자동연동 금액은 앱·위젯에서 숨겨진다.
