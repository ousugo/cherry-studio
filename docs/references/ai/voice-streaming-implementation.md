---
description: Per-PR implementation plan for unified voice execution, bounded process streams, TTS playback, MLX ASR, dictation, and incremental reading
sources:
  - src/main/ai/voice
  - src/main/ai/AiService.ts
  - src/main/ai/localModel
  - src/main/core/utilityProcess
  - src/main/ipc/handlers/voice.ts
  - src/shared/ai/localVoice.ts
  - src/shared/ipc/schemas/voice.ts
  - src/renderer/services/voice
  - src/renderer/pages/home/useChatRuntimeState.ts
  - src/renderer/pages/agents/useAgentChatRuntimeState.ts
  - src/renderer/windows/quickAssistant/home/HomeWindow.tsx
  - packages/aiCore/src/core/runtime/voice.ts
  - scripts/utility-process-smoke
---

# TTS 与 ASR 逐 PR 实现方案

状态：PR 1 已创建 [Draft PR #21795](https://github.com/CherryHQ/cherry-studio/pull/21795)，PR 2–6 待实现。方案基于 `9d1bf05fe2c` 的代码结构，并在合入 `425b15397e7` 后补齐 Kokoro 完整结果适配，细化 [统一接口和流式执行方案](./voice-streaming-design.md) 中的六个 PR。下文保留各 PR 的实施目标，不能将后续接口、文件和验收项视为已交付。

PR 1 已提供完整结果操作表、统一执行句柄和能力描述，迁移了 VoiceSessionService 的调用与依赖；清理失败通过 `closed` 保持可观察。共享层目前只定义已支持的完整输入输出标签，PCM 与增量标签随对应 PR 加入。定向自动化及 Node/Web 类型检查通过；开发版 Electron 已验证 Apple/Qwen3 TTS 生成、播放结束、Qwen 取消与随后重启操作。原生 ASR 因本地资源未安装尚未完成实机识别，Windows 与打包产物也仍需对应环境验收。

交付顺序为 PR 1 → PR 2 → PR 3；PR 4 可在 PR 1 后推进，PR 5 等待 PR 3、4，PR 6 只等待 PR 3。PR 2 的真实消费者验证与 PR 3 一起完成，再先合并基础设施 PR。可选的 fork 分发 PR 是 PR 4 的产物前置条件。

## 所有 PR 共用的边界

### 所有权与服务依赖

| 对象 | 生命周期与所有权 | 依赖及禁止承担的职责 |
| --- | --- | --- |
| `VoiceSessionService` | `WhenReady` 生命周期服务；唯一持有会话、owner、admission 和当前 execution | 依赖 TTS/ASR 推理服务及既有文件、窗口、电源、媒体、进程服务；不直接调用厂商 SDK |
| `execution.ts` / 模型定义 | 无状态启动函数与静态定义；每次启动返回一个执行句柄 | 依赖具体适配器；不注册 IPC、不持有全局播放状态 |
| `SpeechExecution` / `TranscriptionExecution` | 一次操作，从创建到 `closed` 结算；由 session 取消 | 拥有该操作的任务、临时文件和监听器；不拥有共享热模型 |
| `VoiceStream` | 一次执行的传输资源，由 session 创建和关闭 | 依赖窄的发送回调和 execution；不读取设置、不选择模型、不做播放状态决策 |
| `TtsInferenceService` / `AsrInferenceService` | 现有 `WhenReady` 服务；队列、模型使用屏障、进程定义 | 继承 `InferenceServiceBase` 的 `UtilityProcessManager` 依赖；不依赖 session 或 Renderer |
| `UtilityProcessManager` / `ProcessHost` | 应用级服务及其拥有的进程对象；请求关联、退出和维护屏障 | 只理解通用协议、容量、取消；不导入 voice/localModel 类型 |
| Renderer 语音协调器 | 保留现有服务入口；按操作持有资源对象 | `SpeechPlaybackService` 持有播放器；`DictationService` 持有采集器；`AutoReadService` 持有消息订阅与文本游标 |
| `FinitePlayback` / `PcmPlayback` / `PcmCapture` | 普通类，按操作实例化、显式关闭 | 不进主进程服务注册表，不另建单例，不反向调用业务协调器 |
| `LocalModelService` | 现有 `BeforeReady` 服务；模型和共享 artifact 安装、移除 | 就绪后的 capability hook 调用推理服务维护屏障；不反向依赖 VoiceSessionService |

不新增生命周期服务，不要求给所有执行器建立继承体系。共享 `SpeechExecution` 等接口约束行为，适配器通过组合复用完整结果包装；只有两个真实调用者需要相同逻辑时才提取 helper。共享接口的实现放在所属领域，不能为复用把模型业务下沉到 `core`。

`VoiceSessionService` 用 `TtsInferenceService`、`AsrInferenceService` 替换当前 `AiService` 同阶段依赖；其余现有依赖保留。更早阶段的 Preference、Cache、IPC、LocalModel 服务不加入 `@DependsOn`。派生类若声明自己的依赖，显式保留基类依赖，不能误认为装饰器会合并。生命周期容器的停止超时可能使清理重叠，所有关闭路径仍需幂等。

### 终态与类型规则

统一区分四个时刻：输入 EOF、生产完成、执行资源关闭、播放排空。`completed` 给出结果或错误，`closed` 表示执行拥有的资源已清理；播放 drained 由 Renderer 单独报告。`cancel()` 幂等且等待关闭。关闭失败必须可观察，不能靠吞掉错误假装释放成功。

所有句柄创建后立即观察失败与终态；不能依靠调用方开始 `for await` 才执行取消清理。取消要能唤醒容量等待、输入等待和模型加载后的等待。终态不能与 PCM 共用需要额度的队列，否则暂停时可能永远收不到取消或失败；正常 EOF 携带最终序号，消费者仍要排空已接受的数据。

跨进程仅传值类型；能力标签使用常量对象与派生联合，沿用总方案中的 `SpeechInputKind` 等定义。请求使用判别联合，不使用一组可选字段表达互斥输入。IPC 类型从 schema 推导，能力与 schema 共用标签，不分别维护字符串名单。运行期仍校验 owner、选中模型支持的组合、格式、大小、单调序号和状态，编译期类型不能替代这些检查。

开闭原则的目标是：增加同能力后端时只增加适配器、模型目录数据和引擎实现，业务消费者继续使用同一契约。不是承诺“加模型零改动”；静态 catalog、ID 联合和显式导出允许增加条目，新增输入输出语义则必须扩展公共契约并补齐所有消费者。不做动态插件、通用依赖注入容器或无实际消费者的抽象工厂。

## PR 1：统一完整结果执行

建议标题：`refactor(voice): unify speech and transcription execution`。无前置 PR，交付后现有功能完整可用；尚不开放流式能力。

### 类与接口

在 Main 的 `executionTypes.ts` 定义总方案中的 `SpeechExecution`、`TranscriptionExecution` 与输入联合。`startSpeech(request, signal)`、`startTranscription(request, signal)` 是普通函数：解析冻结后的配置 → 查找现有模型定义 → 验证输入输出组合 → 调用适配器。入口不重新读取运行中的 Preference。

模型定义继续共用安装、支持性、语言和音色元数据，在原 `SpeechModelDefinition` / `TranscriptionModelDefinition` 增加各自的执行入口。能力应从同一份操作表导出，例如 `speechOperations` 每项包含一对 input/output 标签及只接受该输入类型的 `start`。用映射联合关联标签与 handler 入参，避免把所有 handler 扩宽成接受所有输入。能力序列化时只投影标签；不能分别手填 capabilities 与 implementations 导致“声明支持但没有实现”。

完整结果适配器内部继续调用现有 `createModel` 与 aiCore API。SDK 模型工厂成为适配器内部细节，公共执行入口不暴露 SDK 对象。先迁移两个不同后端验证共性，再提取确实重复的完整结果包装函数；不建立包含空方法的 `BaseVoiceAdapter`。

本 PR 只注册 `Text → Audio` 与 `Audio → Final`。即使协议预留了其他标签，也不能提前向 UI 公布。完整 ASR 可以有一个最终 revision，但 `completed` 是最终提交的唯一依据；无更新的后端也必须完成，不强迫伪造中间结果。

### 文件组织

| 文件 | 实现内容 |
| --- | --- |
| `src/shared/ai/voice.ts`（新增） | 能力标签、跨进程音频与转录值类型；不放 execution Promise 或 AbortSignal |
| `src/shared/ai/localVoice.ts`、`src/shared/ipc/schemas/voice.ts` | 模型描述接入能力；保留旧完整结果路由与既有 ID |
| `src/main/ai/voice/{execution.ts,executionTypes.ts}`（新增） | 无状态入口、Main 内执行句柄和判别请求 |
| `voiceModelTypes.ts`、`localAdapters.ts`、`localAdapters/{apple,windows,funasr,qwen3Tts}.ts`（同目录） | 静态操作表、现有后端包装、后端错误归一化 |
| `src/main/ai/voice/VoiceSessionService.ts` | 持有句柄，迁移调用和同阶段依赖 |
| `src/main/ai/AiService.ts` | 删除迁移后无调用者的两个语音包装及其孤立 import |

不移动 aiCore，不创建 `ai/voice/index.ts`。现有 `localModel/index.ts` 仅补真实消费者需要的具名导出，继续禁止外部深导入。

### 资源与依赖

完整 TTS 的临时文件在读出音频后由 execution 清理；`MediaProtocolService` 的音频和 URL 由 session 注册、持有，直到播放结束或取消后释放。不得因 execution.closed 就提前撤销仍在播放的 URL。完整 ASR 的上传或录音输入由原所有者管理，执行器只删除自己创建的派生文件。

加载失败、SDK 抛错、空识别、输出前取消，都必须使 output/updates/completed/closed 进入一致终态。将 `AiService` 中空文本和 `NoTranscriptGeneratedError` 到 `no_speech` 的现有语义迁入执行适配层，避免统一接口后变成普通失败。窗口销毁、锁屏和服务停止仍走 session 的统一关闭路径。

### 实施顺序与验收

1. 增加契约和适配器操作表 → 验证错误输入组合编译失败，运行时未知组合明确拒绝，已公布能力均有实现。
2. 逐个包装现有后端 → 用真实完整输入验证音色、语言、语速、错误原因和最终文本保留。
3. 迁移 session 调用与依赖、删除旧包装 → 搜索确认没有生产调用者遗留；执行生命周期回归。

定向测试覆盖现有 `VoiceSessionService.test.ts`、`voiceAdmissionCoordination.test.ts`、Apple、Windows、FunASR、Qwen3-TTS、Kokoro adapter 测试、IPC handler 的 `voice.test.ts` 和 aiCore `voice.test.ts`。把 `src/main/ai/__tests__/AiService.voice.test.ts` 中有价值的契约断言迁至新增 `src/main/ai/voice/__tests__/execution.test.ts`，不保留只验证包装调用次数的测试。

合并门槛：系统 TTS/ASR、FunASR、Qwen3-TTS、Kokoro 的原路径均不要求流式客户端；失败和取消后可再次启动；无临时文件与媒体 URL 泄漏。PR 1 不引入工作线程、PCM 通道或新的包依赖。

## PR 2：通用请求级有界流

建议标题：`feat(utility-process): support bounded request streams`。保持普通 request/event 行为，单独评审 core 协议变更；与 PR 3 原型联合验证后合并。

### 接口与协议设计

在现有 contract 上增加可选的流方法声明；普通方法仍使用 `UtilityProcessMethod`。流方法声明初始请求、输入帧、输出帧和最终结果四种类型。`client.openStream(method, input, options)` 只接受声明为流式的方法，返回以下语义的句柄；实际泛型接入方式由小范围原型确认，不放宽成任意方法名加 `unknown` 返回。

```ts
interface UtilityProcessStream<InputFrame, OutputFrame, Result> {
  readonly output: AsyncIterable<OutputFrame>
  readonly completed: Promise<Result>
  readonly closed: Promise<void>
  write(frame: InputFrame): Promise<void>
  finishInput(): Promise<void>
  cancel(): Promise<void>
}
```

`write` 等待有界接收容量；`finishInput` 关闭输入并等待已提交批次有序交付，不等待整个任务完成。只有输出的操作使用 `never` 输入帧，不能写入业务数据。handler 获得输入迭代器、可等待的输出写入和现有 signal/logger；输出提交等待容量。不要把原有同步 `emit` 改成 Promise，否则会悄悄改变所有现有消费者的错误与取消语义。

帧沿用 requestId 与 generation 关联，新增的帧种类至少覆盖数据、容量归还、输入 EOF、输出 EOF 和关闭确认。终态使用控制路径，不受数据额度阻塞。`completed` 与 `closed` 分离，尤其是 cooperative 取消时，调用者已收到取消不等于 handler 已退出。保留 terminate 策略，只有进程确认退出或 handler 的清理确认才完成资源关闭。

容量必须同时限制单帧字节、未消费总字节和帧数。原型选择可核算的帧结构：小型有界元数据加二进制载荷，泛型约束元数据与载荷的组合；核心按实际序列化元数据和 TypedArray 视图的 `byteLength` 计量，不信任发送方上报的“成本”。既有普通事件不受此新结构影响。不要为任意 JS 对象图设计通用成本算法。

每个方向限制等待写入的数量；超出限制明确拒绝，不能只限制已发送帧却允许调用方创建无限等待 Promise。消费确认只释放对应队列的所有权额度；调用方取走但仍持有的帧计入下一层预算。容量、序号、终态在 core 守卫检查，音频帧排列和文本内容校验留在 voice 层。

### 文件组织与资源生命周期

| 文件 | 实现内容 |
| --- | --- |
| `src/main/core/utilityProcess/types.ts` | 流 contract、client 与 handler 的类型关联 |
| `protocol/{constants,frames,guards}.ts` | 帧联合、边界校验、旧代与重复终态处理 |
| `host/ProcessHost.ts` | 流请求登记、发送与消费额度、停止与崩溃结算 |
| `runtime/{utilityProcessServer,serveUtilityProcess}.ts` | handler 流上下文、输入 EOF、清理确认 |
| `streamState.ts`（该 core 目录内，按需新增） | 若 host/runtime 确有共同逻辑，提取单个请求的额度与等待者状态；无全局 registry |
| `scripts/utility-process-smoke/harness/` | 增加实际子进程的慢消费、双向流与终止场景 |

流请求登记成功即阻止 idle reaping；等待输入、暂停输出和 handler 清理期间仍为活跃。正常结束先完成数据边界和 handler 清理，再解除请求登记。取消、进程崩溃、维护停止都拒绝等待者并让句柄结算；数据晚到不能重建已结束的请求。`withStopped` 仍须确认退出后才执行维护回调。

本 PR 不改变生命周期服务图，不依赖 VoiceSessionService 或推理服务。核心对象由 ProcessHost/utility server 持有，不能新增全局 StreamManager。遵守现有 child entry 的导入边界，不能让主进程 application/logger 进入子进程构建。

### 实施顺序与验收

1. 流类型与帧守卫 → 编译证明方法、输入输出不能串用；拒绝超额、超长、乱序和已关闭写入。
2. 主子进程状态与关闭 → 验证满队列时取消、未开始读取即取消、输入 EOF 后输出继续、崩溃与重启、重复取消。
3. Electron smoke 与 PR 3 的真实 TTS producer → 测量峰值队列及各层在途量，证明普通请求和原取消策略不变。

新增 `src/main/core/utilityProcess/__tests__/ProcessHost.stream.test.ts` 与 `utilityProcessStream.test.ts`，并运行该目录已有 `protocolGuards.test.ts`、`serveUtilityProcess.test.ts`、`ProcessHost.cancellation.test.ts`、`ProcessHost.stop.test.ts`、`ProcessHost.lifecycle.test.ts`。扩展既有 smoke harness 后执行 `pnpm smoke:utility-process`，记录 Electron 实际版本与结果。

合并门槛：慢消费者下内存预算可解释，取消不受信用额度影响，等待中的输入与输出都能退出，普通 request/event 测试保持通过。单纯模拟 MessagePort 的测试通过不算跨进程验收完成。

## PR 3：Qwen3-TTS 流式播放闭环

建议标题：`feat(voice): stream Qwen3 speech to playback`。依赖 PR 1、2，首次开放 `Text → PcmStream`；保持完整音频能力。

### 类与接口

`TtsInferenceService` 增加流式合成入口；其返回值是受队列管理的执行，而不是裸异步迭代器。`InferenceServiceBase` 增加与 `run` 共用模型选择、generation 校验和维护屏障的流执行路径：排队成功后把句柄发布给调用者，队列任务继续等待 `closed`。不要从 PQueue 回调直接返回句柄而提前释放串行占用。排队中取消也必须立即结算对外句柄，并使后来出队的任务跳过启动。

子进程将现有 `synthesizeStream` 输出经过一次语速转换后逐块写入通用流。WAV sink 与 PCM sink 共享实际需要的模型加载、参数和错误归一化逻辑，不把所有后端包装成强制流式。子进程处理后的采样率、声道、连续帧偏移是权威值，不能由 Renderer 根据模型名猜测。

`VoiceStream` 是 session 内部的单次中继，持有 owner 和执行身份、输入关闭状态、输出额度、在途帧与清理任务。通过窄接口接收 send 回调，不自行调用 application 定位所有服务。session 负责授权和状态迁移，VoiceStream 负责已授权执行的数据与背压。

Renderer 增加私有 `SpeechPlayback` 接口及两个实现，至少包含启动、暂停、恢复、关闭，以及 drained/失败观察。`FinitePlayback` 从现有 HTMLAudioElement 路径提取；`PcmPlayback` 拥有 AudioContext、AudioWorkletNode 和有界队列。协调器只在输出 kind 上做一次穷尽分派，不出现 Qwen/MLX 判断。每个资源对象只允许一个 owner，重复 close 返回同一清理结果。

### 文件组织

| 范围 | 文件与变更 |
| --- | --- |
| 推理 | `src/main/ai/localModel/capabilities/tts/{TtsInferenceService,protocol}.ts`、`runtime/InferenceServiceBase.ts`、`runtime/utilityEntries/inferenceTtsHandlers.ts` |
| Main 语音 | `src/main/ai/voice/VoiceStream.ts`（新增）、`VoiceSessionService.ts`、`playbackState.ts`、`localAdapters/qwen3Tts.ts` |
| IPC | `src/shared/ipc/schemas/voice.ts`、`src/main/ipc/handlers/voice.ts`；沿用通用 preload |
| Renderer | `src/renderer/services/voice/{VoiceService,SpeechPlaybackService}.ts`；新增私有 `speechPlaybackTypes.ts`、`FinitePlayback.ts`、`PcmPlayback.ts`、`pcmPlaybackProcessor.ts` |
| 构建 | 核对 `electron.vite.config.ts` 的 Renderer worklet 资源输出；只有现有构建不能正确处理时才修改配置 |

AudioWorklet 入口只导入可运行于音频线程的纯代码或类型，禁止经 services/voice barrel 导入服务单例。开发和打包资源 URL 都要验证。

### 时序、生命周期与类型约束

1. Renderer 先安装定向流事件监听器，再调用 start；Main 准入、冻结配置、分配 request/attempt，创建 execution。start 返回身份与源描述，不等待完整合成。
2. Renderer 建立对应播放器后调用 attach。Main 只有收到匹配 owner/identity 的 attach 才发送数据；等待 attach 期间仅允许有界预取，并设置准备超时。
3. Worklet 实际消费音频后归还额度；按累计消费帧进行单调确认，排除欠载静音。暂停停止消费与额度归还，上游自然背压。
4. producer 完成只设置 synthesis completed；EOF 携带最终帧位置。播放器排空并报告 ended 后 session 释放播放资源和仲裁占用。
5. stop 先在 Renderer 失效当前身份并关闭本地输出，Main 随后取消生产和中继、等待关闭；窗口丢失、锁屏、卸载及停机走同一清理语义。

输入/输出描述是判别联合，音频元数据必须先于数据且在一次流内不变。帧必须连续且完整，异常格式不能通过补零掩盖。有限媒体输出仍由 MediaProtocolService 持有；PCM 不生成完整 WAV，也不经 Cache 或广播传输。

`attemptId` 在发布输出前分配，生成完成不能重置已 playing/paused 的 observed。EOF 与 drained 分离；重试得到新 attempt，旧数据、ACK、播放报告均忽略。对已正常关闭的身份，重复关闭幂等；跨 owner 的请求始终拒绝。

播放端采样率转换具有跨块状态，结束时 flush；消费确认按源帧计量，不能直接用 AudioContext 输出帧数当源帧数。声道映射显式处理。先验证平台或已有库的流式能力，再决定是否需要最小转换实现，不对每个块独立重采样。语速只在生产侧改变一次。

准备/加载有超时，持续无生成进展且未被背压阻塞时才计执行停滞；暂停不消耗生成进展预算。保留明确的失联清理与最大资源保留策略，不能无限挂住模型。数值根据原型测量写入实现与验收记录，不直接沿用当前完整合成的固定 120 秒总预算。

有限长文本的生成调度迁入一次 speech execution，在有界文本队列中推进，不能等待上一段播放 ended 才提交。保留既有内容规范化、长度限制与确认；不要顺带改产品文案或并发规则。

### 验证与合并门槛

新增 `VoiceStream.test.ts`、`PcmPlayback.test.ts` 和纯 PCM 队列/转换测试；覆盖 Main 的 `playbackState.test.ts`、`VoiceSessionService.test.ts`、`voiceAdmissionCoordination.test.ts`，推理的 `InferenceServiceBase.test.ts`、`inferenceEntryTts.test.ts`，Renderer 的 `VoiceService.test.ts`、`VoiceService.interruptions.test.ts`、`SpeechPlaybackService.test.ts`、`manualPlayback.test.ts`、`messagePlayback.test.ts`。

断言真实契约：生成未完成时可消费首帧，暂停后内存有界，恢复不重复，尾部全部排空，停止后的旧帧不进入输出，卸载正在背压的模型不会死锁，卸载其他模型不打断当前模型。不同源/设备采样率下检查持续时间、帧连续性和尾部，不能只断言调用了 resume。

Electron 实机记录冷/热首音、生成结束时间、总播放时长、欠载、最大各级缓冲和停止后恢复；覆盖开发与打包工作线程。未完成扬声器验证时只能报告协议/播放器局部测试通过。PR 3 合并后，试听和手动朗读都应使用同一输出适配路径，不单独合并无消费者的播放器。

## PR 4：MLX Qwen3-ASR 完整识别

建议标题：`feat(local-asr): add MLX Qwen3 transcription`。依赖 PR 1 和可用的匹配分发产物，不依赖流式听写 UI；只公布 `Audio → Final`。

### 模型与引擎接口

新增 `qwen3Asr` 模型定义，明确 voice modelId、bundleId、engine 和 requires 的映射。install/status/path/infer/remove 均传递本次选中的 ID，不能从 capability 默认 bundle 反推。平台支持、运行时已安装、权重已安装和模型可执行分别报告。

当前 `AsrModelPaths` 是 FunASR 专用字段，改为按后端判别的请求：Sherpa 分支使用 encoder/llm/embedding/tokenizer/VAD；MLX 分支使用已解析模型目录和对应参数。标签常量派生类型，分派必须穷尽，禁止补空路径、`as any` 或把所有字段设为 optional。公共 `TranscriptResult` 不暴露这组引擎路径；不具备可靠时间戳的引擎不伪造 segments。

保留一个 `AsrInferenceService`、一个 ASR 串行队列和 `inference.asr` 进程。所选模型变化时沿用基类停止旧进程、确认退出、再加载新模型的顺序。`inferenceAsrHandlers.ts` 成为薄分派层，提取原 FunASR 实现并新增 MLX 实现；按请求只加载所选引擎。

进程 init 传入可定位的 artifact 路径，但初始化不要求所有引擎同时安装，也不在顶层 import MLX。所选 bundle 的 requires 决定 readiness。MLX 分支只消费独立准备的 PCM，不通过 Sherpa 的 readWave 或 resampler 隐式拉入 Sherpa 依赖；复用已有 voice.audio 解码边界。原生 binding 配置必须在该引擎首次懒加载前生效，不能把 MLX 伪装成现有 ONNX CPU/CoreML profile。

### 文件组织与依赖

| 文件 | 实现内容 |
| --- | --- |
| `src/shared/ai/localVoice.ts`、`src/shared/data/presets/localModel.ts`、voice IPC schema | 新模型 ID、显示能力和选择；复用已有设置键，不随意改 Preference 生成文件 |
| `src/main/ai/voice/localAdapters/qwen3Asr.ts`（新增）、`localAdapters.ts` | 选择、状态、安装操作和完整识别适配 |
| `src/main/ai/localModel/catalog/{catalog,types}.ts`、`mlxNodeRelease.json` | 权重、引擎依赖、固定版本、哈希和下载源；只更新实际变化的元数据 |
| `capabilities/asr/{AsrInferenceService,protocol,modelPaths}.ts`（localModel 内） | 按模型解析与强类型请求，不加入播放或录音状态 |
| `runtime/utilityEntries/inferenceAsrHandlers.ts`、`inferenceAsr.ts`、必要的 `inferenceRuntime.ts` | 后端分派与懒加载、释放接线 |
| `runtime/utilityEntries/{inferenceFunAsr,inferenceQwen3Asr}.ts`（新增） | 两个具体引擎实现；不是新的进程 entry 或服务 |
| `package.json`、`pnpm-lock.yaml`、必要的打包配置 | 匹配的 ASR JS 包与 native 分发；升级前检查 `patches/` |

新增文件保持 child-safe；安装下载仍在 Main。只有 TTS/ASR 确实共享的 MLX 加载代码才提取为同目录纯 helper，不能让 ASR import TTS handler 获得运行时。

### 资源生命周期

每次识别拥有输入派生文件、单次识别流和最终结果；模型缓存归 ASR 子进程。异常和取消关闭本次对象，原生不可中断时按既有 terminate 策略确认进程退出。正常完成可保留热模型，不能把 execution.closed 等同于模型 dispose。

下载和卸载沿用 LocalModelService 的 capability hook 与引用保护。若变更共享 MLX artifact 版本，需要维护屏障覆盖所有正在使用该 artifact 的 TTS/ASR 消费者：先阻止新的使用、停止相关进程并确认退出，再替换文件。现有安装器若不能保证这一点，应在其所属模块补齐明确屏障，不能在 ASR adapter 内覆盖正在使用的运行时。未变化的共享 artifact 不重复替换。

删除 Qwen3-ASR 权重不删除仍被 Qwen3-TTS 引用的共享 artifact，也不停止无关的 TTS 任务；实际替换共享 artifact 是需要协调两者的另一种操作。失败安装保留原可用版本，不将部分解压目录标成 ready。

### 实施顺序与验收

1. 核对精确版本的 ASR JS 导出、native 导出、权重格式和平台限制 → 缺产物先完成配套 fork 工作，不以 TTS 已工作推断 ASR 可用。
2. 打通指定 bundle 安装/选择和强类型引擎分派 → 在只装一个引擎的环境验证另一个引擎缺失不阻塞当前模型。
3. 完整音频识别接入 PR 1 → 验证 FunASR ↔ Qwen3-ASR 切换、取消、重试、模型移除与共享运行时更新。

新增 `localAdapters/__tests__/qwen3Asr.test.ts`、`runtime/__tests__/inferenceEntryAsr.test.ts`；运行现有 `capabilities/asr/__tests__/AsrInferenceService.test.ts`、`catalog/__tests__/catalog.test.ts`、`capabilities/__tests__/capabilityHooks.test.ts`、`LocalModelService.test.ts`、`BundleInstaller.test.ts`、`LocalModelStorageService.test.ts` 及 `inferenceEntryTts.test.ts` 的受影响消费者用例。目录以各所属模块为准，执行时列出完整文件路径。

合并门槛：目标 Mac 的开发/打包加载均通过，普通完整录音能识别；所选模型缺失明确报错；安装源与校验可复现；ASR 卸载不破坏 TTS；其他平台原 Sherpa 路径不加载 MLX。不把这项验收写成 Sherpa 同引擎多模型已经完成。

## PR 5：连续 PCM 听写

建议标题：`feat(voice): support streaming dictation`。依赖 PR 2、3、4，新增 `PcmStream → Revisions` 能力并复用已交付的会话与流控。

### 接口与文件

`PcmCapture` 是 DictationService 拥有的普通资源类，提供开始、正常停止并排出尾部、立即取消三种行为。实际 MediaStream、tracks、AudioContext、worklet 和待提交批次只归它管理；设备切换不能在活动录音中静默重建输入源。

`VoiceService` 使用 PR 3 的流身份和监听器，增加 PCM write / finish_input 调用；`VoiceStream` 增加有界输入方向，不建立另一套 ASR session。`AsrInferenceService` 使用 PR 3 的整次流队列占用，MLX handler 串行 feed；输入 EOF 后 finish，映射修订与最终结果。原始 SDK stream 只存在于子进程。

| 文件 | 实现内容 |
| --- | --- |
| `src/renderer/services/voice/{PcmCapture.ts,pcmCaptureProcessor.ts}`（新增） | 设备采集、有界批次、停止尾部及取消 |
| `DictationService.ts`、`VoiceService.ts`、必要的 `VoiceTargetManager.ts`（同目录） | 连续识别编排、修订预览、已有目标绑定上的最终一次提交 |
| `src/shared/ai/voice.ts`、voice IPC schema 与 handler | 输入格式与批次、finish、revision 联合及运行期约束 |
| `src/main/ai/voice/{VoiceSessionService,VoiceStream}.ts`、`localAdapters/qwen3Asr.ts` | 输入授权/额度、执行终态与后端能力开放 |
| localModel 的 ASR protocol/service、`inferenceQwen3Asr.ts` | 连续识别、输入 EOF、SDK 资源释放和 revision 归一化 |

预览接入现有听写展示入口，UI 不持有原生流。不新增设置时不修改 Preference；新增可见文案须走 i18n。若增加组件，沿用 `@cherrystudio/ui`，测试遵循前端测试指南。

### 流控、类型与关闭顺序

采集格式记录真实采样率、声道与帧位置；输入边界明确下混与连续重采样由谁完成，转换状态跨批次保留且 EOF 时 flush。不得声明 16 kHz 却提交 48 kHz 样本。录音硬件不会等待模型容量，客户端必须有上限；达到上限即失败并停止采集，不静默丢掉旧样本。

`write` ACK 只意味着数据进入受限接收范围，仍需计算 Main/子进程已排队的总量；不能在每层提前 ACK 后各自无限缓冲。revision 消费慢时可以只保留最新完整快照，但最终结果和错误不能丢失；这项合并只用于完整文本快照，不能用于 PCM 或文本输入 delta。

| 事件 | 必须执行的动作 |
| --- | --- |
| 正常停止录音 | 停止新增设备输入，取得工作线程已接受尾部，按序送完，flush 转换，发送一次 finish_input，等待 final |
| 用户取消/窗口关闭/锁屏 | 立即停 tracks 和本地输出，丢弃待送输入，取消 Main execution；禁止后续提交文本 |
| 输入持续过载/设备断开/worker 崩溃 | 显式失败、清理设备和句柄；不自动重放旧音频，不把部分文本作为成功提交 |
| 识别完成 | 依据冻结的 target 与执行身份提交一次，再清理预览与监听器；目标失效走已有恢复流程 |

revision 使用单调版本和完整文本；provisional 起点统一成 UTF-16 下标，不能混用 token 或 code point 偏移。较旧 revision 忽略。`final` 更新用于展示，只有 execution.completed 触发提交，避免“final 事件一次、completed 又一次”。模型允许回改前缀时也替换快照，不永久锁死所谓 stable 文本。

### 验证与合并门槛

新增 `PcmCapture.test.ts` 和流式 ASR adapter/handler 用例；运行 `DictationService.test.ts`、`VoiceTargetManager.test.ts`、`VoiceService.test.ts`、Main 的 `VoiceStream.test.ts`、`VoiceSessionService.test.ts`、ASR 推理与 IPC schema/handler 测试。

契约用例覆盖尾帧只处理一次、连续重采样、超额写入、输入 EOF 与取消的差异、revision 回改、空语音、final/completed 竞争、失焦和目标销毁。用持续输入和慢模型证明缓冲上限；不要用丢帧让测试“保持实时”。

实机证明边录边更新、正常停止保留尾词、取消后麦克风释放、焦点切换不误插入、设备断开后可重新开始。未安装或不支持流式模型时仍使用现有完整录音路径，按能力选择，不根据平台写条件分支。UI 不应把有滚动窗口延迟的模型描述成逐音素即时识别。

## PR 6：增量正文朗读

建议标题：`feat(voice): read incremental assistant text`。依赖 PR 3，新增 `TextStream → PcmStream`，无需等待 ASR。

### 类、接口与接入点

扩展现有 `AutoReadService`，在消息执行中接收正文快照/增量和终态，按 `messageId + attemptId` 持有一个朗读执行；现有完成回调作为完整文本后端的路径保留。`SpeechPlaybackService` 增加启动文本输入流的入口，继续复用同一播放器、仲裁和停止行为。

新增纯模块 `incrementalReadableText.ts`，负责可朗读文本的提交边界和游标，不持有播放设备或 session。输入是已经区分 text/reasoning/tool 的消息内容，不能对模型的原始混合 token 字符串猜测正文。Main 的输入是带标签的 `Text` / `Flush` 事件联合，真正的 EOF 走 finish_input；厂商 instruct 等扩展不直接透传为公共协议。

文件涉及 `src/renderer/services/voice/{AutoReadService,SpeechPlaybackService,VoiceService,readableText}.ts` 和新增纯模块，Main 的 execution 输入、voice schema、Qwen3-TTS adapter/handler。当前自动朗读生产调用点是 `src/renderer/pages/home/useChatRuntimeState.ts`、`src/renderer/pages/agents/useAgentChatRuntimeState.ts`、`src/renderer/windows/quickAssistant/home/HomeWindow.tsx`，分别接到各自实际流生命周期；共享文本处理留在 service，不在三个页面复制。

### 文本边界与背压

对提交过的正文保留稳定游标；未完成 Markdown 结构留在有限 pending 区，达到明确句子/段落边界后才规范化并提交。不得每次对全量快照执行 normalize 后按旧字符串长度截取，因为后续 Markdown 闭合可能改变此前输出。正文内容在已提交范围内回改时，停止本次朗读并明确结束，不能继续追加导致重复；只有尚未提交的尾部可以替换。

模型输入 flush 是催促处理已有文本，不是结束整次输入；消息成功结束时 flush 尾部，再 finish_input，等 PCM 排空。一个执行内只有一处负责文本分段，不叠加“句子队列”和“等上一音频 ended”的双重调度。

LLM 生成不会因为语音消费慢而停止。朗读文本 backlog 必须有字符数与在途批次上限；暂停时 backlog 仍可能增加。超限停止本次自动朗读、释放语音资源并提示原因，不阻塞聊天流、不静默丢段，也不自动改用无限缓冲。长文本确认沿用既有自动朗读限制；不能因为增量单批较短绕过总量限制。

### 资源生命周期与扩展边界

订阅、游标和待提交文本由 AutoReadService 的本次执行记录拥有；成功 EOF、聊天 abort/error、关闭自动朗读、手动语音抢占、页面离开或窗口销毁都结束该记录。记录删除前先使身份失效，晚到快照不能重新创建同一 attempt。已输出过声音的失败任务不自动从头重试，避免重复播报。

自动朗读不能为了清理语音而 abort 聊天生成。输入结束不等于播放结束，成功完成消息后仍允许播放尾部。禁用自动朗读要停止订阅和语音，恢复开启只影响后续合格执行，不追读历史快照。

只有声明支持增量文本的模型才走此路径；完整文本后端在消息完成时使用原路径。一旦已启动增量朗读，完成回调不再触发第二次完整朗读。增加新的流式 TTS 后端只需声明并实现同一操作，不修改 AutoReadService 的模型分支。

### 验证与合并门槛

新增 `incrementalReadableText.test.ts`；运行现有 `readableText.test.ts`、`AutoReadService.test.ts`、`SpeechPlaybackService.test.ts`、`VoiceService.test.ts`、`messagePlayback.test.ts` 以及三个接入点已有受影响测试。若对应页面没有可用定向测试，明确记录缺口并用 Electron 验证，不以全量测试代替。

覆盖正文与 reasoning 交错、未闭合代码块和链接、快照重放、提交前/后修订、重试 attempt、完成回调重复、暂停积压、聊天失败与手动抢占。断言最终提交的可朗读文本恰好一次且顺序正确，取消后无新语音输入。

实机在主聊天、Agent 与快捷助手分别验证：生成未结束即可听见正文；成功结束保留尾音；取消和关闭开关立即停止语音但不干扰聊天。不宣称未接入的消息运行时自动支持增量朗读。

## 可选配套 PR：MLX ASR 分发

仅在固定版本的产物不能支持 PR 4 时创建，范围在 `CherryHQ/mlx-node`。它交付匹配的 ASR JS 导出、native binding、平台资源与可复现构建/校验清单；不包含 Cherry 的 session、IPC、模型下载 UI 或播放器。

先验证完整识别，再验证实际 stream 的 feed/finish/cancel、修订与清理语义，清楚区分模型缓存和单次识别对象。对导出、平台要求、版本和权重格式建立一份一致的发布元数据；主仓库 pin 精确版本并校验哈希，不跟随浮动分支。

验收包括干净目录安装、Electron utility process 加载、打包路径、本地完整输入和连续输入、取消后的再次加载；与现有 TTS 的共享原生能力一起回归。源码 PR 合并、准备草稿产物和正式发布是不同动作；公开发布前完成产物验证，不能把创建方案或源码 PR 当成发布授权。

## 验证与交付记录

每个实现 PR 在正文记录：实际改动的接口与所有权、同阶段服务依赖变化、显式测试文件及结果、实机平台/构建方式、未覆盖项。PR 3/5/6 还记录首音或首个 revision、队列峰值、尾部排空、取消与恢复结果。设计中的目标不能填成已经通过的证据。

实施前运行 `pnpm install`，再用 `pnpm check --plan` 查看影响范围；根据上述用例选择 `pnpm test:main <完整测试文件路径...>`、`pnpm test:renderer <完整测试文件路径...>` 等命令。类型改动运行受影响项目的 typecheck，格式和 lint 只覆盖改动文件，不自动执行无过滤的全仓库测试。新增 schema、IPC 事件和 utility contract 同时检查生产者与消费者的编译类型。

仅更新本文及总方案时，运行 `pnpm docs:index`、`pnpm docs:check` 与 `git diff --check`。仓库 Oxfmt 忽略 Markdown，另检查末尾换行、行尾空白和 fenced block 闭合；无需运行 Vitest。生成的 `docs/README.md` 只通过索引脚本更新。
