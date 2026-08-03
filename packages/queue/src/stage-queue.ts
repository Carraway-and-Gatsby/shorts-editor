import type { JobStage } from '@shorts/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAMES, type StageJobPayload } from './names.js';

export interface EnqueueOptions {
  /** 총 시도 횟수 (기본 1 = 재시도 없음) */
  attempts?: number;
}

/** 단계 큐 추상화. 테스트/로컬에서는 인메모리 구현으로 대체할 수 있다. */
export interface StageQueue {
  enqueue(stage: JobStage, payload: StageJobPayload, options?: EnqueueOptions): Promise<void>;
  close(): Promise<void>;
}

/** BullMQ(Redis) 기반 구현. */
export class BullStageQueue implements StageQueue {
  private readonly connection: IORedis;
  private readonly queues = new Map<JobStage, Queue>();

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.connection.on('error', (err) => {
      console.error('[queue] redis error:', err.message);
    });
  }

  private queueFor(stage: JobStage): Queue {
    let queue = this.queues.get(stage);
    if (!queue) {
      queue = new Queue(QUEUE_NAMES[stage], { connection: this.connection });
      this.queues.set(stage, queue);
    }
    return queue;
  }

  async enqueue(
    stage: JobStage,
    payload: StageJobPayload,
    options?: EnqueueOptions,
  ): Promise<void> {
    await this.queueFor(stage).add(stage, payload, {
      attempts: options?.attempts ?? 1,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection.quit().catch(() => {});
  }
}
