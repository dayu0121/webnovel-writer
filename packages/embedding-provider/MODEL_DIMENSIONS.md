# 常用向量模型维度表

由 `src/model-dimensions.ts` 生成；更新后运行 `pnpm --filter @webnovel/embedding-provider docs:dimensions`。

排行榜参考：[MTEB](https://huggingface.co/spaces/mteb/leaderboard)。逐项使用官方模型卡、接口说明或固定版本的 MTEB 元数据复核；不按排名自动替换条目。

这些是模型的标准输出宽度与常用值，不保证每个托管服务都接受维度参数。服务返回的信息优先；手动填写和实测仍可使用。响应始终校验宽度，不在本地截断。

| 模型 | 默认维度 | 常用维度 | 模型范围 | 维度参数 | 核对日期 | 来源 |
| --- | ---: | --- | --- | --- | --- | --- |
| text-embedding-3-small | 1536 | 1536 / 1024 / 768 / 512 / 256 | 支持缩短，见来源 | 接口支持 | 2026-09-12 | [官方接口文档](https://developers.openai.com/api/docs/guides/embeddings) |
| text-embedding-3-large | 3072 | 3072 / 1536 / 1024 / 768 / 512 / 256 | 支持缩短，见来源 | 接口支持 | 2026-09-12 | [官方接口文档](https://developers.openai.com/api/docs/guides/embeddings) |
| text-embedding-ada-002 | 1536 | 1536 | 标准固定输出 | 默认不传 | 2026-09-12 | [MTEB 模型元数据](https://github.com/embeddings-benchmark/mteb/blob/4e24e0cf4fce71839bf3d792f40c2eac47ea92d6/mteb/models/model_implementations/openai_models.py) |
| gemini-embedding-001 | 3072 | 3072 / 1536 / 768 | 支持缩短，见来源 | 接口支持 | 2026-09-12 | [官方接口文档](https://ai.google.dev/gemini-api/docs/embeddings) |
| gemini-embedding-2 | 3072 | 3072 / 1536 / 768 | 128–3072 | 接口支持 | 2026-09-12 | [官方接口文档](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2) |
| Qwen/Qwen3-Embedding-0.6B | 1024 | 1024 / 768 / 512 / 256 / 128 / 64 / 32 | 32–1024 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) |
| Qwen/Qwen3-Embedding-4B | 2560 | 2560 / 2048 / 1536 / 1024 / 768 / 512 / 256 / 128 / 64 / 32 | 32–2560 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-4B) |
| Qwen/Qwen3-Embedding-8B | 4096 | 4096 / 3072 / 2048 / 1536 / 1024 / 768 / 512 / 256 / 128 / 64 / 32 | 32–4096 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-8B) |
| BAAI/bge-m3 | 1024 | 1024 | 标准固定输出 | 默认不传 | 2026-09-12 | [官方模型卡](https://huggingface.co/BAAI/bge-m3) |
| BAAI/bge-large-zh-v1.5 | 1024 | 1024 | 标准固定输出 | 默认不传 | 2026-09-12 | [官方模型卡](https://huggingface.co/BAAI/bge-large-zh-v1.5) |
| BAAI/bge-base-zh-v1.5 | 768 | 768 | 标准固定输出 | 默认不传 | 2026-09-12 | [官方模型卡](https://huggingface.co/BAAI/bge-base-zh-v1.5) |
| intfloat/multilingual-e5-large | 1024 | 1024 | 标准固定输出 | 默认不传 | 2026-09-12 | [MTEB 模型元数据](https://github.com/embeddings-benchmark/mteb/blob/4e24e0cf4fce71839bf3d792f40c2eac47ea92d6/mteb/models/model_implementations/e5_models.py) |
| intfloat/multilingual-e5-large-instruct | 1024 | 1024 | 标准固定输出 | 默认不传 | 2026-09-12 | [MTEB 模型元数据](https://github.com/embeddings-benchmark/mteb/blob/4e24e0cf4fce71839bf3d792f40c2eac47ea92d6/mteb/models/model_implementations/e5_instruct.py) |
| Alibaba-NLP/gte-multilingual-base | 768 | 768 / 512 / 256 / 128 | 128–768 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/Alibaba-NLP/gte-multilingual-base) |
| Alibaba-NLP/gte-Qwen2-1.5B-instruct | 1536 | 1536 | 标准固定输出 | 默认不传 | 2026-09-12 | [官方模型卡](https://huggingface.co/Alibaba-NLP/gte-Qwen2-1.5B-instruct) |
| Alibaba-NLP/gte-Qwen2-7B-instruct | 3584 | 3584 | 标准固定输出 | 默认不传 | 2026-09-12 | [官方模型卡](https://huggingface.co/Alibaba-NLP/gte-Qwen2-7B-instruct) |
| jinaai/jina-embeddings-v3 | 1024 | 1024 / 768 / 512 / 256 / 128 / 64 / 32 | 支持缩短，见来源 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/jinaai/jina-embeddings-v3) |
| nomic-ai/nomic-embed-text-v1.5 | 768 | 768 / 512 / 256 / 128 / 64 | 支持缩短，见来源 | 取决于托管服务 | 2026-09-12 | [官方模型卡](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |

维护约定：

- 每项记录标准名称、明确别名、默认维度、常用维度、已核实范围、参数策略、来源和核对日期。
- 名称匹配忽略大小写；不猜未知后缀、量化版本、微调模型或第三方重命名。
- 不用 hidden_size、输出 token 数或排名推断向量维度。MTEB 的 embed_dim 有专门定义；缩短范围由模型卡补充。
- 开源模型标准维度默认不传参数，选择其他维度才发送，可在高级设置覆盖。
- 此表不代表专用协议和角色参数均受支持；插件目前支持 OpenAI 兼容与 Gemini 原生文本嵌入。
- 更新条目后跑包测试和构建；构建检查文档一致性。填写设置时不抓取排行榜。
