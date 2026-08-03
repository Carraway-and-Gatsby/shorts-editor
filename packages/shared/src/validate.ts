import Ajv from 'ajv';
import type { Composition } from './composition.js';
import schema from './schemas/composition.schema.json';

/** 컷 총 길이 상한(초). 플랫폼 공통 상한. docs/03-functional-spec.md F-21 참조. */
export const MAX_OUTPUT_DURATION_SECONDS = 90;

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile<Composition>(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 컴포지션 문서를 검증한다.
 * 1) JSON Schema 구조 검증
 * 2) 스키마로 표현할 수 없는 의미 규칙 검증 (컷 순서/중복, 길이 상한, 시간 범위)
 */
export function validateComposition(data: unknown): ValidationResult {
  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    );
    return { valid: false, errors };
  }

  const composition = data;
  const errors: string[] = [];

  let prevEnd = -Infinity;
  let totalDuration = 0;
  for (const cut of composition.cuts) {
    if (cut.sourceEnd <= cut.sourceStart) {
      errors.push(`cut ${cut.id}: sourceEnd(${cut.sourceEnd}) must be greater than sourceStart(${cut.sourceStart})`);
      continue;
    }
    if (cut.sourceStart < prevEnd) {
      errors.push(`cut ${cut.id}: cuts must be in ascending source order without overlap`);
    }
    prevEnd = cut.sourceEnd;
    totalDuration += cut.sourceEnd - cut.sourceStart;
  }

  if (totalDuration > MAX_OUTPUT_DURATION_SECONDS) {
    errors.push(
      `total cut duration ${totalDuration.toFixed(2)}s exceeds maximum ${MAX_OUTPUT_DURATION_SECONDS}s`,
    );
  }

  for (const block of composition.subtitles.blocks) {
    if (block.end <= block.start) {
      errors.push(`subtitle ${block.id}: end must be greater than start`);
    }
  }

  return { valid: errors.length === 0, errors };
}
