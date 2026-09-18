'use client';

/**
 * InfoDot — 圈形 ⓘ 悬停注解（2026-09-13 老大长期规矩 #2）。
 *
 * 表单字段旁一个圆圈问号，鼠标碰一下显示该字段注解（原生 title，零依赖、零运行时开销）。
 * 用 <button type="button"> 而非 <span>：键盘 Tab 可达、读屏可读（aria-label = 注解全文）。
 * 触屏（无 hover）也点得开：title 在移动端点击时由浏览器自行处理。
 *
 * 用法：
 *   <label>
 *     场景名 {<InfoDot text="给这场对局起个名字" />}
 *   </label>
 */
export function InfoDot({ text, className = '' }: { text: string; className?: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className={
        'relative ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center ' +
        "after:absolute after:-inset-2 after:content-[''] " +
        'rounded-full border border-hairline bg-surface font-mono text-[11px] normal-case leading-none tracking-normal text-dim ' +
        'align-middle transition hover:border-ledger hover:text-ledger focus:border-ledger ' +
        'focus:text-ledger focus:outline-none ' +
        className
      }
    >
      i
    </button>
  );
}
