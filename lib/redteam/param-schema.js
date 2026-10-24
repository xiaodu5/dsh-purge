/**
 * 工具参数 Schema 归一化（给宿主 @deepseek-ai/dsh-tools 的编译期校验用）。
 *
 * 背景（1.1.73 的真实故障）：
 *   宿主把工具的 `parameters` 属性表交给 `compilePropertyMap(spec, 'parameters')`
 *   （`@deepseek-ai/dsh-tools/lib/index.js:803`），后者在
 *   `lib/types/schema.js:156-160` 处规定：**任何 `type: 'object'` 节点都必须显式
 *   给出布尔型 `additionalProperties`**，缺一个就 `authorError` 抛错。
 *   而工具注册是 fail-fast 的：一条 spec 不合格，整个 `redteam-tools` 插件注册失败，
 *   56 个工具集体消失，只在 `<root>/preset-declare.json` 里留一句
 *   `registered-broken`。1.1.73 新增的自由对象参数（`parameters` / `result`）正好
 *   漏了这一项 —— 报错路径 `parameters.parameters.additionalProperties` 就是它。
 *
 * 这里的选择：注册前把整棵 spec 走一遍，缺省的补 `true`。
 *   · 补 `true` 而不是 `false`：这些节点本来就是"任意 JSON 对象"，
 *     `false` 会在运行期把模型多传的键判成非法，属于收紧行为、会改坏调用；
 *   · 已显式写好的布尔值原样保留（`names` / `ports` / `fingerprints` 都是 `false`）；
 *   · 只改副本，不动调用方传进来的对象。
 *
 * 归一化之后仍然建议在 spec 里写明 `additionalProperties`
 * （`scripts/selfcheck.mjs` 会静态扫一遍，提醒别只依赖这层兜底）。
 */

/** 缺省补什么：true = 允许任意键，与"自由 JSON 对象"的原意一致。 */
export const FREE_FORM_ADDITIONAL_PROPERTIES = true

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 走一棵"值 schema"（`{ type, properties, items, oneOf, ... }`）。
 * @param node 值 schema
 * @param path 报错/统计用的路径（如 `parameters.ports.items`）
 * @param filled 收集补齐过的路径
 */
function walkValueSchema(node, path, filled) {
  if (!isPlainObject(node)) return node
  const out = { ...node }
  if (out.type === 'object') {
    if (typeof out.additionalProperties !== 'boolean') {
      out.additionalProperties = FREE_FORM_ADDITIONAL_PROPERTIES
      filled.push(path)
    }
    if (isPlainObject(out.properties)) out.properties = walkPropertyMap(out.properties, `${path}.properties`, filled)
  }
  if (out.type === 'array' && isPlainObject(out.items)) {
    out.items = walkValueSchema(out.items, `${path}.items`, filled)
  }
  if (Array.isArray(out.oneOf)) {
    out.oneOf = out.oneOf.map((branch, index) => walkValueSchema(branch, `${path}.oneOf[${index}]`, filled))
  }
  return out
}

/** 走一张"属性表"（`{ 参数名: 值 schema }`）。 */
function walkPropertyMap(map, path, filled) {
  const out = {}
  for (const [key, value] of Object.entries(map)) {
    out[key] = walkValueSchema(value, `${path}.${key}`, filled)
  }
  return out
}

/**
 * 返回一份"每个 object 节点都带显式 additionalProperties"的工具描述副本。
 *
 * @param definition `{ name, description, parameters: { 参数名: 值 schema } }`
 * @param options `{ onFill?: (paths: string[]) => void }` —— 补齐了哪些路径，
 *                便于在注册日志里留痕（默认什么都不做）。
 * @returns 新的 definition；`parameters` 缺失或不是对象时原样返回。
 */
export function withExplicitAdditionalProperties(definition, options = {}) {
  if (!isPlainObject(definition)) return definition
  if (!isPlainObject(definition.parameters)) return definition
  const filled = []
  const next = { ...definition, parameters: walkPropertyMap(definition.parameters, 'parameters', filled) }
  if (filled.length > 0 && typeof options.onFill === 'function') {
    try { options.onFill(filled) } catch { /* 回调出错不影响注册 */ }
  }
  if (filled.length > 0) {
    /* 非枚举属性：方便 selfcheck / 调试读取，又不污染宿主看到的 spec。 */
    Object.defineProperty(next, '__filledAdditionalProperties', { value: filled, enumerable: false })
  }
  return next
}
