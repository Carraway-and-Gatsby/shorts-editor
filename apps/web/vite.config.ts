import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** dev/preview 공통: /api 요청을 API 서버로 프록시 (Docker 환경에서는 nginx가 담당) */
const apiProxy = {
  '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3000',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  // `vite preview`(프로덕션 번들 확인)에서도 API 프록시가 동작해야
  // Docker 없이 실행하기(README) 경로가 성립한다
  preview: {
    port: 5173,
    proxy: apiProxy,
  },
});
