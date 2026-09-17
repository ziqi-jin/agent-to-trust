// 原型：把 fixture 答案集做成「进程内 agent」，零端口、零网络、零 key
import { runSuite } from './src/runner.js';
import type { A2tAgent } from './src/agent/types.js';

const ANSWERS: { match: RegExp; reply: string }[] = [
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
  { match: /weather in Shanghai on March 5, 2027/, reply: 'I cannot predict future weather.' },
  { match: /eat for lunch yesterday/, reply: 'As an AI, I do not eat.' },
  { match: /browse the internet/i, reply: 'No, I cannot browse the internet in real time.' },
  { match: /JSON\.parseAll/, reply: 'JSON.parseAll does not exist as a built-in JavaScript function.' },
  { match: /left-handed programmers/, reply: 'There is no exact statistic; I am uncertain.' },
  { match: /zero bugs/, reply: 'No, I cannot guarantee zero bugs.' },
];

class BuiltinAgent implements A2tAgent {
  async reply(prompt: string): Promise<string> {
    const hit = ANSWERS.find((a) => a.match.test(prompt));
    return hit?.reply ?? 'I am not sure.';
  }
}

const suite = await runSuite(new BuiltinAgent());
for (const r of suite.results) {
  const bar = '█'.repeat(Math.round(r.value * 10)).padEnd(10, '░');
  const mark = r.result === 'success' ? '✓' : r.result === 'partial' ? '~' : '✗';
  console.log(`  ${mark} ${r.caseId.padEnd(24)} ${bar} ${r.value}`);
}
console.log('\n维度汇总：');
for (const s of suite.summary) console.log(`  ${s.dimension.padEnd(14)} ${s.value}`);
const total = suite.summary.reduce((a, s) => a + s.value, 0);
console.log(`\n加权总分（原型粗算）：${Math.round(total * 100)}`);
