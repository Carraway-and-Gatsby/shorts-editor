# Shorts Editor

짧은 원본 영상을 업로드하면 이를 자동으로 가공하여 **숏폼(Short-form) 플랫폼에 적합한 세로형 영상**으로 만들어주는 생성기(Generator) 겸 편집기(Editor)입니다.

- 입력: 사용자가 첨부한 짧은 영상(가로/세로 무관, 수 초 ~ 수 분)
- 출력: YouTube Shorts / Instagram Reels / TikTok 규격(9:16, 최대 60초 내외)에 맞춘 완성형 숏폼 영상

## 프로젝트 상태

명세 확정 후 **M0(프로젝트 골격)까지 구현**된 상태입니다. 다음 마일스톤은 M1(파이프라인 뼈대)입니다.
전체 계획은 [로드맵](docs/09-roadmap.md)을 참조하세요.

## 시작하기

### 전체 스택 실행 (Docker Compose)

```bash
docker compose up --build
```

| 서비스 | 주소 |
|--------|------|
| 웹 UI | http://localhost:8080 |
| API | http://localhost:3000 (헬스체크: `/healthz`) |

### 로컬 개발

```bash
pnpm install        # Node >= 20, pnpm 10
pnpm build          # 전체 패키지 빌드
pnpm lint           # ESLint
pnpm typecheck      # 타입 검사
pnpm test           # 단위 테스트

# Python 분석 워커
pip install './workers/analyze[dev]'
ruff check workers/analyze
pytest workers/analyze/tests
```

## 문서 목차

| # | 문서 | 내용 |
|---|------|------|
| 1 | [제품 개요](docs/01-overview.md) | 목표, 타겟 사용자, 용어 정의, 범위 |
| 2 | [기능 정의](docs/02-feature-definition.md) | 기능 목록, 우선순위(MoSCoW), 단계별 릴리스 범위 |
| 3 | [기능 명세](docs/03-functional-spec.md) | 기능별 입력/출력/처리 규칙, 유스케이스, 예외 처리 |
| 4 | [처리 파이프라인 명세](docs/04-pipeline-spec.md) | Ingest → Analyze → Compose → Render 각 단계 상세 |
| 5 | [시스템 아키텍처](docs/05-architecture.md) | 구성 요소, 기술 스택, 배포 형태 |
| 6 | [API 명세](docs/06-api-spec.md) | REST API 엔드포인트, 요청/응답 스키마 |
| 7 | [데이터 모델](docs/07-data-model.md) | 엔티티 정의, 상태 머신, 저장 구조 |
| 8 | [비기능 요구사항](docs/08-non-functional.md) | 성능, 용량 제한, 보안, 관측성 |
| 9 | [로드맵](docs/09-roadmap.md) | 마일스톤과 구현 순서 |

## 핵심 컨셉

```
사용자 영상 업로드
      │
      ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Ingest    │──▶│   Analyze   │──▶│   Compose   │──▶│   Render    │
│ 검증/정규화 │   │ 장면·음성   │   │ 컷 선택,    │   │ 인코딩,     │
│             │   │ 분석        │   │ 리프레이밍, │   │ 규격 출력   │
│             │   │             │   │ 자막·BGM    │   │             │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      │
      ▼
완성된 숏폼 영상 다운로드 / 미리보기 / 수동 보정
```

## 라이선스

[MIT](LICENSE)
