-- M3: 보정(드래프트 컴포지션), STT 교정 수집, 보관 정책 배치용 컬럼

-- 사용자가 보정 중인 컴포지션 초안. 재렌더링 시 새 리비전으로 확정되고 비워진다.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft_composition jsonb;

-- 보관 기한 경과 후 파일 정리가 끝난 시각 (정리 배치 멱등성)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cleaned_at timestamptz;

-- 자막 교정 수집 (F-22, 모델 품질 평가용. docs/07-data-model.md 참조)
CREATE TABLE IF NOT EXISTS stt_corrections (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  original_text text NOT NULL,
  corrected_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
