# 얼리 액세스 배포 (무료)

Render 무료 웹 서비스 한 대로 돌립니다. 서버가 메모리만 쓰고 WebSocket 하나로 통신하므로 다른 서비스(DB·캐시)는 필요 없습니다.

## 1. GitHub에 올리기 (처음 한 번)
```
git remote add origin https://github.com/<계정>/whodunit.git
git push -u origin main
```

## 2. Render에 올리기 (처음 한 번)
1. https://render.com 가입 → GitHub 연결
2. **New → Blueprint** → `whodunit` 저장소 선택 → `render.yaml`을 읽어 그대로 만들어 줌 (지역 싱가포르, 무료 플랜, Node 24, `TRUST_PROXY=1`)
3. 몇 분 뒤 `https://whodunit-xxxx.onrender.com` 주소가 생김. 그 뒤로는 `git push`만 하면 자동으로 다시 배포됨

## 3. 잠들지 않게 하기 (선택)
무료 서비스는 15분 동안 접속이 없으면 잠들고, 첫 접속자가 최대 1분을 기다립니다(첫 화면에 "서버를 깨우는 중" 안내가 뜸).
사람들이 들어올 시간대에 깨어 있게 하려면 무료 핑 서비스를 하나 겁니다.
- https://uptimerobot.com 가입 → New Monitor → HTTP(s) → 위 주소 → 간격 5분
- 무료 플랜 한도(월 750시간)는 서비스 한 대를 한 달 내내 켜 둘 수 있는 양입니다.

## 무료 플랜에서 알아 둘 것
- 인스턴스 1대(메모리 512MB). 동시 접속 수백 명까지는 문제없고, 방 한도는 `MAX_ROOMS`(기본 60)로 조절합니다.
- 다시 배포하거나 서버가 재시작되면 **진행 중인 판은 사라집니다**(상태를 메모리에만 둠). 사람들이 하고 있을 때는 푸시를 피하세요.
- 접속 기록(IP 포함)은 Render가 자체적으로 일정 기간 보관합니다. 첫 화면 안내 문구에 적어 두었습니다.
- 환경 변수(Render 대시보드 → Environment): `MAX_ROOMS`, `MAX_CONN_PER_IP`(기본 12), `ROOM_IDLE_MS`(기본 2시간), `BOT_MS`(봇 속도), `INTRO_MS`.

## 배포 전 점검
```
npm run check     # 타입 검사 + 규칙 테스트
```
서버는 `npm start` 한 번으로 글꼴 복사(`fonts`) → 화면 번들(`build`) → 실행까지 합니다. 개발용 패키지 없이(`npm ci --omit=dev`) 설치해도 뜨는 것을 확인했습니다.
