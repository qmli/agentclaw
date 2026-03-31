# VS Code 调试指南

## 快速开始 (重要!)

### 推荐方式：Debug Server (TypeScript) ✅

1. 按 `Ctrl+Shift+D` 打开调试面板
2. 选择 **"Debug Server (TypeScript)"**
3. 按 `F5` 启动调试

现在你可以在代码中设置断点了！

## 设置断点

### 基本用法

- **点击行号左侧** 即可设置/取消断点（显示红色圆点）
- 按 F5 启动调试，代码执行到断点时自动暂停

### 条件断点

- 右键单击断点 → "Edit Breakpoint"
- 输入条件（如: `msg.id === "abc"` 或 `err.status >= 400`）
- 仅当条件为真时才暂停

### 日志点（不中断）

- 右键单击行号 → "Add Logpoint"
- 输入消息内容（支持 ${variable} 语法）
- 执行该行时输出日志，不暂停程序

## 调试快捷键

| 快捷键       | 功能                   |
| ------------ | ---------------------- |
| F5           | 继续执行 / 启动调试    |
| F10          | 单步跳过（不进入函数） |
| F11          | 单步进入（进入函数）   |
| Shift+F11    | 单步退出（离开函数）   |
| Ctrl+Shift+L | 停止调试               |

## 调试面板

### 查看变量

- **Locals** - 当前作用域变量
- **Globals** - 全局变量
- **Watch** - 自定义监视表达式（点击"+"添加）

### Debug Console

- 在底部 Debug Console 中输入变量名查看其值
- 支持执行表达式获取结果

## 常见调试场景

### 调试 WebSocket 消息处理

在 `src/gateway/ws-server.ts` 中：

```typescript
// 在 handleMessage() 函数设置断点
function handleMessage(ws: WebSocket, ctx: ConnectionContext, raw: string, config: GatewayConfig): void {
  // 在这里设置断点查看消息信息
  let msg: WsClientMessage;
```

### 调试 API 调用

在 `src/gateway/openai-http.ts` 中：

```typescript
// 在 chatCompletion() 函数设置断点
export async function chatCompletion(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
): Promise<AbortController> {
  // 在这里设置断点查看请求参数
```

## 故障排除

### Q: 设置了断点但没有触发

- 确保使用的是 "Debug Server (TypeScript)" 配置
- 检查执行流是否真的会经过该代码行
- 可能需要重启调试 (Ctrl+Shift+L 然后 F5)

### Q: 看不到 TypeScript 源代码（显示编译后的JS）

- Source Maps 未正确配置
- `tsconfig.json` 中的 `"sourceMap": true` 已启用 ✓
- 清除 `.vscode/logs` 目录，重启调试

### Q: 无法在某些文件中设置断点

- 检查文件是否在 `servers/` 目录下
- 文件必须是 TypeScript (.ts) 文件
- 不能在 node_modules 中设置断点

## 其他调试配置

### Debug Server (npm run debug)

- 通过 npm 脚本启动调试
- 如果第一种方式有问题，可尝试此方式

### Debug Server (Compiled)

- 调试编译后的 JavaScript
- 首先需要运行 `npm run build`
- 用于测试构建和打包问题

### Attach to Running Server

- 附加到已运行的服务器进程
- 启动服务器时使用: `node --inspect dist/index.js`
- 端口号: 9229

## 相关文档

- TypeScript 源映射：确保 tsconfig.json 中启用 sourceMap
- Node.js 调试：https://nodejs.org/en/docs/guides/debugging-getting-started/
- VS Code 调试：https://code.visualstudio.com/docs/editor/debugging
