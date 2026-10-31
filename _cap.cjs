const fs = require("fs");
(async () => {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const page = list.find(t => t.title === "scout-cat-pet");
  if (!page) { console.log("pet page not found"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => ws.addEventListener("open", r));

  const info = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      cw: document.querySelector('#pet').clientWidth,
      ch: document.querySelector('#pet').clientHeight,
      w: document.querySelector('#pet').width,
      h: document.querySelector('#pet').height,
      bodyW: document.body.clientWidth,
      bubble: !!document.querySelector('#bubble')
    })`,
    returnByValue: true,
  });
  console.log("canvas info:", info.result.result.value);

  const shot = await send("Runtime.evaluate", {
    expression: `document.querySelector('#pet').toDataURL('image/png')`,
    returnByValue: true,
  });
  const b64 = shot.result.result.value.split(",")[1];
  fs.writeFileSync(process.env.TEMP + "\\pet_canvas.png", Buffer.from(b64, "base64"));
  console.log("saved pet_canvas.png");
  ws.close();
})();