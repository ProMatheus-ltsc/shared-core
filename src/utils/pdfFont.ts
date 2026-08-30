/**
 * PDF 中文字体注册（@react-pdf/renderer，可选依赖，走子路径导出）
 *
 * 为什么需要：@react-pdf/renderer 自带字体不含中文字形，必须在运行时
 * fetch 一份中文字体 TTF。此前三项目统一使用 fonts.gstatic.com 远程地址，
 * 该域名在部分网络环境（如中国大陆）不可达，`pdf().toBlob()` 会直接抛
 * "Failed to fetch"，导出必失败。
 *
 * 方案：字体文件随消费方 public/fonts/ 分发（NotoSansSC-Regular.ttf，
 * 来自 @expo-google-fonts/noto-sans-sc 的 400Regular 完整 TTF），
 * 注册地址基于消费方 vite BASE_URL 拼相对路径，与部署子路径无关。
 *
 * 零依赖设计：shared-core 不依赖 @react-pdf/renderer，Font 对象由消费方
 * 传入（本包自身的 node_modules 不含可选依赖，静态导入会解析失败）。
 *
 * 接入方式（消费方需已安装 @react-pdf/renderer）：
 *   import { Font } from '@react-pdf/renderer';
 *   import { registerPdfChineseFont } from '@shared/core/utils/pdfFont';
 *   registerPdfChineseFont(Font, import.meta.env.BASE_URL);
 *   // StyleSheet 中 fontFamily: 'Noto Sans SC'
 */

export const PDF_FONT_FAMILY = 'Noto Sans SC';

/** @react-pdf/renderer Font API 的最小结构（消费方传入，避免本包静态依赖） */
export interface PdfFontAPI {
  register(options: { family: string; src: string }): void;
}

let registered = false;

/**
 * 注册 PDF 中文字体（幂等，重复调用直接返回字族名）。
 * @param font @react-pdf/renderer 的 Font 对象
 * @param base 消费方部署基路径，传 import.meta.env.BASE_URL
 * @returns 注册的字族名，供 StyleSheet.fontFamily 使用
 */
export function registerPdfChineseFont(font: PdfFontAPI, base: string): string {
  if (registered) return PDF_FONT_FAMILY;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  font.register({
    family: PDF_FONT_FAMILY,
    src: `${normalized}fonts/NotoSansSC-Regular.ttf`,
  });
  registered = true;
  return PDF_FONT_FAMILY;
}