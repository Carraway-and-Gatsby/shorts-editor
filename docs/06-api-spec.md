# 6. API 명세 (API Specification)

REST API. 모든 응답은 JSON, 시간은 ISO 8601 UTC, ID는 접두사 있는 불투명 문자열(`job_…`, `up_…`).
베이스 경로: `/api/v1`

## 6.1 공통 규약

### 오류 응답 형식
```json
{
  "error": {
    "code": "INVALID_MEDIA",
    "message": "비디오 스트림이 없는 파일입니다.",
    "details": {}
  }
}
```

### 공통 오류 코드
| HTTP | code | 의미 |
|------|------|------|
| 400 | `VALIDATION_ERROR` | 요청 파라미터 오류 |
| 404 | `NOT_FOUND` | 리소스 없음 |
| 409 | `INVALID_STATE` | 현재 잡 상태에서 허용되지 않는 작업 |
| 413 | `FILE_TOO_LARGE` | 업로드 용량 초과 |
| 422 | `INVALID_MEDIA` / `TOO_SHORT` / `TOO_LONG` | 미디어 검증 실패 |
| 429 | `RATE_LIMITED` | 요청/동시 잡 수 제한 초과 |

### 인증
MVP: 익명 세션 쿠키(`sid`). 모든 리소스는 생성한 세션에만 보인다. v2에서 Bearer 토큰 추가.

---

## 6.2 업로드

### `POST /uploads` — 업로드 세션 생성
```json
// Request
{ "filename": "myclip.mp4", "size": 52428800, "mimeType": "video/mp4" }
// Response 201
{ "uploadId": "up_x1y2", "chunkSize": 8388608, "expiresAt": "…" }
```
사전 검증: 확장자/MIME/용량. 실패 시 413 또는 422.

### `PUT /uploads/{uploadId}/chunks/{index}` — 청크 업로드
- Body: 바이너리 청크. 멱등(같은 index 재전송 허용).
- Response 204.

### `POST /uploads/{uploadId}/complete` — 업로드 완료 → 잡 생성
```json
// Request (options는 F-03, 전부 선택)
{
  "options": {
    "targetDuration": 60,
    "preset": "clean",
    "subtitle": "on",
    "bgm": "auto",
    "reframe": "auto",
    "language": "auto"
  }
}
// Response 201
{ "jobId": "job_abc123", "status": "QUEUED" }
```

### `DELETE /uploads/{uploadId}` — 업로드 취소

---

## 6.3 잡

### `GET /jobs/{jobId}` — 잡 상세
```json
// Response 200
{
  "jobId": "job_abc123",
  "status": "RENDERING",
  "progress": 72,
  "stage": "render",
  "createdAt": "…",
  "source": { "duration": 94.2, "width": 1920, "height": 1080, "hasAudio": true },
  "options": { "targetDuration": 60, "preset": "clean" },
  "currentRevision": 1,
  "result": null,
  "error": null
}
```
`status=DONE`이면:
```json
"result": {
  "revision": 1,
  "duration": 58.7,
  "thumbnailUrl": "…",
  "downloadUrl": null
}
```

### `GET /jobs/{jobId}/events` — 상태 스트림 (SSE)
```
event: progress
data: {"status":"ANALYZING","progress":31,"stage":"analyze"}

event: done
data: {"status":"DONE","revision":1}

event: failed
data: {"status":"FAILED","error":{"code":"RENDER_FAILED","message":"…"}}
```

### `GET /jobs` — 잡 목록 (F-41)
쿼리: `?limit=20&cursor=…` / 응답: 잡 요약 배열 + `nextCursor`.

### `POST /jobs/{jobId}/cancel` — 잡 취소
- `DONE`/`FAILED` 상태에서는 409 `INVALID_STATE`.

### `DELETE /jobs/{jobId}` — 잡과 산출물 삭제

---

## 6.4 컴포지션 (보정)

### `GET /jobs/{jobId}/composition` — 현재 컴포지션 조회
응답: [4.3.3 composition.json 스키마](04-pipeline-spec.md#433-compositionjson-스키마-요약) + `analysisSummary`(타임라인 UI용 세그먼트/자막 원본 정보).

### `PATCH /jobs/{jobId}/composition` — 컴포지션 수정 (F-21/F-22/F-23)
```json
// Request — 수정할 부분만 전달 (JSON Merge Patch 의미론)
{
  "cuts": [
    { "id": "c1", "sourceStart": 10.0, "sourceEnd": 30.0 },
    { "id": "c2", "sourceStart": 45.0, "sourceEnd": 70.0 }
  ],
  "subtitles": {
    "blocks": [ { "id": "s3", "text": "수정된 자막" } ]
  },
  "style": { "preset": "bold" }
}
// Response 200 — 검증 통과한 전체 컴포지션 (리비전은 아직 미증가)
```
서버 검증: 컷 총 길이 ≤ 90초, 컷 시간 오름차순, 자막 시간 범위 유효성. 실패 시 400.

### `POST /jobs/{jobId}/render` — 재렌더링 (F-24)
```json
// Response 202
{ "jobId": "job_abc123", "status": "RENDERING", "revision": 2 }
```
- 현재 컴포지션으로 새 리비전 렌더링. 진행 중 렌더가 있으면 409.

---

## 6.5 결과물

### `POST /jobs/{jobId}/download-url` — 다운로드 URL 발급
```json
// Request
{ "revision": 2 }        // 생략 시 최신
// Response 200
{ "url": "https://…signed…", "expiresAt": "…(+24h)" }
```

### `GET /jobs/{jobId}/revisions` — 리비전 이력
응답: 리비전 번호, 생성일, 길이, 썸네일 (최근 5개).

---

## 6.6 프리셋/BGM 카탈로그

### `GET /presets`
```json
[ { "id": "clean", "name": "클린", "description": "…", "previewUrl": "…" } ]
```

### `GET /bgm-tracks`
쿼리: `?mood=calm` / 응답: 트랙 ID, 이름, 무드 태그, 길이, 미리듣기 URL.

---

## 6.7 상태 코드 요약

| 엔드포인트 | 성공 | 주요 실패 |
|------------|------|-----------|
| POST /uploads | 201 | 413, 422 |
| PUT …/chunks/{i} | 204 | 404, 409(완료된 세션) |
| POST …/complete | 201 | 409(청크 누락), 422 |
| GET /jobs/{id} | 200 | 404 |
| PATCH …/composition | 200 | 400, 409(처리 중) |
| POST …/render | 202 | 409 |
| POST …/download-url | 200 | 404, 409(미완료) |
