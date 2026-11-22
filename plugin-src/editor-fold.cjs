/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Folding changes the rendered DOM without changing the document. DOM Ranges
// may remain connected while no longer covering the intended text.
function foldChanged(transactions, foldEffect, unfoldEffect) {
  return transactions.some((transaction) => transaction.effects.some((effect) => (
    (foldEffect && effect.is(foldEffect)) || (unfoldEffect && effect.is(unfoldEffect))
  )));
}

// A fold can split a token into several visible fragments. Keep the fragments
// in document order and omit the hidden portions.
function visibleSegments(from, to, visibleRanges) {
  const result = [];
  for (const range of visibleRanges) {
    const start = Math.max(from, range.from);
    const end = Math.min(to, range.to);
    if (start < end) result.push({ from: start, to: end });
  }
  return result;
}

module.exports = { foldChanged, visibleSegments };
