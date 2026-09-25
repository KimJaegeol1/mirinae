# 미리내 백엔드 — 로컬 mock 실행 (실제 Worker + 가짜 은행)

팀의 실제 백엔드(`src/index.ts`, Cloudflare Worker + D1)를 **한 줄도 고치지 않고** 내 컴퓨터에서 돌립니다. 팝빌(은행) 부분만 가짜 SDK로 갈아끼웠어요. 그래서 자동연동 경로의 진짜 기능 — 초대코드·세션 토큰·잔액 캐시·20분 동기화·서버 계산·납부완료 규칙·연결 해제 — 이 전부 실제 코드로 검증됩니다. 나중에 팝빌 계약이 되면 `wrangler.jsonc`(운영 설정)로 배포하면 되고, 이 mock 설정은 그대로 개발용으로 남습니다.

```text
backend/
├── src/                      팀 코드 (무수정)
│   └── mock/
│       ├── fake-popbill-sdk.ts   가짜 팝빌 SDK. wrangler.mock.jsonc 의 alias 가 "popbill" 패키지를 이걸로 바꿔치기
│       └── index.mock.ts         /mock/* 제어 경로만 앞에서 처리하고 나머지는 실제 Worker 로 넘김
├── wrangler.mock.jsonc       mock 실행 설정 (초대코드·더미 키·로컬 D1)
├── wrangler.jsonc            운영 설정 (건드리지 않음. assets 경로가 ZIP 밖을 가리키는 PILOT-02 는 그대로)
├── public/                   설치 안내 페이지 자리 (mock 에선 안내문만)
└── package-lock.json         이번에 생성 (PILOT-01: 잠금 파일 없던 문제 해결)
```

여기서 확인한 것(리눅스에서 `wrangler dev`로 실제 실행): `/health testReady=true` → 연결 201 → 예산 저장 → 위젯 요약 → 가짜 은행 잔액 변경 → 캐시 유지 → 강제 새로고침 반영 → 납부완료(최신 잔액 확인 규칙) → 위젯 전용 토큰 권한 분리(401) → 잘못된 초대코드 403 → 등록 실패 502 → 첫 조회 지연 202 pending → cron 동기화로 fresh 전환 → admin/status → 연결 해제 204 → 이후 401. 팀 단위테스트 13개도 통과.

## 1. 준비 (Mac, Homebrew 없이)

1. **Node.js** — https://nodejs.org 에서 LTS 의 `macOS Installer (.pkg)` 받아 설치 (인텔 지원). 터미널 새로 열고 `node -v` 확인.
2. 백엔드 의존성:
   ```
   cd <킷>/backend
   npm install
   ```
   > npm 이 `Cannot read properties of null (reading 'edgesOut')` 로 죽으면 npm 버그예요. `package.json` 의 `vitest` 를 `^3.2.4` 로 두었으니 그대로면 안 나야 하지만, 나오면 `npx npm@latest install` 로 시도.

## 2. 실행

```
npm run mock:db     # 처음 한 번: 로컬 D1(SQLite)에 schema.sql 적용
npm run mock        # http://localhost:8787 에서 실행. Ctrl+C 로 종료
```

- 상태 확인: http://localhost:8787/health → `"testReady": true` 여야 앱이 연결을 받아요
- **가짜 은행 제어 페이지: http://localhost:8787/mock/** — 등록된 계좌와 잔액이 보이고, 버튼으로 −1만/−5만/+10만… 또는 금액 직접 지정
- 초대코드: `MIRINAE-MOCK-2026` (wrangler.mock.jsonc 의 `PILOT_INVITE_CODE`)
- 서버 잔액 캐시 1분 (`BALANCE_CACHE_MINUTES`). 운영은 15분

가짜 은행 규칙:

| 입력 | 결과 |
|---|---|
| 은행 아무거나, 계좌번호 숫자 6자리 이상, 비밀번호 4자리·생년월일 6자리 아무 숫자 | 등록 성공. 초기 잔액 = 끝 4자리 × 1,000원 (`11012341234` → 1,234,000원) |
| 계좌번호 끝 `0000` | 등록 실패 (팝빌 코드 -18021027 "빠른조회 미신청") → 앱에 오류 문구 |
| 계좌번호 끝 `9999` | 첫 잔액조회만 15초 지연 후 실패 → 202 pending("첫 잔액 확인 중"). 다음 조회부터 정상 |

가짜 은행 상태는 메모리라 `npm run mock` 을 다시 켜면 비워집니다(서버 D1 의 연결·세션은 남으니 앱에서 "계좌 연결 해제"로 정리).

## 3. 클라이언트 붙이기

### Android 에뮬레이터 (제일 쉬움)
debug 빌드는 서버 주소가 `http://10.0.2.2:8787` 로 박혀 있어요 — 에뮬레이터에서 Mac 의 localhost 를 가리키는 주소. 그냥 Android Studio 에서 ▶ 누르고 앱의 **일반은행 연결 (팝빌)** 로 들어가면 됩니다.

### Android 실기기 (같은 Wi-Fi)
Mac 의 IP 확인(시스템 설정 → Wi-Fi → 세부사항, 예 `192.168.0.12`) 후 서버는 LAN 에 열고, 앱은 그 주소로 빌드:
```
npm run mock:lan                                                # 서버 (--ip 0.0.0.0)
cd <킷>/android
./gradlew installDebug -PSSEULDON_API_BASE_URL=http://192.168.0.12:8787 -PSSEULDON_CHANNEL=test
```
`SSEULDON_CHANNEL=test` 를 빼먹으면 앱이 `pilotReady`(운영 준비)를 보고 거절해요. http 는 debug 매니페스트가 허용합니다.

### iPhone Scriptable (https 필요)
Scriptable 스크립트는 `https://` 주소만 받습니다. 제일 간단한 방법은 Cloudflare 의 무료 임시 터널:
1. https://github.com/cloudflare/cloudflared/releases/latest 에서 `cloudflared-darwin-amd64.tgz` 다운로드 → 압축 해제
2. ```
   ./cloudflared tunnel --url http://localhost:8787
   ```
   출력 중 `https://xxxx-xxxx.trycloudflare.com` 주소를 복사 (매번 바뀜). 실행이 막히면 `xattr -d com.apple.quarantine cloudflared`
3. iPhone Scriptable → `Mirinae` 실행 → **서버 주소 설정** → 그 https 주소 입력 (서버 준비 검사 통과하면 저장됨)
4. **일반은행 연결 (팝빌)** → 은행 선택 → 초대코드 `MIRINAE-MOCK-2026` → 계좌번호 `11012341234` → 비밀번호 `1234` → 생년월일 `990101` → 추가정보 비움 → 동의 → 고정비 설정 → 위젯 추가

이미 직접입력 모드로 쓰고 있었으면 먼저 `직접 입력 설정 삭제`를 해야 연결 메뉴가 나옵니다.

### iOS 네이티브 앱 (ios-native)
지금은 직접입력 모드만 있어요. 서버 연동 화면은 Scriptable 의 흐름을 옮기면 되는데 아직 안 했습니다.

## 4. 눈으로 확인하는 시나리오

1. 앱에서 연결 후 위젯에 `자동 갱신됨` + 잔액 1,234,000원 기준 계산이 뜸
2. Mac 브라우저에서 http://localhost:8787/mock/ → **−5만** 클릭
3. 앱 `지금 잔액 새로고침` → 위젯 금액이 5만 줄어듦 (새로고침 없이 기다리면 캐시 1분 뒤 위젯 갱신 때 반영)
4. 고정비 납부일이 지난 항목을 넣어두면 `⚠ 미납` 배지 → `고정비 납부·미납 관리` → 납부 완료 → 서버가 최신 잔액을 먼저 확인하고 처리
5. 20분 동기화(cron)는 로컬에서 자동으로 안 돌아요. 수동 실행:
   ```
   curl "http://localhost:8787/__scheduled?cron=*/20+*+*+*+*"
   ```
6. 운영자 화면(잔액·계좌번호 없이 상태만):
   ```
   curl http://localhost:8787/admin/status -H "Authorization: Bearer mirinae-mock-admin-token-0123456789"
   ```
7. 앱 `계좌 연결 해제` → 서버 세션·연결 삭제(204), 위젯은 `설정 필요`로

## 5. 자주 걸리는 것

- `npm run mock` 이 `.wrangler/state` 어쩌고 하며 D1 오류 → `npm run mock:db` 를 먼저
- 앱이 "운영 서버가 아직 준비 중" → `/health` 의 `testReady` 가 false. wrangler.mock.jsonc 의 vars 가 빠졌는지 확인
- Android 실기기가 서버를 못 찾음 → `mock:lan` 으로 띄웠는지, 같은 Wi-Fi 인지, Mac 방화벽(시스템 설정 → 네트워크 → 방화벽)에서 node 허용
- Scriptable "서버를 확인하지 못했어요" → cloudflared 주소가 바뀌었거나 터널이 꺼짐. 다시 띄우고 주소 재입력
- 처음 `wrangler dev` 가 "usage metrics" 물어보면 아무거나 답해도 됨

## 6. 운영 배포로 갈 때

이 mock 은 `wrangler.mock.jsonc` 만 씁니다. 운영은 팀 문서(05_빌드_배포_가이드)대로 `wrangler.jsonc` + 실제 팝빌 시크릿이고, 그 전에 `assets.directory` 경로(PILOT-02)를 실제 dist 위치로 고쳐야 합니다.
