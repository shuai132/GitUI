// 中文（简体）翻译资源。按域组织（common / app / toolbar / sidebar / history /
// workspace / diff / branch / settings / terminal / errors / misc），内容由后续
// commit 分批填充。
const messages = {
  settings: {
    advanced: {
      uiLanguageTitle: '界面语言',
      uiLanguageAuto: '跟随系统',
      uiLanguageHint: '切换后立即生效，无需重启',
    },
  },
} as const

export default messages
export type MessageSchema = typeof messages
