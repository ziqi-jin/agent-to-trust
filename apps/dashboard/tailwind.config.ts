import type { Config } from 'tailwindcss';

/**
 * 「公开评级档案室」设计系统
 * 世界观：信用评级机构 / 公开名册 / 账簿 / 印章
 * 冷调档案纸 + 墨绿 + 印泥红（只用于印章与失败标记）+ 黄铜（verified/AAA）
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F5F6F1', // 冷调档案纸（绿灰底，非暖奶油）
        panel: '#ECEFE6', // 更深一档的纸：面板 / 斑马纹
        ink: '#17271F', // 墨绿黑：全部正文与标题
        ledger: '#2E5B4C', // 账簿绿：masthead、主按钮、结构色
        seal: '#BF3B2B', // 印泥红：只给信用印章与失败标记
        brass: '#A57C2A', // 黄铜：verified / AAA / 排名前三
        hairline: '#CBD3C1', // 账簿划线
        dim: '#5F6D62', // 弱化文字（灰绿）
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
