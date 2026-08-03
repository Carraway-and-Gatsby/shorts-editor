# 5. 시스템 아키텍처 (System Architecture)

## 5.1 설계 원칙

1. **파이프라인 분리**: 업로드/API 처리(빠른 응답)와 영상 처리(무겁고 긴 작업)를 큐로 분리한다.
2. **컴포지션 중심**: 편집 결정은 전부 `composition.json`이라는 데이터로 표현하고, 렌더러는 이를 해석만 한다. → 보정/재렌더링/프리셋 교체가 렌더러 수정 없이 가능.
3. **로컬 우선 MVP**: MVP는 단일 머신(도커 컴포즈)에서 동작하게 만들고, 스토리지·큐 인터페이스를 추상화해 클라우드 확장 시 구현체만 교체한다.

## 5.2 구성 요소

```
┌──────────────┐        ┌───────────────────────────────────────────┐
│   Web App    │  HTTP  │                API Server                 │
│ (React SPA)  │◀──────▶│  업로드 세션, 잡 CRUD, 상태 조회(SSE),      │
│              │        │  컴포지션 편집, 다운로드 URL 발급            │
└──────────────┘        └──────┬────────────────────────┬───────────┘
                               │ enqueue                │ read/write
                               ▼                        ▼
                        ┌────────────┐          ┌──────────────┐
                        │ Job Queue  │          │   Database   │
                        │ (Redis)    │          │ (PostgreSQL) │
                        └─────┬──────┘          └──────────────┘
                              │ consume
              ┌───────────────┼───────────────────┐
              ▼               ▼                   ▼
      ┌──────────────┐ ┌──────────────┐   ┌──────────────┐
      │ Ingest Worker│ │Analyze Worker│   │ Render Worker│
      │ (ffmpeg)     │ │(CV + STT)    │   │ (ffmpeg)     │
      └──────┬───────┘ └──────┬───────┘   └──────┬───────┘
             │                │                  │
             └────────────────┼──────────────────┘
                              ▼
                     ┌─────────────────┐
                     │  Object Storage │
                     │ (로컬 FS / S3)  │
                     └─────────────────┘
```

| 구성 요소 | 역할 | 기술 선택 (MVP) |
|-----------|------|-----------------|
| Web App | 업로드 UI, 진행 표시, 미리보기, 보정 에디터 | React + TypeScript + Vite |
| API Server | REST API, 업로드 세션, SSE 상태 스트림 | Node.js (NestJS 또는 Fastify) + TypeScript |
| Job Queue | 단계별 작업 큐, 재시도, 우선순위 | Redis + BullMQ |
| Ingest/Render Worker | ffmpeg 기반 미디어 처리 | Node.js 워커에서 ffmpeg 호출 |
| Analyze Worker | 장면 분석 + STT | **Python** (OpenCV, PySceneDetect, faster-whisper) |
| Database | 잡/컴포지션/이력 메타데이터 | PostgreSQL |
| Object Storage | 원본·산출물 저장 | MVP: 로컬 볼륨, 확장: S3 호환 |

> Analyze만 Python인 이유: CV/STT 생태계가 Python에 집중되어 있다. 워커 간 통신은 큐와
> 스토리지를 통해서만 이루어지므로 언어 혼용 비용이 낮다.

## 5.3 컴포넌트 간 계약

- **API ↔ Worker**: 큐 메시지는 `{ jobId, stage, revision }` 최소 정보만 전달. 상세 데이터는 DB/스토리지에서 조회 (메시지 비대화 방지).
- **Worker ↔ Storage**: 단계별 산출물 경로 규약 `jobs/{jobId}/{artifact}` ([4.6](04-pipeline-spec.md#46-중간-산출물artifact-목록) 참조).
- **상태 전이는 API 서버가 아닌 워커가 소유**: 각 워커는 자기 단계의 시작/완료/실패 시 DB 상태를 갱신하고 다음 단계를 enqueue한다.

## 5.4 배포 형태

### MVP: Docker Compose 단일 호스트
```
services: web, api, redis, postgres, worker-ingest, worker-analyze, worker-render
volumes: storage(공유 볼륨), models(Whisper 모델 캐시)
```
- GPU 없이 동작 가능해야 한다 (faster-whisper CPU int8, 얼굴 감지는 경량 모델).
- GPU가 있으면 STT·인코딩(NVENC)에 자동 활용 (환경 변수로 감지).

### 확장 단계 (v2+)
- 워커를 오토스케일 그룹으로 분리 (렌더 워커가 병목).
- 스토리지를 S3, 다운로드를 CloudFront 서명 URL로 전환.
- 분석 모델 서빙 분리 (STT 전용 서비스).

## 5.5 주요 기술 결정 기록 (ADR 요약)

| ID | 결정 | 근거 | 대안과 기각 사유 |
|----|------|------|------------------|
| ADR-1 | 렌더링은 서버 사이드 ffmpeg | 결과 일관성, 모바일 성능 비의존 | 클라이언트 WebCodecs 렌더링 — 브라우저별 편차와 대용량 처리 한계로 기각 |
| ADR-2 | 편집 상태를 composition.json 단일 문서로 관리 | 리비전/실행취소/재렌더 단순화 | DB 정규화 테이블 분산 — 조인 복잡도 대비 이득 없음 |
| ADR-3 | STT는 자체 호스팅 Whisper 계열 | 비용 예측 가능, 오프라인 동작 | 클라우드 STT API — 품질은 높으나 종량 비용과 외부 의존 기각 (v2에서 옵션 재검토) |
| ADR-4 | 큐는 Redis+BullMQ | 운영 단순, 단계별 큐/재시도 내장 | Kafka — MVP 규모에 과도 |
| ADR-5 | 자막은 번인 방식 | 플랫폼 업로드 시 스타일 보존 | 소프트 자막(sidecar) — 숏폼 플랫폼이 미지원 |

## 5.6 디렉터리 구조 (구현 시 기준)

```
shorts-editor/
├── apps/
│   ├── web/            # React SPA
│   └── api/            # API 서버
├── workers/
│   ├── ingest/         # Node + ffmpeg
│   ├── analyze/        # Python (CV/STT)
│   └── render/         # Node + ffmpeg
├── packages/
│   ├── shared/         # 타입, composition 스키마, 상태 상수
│   ├── storage/        # 오브젝트 스토리지 추상화 (로컬 FS / S3)
│   ├── queue/          # 큐 클라이언트 래퍼, 워커 공통 런타임
│   ├── db/             # 마이그레이션, 리포지토리 (PG 구현 + 테스트용 인메모리)
│   └── media/          # ffprobe/ffmpeg 명령·실행, Ingest/Render 파이프라인 로직
├── config/
│   ├── scoring.yaml    # 하이라이트 가중치
│   └── presets/        # 스타일 프리셋 정의
├── assets/
│   └── bgm/            # 라이선스 확보 BGM 라이브러리 + 메타데이터
├── docs/               # 본 명세 문서
└── docker-compose.yaml
```
