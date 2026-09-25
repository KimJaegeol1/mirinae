// 미리내 Scriptable 로컬 빌드 (build-release.ps1 의 OS 무관 대체)
//
//   node build-local.mjs                         → Mirinae.js (서버 주소 없음, 채널 test) — 수동입력 MVP용
//   node build-local.mjs --api https://서버 --channel test
//   node build-local.mjs --api https://서버 --channel production --check   (--check: /health 준비상태 확인)
//   node build-local.mjs --out ../dist/Mirinae.js
//
// 원본(SseuldonPilot.source.js)의 자리표시자 두 개만 치환합니다.
//   __SSEULDON_API_BASE_URL__  → --api 값 (없으면 빈 문자열 = 앱에서 "서버 주소 설정"으로 입력)
//   __SSEULDON_BUILD_CHANNEL__ → --channel 값 (test | production)
// 수동입력 모드는 서버 주소를 전혀 쓰지 않으므로 인자 없이 만든 파일로 바로 시작할 수 있습니다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const apiBaseUrl = String(opt("--api", "")).trim().replace(/\/+$/, "");
const channel = opt("--channel", "test");
const outPath = path.resolve(here, opt("--out", "Mirinae.js"));
const check = args.includes("--check");

if (!["test", "production"].includes(channel)) {
  console.error("--channel 은 test 또는 production 만 가능합니다.");
  process.exit(1);
}
if (apiBaseUrl && !/^https:\/\/[^/\s]+(?:\/.*)?$/i.test(apiBaseUrl)) {
  console.error("--api 는 https:// 로 시작해야 합니다 (스크립트가 http 를 거부합니다).");
  process.exit(1);
}
if (check && apiBaseUrl) {
  const health = await fetch(`${apiBaseUrl}/health`).then((r) => r.json());
  const ready = channel === "test" ? health.testReady : health.pilotReady;
  if (health.status !== "ok" || !health.persistentStore || !ready) {
    console.error(`/health 가 ${channel} 연결을 받을 준비가 아닙니다:`, JSON.stringify(health));
    process.exit(1);
  }
}

const sourcePath = path.join(here, "SseuldonPilot.source.js");
let source = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
for (const marker of ["__SSEULDON_API_BASE_URL__", "__SSEULDON_BUILD_CHANNEL__"]) {
  if (!source.includes(marker)) {
    console.error(`원본에서 자리표시자 ${marker} 를 찾지 못했습니다.`);
    process.exit(1);
  }
}
source = source
  .replace("__SSEULDON_API_BASE_URL__", apiBaseUrl)
  .replace("__SSEULDON_BUILD_CHANNEL__", channel);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, source, "utf8");
console.log(`${path.relative(process.cwd(), outPath)}  (api=${apiBaseUrl || "(없음)"}, channel=${channel})`);
