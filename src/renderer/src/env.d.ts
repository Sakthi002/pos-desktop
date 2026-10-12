/// <reference types="vite/client" />
import type { PosApi } from '../../preload';

declare global {
  interface Window {
    api: PosApi;
  }
}

export {};
