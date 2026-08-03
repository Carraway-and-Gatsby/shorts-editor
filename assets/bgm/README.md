# BGM 라이브러리

F-15(BGM 삽입)용 내장 트랙입니다. NFR-36에 따라 **재배포 가능한 라이선스의 트랙만** 등록합니다.

## 라이선스

현재 트랙 3종은 모두 이 저장소에서 ffmpeg `aevalsrc`로 **직접 합성한 자체 제작 사운드**이며
CC0(퍼블릭 도메인)로 제공됩니다. 외부 음원을 포함하지 않습니다.

품질이 필요한 실제 서비스 단계에서는 CC0/자체 보유 음원으로 교체하되,
`catalog.json`의 `licenseNote`에 각 트랙의 출처·라이선스를 반드시 기재해야 합니다.

## 트랙 추가 방법

1. 재배포 가능한 음원 파일(m4a/aac 권장)을 이 디렉터리에 추가
2. `catalog.json`의 `tracks`에 항목 추가 — `id`는 파일명(확장자 제외)과 일치시킬 것
3. `moods` 태그는 자동 선택(F-15) 규칙이 사용한다: `calm` / `upbeat` / `energetic` / `promo` 등

## 재생성

트랙을 다시 합성하려면 저장소 루트에서:

```bash
# 예: calm 트랙
ffmpeg -y -f lavfi -i "aevalsrc='(0.16*sin(2*PI*220*t)+0.12*sin(2*PI*261.63*t)+0.10*sin(2*PI*329.63*t))*(0.7+0.3*sin(2*PI*0.2*t))':s=44100:d=24" \
  -af "lowpass=f=900,afade=t=in:d=0.5,afade=t=out:st=23:d=1" -c:a aac -b:a 96k assets/bgm/bgm_calm_01.m4a
```
