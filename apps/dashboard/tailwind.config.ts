import type { Config } from 'tailwindcss';

/**
 * 设计系统 v4 · 「Verification Console」
 * 世界观：公开信用名册 = 一台持续核验 Agent 的控制台。
 * 签名语言：近黑底 + 信号橙、HUD 角标框、技术网格、证据哈希、扫描线、解码文字动效、发光印章。
 * 语义色：信号橙 = 主操作 / 印章；磷光绿 = 成功；信号红 = 失败；琥珀 = 部分；金 = verified / AAA / 前三。
 * 字体均为 SIL OFL（next/font 构建期自托管），图标为 lucide（ISC）；无第三方品牌元素。
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#09090B', // 页面底（近黑）
        surface: '#111114', // 卡片层
        panel: '#18181C', // 面板 / 输入框底 / 斑马纹
        ink: '#F2F2F3', // 主文字
        dim: '#A1A1AA', // 次要文字（对 paper 对比度 ≈ 8:1）
        line: {
          DEFAULT: '#26262C', // 结构分隔线
          strong: '#3A3A42', // 卡片描边
        },
        hairline: '#26262C',
        ledger: {
          DEFAULT: '#FF6A1F', // 信号橙：主按钮、强调、印章
          dark: '#FF8A4F', // hover（深底上变亮）
          soft: '#1F120A', // 橙色浅底：选中态、提示条
        },
        seal: '#F2574D', // 信号红：失败
        brass: '#E8B84A', // 金：verified / AAA / 前三
        amber: '#F5A524', // 部分成功
        info: '#3DD68C', // 磷光绿：成功
        night: '#050506', // 终端底
      },
      fontFamily: {
        display: ['var(--font-grotesk)', 'var(--font-inter)', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        body: ['var(--font-inter)', 'system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 0 0 rgba(255,255,255,.03) inset, 0 1px 2px rgba(0,0,0,.4)',
        card: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 16px 40px -20px rgba(0,0,0,.9)',
        lift: '0 1px 0 0 rgba(255,255,255,.05) inset, 0 28px 60px -24px rgba(0,0,0,.95)',
        glow: '0 0 0 1px rgba(255,106,31,.55), 0 10px 34px -8px rgba(255,106,31,.55)',
        'glow-sm': '0 0 0 1px rgba(255,106,31,.45), 0 0 18px -4px rgba(255,106,31,.5)',
        'glow-green': '0 0 12px rgba(61,214,140,.55)',
      },
      borderRadius: {
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '14px',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        ping: {
          '75%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'grow-x': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'dash-flow': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '24px 0' },
        },
        // 表盘上电：由小到大弹出
        'dial-in': {
          '0%': { opacity: '0', transform: 'scale(0.55) rotate(-40deg)' },
          '70%': { opacity: '1' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .7s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in .5s ease-out both',
        'pop-in': 'pop-in .35s cubic-bezier(0.16,1,0.3,1) both',
        float: 'float 6s ease-in-out infinite',
        'spin-slow': 'spin-slow 40s linear infinite',
        ping: 'ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
        'grow-x': 'grow-x 1.1s cubic-bezier(0.16,1,0.3,1) both',
        blink: 'blink 1.05s step-end infinite',
        scan: 'scan 3.6s cubic-bezier(0.45,0,0.55,1) infinite',
        'dash-flow': 'dash-flow 0.9s linear infinite',
        'dial-in': 'dial-in 1.2s cubic-bezier(0.16,1,0.3,1) both',
        'spin-a': 'spin-slow 60s linear infinite',
        'spin-b': 'spin-slow 26s linear infinite reverse',
        'spin-c': 'spin-slow 14s linear infinite',
        'spin-d': 'spin-slow 40s linear infinite reverse',
        sweep: 'spin-slow 5s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
