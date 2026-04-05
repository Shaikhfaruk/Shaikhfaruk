const { Chess } = require('chess.js');
const fs = require('fs');
const https = require('https');

const ISSUE_TITLE  = process.env.ISSUE_TITLE;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_USER   = process.env.ISSUE_USER;
const TOKEN        = process.env.GITHUB_TOKEN;
const [OWNER, REPO] = process.env.REPO.split('/');

const move = ISSUE_TITLE.replace('chess:', '').trim(); // e.g. "e2e4"

// ── Load game state ──────────────────────────────────────────
let pgn = '';
try { pgn = fs.readFileSync('chess/game.pgn', 'utf8').trim(); } catch {}

const chess = new Chess();
if (pgn) chess.loadPgn(pgn);

// ── Apply the human's move ───────────────────────────────────
let result;
try {
  result = chess.move({ from: move.slice(0,2), to: move.slice(2,4), promotion: 'q' });
} catch {
  postComment(`❌ Invalid move \`${move}\`. Please try again with a valid move!`);
  closeIssue();
  process.exit(0);
}

// ── Bot replies as black (random legal move) ─────────────────
let botMove = null;
if (!chess.isGameOver()) {
  const moves = chess.moves({ verbose: true });
  botMove = moves[Math.floor(Math.random() * moves.length)];
  chess.move(botMove);
}

// ── Save state ───────────────────────────────────────────────
fs.mkdirSync('chess', { recursive: true });
fs.writeFileSync('chess/game.pgn', chess.pgn());

// ── Generate SVG board ───────────────────────────────────────
const board = chess.board();
const unicodeMap = {
  wP:'♙', wR:'♖', wN:'♘', wB:'♗', wQ:'♕', wK:'♔',
  bP:'♟', bR:'♜', bN:'♞', bB:'♝', bQ:'♛', bK:'♚'
};

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 480" width="440" height="480">
  <rect width="440" height="480" fill="#0d1117" rx="10"/>
  <text x="220" y="28" font-family="monospace" font-size="14" fill="#34D399" text-anchor="middle" font-weight="bold">♟ Play Chess Against Faruk</text>
  <rect x="20" y="38" width="400" height="400" rx="4" fill="#0a3d2e" stroke="#34D399" stroke-width="1.5"/>`;

board.forEach((row, ri) => {
  row.forEach((sq, ci) => {
    const light = (ri + ci) % 2 === 0;
    const x = 20 + ci * 50;
    const y = 38 + ri * 50;
    svg += `<rect x="${x}" y="${y}" width="50" height="50" fill="${light ? '#34D399' : '#0a3d2e'}"/>`;
    if (sq) {
      const key = sq.color + sq.type.toUpperCase();
      const glyph = unicodeMap[key] || '?';
      const fill  = sq.color === 'w' ? '#ffffff' : '#1a1a2e';
      const size  = sq.type === 'p' ? 34 : 36;
      svg += `<text x="${x+25}" y="${y+37}" font-size="${size}" text-anchor="middle" font-family="serif" fill="${fill}">${glyph}</text>`;
    }
  });
});

// Rank & file labels
['8','7','6','5','4','3','2','1'].forEach((r,i) => {
  svg += `<text x="10" y="${63 + i*50}" font-family="monospace" font-size="11" fill="#34D399" text-anchor="middle">${r}</text>`;
});
['a','b','c','d','e','f','g','h'].forEach((f,i) => {
  svg += `<text x="${45 + i*50}" y="452" font-family="monospace" font-size="11" fill="#34D399" text-anchor="middle">${f}</text>`;
});

svg += `<text x="220" y="472" font-family="monospace" font-size="11" fill="#555" text-anchor="middle">⬛ Black = Faruk (Bot)  |  ⬜ White = You</text>`;
svg += `</svg>`;

fs.writeFileSync('chess/board.svg', svg);

// ── Append to history ────────────────────────────────────────
const histLine = `| ${chess.history().length} | @${ISSUE_USER} | \`${result.san}\`${botMove ? ` | Bot | \`${botMove.san}\`` : ''} |\n`;
try { fs.appendFileSync('chess/history.md', histLine); } catch {}

// ── Post comment & close issue ───────────────────────────────
const status = chess.isCheckmate() ? '🏆 Checkmate!' :
               chess.isDraw()      ? '🤝 Draw!'      :
               chess.isCheck()     ? '⚠️ Check!'     : '';

const comment = botMove
  ? `♟️ **@${ISSUE_USER}** played \`${result.san}\`. Bot replied with \`${botMove.san}\`. ${status}\n\nBoard updated — check the README!`
  : `♟️ **@${ISSUE_USER}** played \`${result.san}\`. ${status || 'Game over!'}`;

postComment(comment);
closeIssue();

// ── Helpers ──────────────────────────────────────────────────
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}${path}`,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'chess-bot'
      }
    }, res => { res.resume(); resolve(); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function postComment(body) {
  return apiRequest('POST', `/issues/${ISSUE_NUMBER}/comments`, { body });
}

function closeIssue() {
  return apiRequest('PATCH', `/issues/${ISSUE_NUMBER}`, { state: 'closed', labels: ['chess'] });
}
