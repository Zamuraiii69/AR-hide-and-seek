// GET /api/config — public client settings. The LIFF id is not a secret (it is
// part of every liff.line.me URL); null means the game runs without LIFF.
const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ liffId: process.env.GAME_LIFF_ID || null });
});

module.exports = router;
