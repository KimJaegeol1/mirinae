# 미리내 Android

Android 6.0 이상용 앱과 Jetpack Glance 홈 화면 위젯이다.

## 현재 기능

- 일반은행: 팝빌 연결
- 자동연결이 안 되는 계좌: 초기 잔액 입력 뒤 입금은 더하고 지출은 빼는 직접 입력 장부
- 직접 입력 이력: 최근 기록 기기 내 확인, Android Keystore 기반 암호화 저장, 참여자 동의 후 CSV 내용 공유
- 잔액에서 다음 소득일까지 미납 고정비와 안전완충액을 뺀 금액 표시
- 금액이 줄수록 붉어지는 색상·경고 문구·위험 표식
- iPhone과 같은 새로고침·고정비 수정·납부상태·연결상태·연결해제·설명서 메뉴
- WorkManager 20분 갱신 요청, 실패 시 마지막 정상 잔액 유지, 24시간 후 숫자 숨김
- Android Keystore 기반 세션·잔액·예산 암호화
- 개인정보 처리 안내와 연결 해제
- 다른 앱 알림 접근 서비스 없음

## Windows 검증 빌드

JDK 17과 Android SDK 36이 필요하다.

```text
gradlew.bat testDebugUnitTest assembleDebug
```

기본 디버그 앱은 에뮬레이터의 `http://10.0.2.2:8787` 서버를 사용한다. 실기기 테스트는
`-PSSEULDON_API_BASE_URL=https://... -PSSEULDON_CHANNEL=test`를 지정해 빌드한다.
실제 배포 Release는 운영 HTTPS 서버 주소가 없으면 빌드가 실패한다.

최초 Release 서명과 빌드는 다음 스크립트를 사용한다. 비밀번호는 Windows 사용자 DPAPI로 암호화되고 `.signing` 폴더는 배포물과 저장소에서 제외된다.

```text
powershell -ExecutionPolicy Bypass -File .\build-pilot-release.ps1 -InitializeSigning
```

이후 업데이트 APK는 같은 키를 사용해야 기존 설치 위에 정상 업데이트된다.

```text
powershell -ExecutionPolicy Bypass -File .\build-pilot-release.ps1
```

## 파일럿 전 실기기 확인

- 팝빌 지원 일반은행의 최초 연결과 연결 해제
- 카카오뱅크·토스뱅크·케이뱅크가 연결 대상으로 표시되지 않는지
- Android 설정에 미리내 알림 접근 서비스가 나타나지 않는지
- 입금·출금 후 앱과 위젯 갱신
- 직접 입력 시작·잔액 수정·기록 공유·설정 삭제
- 재부팅·절전모드·네트워크 끊김
- 5만원·3만원·1만원 경계 색상/떨림
- 24시간 지난 잔액 숨김
- 납부 완료 고정비 이중차감 방지
