/** Safe client-facing API errors — never leak stacks or paths */
export function sendError(res, status, code, err) {
  if (err) {
    console.error(`[${code}]`, err?.stack || err?.message || err);
  }
  return res.status(status).json({ error: code });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default { sendError, asyncHandler };
