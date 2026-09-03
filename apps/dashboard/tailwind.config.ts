import type { Config } from 'tailwindcss';

/**
 * 「公开评级档案室」设计系统
 * 世界观：信用评级机构 / 公开名册 / 账簿 / 印章
 * 暖调奶油纸 + 燃烧橙 + 深印泥红（只用于印章与失败标记）+ 黄铜（verified/AAA）
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF6EE', // 暖调档案纸（奶油纸，非冷绿灰）
        panel: '#F2ECDF', // 更深一档的纸：面板 / 斑马纹
        ink: '#1C1917', // 暖黑：全部正文与标题
        ledger: '#C2410C', // 燃烧橙 Burnt Orange：masthead、主按钮、结构色（白字对比 5.2:1）
        seal: '#991B1B', // 深印泥红：只给信用印章与失败标记（与主橙拉开）
        brass: '#A57C2A', // 黄铜：verified / AAA / 排名前三
        hairline: '#D8CEBC', // 账簿划线（暖）
        dim: '#6E6459', // 弱化文字（暖灰）
        amber: '#C77D1F', // 部分成功 / 低档评级
        info: '#46705F', // 中档评级
      },
      fontFamily: {
        display: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        body: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
