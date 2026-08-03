import { createHmac, timingSafeEqual } from 'node:crypto';

export interface FileTokenPayload {
  /** 스토리지 키 */
  key: string;
  /** 만료 (epoch seconds) */
  exp: number;
  disposition: 'inline' | 'attachment';
  filename?: string;
}

/**
 * 산출물 접근용 서명 토큰 (다운로드/썸네일/미리보기).
 * 서명된 URL 자체가 인가 수단이다. docs/06-api-spec.md §6.5 참조.
 */
export class FileTokenSigner {
  constructor(private readonly secret: string) {}

  private hmac(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  sign(payload: FileTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  verify(token: string, now: number = Date.now()): FileTokenPayload | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) {
      return null;
    }
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.hmac(body);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    let payload: FileTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as FileTokenPayload;
    } catch {
      return null;
    }
    if (typeof payload.key !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp * 1000 < now) {
      return null;
    }
    return payload;
  }
}
