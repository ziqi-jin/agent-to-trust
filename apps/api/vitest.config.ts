import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 所有测试文件共享同一个测试库且用例内 TRUNCATE 全表
    // （arena/ingest/reverify 均有 TRUNCATE ... CASCADE）→ 文件必须串行，否则并行互踩数据
    fileParallelism: false,
  },
});
