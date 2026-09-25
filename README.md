# 미리내 로컬 MVP 킷 — 두 폰에 소스 빌드로 띄우기 (v0.7.0 기준)

팝빌 계약도, Cloudflare 계정도, Android 서명키도 없이 **오늘 내 Android·iPhone 홈 화면에 위젯을 띄우고, 코드를 고쳐가며 볼 수 있게** 정리한 패키지입니다.

핵심은 두 클라이언트에 이미 들어 있는 **수동입력 모드**입니다. 잔액을 직접 넣으면 `현재 잔액 − 미납 고정비 − 안전완충액` 계산부터 위젯 렌더링까지 전부 기기 안에서 끝나고, 서버 호출이 0회입니다. 그래서 백엔드 없이도 계산·위젯·메뉴·저장 로직을 실제 폰에서 만지면서 개발할 수 있습니다.

```text
mirinae-local-mvp-v0.7.0/      (폴더·파일명은 일부러 영문 — 한글 경로에서 Gradle/압축해제가 깨지는 걸 피하려고)
├── README.md                  ← 이 문서
├── android/                   ← 핸드오프 소스 그대로 (debug 빌드 가능) + 아래 2개 추가
│   ├── app/src/debug/AndroidManifest.xml            debug 전용 cleartext 허용 (나중 로컬 서버용)
│   └── app/src/test/.../CrossPlatformScenarioTest.kt 12개 시나리오 교차 검증 테스트
├── ios-native/                ← 【Mac 있으면】 SwiftUI + WidgetKit 네이티브 앱. README_MAC.md 부터 읽기
│   ├── project.yml            XcodeGen 정의 → `xcodegen generate`
│   ├── Shared/                계산기·모델·저장소·테마 (앱과 위젯이 공유)
│   ├── App/  Widget/  Tests/  앱 화면 · 홈 화면 위젯 · 테스트 25개
├── ios-scriptable/            ← 【Mac 없어도】 Scriptable 위젯
│   ├── Mirinae.js             ← 폰에 바로 넣는 로컬 빌드 (서버 주소 없음, 채널 test)
│   ├── SseuldonPilot.source.js   원본 템플릿 (자리표시자 2개)
│   ├── build-local.mjs        ← Windows/Mac 어디서든 `node`로 Mirinae.js 생성 (.ps1 대체)
│   ├── manual-mode.test.mjs   ← 파일명 참조 고친 원본 테스트
│   └── *.orig.md              참가자·운영 안내 원문
└── verify/
    ├── scenarios.json         12개 시나리오 (오늘 날짜·잔액·고정비)
    ├── expected.txt           Android 계산 결과 (= Scriptable 결과, 검증 완료)
    └── scriptable-scenarios.mjs  Scriptable 계산을 돌려 expected.txt와 비교
```

이미 확인한 것: Android `SpendableCalculator` 단위테스트 13개 통과, 위 12개 시나리오를 Android(Kotlin)와 Scriptable(JS)에 똑같이 넣었을 때 **모든 필드가 글자 단위로 동일**했습니다. 즉 두 폰에 같은 값을 넣으면 같은 숫자·같은 위험도가 나옵니다.

---

## 1. Android — Android Studio로 debug 빌드 (약 30분, 첫 빌드 기준)

### 준비물
- Android Studio 2025년 하반기 이후 버전 (AGP 8.12.2 / Gradle 8.13 / Kotlin 2.2.20 사용. 번들 JDK로 충분)
- SDK Manager에서 **Android 16 (API 36) SDK Platform** 설치 (없으면 열 때 설치하라고 뜹니다)
- 실기기: 개발자 옵션 → USB 디버깅 켜기. 에뮬레이터도 됩니다(API 33 이상 권장, 위젯 추가 가능)
- 폴더는 **영문 경로**에 두는 걸 권합니다. 예: `C:\dev\mirinae\android`. 한글 경로도 `gradle.properties`의 `overridePathCheck`로 열리긴 하지만 툴체인이 가끔 깨집니다.

### 빌드·설치
1. Android Studio → Open → `android` 폴더 선택. Gradle 8.13이 자동 다운로드됩니다(첫 sync 몇 분).
2. **폰에 파일럿 APK(`Mirinae-Android-Pilot.apk`)가 이미 깔려 있으면 먼저 삭제**하세요. 같은 `kr.sseuldon.app`인데 서명키가 달라서 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`로 막힙니다.
3. 상단 Run ▶ (기본 `app` / debug). 끝.

명령줄로 하려면:

```text
cd android
gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

debug 빌드는 서명키·서버주소 환경변수가 **필요 없습니다**. `app/build.gradle`이 debug에 `API_BASE_URL=http://10.0.2.2:8787`, `API_CHANNEL=test`를 자동으로 넣고 디버그 키로 서명합니다. release는 `verifyReleaseApiBaseUrl` 태스크가 https 주소와 키스토어를 강제하니 이번엔 건드리지 않습니다.

### 폰에서
1. 앱 열기 → `시작하기` 아래 **`잔액 직접 입력`** (팝빌 버튼은 서버가 없어 실패하는 게 정상)
2. 참여자 코드(아무거나, 예 `P01`)와 현재 잔액 입력 → `다음`
3. 소득 방식·예상일·안전완충액·고정비(이름/금액/납부일 `2026-09-25` 형식) → `설정 저장`
4. 홈 화면 빈 곳 길게 → 위젯 → `미리내` 추가. 4×2 셀 기본.
5. 이후 `지출 입력`/`입금 입력`을 누르면 앱 카드와 위젯이 같이 바뀝니다.

수동 모드는 잔액·설정·기록을 Android Keystore AES-GCM으로 암호화해 SharedPreferences에 저장하고, 24시간 숨김 규칙도 적용되지 않습니다(`syncStatus`가 항상 `FRESH`). 20분 WorkManager는 세션이 없으면 네트워크를 타지 않고 위젯만 다시 그립니다.

### 단위테스트
```text
gradlew.bat testDebugUnitTest
```
`SpendableCalculatorTest` 13개 + 이번에 추가한 `CrossPlatformScenarioTest` 12개가 돕니다.

---

## 2. iPhone — Scriptable (약 10분, Mac 불필요)

iOS 쪽 "소스"는 `Mirinae.js` 한 파일이고, Scriptable 앱 안에서 바로 편집·실행됩니다. Xcode도 Apple 개발자 계정도 필요 없습니다.

### 설치
1. App Store에서 **Scriptable** 설치 후 한 번 열었다 닫기.
2. `ios-scriptable/Mirinae.js`를 폰에 넣기. 방법은 편한 것 하나:
   - Windows: **iCloud for Windows** 설치 → 탐색기 `iCloud Drive\Scriptable\`에 복사 (이후 PC에서 편집하면 폰에 동기화됩니다 — 개발 루프로 가장 편함)
   - Mac: AirDrop으로 보내거나 `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/`에 복사
   - 파일이 폰의 `파일` 앱에 있으면 길게 눌러 `이동` → `iCloud Drive` → `Scriptable`
   - 가장 단순한 방법: Scriptable에서 `+` 새 스크립트 → 코드 전체 붙여넣기 → 이름을 **`Mirinae`** 로 저장
3. 스크립트 이름은 `Mirinae` 또는 `SseuldonPilot`로 두세요. 다른 이름이면 저장 키에 접미사가 붙어 **별개 인스턴스**가 됩니다(원본의 `INSTANCE_SUFFIX`). 이건 반대로, 같은 폰에 두 벌 띄워 A/B 비교할 때 쓸 수 있습니다.

### 폰에서
1. Scriptable에서 `Mirinae` 실행 → 메뉴에서 **`잔액 직접 입력`**
2. 참여자 코드·현재 잔액 → 이어지는 화면에서 소득일·안전완충액·고정비 입력
3. 홈 화면 빈 곳 길게 → `+` → Scriptable → **중간 크기** 위젯 추가
4. 위젯 길게 → `위젯 편집` → Script: `Mirinae`, When Interacting: `Run Script`(기본값)
5. 위젯을 탭하면 메뉴가 열리고, `지출 입력`/`입금 입력` 후 위젯이 갱신됩니다.

위젯의 자동 갱신 시각은 iOS가 정합니다(스크립트는 20분 요청). 코드를 고친 뒤 바로 보고 싶으면 Scriptable 앱에서 스크립트를 한 번 실행하거나 위젯을 탭했다 닫으세요.

### Mirinae.js 다시 만들기
원본 `SseuldonPilot.source.js`와 `Mirinae.js`의 차이는 딱 두 줄(서버 주소·채널 자리표시자)입니다. 원본을 고쳤으면:

```text
cd ios-scriptable
node build-local.mjs                              # 서버 없음, 채널 test  → Mirinae.js
node build-local.mjs --api https://서버 --channel test --check   # 나중에 서버가 생기면
node manual-mode.test.mjs                         # 문법 + 수동 장부 계산 테스트
```

`build-local.mjs`는 원래 `build-release.ps1`이 하던 일 중 자리표시자 치환만 OS 무관하게 옮긴 것입니다(.ps1은 ZIP 밖의 `docs/` 폴더와 `SseuldonPilot.js`를 참조해서 전달본만으로는 돌지 않습니다).

### iOS 네이티브(SwiftUI) — Mac이 있으면 `ios-native/`
핸드오프의 `ios-native-legacy`는 옛 금융결제원 백엔드 기준이라 회차(`resolutions`) 개념이 없고 계산도 달랐습니다. 그래서 `ios-native/`에 현재 로직(Android 계산기 1:1 이식 + Scriptable 장부 기능)으로 다시 썼습니다. Mac + Xcode + 무료 Apple ID로 시뮬레이터와 본인 아이폰에 설치할 수 있고, 절차·주의사항·검증값은 `ios-native/README_MAC.md`에 있습니다. 첫 단계는 ⌘U(테스트 25개)입니다.

---

## 3. 어디를 고치면 뭐가 바뀌나

| 바꾸고 싶은 것 | Android | iPhone (Scriptable) | 같이 봐야 할 곳 |
|---|---|---|---|
| 계산식·위험도 임계값 (30만/5만/max(10만, 고정비/4)/일 2만) | `domain/SpendableCalculator.kt` `summary()` `riskLevel()` | `manualSummary()` `manualObligations()` (약 300~400행) | iOS 네이티브 `ios-native/Shared/SpendableCalculator.swift`, 서버 `backend-cloudflare/src/budget.ts` — 자동연동 시 서버가 계산하므로 전부 맞춰야 함 |
| 위젯 모양·문구·색 | `widget/SseuldonWidget.kt` (Glance) | `summaryWidget()` `placeholderWidget()` | 위험도 색은 Android `riskColor()`, Scriptable 게이지 색 로직 |
| 앱 화면·메뉴 | `MainActivity.kt` `buildScreen()` `refreshActionMenu()` | `menu()` 와 각 `async function` | — |
| 수동 장부(입금/지출/잔액 맞추기) | `data/SseuldonRepository.kt` `startManualMode()` `recordManualTransaction()` | `startManualMode()` `recordManualTransaction()` `appendManualEvent()` | 잔액 음수 방지는 `SpendableCalculator.manualBalanceAfter()` |
| 저장 방식 | `data/EncryptedJsonStore.kt` (Keystore AES-GCM) | `mirinae-manual-state.json` (`FileManager.local()`) + Keychain | — |
| 갱신 주기 | `worker/WidgetRefreshWorker.kt` 20분 | `refreshMinutes = 20` | — |
| 버전 | `app/build.gradle` `versionCode 8` / `0.7.0-pilot` | 파일 상단 주석 | — |

계산식을 한쪽에서 바꿨다면 §4의 교차 검증을 다시 돌려 반대쪽도 같이 바꾸세요.

---

## 4. 두 폰의 계산이 같은지 확인하기

```text
node verify/scriptable-scenarios.mjs        # iPhone Scriptable 쪽 → expected.txt 와 비교
cd android && gradlew.bat testDebugUnitTest # Android 쪽 → CrossPlatformScenarioTest
(Mac) ios-native 를 Xcode 로 열고 ⌘U      # iOS 네이티브 쪽 → CrossPlatformScenarioTests
```

셋 다 같은 12개 시나리오(`verify/scenarios.json`)를 돌립니다. 계산식을 의도적으로 바꿨으면 `node verify/scriptable-scenarios.mjs --print > verify/expected.txt`로 기대값을 갱신하고, Kotlin 테스트의 expected 문자열도 같은 값으로 바꿉니다.

| # | 시나리오 | 오늘 | 기대 결과 |
|---|---|---|---|
| 01 | 납부일 전 | 08-04 | 643,000 · 안전 |
| 02 | 납부일 다음 날 미납 | 08-06 | 143,000 · 두 회차 100만 차감 · 주의 |
| 03 | 이번 회차 납부완료 | 08-06 | 643,000 · 다음 회차만 |
| 04 | 오늘 기준 복합(통신비·월세·1회성 미납) | 09-13 | **−22,000 → "22,000원 부족"** · 위험(critical) |
| 05 | 정확히 50,000 | 09-13 | caution (5만 미만이 아니므로) |
| 06 | 49,999 | 09-13 | danger |
| 07 | 주의선 = 고정비/4 (80만→20만) | 09-13 | 199,000 · caution |
| 08 | 일일가용 2만 미만 | 09-01 | 250,000/29일 · caution |
| 09 | 31일 납부일 짧은 달 보정 | 02-10 | 1월 미납 + 2/28 회차 |
| 10 | 불규칙 소득 유예 만료 | 09-13 | 소득일 미정 |
| 11 | 연도 전환 | 12-20 | 2026-12 미납 + 2027-01 회차 |
| 12 | 고정비 없음·소득 미정 | 09-13 | 80,000 · caution |

폰에서 눈으로 확인하기 좋은 조합(오늘 2026-09-13 기준):
- 잔액 400,000 / 완충 50,000 / 통신비 55,000(09-15 매월) / 월세 300,000(09-25 매월) / 넷플릭스 17,000(09-10 한 번만) → 카드에 **"22,000원 부족"**, 상세에 `⚠ 넷플릭스 미납 · 17,000원`
- 잔액 150,000 / 완충 0 / 관리비 100,000(09-20) → **50,000원 · 조금 아껴 써요**(주황). 잔액을 149,999로 맞추면 **고정비에 가까워요**(빨강)로 바뀝니다.

---

## 5. 이번에 새로 확인한 것 (PILOT-01~09 밖)

- `ios-scriptable/manual-mode.test.mjs`가 `SseuldonPilot.js`를 읽는데 패키지엔 `SseuldonPilot.source.js`만 있어 **그대로는 실패**합니다. 킷의 복사본은 경로를 고쳤습니다.
- `build-release.ps1`도 같은 파일명과 ZIP 밖 `docs/*iPhone*.md`를 참조합니다(PILOT-02와 같은 종류). 로컬에선 `build-local.mjs`로 대체.
- Scriptable `manualObligations()`는 옛 1개월 설정 호환용 `paidAt` 필드를 무시하고 Android는 `resolutions`로 승격해 처리합니다. 파일럿 이후 새로 만든 데이터는 전부 `resolutions`라 결과 차이는 없지만, 옛 상태 파일을 그대로 옮기면 한 회차가 다르게 잡힐 수 있습니다.
- Android debug 매니페스트(`app/src/debug/AndroidManifest.xml`)를 추가했습니다. 수동 모드엔 영향이 없고, 나중에 PC에서 띄운 http 서버에 실기기로 붙을 때 필요한 `usesCleartextTraffic`만 debug에 병합됩니다.

## 6. 다음 단계 후보

- **mock 서버**: `POPBILL_MODE`에 mock 분기가 없어 `wrangler dev`로는 잔액을 못 받습니다. `/health` `/auth/popbill/connect` `/api/balance` `/api/budget`만 흉내 내는 작은 서버를 만들면 자동연동 경로(세션·20분 갱신·24시간 숨김·서버 계산)까지 로컬에서 재현할 수 있습니다.
- **정식서비스 계산식 변경 확인**: v1 요구사항은 `max(0, …)`으로 0에서 자르는데 파일럿은 "○○원 부족"을 의도적으로 보여줍니다. 클라이언트를 고치기 전에 어느 쪽이 맞는지 먼저 정하는 게 좋습니다.
