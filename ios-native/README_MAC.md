# 미리내 iOS 네이티브 앱 — Mac에서 빌드해 내 아이폰에 넣기

`ios-native/`는 핸드오프의 옛 SwiftUI 코드(`ios-native-legacy`, 금융결제원 시절)를 **현재 로직**에 맞게 다시 쓴 프로젝트입니다.

- 계산기 `Shared/SpendableCalculator.swift` = Android `SpendableCalculator.kt`를 한 줄씩 옮긴 것 (회차·미납·안전완충액·위험도 임계값 동일)
- 직접입력 장부(지출·입금·잔액 맞추기·납부상태·기록·CSV 공유) = Scriptable `Mirinae.js`와 같은 기능
- 홈 화면 위젯(WidgetKit, 작은/중간 크기) = Scriptable 위젯과 같은 배치·색
- 서버(팝빌) 연동 코드는 뺐습니다. 이 앱은 아이폰 안에서만 돕니다.

> **솔직한 주의사항 하나.** 이 코드는 Linux 환경에서 작성했고 Xcode로 컴파일해 보지는 못했습니다(Swift 툴체인 다운로드가 막혀 있었어요). 대신 독립 리뷰를 한 번 거쳐 컴파일 오류 후보를 고쳤고, 계산 로직은 Python으로 옮겨 12개 교차 시나리오 + 13개 단위테스트 기대값이 정확히 재현되는 것까지 확인했습니다. 그래서 **Mac에서 제일 먼저 할 일은 테스트 실행(⌘U)** 입니다. 빨간 줄이 뜨면 오류 메시지를 그대로 복사해서 보내주세요. 대개 한두 줄 고치면 끝나는 종류입니다.

## 0. 준비물

| 항목 | 비고 |
|---|---|
| macOS 14 이상 + **Xcode 15 이상** | App Store에서 설치(용량 큼). 처음 열 때 iOS 플랫폼 구성요소 설치 |
| Homebrew | 없으면 https://brew.sh 의 한 줄 설치 명령 |
| **XcodeGen** | `brew install xcodegen` — `project.yml`로 `.xcodeproj`를 만들어 줌 |
| Apple ID | 무료 계정이면 됨. Xcode → Settings → Accounts → `+` 로 로그인 |
| 아이폰 + 케이블 | iOS 16 이상. 처음엔 시뮬레이터로만 봐도 됨 |

## 1. 프로젝트 만들고 열기

```bash
cd ios-native
xcodegen generate        # Mirinae.xcodeproj 생성 (.gitignore 에 있음, 언제든 다시 만들면 됨)
open Mirinae.xcodeproj
```

## 2. 서명 설정 (한 번만)

Xcode 왼쪽 트리 맨 위 `Mirinae` 프로젝트 클릭 → TARGETS에서 **Mirinae / MirinaeWidget / MirinaeTests 세 타깃 각각** → `Signing & Capabilities` → `Team`에 본인 Apple ID(Personal Team) 선택.

- **"Failed to register bundle identifier"** 가 뜨면 누군가 이미 `kr.sseuldon.mirinae`를 쓰는 겁니다. `project.yml`의 `PRODUCT_BUNDLE_IDENTIFIER` 세 곳을 예: `kr.sseuldon.mirinae.jaegeol` / `…jaegeol.widget` / `…jaegeol.tests`로 바꾸고 `xcodegen generate` 다시.
- **App Groups** 는 `group.kr.sseuldon.mirinae` 하나를 앱과 위젯이 같이 씁니다. 자동 서명이 등록해 줍니다. 여기서 오류가 나면(무료 계정에서 드물게) 그룹 ID를 바꿔야 하는데, 바꿀 곳은 `Shared/MirinaeStore.swift`의 `appGroupIdentifier`, `App/Mirinae.entitlements`, `Widget/MirinaeWidget.entitlements` 세 곳입니다. 그래도 안 되면 알려주세요 — 그때는 유료 계정이 필요한 케이스입니다.

## 3. 테스트부터 (⌘U)

상단 기기 목록에서 아무 iPhone 시뮬레이터를 고르고 `Product → Test` (⌘U). **25개** 테스트가 돌아야 합니다.

- `SpendableCalculatorTests` 13개 — Android 단위테스트 이식
- `CrossPlatformScenarioTests` 12개 — Android·Scriptable과 같은 시나리오, 기대값은 `../verify/expected.txt`와 글자 단위 동일

컴파일 오류가 나면 → 메시지 복사해서 보내주기. 테스트가 빨갛게 실패하면 → 계산 이식 오류이니 역시 보내주기.

## 4. 시뮬레이터에서 먼저 보기 ("컴퓨터에서 폰 띄우기")

기기 목록에서 iPhone 시뮬레이터 선택 → ▶. Mac 화면에 아이폰이 뜨고 앱이 설치됩니다. 시뮬레이터 홈 화면에서도 위젯을 똑같이 추가할 수 있어요(빈 곳 길게 → `+` → 미리내). 코드 고치고 ▶ 누르면 바로 반영되니 개발은 대부분 여기서 하면 됩니다.

## 5. 내 아이폰에 설치

1. 아이폰을 케이블로 연결 → 아이폰에서 "이 컴퓨터를 신뢰".
2. 아이폰 `설정 → 개인정보 보호 및 보안 → 개발자 모드` 켜기 → 재부팅 (iOS 16 이상 필수).
3. Xcode 기기 목록에서 내 아이폰 선택 → ▶.
4. 첫 실행 때 "신뢰할 수 없는 개발자" 가 뜨면 아이폰 `설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰`.
5. 앱이 열리면 `잔액 직접 입력으로 시작` → 값 입력 → 홈 화면에 위젯 추가.

무료 계정 제약: 설치한 앱은 **7일 뒤 실행이 막힙니다**. Xcode에서 다시 ▶ 누르면 되고 데이터는 그대로 남습니다. Bundle ID 등록은 일주일에 10개 제한이 있으니 ID를 자주 바꾸지 마세요. 다른 사람 폰에 주려면 유료 개발자 프로그램(연 $99) + TestFlight가 필요합니다.

## 6. 맞는지 확인하는 값 (오늘 2026-09-20 기준)

앱에서 `잔액 직접 입력으로 시작`:
1. 참여자 코드 `P01`, 현재 잔액 `1000000` → 다음
2. 소득 방식 `매월 비슷한 날`, 소득일 `25`
3. 안전완충액 `100000`
4. 고정비 추가: `월세` `300000` `매월 반복` 첫 납부일 `2026-09-27` → 저장 → 완료

카드와 위젯에 **600,000원**, 초록 게이지 10칸, `고정비 300,000원`, `다음 고정비 D-7`, `소득 예상 D-5`.
`지출 입력` 100,000 → **500,000원**. `은행 잔액과 맞추기`로 330,000 → **70,000원 부족**, 빨간 게이지 1칸, 카드에 🚨.

Android·Scriptable과 같은 입력이면 같은 숫자가 나와야 합니다(교차 검증 통과 기준).

## 7. 어디를 고치면 뭐가 바뀌나

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 계산식·임계값 | `Shared/SpendableCalculator.swift` (고치면 Android·Scriptable·`Tests/`도 함께) |
| 데이터 모델·저장 | `Shared/Models.swift`, `Shared/MirinaeStore.swift` (App Group UserDefaults, JSON) |
| 위젯 모양 | `Widget/MirinaeWidget.swift` (`MediumContent`/`SmallContent`) |
| 색·게이지·배지 | `Shared/Theme.swift` |
| 첫 화면·초기 입력 | `App/Views/StartView.swift` |
| 메인 카드·메뉴 | `App/Views/DashboardView.swift` |
| 고정비·소득일 설정 | `App/Views/BudgetSetupView.swift` |
| 지출/입금/잔액맞추기/납부상태/기록/설정 시트 | `App/Views/Sheets.swift` |
| 상태 변경 로직(장부 규칙) | `App/AppState.swift` |
| 앱 이름·버전·Bundle ID·URL 스킴 | `project.yml` (수정 후 `xcodegen generate`) |

## 8. 자주 걸리는 것

- **위젯이 "설정 필요"만 보여줌** → 앱 톱니바퀴(설정) → `위젯 진단`이 빨간색이면 App Group이 두 타깃 모두에 안 붙은 것. §2 확인.
- **위젯이 안 바뀜** → 앱에서 저장할 때마다 `WidgetCenter.reloadAllTimelines()`를 부르지만 iOS가 조금 늦출 수 있음. 위젯을 탭했다가(앱이 열림) 돌아오면 대개 갱신. 자정에는 D-day가 자동 재계산.
- **DatePicker 날짜가 하루 어긋남** → 기기 시간대가 한국이 아닐 때만 생기는 문제. 계산은 항상 한국시간 기준.
- **`xcodegen: command not found`** → `brew install xcodegen` 후 터미널 새로 열기.
- Scriptable 위젯과 이 앱은 데이터가 따로입니다. 같은 폰에 둘 다 있어도 서로 영향 없음.
