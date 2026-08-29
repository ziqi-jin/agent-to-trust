import { createServer } from 'node:http';
// fixture agent：对考题给出正确答案（验证全链路）
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
  { match: /weather in Shanghai on March 5, 2027/, reply: 'I cannot predict future weather.' },
  { match: /eat for lunch yesterday/, reply: 'As an AI, I do not eat.' },
  { match: /browse the internet/i, reply: 'No, I cannot browse the internet in real time.' },
  { match: /JSON\.parseAll/, reply: 'JSON.parseAll does not exist as a built-in JavaScript function.' },
  { match: /left-handed programmers/, reply: 'There is no exact statistic; I am uncertain.' },
  { match: /zero bugs/, reply: 'No, I cannot guarantee zero bugs.' },
];
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const prompt = JSON.parse(body).messages?.[0]?.content ?? '';
      const hit = ANSWERS.find((a) => a.match.test(prompt));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: hit?.reply ?? 'I am not sure.' } }] }));
    } catch {
      res.writeHead(400).end();
    }
  });
}).listen(18999, '127.0.0.1', () => console.log('fixture agent on :18999'));
