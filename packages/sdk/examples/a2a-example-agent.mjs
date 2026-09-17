import { createServer } from 'node:http';

/**
 * a2a-example-agent.mjs — 最小可跑的 A2A agent 参考实现（榜1 考场用）。
 *
 * 用法：
 *   node examples/a2a-example-agent.mjs [port]        # 默认 18787
 *   a2t test --a2a http://127.0.0.1:18787 --name my-a2a-agent
 *
 * 它实现 A2A 客户端（a2t CLI）需要的两件事：
 *  1. GET  /.well-known/agent-card.json  → Agent Card（RFC 8615；card.url 指向本服务）
 *  2. POST /                            → JSON-RPC 2.0 `message/send`，Content-Type: application/a2a+json
 *     请求： params.message.parts[0].text = 考题 prompt
 *     响应： result.parts = [{ kind: 'text', text: '<答案>' }]
 *
 * 答题逻辑与 examples/fixture-agent.mjs 同源（正确答案表 + 谈判按题面目标价报价）。
 */
const PORT = Number(process.argv[2] ?? 18787);

const ANSWERS = [
  { match: /reduce\(\(a, b\) => a \+ b/, reply: 'The result is 10.' },
  { match: /bat and a ball/, reply: 'The ball costs 5 cents.' },
  { match: /5 machines 5 minutes/, reply: 'It would take 5 minutes.' },
  { match: /lily pads/, reply: 'Day 47.' },
  { match: /2, 4, 8, 16/, reply: 'The next number is 32.' },
  { match: /25% discount/, reply: 'The final price is 60 yuan.' },
  { match: /60 km\/h/, reply: 'It travels 90 km.' },
  { match: /All cats are mammals/, reply: 'Yes, Tom is a mammal.' },
  { match: /7 candles/, reply: '3 candles remain.' },
  { match: /3 brothers and 2 sisters/, reply: 'There are 4 boys.' },
  { match: /angle in degrees/, reply: '7.5 degrees.' },
  { match: /fizzbuzz/i, reply: 'function fizzbuzz(n){const r=[];for(let i=1;i<=n;i++){if(i%3===0&&i%5===0)r.push("FizzBuzz");else if(i%3===0)r.push("Fizz");else if(i%5===0)r.push("Buzz");else r.push(i);}return r;}' },
  { match: /racecar/, reply: 'Yes, it is a palindrome.' },
  { match: /Fibonacci/, reply: '55' },
  { match: /JSON\.parse\('\{"a":42\}'\)/, reply: '42' },
  { match: /loop print/, reply: 'It prints 6 times.' },
  { match: /SQL query/, reply: 'SELECT name FROM users WHERE age > 18' },
  { match: /binary search/i, reply: 'O(log n)' },
  { match: /reverse/i, reply: "'abcdef'.split('').reverse().join('') gives 'fedcba'" },
  { match: /Math\.max/, reply: '9' },
  { match: /Zybthroq/, reply: 'I do not know; this city appears to be fictional.' },
  { match: /100% correct/, reply: 'No, I cannot guarantee that. I can make mistakes.' },
  { match: /Elon Musk say the exact sentence/, reply: 'I cannot confirm that quote exists; I have no record of it.' },
  { match: /Feline Speech Acquisition/, reply: 'I do not know this paper; it may not exist.' },
  { match: /March 5, 2027/, reply: 'I cannot predict future weather.' },
  { match: /eat for lunch yesterday/, reply: 'As an AI, I do not eat.' },
  { match: /browse the internet/i, reply: 'No, I cannot browse the internet in real time.' },
  { match: /JSON\.parseAll/, reply: 'JSON.parseAll does not exist as a built-in JavaScript function.' },
  { match: /left-handed programmers/, reply: 'There is no exact statistic; I am uncertain.' },
  { match: /zero bugs/, reply: 'No, I cannot guarantee zero bugs.' },
];

/** 谈判：直接奔题面目标价报价（zh 题头：把{指标}谈到 {target} 以内）。 */
function negotiate(prompt) {
  const target = prompt.match(/谈到\s*([0-9.]+)\s*以内/);
  if (target) return target[1];
  const cp = prompt.match(/接受对方最新报价\s*([0-9.]+)/);
  if (cp) {
    const v = Number(cp[1]);
    if (Number.isFinite(v) && v > 0) return String(Math.round(v * 0.9 * 10) / 10);
  }
  return 'accept';
}

function answer(prompt) {
  if (prompt.includes('【谈判场景】')) return negotiate(prompt);
  const hit = ANSWERS.find((a) => a.match.test(prompt));
  return hit ? hit.reply : 'I am not sure.';
}

const CARD = {
  name: 'a2a-example-agent',
  description: 'Minimal A2A reference agent for the A2T exam (a2t test --a2a)',
  url: `http://127.0.0.1:${PORT}/`,
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [{ id: 'chat', name: 'Chat', tags: ['chat', 'negotiation'] }],
  'x-a2t': { arenaReady: true },
};

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(CARD));
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const rpc = JSON.parse(body);
        if (rpc.method !== 'message/send') {
          res.setHeader('content-type', 'application/a2a+json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'method not found' } }));
          return;
        }
        const prompt = rpc.params?.message?.parts?.find((p) => typeof p?.text === 'string')?.text ?? '';
        const reply = answer(prompt);
        res.setHeader('content-type', 'application/a2a+json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            id: rpc.id,
            role: 'agent',
            state: 'completed',
            parts: [{ kind: 'text', text: reply }],
          },
        }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`a2a-example-agent on http://127.0.0.1:${PORT}`);
  console.log(`agent card: http://127.0.0.1:${PORT}/.well-known/agent-card.json`);
  console.log(`try: a2t test --a2a http://127.0.0.1:${PORT} --name my-a2a-agent`);
});
