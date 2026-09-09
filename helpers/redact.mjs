import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

// Retain an incomplete match across stream chunks, without changing UTF-8 text.
export function redactor(secrets) {
  const values = secrets.filter(Boolean);
  let pending = '';
  const decoder = new StringDecoder('utf8');
  function consume(final) {
    let output = '';
    while (pending) {
      const match = values.find((value) => pending.startsWith(value));
      if (match) { output += '[REDACTED]'; pending = pending.slice(match.length); continue; }
      if (!final && values.some((value) => value.startsWith(pending))) break;
      output += pending[0]; pending = pending.slice(1);
    }
    return output;
  }
  return new Transform({
    transform(chunk, _, done) { pending += decoder.write(chunk); this.push(consume(false)); done(); },
    flush(done) { pending += decoder.end(); this.push(consume(true)); done(); },
  });
}
