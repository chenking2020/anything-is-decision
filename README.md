# Anything is Decision · 本体驱动的多语言决策平台

> 任何东西都可以是一次决策。
> 把每一次判断原子化成一个**决策因子**，先汇聚数据、自动摊成一张**本体图**，
> 每个因子再从图上裁一块**动态子本体**，按依赖链式推进、多步迭代，最后收敛成一个带概率的结论。

底层引擎是本地权重 [`convaiinnovations/laya-multilingual`](https://www.modelscope.cn/models/convaiinnovations/laya-multilingual)
（mmBERT-base 307M + 2 层决策头，322M 参数，100+ 语言，非自回归，RLCD 训练）。
运行时**不访问网络**：本体构建是纯 Python 启发式（无 LLM 调用），决策是一次前向传播。

---

## 一、方法论：一次蓝图执行的六步

```
汇聚数据 → 构建本体 → 因子分层 → 动态子本体 → 链式推进 → 多步迭代
```

| 步骤 | 做什么 | 产出 |
|---|---|---|
| **1. 汇聚数据** | 把多条来源（正文、画像、历史记录、交易流水）统一成文档集 + 属性表 | `DataBundle` |
| **2. 构建本体** | 结构化字段 → 属性节点；文本 → 短语级概念节点 + 同句共现边 | 带权本体图 `OntologyGraph` |
| **3. 因子分层** | 按因子的 `depends_on` 做拓扑分层，同层互不依赖 | 有向无环的执行层 |
| **4. 动态子本体** | 每个因子按自己的 `scope`（类型 / 关键词 / 跳数）裁出 k 跳邻域 | 每个因子一份子图 |
| **5. 链式推进** | 上游结论写成图上的**结论节点**，下游裁子图时自然读到 | 结论节点 + `derives` 边 |
| **6. 多步迭代** | 重复 2–5 若干轮，直到取值稳定或达到 `max_steps` | 收敛的结论 + 完整轨迹 |

**链式依赖不是参数传递，而是图上多出来的那一个节点。** 判完「是否要求退款」，
图上就多了一个 `conclusion:是否要求退款 = 是（0.99）`，并且它 `derives` 自「扣款 / 退款 / 订阅费」；
下一个因子裁子图时，这个节点就在它的邻域里——不需要胶水代码，也不需要提示词工程。

**多步迭代为什么有效**（同一条工单，本地实测）：

| 因子 | 第 1 轮 | 第 2 轮（上游结论已进图） |
|---|---|---|
| 紧急度 | 0.5572 → 门控：升级人工 | 0.5849 → 后验收紧 |
| 归属团队 | 0.7349 | 0.8967 |

第一轮里下游因子只能读到原始文本；第二轮子图里多了两个高置信的结论节点，
后验明显收紧。代价是延迟随「轮数 × 因子数」增长——所以它默认 `max_steps = 1`，
只在你需要时才打开。

**为什么概率可信**：RLCD 用严格适当评分规则训练——模型只有如实报告信念时期望奖励才最大。
但「可标定 ≠ 已标定」：本检查点出厂 `temperature = [1.0, 1.0, 1.0]`，系统性过度自信，
所以平台把**温度拟合**与**阈值扫描**做成一等公民功能，而不是留给使用者自己拍脑袋。

**与 Palantir 的分工**：

| 维度 | Palantir | Anything is Decision |
|---|---|---|
| 本体从哪来 | 先建模：数据接入、实体对齐、本体工程 | 自动摊开：每次执行时从原始材料现构一张图，用完即弃 |
| 本体有多大 | 一个组织级世界模型 | 每个因子一块动态子图（默认 ≤ 16 节点） |
| 前置成本 | 底座建成之后决策能力才出现 | 零前置：给数据 + 一组因子，第一次调用就产出决策 |
| 答案形态 | 查询结果、图谱路径、生成式结论 | 类型化取值 + 完整概率分布 + 集中度 + 门控裁决 |
| 时延 | 秒级～分钟级 | 单因子一次前向 ≈ 30 ms；链路 = 轮数 × 因子数 × 30 ms |
| 不确定性 | 主要由人把握 | 一等公民：被标定、被画成曲线、被阈值化成策略 |
| 失败模式 | 本体建错/数据滞后 → 系统性偏移且往往无声 | 分布平坦 → 置信度低 → 显式升级人工 |
| 成本 | 平台 + 实施 + 持续数据工程 | 开源权重单机自托管，边际成本趋近于零 |

二者并不互斥：本体擅长回答「世界是什么样」，决策引擎擅长回答「此刻该做什么、有多确定」。
生产系统里 Anything is Decision 通常站在最前面——用几十毫秒决定这条输入该走哪条路、
要不要交给更贵更慢的系统。

---

## 二、快速开始

```bash
# 1) 后端（Python ≥ 3.10）
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python server/run.py            # http://127.0.0.1:8000

# 2) 前端（开发模式，已配置 /api → 8000 代理）
cd web && npm install && npm run dev      # http://127.0.0.1:5173

# 或：构建产物交给后端托管，只开一个端口
cd web && npm run build && cd .. && .venv/bin/python server/run.py

# 也可以一条命令（含建环境、装依赖、构建、启动）
./start.sh
```

首次启动会把 322M 权重读进内存（Apple Silicon 上约 8–10 秒，自动使用 MPS）。
设备可用 `LAYA_DEVICE=cuda|mps|cpu` 指定，长文档用 `LAYA_MAX_LEN=8192`。

---

## 三、功能地图

| 页面 | 作用 |
|---|---|
| **总览** | 决策量、自动执行率、平均置信、置信直方图、近 14 天趋势、引擎状态 |
| **决策工作台** | 输入状态（文本 / JSON）+ 可视化编写 choice / score / noul，一次前向出全部答案；可打真值、可存为蓝图 |
| **本体与链路** | 汇聚多条数据源 → 自动构建本体图 → 编辑因子的依赖与作用域 → 链式多步决策；可回放每一步读到的子本体 |
| **蓝图库** | 31 张内置决策蓝图、20 个领域（客户运营 / 风控合规 / 内容安全 / 研发运维 / 销售市场 / 人力资源 / 医疗健康 / 公共部门 / 投资研究 / 个人决策 / 通用办公 / 电商零售 / 营销合规 / 金融保险 / 信息安全 / 舆情公关 / 供应链 / 产品管理 / 教育教学 / 数据运营），支持自建与克隆 |
| **批量决策** | CSV / JSON / 逐行文本导入 → 共享前向传播批量打分 → 分流统计 → 导出 CSV → 逐条标注 |
| **决策账本** | 每次决策的完整留痕（状态、问题集、概率分布、语言路由、耗时、裁决），可回溯、可标注、可删除 |
| **标定与门控** | 准确率 / ECE / Brier / MAE 指标、覆盖率↔准确率扫描曲线、一键拟合各类型温度并应用到运行时 |
| **方法论** | 与 Palantir 的逐维度对照、三原语、门控经济学、什么时候不该用它、模型卡 |

---

## 四、目录结构

```
weights/laya-multilingual/        本地检查点（model.safetensors + tokenizer + rl_agent_config.json）
server/
  run.py                          启动脚本（--host/--port/--device/--no-preload）
  requirements.txt
  app/
    config.py                     路径、设备、默认阈值
    engine.py                     Laya 引擎单例：加载、推理、结果规范化、温度缩放、门控
    ontology.py                   本体层：数据汇聚、自动构图、动态子本体裁剪、结论回写、渲染
    orchestrator.py               链式编排：拓扑分层、按因子裁子图、链式推进、多步收敛
    calibration.py                指标 / ECE / 阈值扫描 / 温度拟合
    store.py                      SQLite 持久化（账本、反馈、蓝图、设置）
    blueprints_data.py            内置蓝图库
    schemas.py                    pydantic 模型
    routers/                      meta / decisions / chain / blueprints / ledger / calibration
web/                              React 18 + Vite + TS + Tailwind 前端
  src/pages/                      8 个页面（含「本体与链路」）
  src/components/                 Layout / ui / QuestionEditor / AnswerCard / OntologyGraphView
  src/lib/                        api.ts / types.ts / format.ts / MetaContext
server/data/anything-is-decision.db            运行时生成的 SQLite（已在 .gitignore）
```

---

## 五、HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 引擎信息 + 设置 |
| POST | `/api/route` | 只做脚本 / 语言分析，不走前向 |
| POST | `/api/decide` | 单条决策，返回答案、概率、门控、账本 ID |
| POST | `/api/decide/batch` | 批量决策（共享前向） |
| POST | `/api/decide/chain` | **链式决策**：汇聚 → 构图 → 动态子本体 → 多步迭代，返回图 + 每步轨迹 |
| POST | `/api/ontology/build` | 只汇聚数据并构建本体图（不跑推理） |
| POST | `/api/chain/plan` | 只做依赖分析：拓扑分层 + 环检测（不跑推理） |
| GET | `/api/chain/demo` | 一条带依赖与作用域的链式样例 |
| POST | `/api/ingest/parse` | CSV / JSON / 逐行文本 → 批量条目 |
| GET/POST/PUT/DELETE | `/api/blueprints` | 蓝图 CRUD |
| GET | `/api/ledger`、`/api/ledger/stats` | 账本与统计 |
| POST | `/api/ledger/{id}/feedback` | 给某个答案打真值（成为标定样本） |
| POST | `/api/calibration/metrics` · `/sweep` · `/fit` · `/apply` | 指标、阈值扫描、温度拟合与应用 |
| GET/PUT | `/api/settings` | 阈值、温度、自动执行开关 |

交互文档：`http://127.0.0.1:8000/docs`

一段最小调用：

```bash
curl -s localhost:8000/api/decide -H 'content-type: application/json' -d '{
  "state": {"body": "我被重复扣款了，请今天退款，否则我们取消套餐。"},
  "questions": {
    "department": {"type": "choice", "instructions": "Which team should handle this?",
                   "criteria": {"billing": "invoices, refunds", "technical": "bugs, outages"}},
    "refund_requested": {"type": "noul", "instructions": "Does the sender ask for money back?"}
  }
}'
```

一段链式调用（因子带依赖与作用域，`max_steps: 2` 表示多跑一轮让后验收紧）：

```bash
curl -s localhost:8000/api/decide/chain -H 'content-type: application/json' -d '{
  "state": {
    "subject": "重复扣款，请马上退款",
    "body": "我在本月被重复扣款了两笔订阅费，共计398元。请今天退款，否则我们取消套餐并投诉。",
    "user": {"plan": "pro", "tenure_months": 26}
  },
  "questions": {
    "是否要求退款": {"type": "noul", "instructions": "这条消息是否明确要求退款？"},
    "归属团队": {
      "type": "choice",
      "instructions": "这条消息应该归属哪个团队处理？",
      "criteria": {"财务": "发票、支付、扣款、退款", "技术": "崩溃、故障、报错", "其他": "以上都不是"},
      "depends_on": ["是否要求退款"],
      "scope": {"keywords": ["扣款", "退款"], "depth": 2}
    },
    "紧急度": {
      "type": "score",
      "instructions": "这件事有多紧急？",
      "criteria": ["没有时间压力", "本周内需要处理", "正在阻塞对方"],
      "depends_on": ["归属团队"]
    }
  },
  "policy": {"threshold": 0.6},
  "max_steps": 2,
  "depth": 2
}'
```

返回里 `graph` 是最终本体图（含结论节点），`steps` 是每一步的轨迹
（读了哪块子图、答案是什么、置信多少、gate 怎么裁决、这一轮是否发生变化），
`rounds` / `converged` 说明多步迭代跑到第几轮、有没有收敛。

---

## 六、语言约定

* **决策维度用中文**：问题名、选项标签、等级描述、门控说明一律中文——
  使用者以中文编写、阅读与复核。例如「归属团队 / 紧急度 / 情绪强度 / 流失风险 / 要求退款」。
* **多语言只作用于原始数据**：被决策的对象（工单、交易、帖子、告警）可以是英、日、西、阿、印地等
  任意语言，同一个检查点、同一套中文维度一次前向完成。
* **蓝图样例以中文为主**：内置蓝图的示例状态默认给中文（可直接改、可直接跑），
  另附 1–2 条多语言原始数据样例用于验证跨语言表现。
* **是非题的显示**：内部取值仍是 `true / false`，界面统一显示为「是 / 否」。

## 七、编写问题的三条硬规则

1. **choice 选项 ≤ 20 个**，且绝不使用 `true/false`、`yes/no` 之类的真值词做标签
   （模型会跟着标签走而不是跟着内容走）——平台在保存蓝图时会直接拒绝。
2. **score 等级 ≤ 5 级**，每一级都要写清楚判据；这是最弱的原语，能用 choice 就别用。
3. **noul 只问一个命题**；概率落在 0.5 附近时，门控会强制升级人工。

---

## 八、链式依赖与作用域

默认形态是**扁平并行**：所有因子共享同一份状态、彼此看不见对方的答案，交换顺序结果不变。
快、可复现、可解释——对互不相关的维度这就是最优解。

只有当因子之间真的有依赖时，才给它们加两个字段（两者都是可选的，不写就走扁平路径）：

```jsonc
{
  "是否要求退款": { "type": "noul", "instructions": "这条消息是否明确要求退款？" },
  "归属团队": {
    "type": "choice",
    "instructions": "这条消息应该归属哪个团队处理？",
    "criteria": { "财务": "扣款、退款、发票", "技术": "崩溃、报错", "其他": "以上都不是" },
    "depends_on": ["是否要求退款"],                 // 我先知道它要不要退款，再判归属
    "scope": { "types": ["attribute"],              // 我只关心图上这几类节点
               "keywords": ["扣款", "退款"],         // 以及命中这些词的节点
               "depth": 2 }                          // 再向外扩 2 跳
  }
}
```

语义与代价：

* `depends_on` 决定**执行顺序**：被引用的因子先跑，它的结论以 `conclusion:<因子名>` 节点写回图，
  并从它依据的节点连 `derives` 边。依赖必须构成有向无环图——有环时 `/api/chain/plan` 会直接报出环。
* `scope` 决定**读哪块图**：命中类型的节点 + 命中关键词的节点作为种子，向外扩 `depth` 跳，
  再按权重截断到 `limit`（默认 16）个节点。不写 `scope` 时退化为「全图按权重取头部节点」，
  此时同层因子的输入文本相同，会被合并成**一次**前向传播——所以不写依赖也不写作用域时，
  链路的开销与扁平并行基本一致。
* `max_steps` 决定**跑几轮**：默认 1。第 2 轮起只重判「自身未过阈」和「上游发生了变化」的因子。
  延迟大约是 `轮数 × 层数` 次前向，请按需要打开。
* 上游的错误会顺着链条传播：链式依赖放大了「先判对的那一步」的价值，也放大了它判错时的代价。

---

## 九、致谢与许可

* 模型：[convaiinnovations/laya-multilingual](https://www.modelscope.cn/models/convaiinnovations/laya-multilingual) · Apache 2.0 · Convai Innovations
* 库：`pip install laya` · 文档 https://nandhakishorm.github.io/laya/ · 官方演示 https://huggingface.co/spaces/convaiinnovations/laya-demo
* 本平台代码同样以 Apache 2.0 发布。

## 十、Star History

如果这个项目对你有帮助，欢迎点个 Star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=chenking2020/anything-is-decision&type=Date)](https://www.star-history.com/#chenking2020/anything-is-decision&Date)

