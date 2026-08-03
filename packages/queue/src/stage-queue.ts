import type { JobStage } from '@shorts/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAMES, type StageJobPayload } from './names.js';

/** 단계 큐 추상화. 테스트/로컬에서는 인메모리 구현으로 대체할 수 있다. */
export interface StageQueue {
  enqueue(stage: JobStage, payload: StageJobPayload): Promise<void>;
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

  async enqueue(stage: JobStage, payload: StageJobPayload): Promise<void> {
    await this.queueFor(stage).add(stage, payload, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection.quit().catch(() => {});
  }
}
