# 4. 처리 파이프라인 명세 (Processing Pipeline Specification)

잡(Job) 하나가 거치는 처리 단계를 정의한다. 파이프라인은 4단계로 구성되며,
각 단계는 독립 워커로 실행 가능하고 중간 산출물(Artifact)을 스토리지에 남긴다.

```
┌────────┐    ┌─────────┐    ┌─────────┐    ┌────────┐
│ Ingest │───▶│ Analyze │───▶│ Compose │───▶│ Render │
└────────┘    └─────────┘    └─────────┘    └────────┘
 원본 검증     장면/음성 분석   편집 결정      영상 인코딩
 프록시 생성   (병렬 실행)     (컴포지션 산출)  최종 MP4
```

## 4.1 Stage 1 — Ingest

| 항목 | 내용 |
|------|------|
| 입력 | 업로드된 원본 파일 |
| 출력 | `source.json`(메타데이터), `proxy.mp4`(720p/30fps 분석용), `thumbnail.jpg` |
| 대응 기능 | F-02 |

처리 순서:
1. `ffprobe`로 스트림 정보 추출 → 검증 규칙 적용 (포맷/길이/해상도).
2. 회전 태그 정규화 (`-metadata:s:v rotate` 해석 후 물리 회전 적용).
3. 프록시 트랜스코드: `H.264 720p 30fps CRF 23 preset veryfast + faststart`.
4. 오디오 추출: `16kHz mono WAV` (STT용). 오디오 없으면 생략하고 플래그 기록.
5. 대표 썸네일 1장 추출 (중간 지점 프레임).

실패 정책: 어떤 하위 단계라도 실패하면 잡 전체를 `FAILED` 처리. 재시도 없음(입력 문제이므로).

## 4.2 Stage 2 — Analyze

| 항목 | 내용 |
|------|------|
| 입력 | `proxy.mp4`, `audio.wav` |
| 출력 | `analysis.json` (샷, 피사체 트랙, 신호 점수, 전사 결과, 무음 구간) |
| 대응 기능 | F-10, F-11 |

두 분석은 **병렬 실행**한다:

### 4.2.1 Visual Analysis (F-10)
- 샷 경계 감지: PySceneDetect `ContentDetector` (threshold 기본 27) 또는 동급 알고리즘.
- 얼굴 감지: 경량 모델(예: YuNet/MediaPipe Face Detection)로 2~5fps 샘플링, IoU 기반 트래킹으로 샷 내 트랙 구성.
- 신호 계산: 샷별 모션(옵티컬 플로 크기 평균), 흔들림(글로벌 모션 분산), 노출 점수.

### 4.2.2 Audio Analysis (F-11)
- STT: Whisper 계열(초기: `faster-whisper` small/base), `word_timestamps=true`.
- VAD로 무음 구간 산출(무음 기준: 에너지 임계 + 0.8초 이상 지속).
- 음량 에너지 곡선(RMS, 0.5초 창) 산출 → 하이라이트 점수 입력.

실패 정책:
- Visual 실패 → 잡 실패 (필수 신호).
- STT 실패 → 경고 후 진행 (자막 없이 생성, `analysis.warnings`에 기록). 단 오류가 일시적(모델 서버 등)이면 2회 재시도.

## 4.3 Stage 3 — Compose

| 항목 | 내용 |
|------|------|
| 입력 | `analysis.json`, 생성 옵션(F-03) |
| 출력 | `composition.json` — 렌더링에 필요한 모든 편집 결정 |
| 대응 기능 | F-12, F-13, F-14, F-15, F-16 |

### 4.3.1 하이라이트 점수화 기본 가중치 (F-12)

```
score(seg) =  0.30 · speechDensity     # 발화 시간 비율
            + 0.20 · audioEnergy       # 정규화 RMS
            + 0.20 · motion            # 모션 크기 (0~1 클램프)
            + 0.15 · facePresence      # 얼굴 등장 비율
            + 0.15 · quality           # 노출/선명도
            - 0.30 · shakePenalty
            - 0.20 · darkPenalty
```
가중치는 `config/scoring.yaml`로 외부화한다. 튜닝은 라벨링된 샘플셋에 대한 오프라인 평가로 진행.

### 4.3.2 컴포지션 산출 순서
1. 컷 목록 확정 (F-12 규칙 적용).
2. 컷별 리프레이밍 경로 계산 (F-13) — 크롭 키프레임 목록으로 기록.
3. 자막 블록 생성 및 출력 시간축 리매핑 (F-14).
4. BGM 트랙 선택과 오디오 믹싱 파라미터 결정 (F-15).
5. 프리셋의 스타일 요소 바인딩 (F-16).

### 4.3.3 composition.json 스키마 (요약)

```json
{
  "version": 1,
  "jobId": "job_abc123",
  "revision": 1,
  "output": { "width": 1080, "height": 1920, "fps": 30, "duration": 58.7 },
  "cuts": [
    { "id": "c1", "sourceStart": 12.40, "sourceEnd": 31.10, "transition": "cut" }
  ],
  "reframe": {
    "mode": "track",
    "keyframes": [ { "t": 0.0, "cx": 0.42, "cy": 0.37, "zoom": 1.0 } ]
  },
  "subtitles": {
    "style": "bold",
    "blocks": [
      { "id": "s1", "start": 0.4, "end": 1.9, "text": "안녕하세요!", "words": [] }
    ]
  },
  "audio": {
    "bgm": { "trackId": "bgm_calm_01", "gainDb": -18, "duckDb": -24 },
    "loudnessTarget": -14
  },
  "style": { "preset": "clean", "titleCard": null, "lut": null }
}
```

컴포지션은 **렌더링과 분리된 순수 데이터**다. 사용자 보정(F-21~F-23)은 이 파일만 수정하며,
Analyze 산출물은 불변으로 재사용된다.

## 4.4 Stage 4 — Render

| 항목 | 내용 |
|------|------|
| 입력 | 원본 파일, `composition.json` |
| 출력 | `output_r{revision}.mp4`, `output_thumb.jpg` |
| 대응 기능 | F-24, F-30 |

처리 순서:
1. **컷 추출**: 원본(프록시가 아닌 원본)에서 컷 구간을 프레임 정확도로 추출.
2. **리프레이밍 적용**: 크롭 키프레임을 ffmpeg `crop`/`zoompan` 필터 체인 또는 프레임 단위 처리로 적용, 1080×1920 스케일.
3. **자막 번인**: ASS 자막으로 변환 후 `subtitles` 필터로 번인 (스타일·애니메이션 표현).
4. **오디오 믹싱**: 원본 오디오 + BGM 덕킹 믹스, `loudnorm`으로 -14 LUFS 노멀라이즈.
5. **인코딩**: H.264 High, VBR 8~10Mbps, AAC 128kbps, `+faststart`.
6. 썸네일 추출, 산출물 업로드, 잡 `DONE` 전환.

실패 정책: 렌더 실패는 1회 자동 재시도. 재실패 시 `FAILED` + 내부 오류 코드 기록.

## 4.5 진행률 보고

각 단계는 진행률을 보고하며 전체 진행률은 고정 가중치로 합산한다:

| 단계 | 가중치 |
|------|--------|
| Ingest | 10% |
| Analyze | 35% |
| Compose | 5% |
| Render | 50% |

## 4.6 중간 산출물(Artifact) 목록

| 파일 | 생성 단계 | 보관 |
|------|-----------|------|
| `source.{ext}` (원본) | Upload | 잡 보관 기한까지 |
| `source.json` | Ingest | 영구(메타데이터 DB와 동기) |
| `proxy.mp4` / `audio.wav` | Ingest | 잡 완료 후 72시간 (재분석 대비) |
| `analysis.json` | Analyze | 잡 보관 기한까지 |
| `composition.json` (리비전별) | Compose | 잡 보관 기한까지 |
| `output_r{n}.mp4` | Render | 최근 5개 리비전, 보관 기한까지 |

## 4.7 재렌더링 경로 (F-24)

```
사용자 보정 → composition.json 리비전 +1 → Render 단계만 재실행
```
- Analyze 재실행 조건: 없음 (원본이 바뀌지 않는 한 분석은 1회).
- 프록시가 이미 만료 삭제된 경우에도 렌더는 원본 기반이므로 영향 없음.
