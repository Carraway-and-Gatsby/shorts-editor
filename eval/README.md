# 하이라이트 평가셋 (Scoring Evaluation Harness)

하이라이트 선택(F-12)의 가중치(`config/scoring.yaml`)를 튜닝하기 위한 평가 루프입니다.
docs/09-roadmap.md M2의 "평가셋 구축" 항목에 해당합니다.

## 실행

```bash
pnpm build          # @shorts/media 빌드 필요
pnpm eval
```

케이스별로 다음 지표를 출력합니다.

| 지표 | 의미 |
|------|------|
| coverage | `mustInclude` 구간이 선택된 컷으로 덮인 비율 (높을수록 좋음) |
| leakage | 선택된 컷 중 `mustExclude` 구간과 겹치는 비율 (낮을수록 좋음) |
| durationOk | 출력 길이가 목표 ±10% 이내인지 |

## 케이스 추가 방법

1. 실제 영상을 파이프라인에 넣고 `analysis.json`을 얻는다
   (또는 `python -m analyze_worker.local <jobId>`로 직접 생성).
2. `eval/cases/<이름>.json` 파일 작성:

```json
{
  "name": "설명적인 이름",
  "targetDuration": "auto",
  "analysis": { /* AnalysisDoc 전문 */ },
  "expected": {
    "mustInclude": [[5, 13], [17, 24]],
    "mustExclude": [[13, 17]]
  }
}
```

3. `pnpm eval`로 회귀 확인. 가중치를 바꿀 때는 이 지표가 개선되는 방향으로만 조정한다.

현재 케이스는 합성 시나리오 3종입니다. 실제 라벨링 영상 20개 확보는 진행 중인 작업입니다
(원본 영상은 저장소에 커밋하지 않고 analysis.json만 커밋합니다).
