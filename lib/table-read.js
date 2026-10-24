import { createDecipheriv } from "node:crypto";
import { inflateSync } from "node:zlib";
import { IV, MASK, SLOT, TAG } from "./asset-table.js";
import { mixKey } from "./table-key.js";

/**
 * 打开加密槽，**带失败分类**。
 *
 * 背景：`openSlot()` 失败时静默返回 ""（v1.1.71 及以前只有这一个入口），
 * 调用方拿到空串只会让出厂默认提示词"消失"，谁也说不清是
 * 槽文件没打进去、密钥不匹配、还是载荷被改坏。这里把三种失败拆开：
 *
 *   · `decrypt`   — AES-GCM 认证失败：密钥/IV/TAG 对不上，或槽内容被改动
 *                   （GCM 的认证标签就是干这个用的，改一个字节都过不去）；
 *   · `decompress`— 解密成功但 inflate 炸了：载荷不是合法 deflate 流（截断/损坏）；
 *   · `empty`     — 全部解开但内容是空白：embed 环节把空正文封了进去。
 *
 * @param parts `{ IV, MASK, SLOT, TAG }` —— 默认取内置槽；测试可注入被篡改的分量。
 * @returns `{ ok, reason, text, error? }`；成功时 `reason` 为 null。
 */
export function openSlotDetailed(parts = { IV, MASK, SLOT, TAG }) {
  let raw;
  try {
    const decipher = createDecipheriv("aes-256-gcm", mixKey(parts.MASK), Buffer.from(parts.IV, "base64"));
    decipher.setAuthTag(Buffer.from(parts.TAG, "base64"));
    raw = Buffer.concat([
      decipher.update(Buffer.from(parts.SLOT, "base64")),
      decipher.final(),
    ]);
  } catch (e) {
    return { ok: false, reason: "decrypt", text: "", error: String(e && e.message ? e.message : e) };
  }
  let text;
  try {
    text = inflateSync(raw).toString("utf8");
  } catch (e) {
    return { ok: false, reason: "decompress", text: "", error: String(e && e.message ? e.message : e) };
  }
  if (!String(text).trim()) {
    return { ok: false, reason: "empty", text: "", error: "slot payload is empty" };
  }
  return { ok: true, reason: null, text, error: null };
}

/** 兼容入口：只要正文，任何失败都返回 ""（历史行为不变）。 */
export function openSlot() {
  return openSlotDetailed().text;
}
